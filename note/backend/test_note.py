"""The tex note's two rules, checked. Run: python backend/test_note.py

A tex note's folder is named by the note id, which comes from the client —
so the one thing worth a test is that an id can never point outside the
project's files folder.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("NOTE_DATA_DIR", "/tmp/note-test-data")

from fastapi import HTTPException            # noqa: E402
from backend.main import (AUTH_RE, BIB_KEY, FILES, PROJ_RE, TAG_RE, TEX_AT,            # noqa: E402
                          _braced, _files, _name_key, _no_code, _proj_key, _rewrite, _safe_rel,
                          _sub_outside_code)

# ── code is not prose: `#include` in a fence is not a tag ─────────────────
_code = """#real

```c++
#include <vector>      // #notatag +notaproject
```

~~~
#tilde
~~~

#after and `#inline` and ``#double`` done
"""
assert len(_no_code(_code)) == len(_code), "a blank keeps the text's shape"
assert [m.group(1) for m in TAG_RE.finditer(_no_code(_code))] == ["real", "after"]
assert [m.group(1) for m in PROJ_RE.finditer(_no_code(_code))] == []
# The fence itself, and the prose around it, come back untouched by a rename.
_ren = _sub_outside_code(TAG_RE, lambda m: f"{m.group(0)}!", _code)
assert "#include <vector>      // #notatag" in _ren and "#real!" in _ren and "#after!" in _ren
assert "`#inline`" in _ren, "inline code is code too"
# A fence nobody closed runs to the end, which is markdown's own rule.
assert [m.group(1) for m in TAG_RE.finditer(_no_code("#a\n```\n#b\n#c"))] == ["a"]
# An indented fence closes with its own mark.
assert [m.group(1) for m in TAG_RE.finditer(_no_code("  ```\n#in\n  ```\n#out"))] == ["out"]


# A markdown note shares the vault's one folder; a tex note gets its own.
assert _files() == FILES
assert _files("2026-10-31-paper") == FILES / "2026-10-31-paper"

for bad in ("..", "../..", "a/b", "a\\b", ".hidden", "../../etc"):
    try:
        _files(bad)
    except HTTPException:
        continue
    raise AssertionError(f"accepted {bad!r}")

# What an error line says, and which line of the NOTE it happened on — the
# body is main.tex, so the engine's line number is the editor's.
m = TEX_AT.search("error: main.tex:298: Unable to load picture or PDF file 'fig.pdf'")
assert m and int(m.group(1)) == 298, m
assert m.group(2) == "Unable to load picture or PDF file 'fig.pdf'", m.group(2)
assert TEX_AT.search("error: pdf: image inclusion failed for \"a.eps\" (page=1).") is None

# `+STARK` names a project; `C++`, a bullet `+ `, a number `+3` do not.
assert [m.group(1) for m in PROJ_RE.finditer("+STARK 와 (+ELARK), C++ a+b\n+ 목록 +3 명")] == ["STARK", "ELARK"]

# A name with spaces is called with them run into `_`.
assert _proj_key("STARK + CRIB") == _proj_key("stark_crib") == "stark_crib"
assert _proj_key("TAMU TeXAT 실험") == "tamu_texat_실험"

# A zip keeps its own layout: `img/fig1.png` is what the body already writes.
# The parts are cleaned, and a path that tries to leave the folder cannot.
for rel, want in (("img/fig1.png", "img/fig1.png"),
                  ("Pictures/sub/a.pdf", "Pictures/sub/a.pdf"),
                  ("a/../b.tex", "a/b.tex"),
                  ("./main.tex", "main.tex"),
                  ("sec\\intro.tex", "sec/intro.tex"),
                  ("../../etc/passwd", "etc/passwd"),
                  ("..", "file"), ("", "file"),
                  ("/abs/x.png", "abs/x.png")):
    got = _safe_rel(rel)
    assert got == want, (rel, got, want)
# Deep enough to be a disk and not a manuscript: only the tail is kept.
assert _safe_rel("/".join("abcdefghijkl") + "/x.png").count("/") == 7

# A tex note's drop goes where its kind belongs; a markdown note's stays flat.
from backend.main import TEX_DIRS            # noqa: E402
assert TEX_DIRS[".png"] == "img" and TEX_DIRS[".sty"] == "style"
assert TEX_DIRS[".tex"] == "section" and ".bib" not in TEX_DIRS

# An EPS is the one path an import rewrites, because no engine can place one.
moved = {"img/fig1.eps": "img/fig1.pdf"}
body, n = _rewrite(
    r"\includegraphics{img/fig1.eps}" "\n"
    r"\includegraphics[width=1cm]{./img/fig1.eps}" "\n", moved)
assert body.count("img/fig1.pdf") == 2 and ".eps" not in body, body
assert "./img" not in body, body
assert n >= 1, n

# `@article{KEY,` — what a .bib calls a paper.
assert BIB_KEY.findall("@article{ELARK2026,\n title={a}}\n@book{ b2 , x}") == ["ELARK2026", "b2"]

# A bibtex title keeps its own braces: `{ELARK}` is how a bib says "do not
# lowercase this", and stopping at the first `}` is half a title.
src = "title = {The {ELARK} array,\n  and its {DAQ}}, year = {2026},"
assert _braced(src, src.index("{")) == "The {ELARK} array, and its {DAQ}", _braced(src, src.index("{"))
assert _braced("{a}", 0) == "a"

# A note deleted waits in the bin (the rack services' one, rackstore's Bin) and
# comes back byte for byte.
from backend.main import BIN, NOTES, _restore, delete_note   # noqa: E402
NOTES.mkdir(parents=True, exist_ok=True)
f = NOTES / "bin-check.md"
f.write_text("---\ntitle: Bin check\n---\n\nbody #x\n", encoding="utf-8")
raw = f.read_text(encoding="utf-8")
delete_note("bin-check", {"email": "kim@x"})
assert not f.exists()
entry = next(t for t in BIN.list() if t["record"]["id"] == "bin-check")
assert entry["record"]["title"] == "Bin check" and entry["by"] == "kim@x", entry
_restore("notes", "bin-check", entry, {})
assert f.read_text(encoding="utf-8") == raw
BIN.drop("notes", "bin-check")
f.unlink()

# ── a markdown note's folder does not show the manuscripts' own ──────────
from backend.main import NOTES as _N, list_files   # noqa: E402
_N.mkdir(parents=True, exist_ok=True)
FILES.mkdir(parents=True, exist_ok=True)
(_N / "a-paper.md").write_text("---\ntitle: p\n---\n", encoding="utf-8")
(FILES / "a-paper" / "img").mkdir(parents=True, exist_ok=True)
(FILES / "a-paper" / "img" / "fig1.png").write_bytes(b"x")
(FILES / "shared.png").write_bytes(b"y")
_shared = [f["name"] for f in list_files("", {})["files"]]
assert "shared.png" in _shared, _shared
assert not any(n.startswith("a-paper/") for n in _shared), _shared
# The paper's own folder still shows the paper's own files.
assert [f["name"] for f in list_files("a-paper", {})["files"]] == ["img/fig1.png"]
(_N / "a-paper.md").unlink()

# Two "+new" at once: both notes are made, under different names, and both
# saves land (each writer its own .tmp).
from concurrent.futures import ThreadPoolExecutor  # noqa: E402
from backend.main import NOTES as _N, NewBody, new_note  # noqa: E402
with ThreadPoolExecutor(4) as ex:
    _made = list(ex.map(lambda _: new_note(NewBody(title="같이"), {})["id"], range(4)))
assert len(set(_made)) == 4, _made
for _i in _made:
    assert (_N / f"{_i}.md").read_text(encoding="utf-8").startswith("---"), _i
    (_N / f"{_i}.md").unlink()

# #agent finds what is inside it (#agent/rack), not what merely starts the same.
from backend.main import tagged   # noqa: E402
(_N / "tree-check.md").write_text("---\ntitle: t\n---\n\n#Agent/rack\n\n- [ ] 할 일 #agent/note\n", encoding="utf-8")
(_N / "tree-other.md").write_text("---\ntitle: o\n---\n\n#agents\n", encoding="utf-8")
_got = tagged(tag="agent", project="", _={})["items"]
assert {x["key"] for x in _got} == {"notes", "todos"} and all(x["rec"]["id"] == "tree-check" for x in _got), _got
(_N / "tree-check.md").unlink()
(_N / "tree-other.md").unlink()

# A template saved from a note keeps the body alone, and the note made from
# it gets its own title and date rather than the template's.
from backend.main import TEMPLATES, TemplateBody, save_template   # noqa: E402
assert save_template(TemplateBody(name="회의 록", body="---\ntitle: x\n---\n\n## 논의\n\n#회의\n"), {}) == {"name": "회의 록"}
assert (TEMPLATES / "회의 록.md").read_text(encoding="utf-8") == "## 논의\n\n#회의\n"
_t = new_note(NewBody(title="그 회의", template="회의 록"), {})
assert _t["title"] == "그 회의" and "## 논의" in _t["body"], _t
(_N / f"{_t['id']}.md").unlink()
(TEMPLATES / "회의 록.md").unlink()
try:
    save_template(TemplateBody(name="  ", body="x"), {})
    raise AssertionError("a nameless template was saved")
except HTTPException as e:
    assert e.status_code == 400

# ── a save adds one final newline at most: reading and saving back changes nothing
from backend.main import _join, _split                                          # noqa: E402
_once = _join({"title": "t"}, "본문")
assert _once.endswith("본문\n") and _join(*_split(_once)) == _once, _once

# ── `@사람`: the name run together, without case, is the key ───────────────
# The same rule as the screen's (racklist tags.js nameKey): the two have to
# agree or a mention found here would not be the one shown there.
assert _name_key("Jung Woo Lee") == "jungwoolee"
assert _name_key("F.-K. Thielemann") == _name_key("F. K. Thielemann")
assert _name_key("이정우") == "이정우"

_names = lambda t: [m.group(1) for m in AUTH_RE.finditer(_no_code(t))]  # noqa: E731
# A mention starts a word; an address's `@` has a letter in front of it.
assert _names("고마워요 @이정우 그리고 @JungWooLee") == ["이정우", "JungWooLee"]
assert _names("@이정우 가 처음") == ["이정우"]
assert _names("(@이정우)") == ["이정우"]
assert _names("kim@jinr.ru 로 보냈다") == []
assert _names("a@b.com @이정우") == ["이정우"]
assert _names("```\n@이정우\n```") == []

# ── search finds a note by its title, and a body line still wins ──
from backend.main import search   # noqa: E402
_f = NOTES / "search-check.md"
_f.write_text("---\ntitle: 제목만 있는 낱말\ndate: 2026-11-03\n---\n\n본문 줄\n", encoding="utf-8")
assert [(h["id"], h["text"]) for h in search("제목만 있는", {})["hits"]] == [("search-check", "")]
assert search("본문 줄", {})["hits"][0]["text"] == "본문 줄"
_f.unlink()

# ── a due day written without its zero is still a due day ──
from backend.main import _todo_text   # noqa: E402
assert _todo_text("보내기 #TAMU » 2026-11-4") == ("보내기 #TAMU", "2026-11-04", "")
assert _todo_text("끝 » 2026-11-04 ✓ 2026-1-2") == ("끝", "2026-11-04", "2026-01-02")
# ── `!!` is urgent only as a word of its own ──
from backend.main import URGENT_RE  # noqa: E402
assert all(URGENT_RE.search(s) for s in ["!! 보내기", "보내기 !!", "보내기 !! #TAMU"])
assert not any(URGENT_RE.search(s) for s in ["좋다!!", "!!!", "![[그림]]", "a!! b"])

print("note: ok")
