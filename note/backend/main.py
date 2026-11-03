"""note — one markdown file per note, so the folder is the data.

Every other service in this portal keeps one JSON document and saves it whole.
A note is different: bodies are long, they are edited one at a time, and the
point of a notes app is that the notes are FILES. So:

    projects/<project>/
        notes/2026-10-08-회의.md      ← a note: YAML front matter + markdown
        templates/회의록.md            ← a template: the same thing, copied on create

That folder opens in Obsidian as it is. Nothing here is a format of our own:
front matter is YAML, the body is markdown, the todos are GFM checkboxes.

Concurrency: a note carries the file's mtime as its version. A PUT sends the
`baseVersion` it read; if the file moved on, it is rejected with 409 and the
current note, rather than overwriting someone's paragraph.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from lilak_portal_auth import identity, manager, signed_in
from rackstore.store import Bin, mount_spa

DATA = Path(os.environ.get("NOTE_DATA_DIR", "./data"))
PROJECT = os.environ.get("PORTAL_PROJECT", "")
DIST = Path(os.environ.get("NOTE_DIST_DIR", "/app/note/dist"))
NOTES = DATA / "notes"
TEMPLATES = DATA / "templates"
# What a note points at: images and anything else it embeds. Obsidian keeps
# these beside the notes in the vault, and a note names one by file name alone.
FILES = DATA / "files"
# A note holds a picture or a scan, not a disk image.
MAX_FILE = 32 << 20
# A tex note's PDF is made from the note, not kept by it: it lives outside the
# project folder so it never syncs, never exports and never has to be excluded
# from either. A lost one costs one recompile.
BUILD = Path(tempfile.gettempdir()) / "note-build" / (PROJECT or "_")
TECTONIC = os.environ.get("NOTE_TECTONIC", "tectonic")
COMPILE_SECONDS = 180

app = FastAPI(title="note")

# The fields the app knows by name. Anything else in the front matter is kept
# and handed back untouched — a note may carry fields this app never heard of,
# which is how "속성 추가하기" works without a schema.
KNOWN = ("title", "date")
TODO_RE = re.compile(r"^(\s*[-*]\s+\[)([ xX])(\]\s*)(.*)$")
# `#태그` written in the body, the way Obsidian spells one. A heading is `# `
# WITH a space after the hash, so the two cannot be confused — which is why the
# tag needs no field of its own.
TAG_RE = re.compile(r"(?:^|[\s(])#(?![0-9]+(?![^\s#.,;:!?()\[\]{}'\"]))([^\s#.,;:!?()\[\]{}'\"]+)")
# `+name` names a project (project_manager's), by the same rule as a tag.
# A project's name may have spaces ("STARK + CRIB"); in text it is called with
# them, and anything else a name cannot hold, run into one `_`: `+STARK_CRIB`.
_proj_key = lambda s: re.sub(r"[\s#+.,;:!?()\[\]{}'\"_]+", "_", str(s).strip().lower()).strip("_")  # noqa: E731
PROJ_RE = re.compile(r"(?:^|[\s(])\+(?![0-9]+(?![^\s#+.,;:!?()\[\]{}'\"]))([^\s#+.,;:!?()\[\]{}'\"]+)")
# ── code is not prose ──────────────────────────────────────────────────────
_FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,})")
# A code span is a RUN of backticks closed by the same run: ``#x`` is one too.
_INLINE = re.compile(r"(`+)[^\n]*?\1")
_blank = lambda s: re.sub(r"[^\n]", " ", s)  # noqa: E731


def _no_code(text: str) -> str:
    """The body with its CODE blanked out — the same length, character for
    character, so a position in the answer is a position in the text.

    A ```fence is not a sentence: `#include` is not a tag and `+x` is not a
    project. Everything that reads the body for this app's notations reads it
    through here, inline ```#x``` with it. A fence nobody closed runs to the
    end of the note, which is markdown's own rule.
    """
    out: list = []
    open_ = ""
    for line in str(text or "").split("\n"):
        m = _FENCE.match(line)
        if open_:
            if m and m.group(1)[0] == open_[0] and len(m.group(1)) >= len(open_):
                open_ = ""
            out.append(_blank(line))
            continue
        if m:
            open_ = m.group(1)
            out.append(_blank(line))
            continue
        out.append(_INLINE.sub(lambda g: _blank(g.group(0)), line))
    return "\n".join(out)


def _sub_outside_code(rule, repl, text: str) -> str:
    """`rule` applied where the body is prose, the code left exactly as it is."""
    safe = _no_code(text)
    out: list = []
    last = 0
    for m in rule.finditer(safe):
        out.append(text[last:m.start()])
        out.append(repl(m))
        last = m.end()
    out.append(text[last:])
    return "".join(out)


# The day a box was ticked: `✓ 2026-08-04`. The vault these notes came from
# used Obsidian Tasks' `✅`, so that is still read — only what this app WRITES
# changed, to a mark that is a line rather than a picture.
DONE_RE = re.compile(r"\s*[✓✅]\s*(\d{4}-\d{2}-\d{2})")
# The day it is due, the same way. `>>2026-10-20` is the typing-friendly
# spelling of it — the editor turns one into the other as you write, and a
# file written elsewhere is read either way.
DUE_RE = re.compile(r"\s*(?:»|📅|>>)\s*(\d{4}-\d{2}-\d{2})")
# An empty line inside a checklist is written out as `- [ ] <br />`: a box with
# nothing in it, which is a blank line the person is still typing on, not a job.
BLANK_RE = re.compile(r"(?:\s|<br\s*/?>|&nbsp;)*$")


def _todo(line: str):
    """The checkbox on this line, if it has anything in it."""
    m = TODO_RE.match(line)
    return m if m and not BLANK_RE.fullmatch(m.group(4)) else None


def _todo_text(raw: str) -> tuple[str, str, str]:
    """The todo as a person wrote it, the day it is due, the day it was done."""
    done = DONE_RE.search(raw)
    due = DUE_RE.search(raw)
    text = DUE_RE.sub("", DONE_RE.sub("", raw)).strip()
    return text, (due.group(1) if due else ""), (done.group(1) if done else "")


def _todo_line(text: str, due: str, done_at: str) -> str:
    """…and back again, with the marks in the order Obsidian writes them."""
    return text + (f" » {due}" if due else "") + (f" ✓ {done_at}" if done_at else "")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _slug(title: str) -> str:
    """A filename out of a title. Korean is kept — the filesystem takes it and
    the folder is meant to be read by a person."""
    s = unicodedata.normalize("NFC", (title or "").strip())
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", s)        # what a filename cannot hold
    s = re.sub(r"\s+", " ", s).strip(" .")
    return s[:80] or "untitled"


def _split(text: str) -> tuple[dict, str]:
    """front matter, body. A file without front matter is all body."""
    if text.startswith("---\n"):
        end = text.find("\n---", 3)
        if end != -1:
            head = text[4:end]
            body = text[end + 4:].lstrip("\n")
            try:
                meta = yaml.safe_load(head) or {}
            except Exception:
                meta = {}
            if isinstance(meta, dict):
                return meta, body
    return {}, text


def _join(meta: dict, body: str) -> str:
    clean = {}
    for k, v in meta.items():
        if v in (None, "", [], {}):
            continue
        # A date written as a date, not as a quoted string: it is what the file
        # looks like in Obsidian and in any other reader of this folder.
        if k == "date" and isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            v = date.fromisoformat(v)
        clean[k] = v
    head = yaml.safe_dump(clean, allow_unicode=True, sort_keys=False).strip()
    return f"---\n{head}\n---\n\n{body.lstrip()}\n" if head else body.lstrip() + "\n"


def _as_tags(v: Any) -> list:
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    return [t.strip() for t in str(v or "").replace(",", " ").split() if t.strip()]


def _path(note_id: str) -> Path:
    """`note_id` is the file's stem. It never leaves the notes folder."""
    if not note_id or "/" in note_id or "\\" in note_id or note_id.startswith("."):
        raise HTTPException(400, "잘못된 노트 이름입니다.")
    p = (NOTES / f"{note_id}.md").resolve()
    if not str(p).startswith(str(NOTES.resolve())):
        raise HTTPException(400, "잘못된 노트 이름입니다.")
    return p


