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
from backend.main import (BIB_KEY, FILES, PROJ_RE, TEX_AT,            # noqa: E402
                          _braced, _files, _flat, _proj_key, _rewrite)

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

# A zip's paths become flat names, and the body is pointed at them. The first
# `1.png` keeps the name the document already writes; the second wears its
# folder, because a tex note's files all sit next to main.tex.
taken = {}
for rel, want in (("Pictures/fig1.pdf", "fig1.pdf"), ("Pictures/fig1.pdf", "fig1.pdf"),
                  ("fig/1.png", "1.png"), ("tab/1.png", "tab-1.png"),
                  ("deep/../1.png", "1-1.png")):
    got = _flat(rel, taken)
    assert got == want, (rel, got, want)
    taken[got] = rel

# A member whose path tries to leave the folder is a file with a plain name.
assert "/" not in _flat("../../etc/passwd", {}) and _flat("../../x.tex", {}) == "x.tex"

moved = {"Pictures/fig1.eps": "fig1.pdf", "fig/1.png": "1.png", "ref/paper.bib": "paper.bib"}
body, n = _rewrite(
    r"\includegraphics{Pictures/fig1}" "\n"
    r"\includegraphics[width=1cm]{./fig/1.png}" "\n"
    r"\bibliography{ref/paper}" "\n", moved)
assert r"\includegraphics{fig1}" in body, body
assert r"{1.png}" in body and "./fig" not in body, body
assert r"\bibliography{paper}" in body, body
assert n >= 3, n

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

print("note: ok")