def _read(p: Path) -> dict:
    text = p.read_text(encoding="utf-8")
    meta, body = _split(text)
    extra = {k: v for k, v in meta.items() if k not in KNOWN}
    d = meta.get("date")
    # Tags live in the BODY and nowhere else: `#태그`, which is both Obsidian's
    # spelling and the only place a reader of the file would look. A `tags:`
    # key someone leaves in the front matter is kept as an ordinary field, not
    # read as tags — two places to write one thing is how they disagree.
    tags = []
    for m in TAG_RE.finditer(_no_code(body)):
        if m.group(1) not in tags:
            tags.append(m.group(1))
    return {
        "id": p.stem,
        "title": str(meta.get("title") or p.stem),
        "date": (d.isoformat() if isinstance(d, (date, datetime)) else str(d or "")),
        "tags": tags,
        "fields": extra,
        "body": body,
        # A STRING on purpose: st_mtime_ns is ~1.8e18, past JavaScript's safe
        # integer range, so a client that parsed it as a number handed back a
        # rounded value and every save looked like someone else's edit.
        "version": str(p.stat().st_mtime_ns),
        "bytes": p.stat().st_size,
    }


def _summary(n: dict) -> dict:
    """What the LIST needs. The body goes only as far as a first line, so a
    folder of long notes still lists in one small response."""
    first = next((ln.strip() for ln in n["body"].splitlines()
                  if ln.strip() and not ln.startswith("#")), "")
    todos = [m for m in (_todo(ln) for ln in n["body"].splitlines()) if m]
    return {
        "id": n["id"], "title": n["title"], "date": n["date"], "tags": n["tags"],
        "fields": n["fields"], "excerpt": first[:160], "version": n["version"],
        "words": len(n["body"].split()), "bytes": n["bytes"],
        "todo": sum(1 for m in todos if m.group(2) == " "),
        "done": sum(1 for m in todos if m.group(2) != " "),
    }


def _all(folder: Path) -> list:
    if not folder.is_dir():
        return []
    out = []
    for p in sorted(folder.glob("*.md")):
        try:
            out.append(_read(p))
        except Exception:
            continue          # a file we cannot read is not a reason to show nothing
    return out


class SaveBody(BaseModel):
    baseVersion: Optional[str] = None
    title: Optional[str] = None
    date: Optional[str] = None
    fields: Optional[dict] = None
    body: Optional[str] = None


class NewBody(BaseModel):
    title: str = ""
    template: Optional[str] = None


class TodoBody(BaseModel):
    id: str
    line: int
    done: bool
    text: Optional[str] = None     # what the line said when it was read
    due: Optional[str] = None      # '' clears it, None leaves it alone


@app.get("/api/notes")
def list_notes(_: dict = Depends(signed_in)) -> dict:
    notes = [_summary(n) for n in _all(NOTES)]
    return {"notes": notes, "templates": [n["id"] for n in _all(TEMPLATES)],
            "project": PROJECT, "updatedAt": _now()}


@app.get("/api/notes/{note_id}")
def get_note(note_id: str, _: dict = Depends(signed_in)) -> dict:
    p = _path(note_id)
    if not p.is_file():
        raise HTTPException(404, "그 노트가 없습니다.")
    # When this note's PDF was made, if it has one — so the editor can offer
    # to show it, and can tell whether it is still the note (its stamp is
    # later than the note's own `version`, which is the file's).
    return {**_read(p), "pdf_at": _pdf_at(note_id)}


@app.post("/api/notes", status_code=201)
def new_note(body: NewBody, _: dict = Depends(signed_in)) -> dict:
    title = body.title.strip() or "제목 없음"
    meta, text = {"title": title, "date": date.today().isoformat()}, ""
    if body.template:
        tp = (TEMPLATES / f"{body.template}.md")
        if tp.is_file():
            tmeta, text = _split(tp.read_text(encoding="utf-8"))
            tmeta.pop("title", None)
            # The template's own #tags come along in its body, where they live.
            meta = {**{"title": title, "date": date.today().isoformat()}, **tmeta}
    stem = f"{meta['date']}-{_slug(title)}"
    p = _path(stem)
    n = 2
    while p.exists():                       # two notes may share a title on a day
        p = _path(f"{stem}-{n}")
        n += 1
    _atomic_write(p, _join(meta, text))
    return _read(p)


@app.put("/api/notes/{note_id}")
def put_note(note_id: str, body: SaveBody, _: dict = Depends(signed_in)):
    p = _path(note_id)
    if not p.is_file():
        raise HTTPException(404, "그 노트가 없습니다.")
    cur = _read(p)
    if body.baseVersion is not None and body.baseVersion != cur["version"]:
        return JSONResponse(status_code=409, content={
            "detail": "이 노트가 그 사이에 바뀌었습니다. 최신 내용을 불러옵니다.",
            "current": cur})
    meta = {
        "title": cur["title"] if body.title is None else body.title.strip(),
        "date": cur["date"] if body.date is None else body.date.strip(),
        **(cur["fields"] if body.fields is None else body.fields),
    }
    _atomic_write(p, _join(meta, cur["body"] if body.body is None else body.body))
    return _read(p)


# A note deleted waits in the rack services' one bin (rackstore's Bin), 30
# days, to be brought back from the trash tab — the file as it was.
BIN = Bin(DATA, days=30)


@app.delete("/api/notes/{note_id}")
def delete_note(note_id: str, me: dict = Depends(signed_in)) -> dict:
    p = _path(note_id)
    if p.is_file():
        n = _read(p)
        BIN.put("notes", note_id, {"record": {"id": note_id, "title": n["title"], "date": n["date"]},
                                   "text": p.read_text(encoding="utf-8")},
                me.get("email") or me.get("username") or "")
        p.unlink()
    return {"ok": True, "id": note_id}


def _restore(key: str, rid: str, entry: dict, me: dict) -> dict:
    """A note back from the bin, under its own name — unless a note of that name
    has been made since, which this would overwrite."""
    if key != "notes":
        raise HTTPException(400, "되살릴 수 없는 종류입니다.")
    p = _path(rid)
    if p.exists():
        raise HTTPException(409, "같은 이름의 노트가 이미 있습니다.")
    p.write_text(entry.get("text") or "", encoding="utf-8")
    return {"ok": True, "id": rid}


BIN.mount(app, _restore)


@app.get("/api/tags")
def tags(_: dict = Depends(signed_in)) -> dict:
    """The tags the notes wear, with how many notes wear each — what the rack
    services offer as you type one (they answer the same here, and note asks them)."""
    n: dict = {}
    for note in _all(NOTES):
        for t in note["tags"]:
            n[t] = n.get(t, 0) + 1
    return {"tags": n}


@app.post("/api/tags/rename")
def rename_tags(body: dict, _: dict = Depends(signed_in)) -> dict:
    """Every `#tag` in `from` (any case) becomes `#to`, in every note — the
    text is the only place a tag lives. Renaming one tag, or merging several;
    project_manager asks every service in turn. An empty `to` deletes the
    tag: its `#` goes, the word stays (the sentence still reads)."""
    gone = {str(t).strip().lower() for t in body.get("from") or [] if str(t).strip()}
    to = str(body.get("to") or "").strip()
    if not gone or re.search(r"[\s#]", to):
        raise HTTPException(400, "바꿀 태그와 새 이름(띄어쓰기 없이)이 필요합니다.")
    lead = re.compile(r"(^|[\s(])#(?![0-9]+(?![^\s#.,;:!?()\[\]{}'\"]))([^\s#.,;:!?()\[\]{}'\"]+)")
    n = 0
    for p in sorted(NOTES.glob("*.md")):
        text = p.read_text(encoding="utf-8")
        m = re.match(r"---\n.*?\n---\n", text, re.S)
        head, rest = (text[:m.end()], text[m.end():]) if m else ("", text)
        new = _sub_outside_code(
            lead,
            lambda x: f"{x.group(1)}{'#' + to if to else x.group(2)}" if x.group(2).lower() in gone else x.group(0),
            rest)
        if new != rest:
            _atomic_write(p, head + new)
            n += 1
    return {"changed": n}


@app.get("/api/tagged")
def tagged(tag: str = "", project: str = "", _: dict = Depends(signed_in)) -> dict:
    """The notes wearing `tag` (any case), and the todos written with it — what
    project_manager gathers from every service. With `project` instead, the
    ones that name it (`+STARK`)."""
    rule, want = (PROJ_RE, _proj_key(project)) if project.strip() else (TAG_RE, tag.strip().lower())
    hit = (lambda m: _proj_key(m.group(1)) == want) if rule is PROJ_RE else (lambda m: m.group(1).lower() == want)
    out = []
    for note in _all(NOTES):
        if want and (any(t.lower() == want for t in note["tags"]) if rule is TAG_RE
                     else any(hit(m) for m in PROJ_RE.finditer(_no_code(note["body"])))):
            out.append({"key": "notes", "rec": {"id": note["id"], "title": note["title"], "date": note["date"]}})
        for i, ln in enumerate(note["body"].splitlines()):
            m = _todo(ln)
            if not m:
                continue
            text, due, at = _todo_text(m.group(4))
            if want and any(hit(t) for t in rule.finditer(text)):
                out.append({"key": "todos", "rec": {"id": note["id"], "title": note["title"], "line": i,
                                                    "text": text, "done": m.group(2) != " ", "due": due}})
    return {"items": out}


@app.get("/api/todos")
def todos(_: dict = Depends(signed_in)) -> dict:
    """Every GFM checkbox in every note. Collected, never stored — the line in
    the note is the only copy, so a box ticked here is ticked there."""
    out = []
    for n in _all(NOTES):
        for i, ln in enumerate(n["body"].splitlines()):
            m = _todo(ln)
            if m:
                text, due, at = _todo_text(m.group(4))
                # The tags of the LINE, not of the note: a todo wears what was
                # written on it, which is the only way a list of them can be
                # told apart.
                out.append({"id": n["id"], "title": n["title"], "date": n["date"],
                            "tags": [t.group(1) for t in TAG_RE.finditer(text)],
                            "line": i, "done": m.group(2) != " ",
                            "due": due, "doneAt": at, "text": text})
    return {"todos": out}


@app.put("/api/todos")
def set_todo(body: TodoBody, _: dict = Depends(signed_in)):
    p = _path(body.id)
    if not p.is_file():
        raise HTTPException(404, "그 노트가 없습니다.")
    n = _read(p)
    lines = n["body"].splitlines()
    if not 0 <= body.line < len(lines):
        raise HTTPException(409, "그 줄이 더 이상 없습니다 — 노트를 다시 읽어주세요.")
    m = TODO_RE.match(lines[body.line])
    # The line must still BE the todo it was: a note edited elsewhere must not
    # have a checkbox stamped onto whatever moved into that position.
    text, due, _ = _todo_text(m.group(4)) if m else ("", "", "")
    if not m or (body.text is not None and text != body.text.strip()):
        raise HTTPException(409, "그 줄이 바뀌었습니다 — 노트를 다시 읽어주세요.")
    # Ticked here, dated here; unticked, the date goes with it. A due date the
    # line already carried is not ours to drop.
    if body.due is not None:
        due = body.due.strip()
    done_at = date.today().isoformat() if body.done else ""
    rest = _todo_line(text, due, done_at)
    lines[body.line] = f"{m.group(1)}{'x' if body.done else ' '}{m.group(3)}{rest}"
    _atomic_write(p, _join({"title": n["title"], "date": n["date"], **n["fields"]},
                           "\n".join(lines)))
    return {"ok": True, "id": body.id, "line": body.line, "done": body.done,
            "due": due, "doneAt": done_at}


@app.get("/api/search")
def search(q: str = "", _: dict = Depends(signed_in)) -> dict:
    """Body search, which the list cannot do — it only carries a first line.
    A title counts too: a caller with only this search (the MCP tool) would
    otherwise miss the note it is about to write a second time."""
    needle = q.strip().lower()
    if not needle:
        return {"hits": []}
    hits = []
    for n in _all(NOTES):
        for i, ln in enumerate(n["body"].splitlines()):
            if needle in ln.lower():
                hits.append({"id": n["id"], "title": n["title"], "line": i,
                             "text": ln.strip()[:160]})
                break
        else:
            if needle in n["title"].lower():
                hits.append({"id": n["id"], "title": n["title"], "text": ""})
    return {"hits": hits}


def _files(note: str = "") -> Path:
    """Where a note's files live.

    A markdown note shares the project's files folder: that folder is a vault,
    `![[a.png]]` names one file in it, and two notes showing the same picture
    should be showing the same file.

    A tex note gets a folder of its own (`files/<note>/`), with the shape a
    manuscript has — `img/`, `section/`, `style/`, the `.bib` at the top — and
    the compile copies the whole tree around `main.tex`. Its own, because two
    papers that each have an `img/fig1.pdf` must not be one file.
    """
    if not note:
        return FILES
    if "/" in note or "\\" in note or note.startswith("."):
        raise HTTPException(400, "잘못된 노트 이름입니다.")
    return FILES / note


@app.get("/api/files")
def list_files(note: str = "", _: dict = Depends(signed_in)) -> dict:
    """What this note keeps beside it, as paths — `img/fig1.png`.

    A tex note's folder is a tree now (`_safe_rel`), and a tree nobody can see
    is a tree you guess at: which pictures arrived with the zip, whether the
    `.bib` the body asks for is the one that is there. The folder itself is a
    click away (`/api/reveal`), but that is the host's file manager, and the
    note may be read from another machine."""
    root = _files(note)
    if not root.is_dir():
        return {"files": []}
    out = [{"name": f.relative_to(root).as_posix(), "bytes": f.stat().st_size}
           for f in root.rglob("*") if f.is_file() and not f.name.startswith(".")]
    out.sort(key=lambda x: x["name"])
    return {"files": out}


@app.get("/api/file/{name:path}")
def get_file(name: str, note: str = "", _: dict = Depends(signed_in)):
    """A file a note embeds — `![[name.png]]` in a markdown note, which is
    Obsidian's spelling, or `img/fig1.png` in a tex note, which keeps its files
    in folders (`_safe_rel`). Either way it never leaves the project's files
    folder: the path is resolved and then checked to be inside it, so a
    symlink is no way out either.

    `note` asks that note's own folder first (a tex note), and the shared
    folder after it, so a picture already in the vault still shows."""
    if not name or name.startswith((".", "/")) or ".." in name.replace("\\", "/").split("/"):
        raise HTTPException(400, "잘못된 파일 이름입니다.")
    root = FILES.resolve()
    for base in ([_files(note), FILES] if note else [FILES]):
        p = (base / name).resolve()
        if p.is_relative_to(root) and p.is_file():
            return FileResponse(p)
    raise HTTPException(404, "그 파일이 없습니다.")


def _pdf_at(note_id: str) -> str:
    """When this note's PDF was last written, as a string of nanoseconds — the
    same clock and the same shape as a note's `version`, so the two compare.
    Empty when there is no PDF."""
    p = BUILD / f"{note_id}.pdf"
    return str(p.stat().st_mtime_ns) if p.is_file() else ""


def _tex_body(note_id: str) -> str:
    """The note as LaTeX. The front matter is NOT part of the document — the
    body alone is `main.tex`, which is also why an error's line number is the
    line the editor shows."""
    p = _path(note_id)
    if not p.is_file():
        raise HTTPException(404, "그런 노트가 없습니다.")
    meta, body = _split(p.read_text(encoding="utf-8"))
    if str(meta.get("format", "")).lower() != "tex":
        raise HTTPException(400, "LaTeX 노트가 아닙니다 (앞머리에 format: tex).")
    return body


# `error: main.tex:12: …` — the line of the note the engine stopped on.
TEX_AT = re.compile(r"\bmain\.tex:(\d+):\s*(.*)")


@app.post("/api/compile/{note_id}")
def compile_note(note_id: str, _: dict = Depends(signed_in)) -> dict:
    r"""The note, typeset. Its body is written out as `main.tex` and its files
    folder is copied around it, folders and all — which is why a tex note has a
    folder of its own, and why `\includegraphics{img/fig1.pdf}` means the path
    it says.

    `--untrusted` is the point: no shell-escape, nothing read from outside the
    folder we just made. The document is text from a browser."""
    body = _tex_body(note_id)
    exe = shutil.which(TECTONIC)
    if not exe:
        raise HTTPException(501, "이 서버에는 tectonic이 없습니다.")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        src = _files(note_id)
        if src.is_dir():
            shutil.copytree(src, work, dirs_exist_ok=True)
        # After the files, so a `main.tex` sitting in the folder cannot win
        # over the note: the note IS the document.
        (work / "main.tex").write_text(body, encoding="utf-8")
        try:
            r = subprocess.run([exe, "--untrusted", "main.tex"], cwd=work,
                               capture_output=True, text=True,
                               timeout=COMPILE_SECONDS)
            log, code = (r.stderr or "") + (r.stdout or ""), r.returncode
        except subprocess.TimeoutExpired:
            log, code = f"{COMPILE_SECONDS}초 안에 끝나지 않았습니다.", 1
        pdf = work / "main.pdf"
        ok = code == 0 and pdf.is_file()
        if ok:
            BUILD.mkdir(parents=True, exist_ok=True)
            shutil.copy(pdf, BUILD / f"{note_id}.pdf")
    # Only what went wrong: a LaTeX run says thousands of words about boxes
    # being a little too wide, and none of them is why the PDF is missing.
    bad = [ln for ln in log.splitlines() if ln.startswith("error:")]
    errors = []
    for ln in bad:
        m = TEX_AT.search(ln)
        errors.append({"line": int(m.group(1)), "text": m.group(2)} if m
                      else {"line": 0, "text": ln[len("error:"):].strip()})
    return {"ok": ok, "errors": errors, "log": log[-8000:], "pdf_at": _pdf_at(note_id)}


@app.get("/api/pdf/{note_id}")
def get_pdf(note_id: str, _: dict = Depends(signed_in)):
    """The PDF the last compile left. It is not the note — a note whose PDF is
    gone is a note that has not been compiled on this server yet."""
    _path(note_id)                      # the name is a note's, not a path
    p = BUILD / f"{note_id}.pdf"
    if not p.is_file():
        raise HTTPException(404, "아직 컴파일하지 않았습니다.")
    return FileResponse(p, media_type="application/pdf")


@app.get("/api/where")
def where(note: str = "", _: dict = Depends(signed_in)) -> dict:
    """Where this project keeps what it is made of — the folders behind the
    notes and their files, so the app can say it rather than make you guess."""
    return {"project": PROJECT, "notes": str(NOTES), "files": str(_files(note))}


@app.post("/api/reveal")
def reveal(note: str = "", _: dict = Depends(manager)) -> dict:
    """Show the files folder in the host's own file manager. The portal spawns
    this service on the machine it runs on, so 'the host' is that machine — in
    a container, or behind a portal somewhere else, there is nothing to open
    and the caller is told so rather than left waiting."""
    folder = _files(note)
    folder.mkdir(parents=True, exist_ok=True)
    opener = {"darwin": "open", "win32": "explorer"}.get(sys.platform, "xdg-open")
    try:
        subprocess.Popen([opener, str(folder)],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        raise HTTPException(501, "이 서버에서는 폴더를 열 수 없습니다.")
    return {"path": str(folder)}


# Where a kind of file belongs in a tex note's folder. A manuscript is a
# structure, not a heap — a picture goes in `img/`, a class or a style in
# `style/`, a chapter in `section/`, and the `.bib` stays at the top because
# `\bibliography{reference}` is where everyone writes it. Decided by what the
# file IS, so nothing has to be asked at the drop.
TEX_DIRS = {".png": "img", ".jpg": "img", ".jpeg": "img", ".gif": "img",
            ".pdf": "img", ".eps": "img", ".ps": "img", ".svg": "img",
            ".sty": "style", ".cls": "style", ".bst": "style",
            ".tex": "section"}


@app.post("/api/file")
async def put_file(f: UploadFile = File(...), note: str = "", replace: bool = False,
                   _: dict = Depends(signed_in)):
    """A file dropped into a note. A markdown note's lands beside the notes
    under its own name, the way a vault keeps it; a tex note's goes into the
    folder its kind belongs in (`TEX_DIRS`). Either way a name already taken
    grows a number rather than overwriting someone else's picture, and the
    answer is the path the document should point at.

    `replace` writes over the name instead — for a file this app generates and
    regenerates (a .bib made from reference_manager), where a second copy
    under a second name is not a kept picture, it is the wrong bibliography."""
    raw = await f.read(MAX_FILE + 1)
    if len(raw) > MAX_FILE:
        raise HTTPException(413, f"파일이 너무 큽니다 ({MAX_FILE // (1 << 20)}MB까지).")
    name = _slug(Path(f.filename or "file").name) or "file"
    # `\includegraphics{img/drop test.png}` is a fight nobody wins. A vault
    # keeps the name it was given; a manuscript gets one LaTeX can write.
    if note:
        name = re.sub(r"\s+", "-", name)
    stem, ext = os.path.splitext(name)
    sub = TEX_DIRS.get(ext.lower(), "") if note else ""
    folder = _files(note) / sub
    folder.mkdir(parents=True, exist_ok=True)
    n = 1
    while not replace and (folder / name).exists():
        name = f"{stem}-{n}{ext}"
        n += 1
    (folder / name).write_bytes(raw)
    out = _pdfify(folder / name) or name
    return {"name": f"{sub}/{out}" if sub else out}


def _pdfify(p: Path) -> str:
    """PostScript, turned into a PDF beside itself — and the PDF's name, which
    is the one a document should point at.

    Tectonic cannot place an EPS at all: not a shell-escape rule, the PDF
    writer simply has no PostScript in it. So the conversion happens once, when
    the file arrives, rather than on every compile. The original is kept — it
    is what was handed to us. No ghostscript on this host means the file stays
    as it is and the compile says which picture it could not read."""
    if p.suffix.lower() not in (".eps", ".ps"):
        return ""
    gs = shutil.which("gs")
    if not gs:
        return ""
    out = p.with_suffix(".pdf")
    r = subprocess.run([gs, "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dEPSCrop",
                        "-sDEVICE=pdfwrite", f"-sOutputFile={out}", str(p)],
                       capture_output=True, timeout=120)
    return out.name if r.returncode == 0 and out.is_file() else ""


# What a LaTeX project carries that is not part of it: what a previous run
# left behind, and what a Mac puts in a zip.
TEX_JUNK = (".aux", ".log", ".out", ".bbl", ".blg", ".toc", ".lof", ".lot",
            ".fls", ".fdb_latexmk", ".synctex.gz", ".spl", ".nav", ".snm")
# A manuscript, not an archive of a disk. Both caps are on what comes OUT of
# the zip: a few hundred kilobytes can declare terabytes.
ZIP_MEMBERS, ZIP_BYTES = 500, 128 << 20
# `@article{ELARK2026,` — a cite key, as a .bib writes one.
BIB_KEY = re.compile(r"^\s*@\w+\s*\{\s*([^\s,{}]+)\s*,", re.M)


def _safe_rel(rel: str) -> str:
    """A path inside the note's folder, out of a path we were handed.

    A tex note's files keep the shape the manuscript gave them — `img/fig1.png`
    is what the body already writes, and rewriting it to a flat name was work
    nobody asked for. So the folders are kept and only cleaned: every part
    slugged, `.` and `..` dropped, nothing resolved against the filesystem. A
    zip member called `../../etc/passwd` is a file at `etc/passwd` here, and
    one called `a/../b.tex` is `a/b.tex`."""
    parts = [_slug(s) for s in str(rel).replace("\\", "/").split("/")
             if s not in ("", ".", "..")]
    return "/".join(parts[-8:]) or "file"      # a manuscript is not a disk


def _rewrite(body: str, moved: dict) -> tuple[str, int]:
    r"""The document, pointing at where its pictures actually are now.

    Only an EPS moves (`_pdfify`) — an import keeps every other path as the
    manuscript wrote it. A path is rewritten with its extension
    (`img/fig1.eps`) and without it, because `\includegraphics{img/fig1}` is
    how most manuscripts write one. Longest first: `fig/a.eps` must not be
    half-replaced by `a.eps`."""
    n = 0
    for rel in sorted(moved, key=len, reverse=True):
        flat = moved[rel]
        for a, b in ((rel, flat), (os.path.splitext(rel)[0], os.path.splitext(flat)[0])):
            if not a or a == b:
                continue
            for pre in ("./", ""):
                if pre + a in body:
                    body = body.replace(pre + a, b)
                    n += 1
    return body, n


@app.post("/api/import/{note_id}")
async def import_zip(note_id: str, f: UploadFile = File(...),
                     _: dict = Depends(signed_in)) -> dict:
    r"""A LaTeX manuscript, as it comes off a journal or a co-author: one zip
    with `main.tex`, a folder of pictures and a `.bib`.

    It becomes THIS note — the tex is the body, everything else lands in the
    note's own files folder AS IT CAME, folders and all, placed relative to
    where the main tex sat. So the paths the body already writes keep working
    and the body is not touched (except for an EPS, which no engine can place).
    The zip's paths are cleaned, never trusted: see `_safe_rel`."""
    p = _path(note_id)
    if not p.is_file():
        raise HTTPException(404, "그 노트가 없습니다.")
    raw = await f.read(MAX_FILE + 1)
    if len(raw) > MAX_FILE:
        raise HTTPException(413, f"파일이 너무 큽니다 ({MAX_FILE // (1 << 20)}MB까지).")
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
        members = [i for i in z.infolist() if not i.is_dir()]
    except zipfile.BadZipFile:
        raise HTTPException(400, "zip 파일이 아닙니다.")
    if len(members) > ZIP_MEMBERS or sum(i.file_size for i in members) > ZIP_BYTES:
        raise HTTPException(413, "zip 안이 너무 큽니다.")

    def keep(i) -> bool:
        name = Path(i.filename).name
        return not (name.startswith(".") or "__MACOSX" in i.filename
                    or i.filename.lower().endswith(TEX_JUNK))

    members = [i for i in members if keep(i)]
    texs = [i for i in members if i.filename.lower().endswith(".tex")]
    if not texs:
        raise HTTPException(400, "zip 안에 .tex 파일이 없습니다.")
    # The document, not something it includes: the one that declares a class.
    # Failing that `main.tex`, failing that the shallowest .tex there is.
    main = next((i for i in texs if rb"\documentclass" in z.read(i)), None) \
        or next((i for i in texs if Path(i.filename).name.lower() == "main.tex"), None) \
        or min(texs, key=lambda i: (i.filename.count("/"), i.filename))

    folder = _files(note_id)
    folder.mkdir(parents=True, exist_ok=True)
    # Everything is placed relative to where the main tex sat: a zip that is
    # one folder (`paper/main.tex`, `paper/img/fig1.png`) becomes that folder's
    # contents, so `img/fig1.png` is still `img/fig1.png` to the body.
    base = Path(main.filename).parent.as_posix()
    base = "" if base in (".", "/") else base + "/"
    moved, kept = {}, []
    for i in members:
        if i is main:
            continue
        said = i.filename[len(base):] if i.filename.startswith(base) else i.filename
        rel = _safe_rel(said)
        at = folder / rel
        at.parent.mkdir(parents=True, exist_ok=True)
        at.write_bytes(z.read(i))
        kept.append(rel)
        # An EPS cannot be placed at all (see `_pdfify`), so the document is
        # pointed at the PDF made from it instead. That is the ONLY thing the
        # import rewrites — every other path is already right.
        pdf = _pdfify(at)
        if pdf:
            to = (Path(rel).parent / pdf).as_posix()
            moved[said] = to
            if rel != said:
                moved[rel] = to

    body, rewrote = _rewrite(z.read(main).decode("utf-8", "replace"), moved)
    keys = sorted({k for i in members if i.filename.lower().endswith(".bib")
                   for k in BIB_KEY.findall(z.read(i).decode("utf-8", "replace"))})
    cur = _read(p)
    # The note keeps its name, its date and whatever else it carried; the
    # import only decides what it IS (a tex document) and what it says.
    meta = {"title": cur["title"], "date": cur["date"], **cur["fields"], "format": "tex"}
    _atomic_write(p, _join(meta, body))
    # `pdf_at` the way a note read carries it: the PDF on disk is now older
    # than the note, which is exactly what the editor needs to know.
    return {**_read(p), "pdf_at": _pdf_at(note_id), "main": main.filename,
            "files": sorted(set(kept)), "rewrote": rewrote, "bib_keys": keys}


def _braced(text: str, at: int) -> str:
    """The `{…}` that begins at `at`, nested braces and all.

    A bibtex title is full of them — `title = {The {ELARK} array}` — and a
    non-greedy regex stops at the first `}`, which is half a title."""
    depth, out = 0, []
    for ch in text[at:]:
        if ch == "{":
            depth += 1
            if depth == 1:
                continue
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        out.append(ch)
    return re.sub(r"\s+", " ", "".join(out)).strip()


TITLE_AT = re.compile(r"\btitle\s*=\s*\{", re.I)


@app.get("/api/bib/{note_id}")
def bib(note_id: str, _: dict = Depends(signed_in)) -> dict:
    r"""Every cite key this note's own `.bib` files define.

    These are the keys that will actually resolve when the note compiles —
    reference_manager may hold a thousand more, but a `\cite{}` the bib has
    never heard of comes out of the PDF as a `?`."""
    folder = _files(note_id)
    out = {}
    for f in sorted(folder.rglob("*.bib")) if folder.is_dir() else []:
        text = f.read_text(encoding="utf-8", errors="replace")
        hits = list(BIB_KEY.finditer(text))
        for i, m in enumerate(hits):
            end = hits[i + 1].start() if i + 1 < len(hits) else len(text)
            t = TITLE_AT.search(text, m.end(), end)
            out.setdefault(m.group(1), _braced(text, t.end() - 1)[:120] if t else "")
    return {"keys": [{"key": k, "title": v} for k, v in sorted(out.items())]}


@app.get("/api/whoami")
def whoami(me: dict = Depends(identity)) -> dict:
    return {**me, "project": PROJECT}


# ── Static SPA (must stay last: the catch-all would shadow /api/*) ────────────
mount_spa(app, DIST, name="note")
