"""A note read in pieces, for review: the pieces, and where a comment on one is.

The screen (Review mode) and the agents' tools (MCP) both ask the server for
the pieces, so there is ONE rule for cutting them and one hash for naming them.

A piece is a sentence, a paragraph or a line of the body — or the whole note
(`doc`). A code fence, a `$$` block, a table and a line of pictures are never
cut: each is one piece at every level (`kind: block`).

A comment is held by an ANCHOR: the hash of its piece's text, which of the
pieces with that text it was, and the first 40 characters. The body changes
under it; the anchor finds the piece again by hash, then by those characters,
and failing both the comment is kept apart ("moved"), never dropped.
"""
import difflib
import hashlib
import re
import unicodedata

LEVELS = ("sentence", "paragraph", "line", "doc")
# The jobboard report's rules (flow/reportcheck.js): `[@key]` is evidence, a
# sentence ends at . ! ? 。 and a space, and one stating a number needs evidence.
MARK = re.compile(r"\[@([^\]\s]+)\]")
JOB = re.compile(r"::[0-9a-f]{6}\b")
SENT = re.compile(r"(?<=[.!?。])\s+")
_FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,})")
_FIG = re.compile(r"^(?:(?:!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\s]+\))[ \t]*)+$")
_HEAD = re.compile(r"^#{1,6}\s")
_TAGS = re.compile(r"^(?:[#+@][^\s#]+\s*)+$")       # a line of tags only (`#report +STARK`): not prose


def norm(text: str) -> str:
    """What a piece's hash is of: its words, without the evidence marks (a
    reference added to a sentence must not lose the comments on it)."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", MARK.sub("", text))).strip()


def hash_of(text: str) -> str:
    return hashlib.sha1(norm(text).encode("utf-8")).hexdigest()[:12]


def needs(text: str) -> bool:
    return bool(re.search(r"\d", JOB.sub("", MARK.sub("", text))))


def _rows(body: str) -> list:
    """The body's lines as (kind, first, last): 'text', 'block' or 'blank',
    0-based line numbers, a block's lines together."""
    lines = body.split("\n")
    out, i = [], 0
    while i < len(lines):
        s = lines[i].strip()
        j = i
        m = _FENCE.match(lines[i])
        if m:                                   # to its closing fence, or the end
            j = i + 1
            while j < len(lines) and not (_FENCE.match(lines[j]) and lines[j].strip().startswith(m.group(1))):
                j += 1
            out.append(("block", i, min(j, len(lines) - 1)))
        elif s.startswith("$$") and not (len(s) > 2 and s.endswith("$$")):
            j = i + 1
            while j < len(lines) and "$$" not in lines[j]:
                j += 1
            out.append(("block", i, min(j, len(lines) - 1)))
        elif s.startswith("|"):
            while j + 1 < len(lines) and lines[j + 1].strip().startswith("|"):
                j += 1
            out.append(("block", i, j))
        elif s.startswith("$$") or _FIG.match(s):
            out.append(("block", i, i))
        else:
            out.append(("blank" if not s or _TAGS.match(s) else "text", i, i))
        i = j + 1
    return out


def units(body: str, level: str) -> list:
    """The pieces: {n, kind, line (1-based), start, end (offsets in body), text,
    hash, idx, keys, needs}. `doc` is the one piece of the whole note."""
    lines = body.split("\n")
    at = [0]
    for ln in lines:
        at.append(at[-1] + len(ln) + 1)
    spans = []                                  # (kind, line, start, end)
    if level == "doc":
        spans.append(("text", 0, 0, len(body)))
    else:
        rows = _rows(body)
        k = 0
        while k < len(rows):
            kind, a, b = rows[k]
            if kind == "block":
                spans.append(("block", a, at[a], at[b] + len(lines[b])))
            elif kind == "text" and level == "line":
                spans.append(("text", a, at[a], at[a] + len(lines[a])))
            elif kind == "text" and level == "sentence":
                text, s0 = lines[a], 0
                for m in list(SENT.finditer(text)) + [None]:
                    e = m.start() if m else len(text)
                    if text[s0:e].strip():
                        lead = len(text[s0:e]) - len(text[s0:e].lstrip())
                        spans.append(("text", a, at[a] + s0 + lead, at[a] + e))
                    s0 = m.end() if m else s0
            elif kind == "text":                # paragraph: a run of text lines; a heading alone
                last = a
                if not _HEAD.match(lines[a]):
                    while k + 1 < len(rows) and rows[k + 1][0] == "text" and not _HEAD.match(lines[rows[k + 1][1]]):
                        k += 1
                        last = rows[k][1]
                spans.append(("text", a, at[a], at[last] + len(lines[last])))
            k += 1
    out, seen = [], {}
    for n, (kind, line, s, e) in enumerate(spans, 1):
        text = body[s:e]
        h = hash_of(text)
        out.append({"n": n, "kind": kind, "line": line + 1, "start": s, "end": e, "text": text,
                    "hash": h, "idx": seen.get(h, 0), "keys": MARK.findall(text),
                    "needs": kind == "text" and level != "doc" and needs(text)})
        seen[h] = seen.get(h, 0) + 1
    return out


def anchor(u: dict, level: str) -> dict:
    return {"level": level, "hash": u["hash"], "idx": u["idx"], "quote": norm(u["text"])[:40]}


def find(pieces: list, a: dict):
    """The piece an anchor names among `pieces` (its own level's), and whether
    it was found only by its first words. (None, False) when it is gone."""
    same = [u for u in pieces if u["hash"] == a.get("hash")]
    if same:
        return next((u for u in same if u["idx"] == a.get("idx")), same[0]), False
    q = a.get("quote") or ""
    best, score = None, 0.0
    for u in pieces:
        r = difflib.SequenceMatcher(None, q, norm(u["text"])[:len(q)], autojunk=False).ratio()
        if r > score:
            best, score = u, r
    return (best, True) if q and score >= 0.6 else (None, False)


def place(body: str, reviews: list, level: str) -> dict:
    """The pieces at `level` with the comments on them, wherever (at whatever
    level) each was made: it is found at its own level, and goes on the piece
    here that holds where it starts."""
    view = units(body, level)
    cache = {level: view}
    doc, moved = [], []
    for u in view:
        u["comments"] = []
    for r in reviews or []:
        a = r.get("anchor") or {}
        lv = a.get("level") if a.get("level") in LEVELS else "doc"
        if lv == "doc":
            doc.append(r)
            continue
        hit, drift = find(cache.setdefault(lv, units(body, lv)), a)
        if not hit:
            moved.append(r)
            continue
        home = next((u for u in view if u["start"] <= hit["start"] < max(u["end"], u["start"] + 1)), None) \
            or next((u for u in view if u["start"] >= hit["start"]), None)
        (home["comments"] if home else moved).append({**r, "drift": True} if drift else r)
    open_ = sum(1 for r in reviews or [] if r.get("state") != "resolved")
    return {"level": level, "doc": {"comments": doc}, "units": view, "moved": moved,
            "counts": {"units": len(view), "need": sum(u["needs"] for u in view),
                       "none": sum(1 for u in view if u["needs"] and not u["keys"]),
                       "open": open_, "resolved": len(reviews or []) - open_, "moved": len(moved)}}


def cite(text: str, key: str) -> str:
    """`text` with ` [@key]` at its end — before its full stop, or the mark
    would belong to the next sentence."""
    m = re.search(r"([.!?。]?)(\s*)$", text)
    return f"{text[:m.start()]} [@{key}]{m.group(1)}{m.group(2)}"


if __name__ == "__main__":
    b = "#tag +proj\n# 제목\n\n첫 문장은 3 MeV. 둘째 문장 [@a].\n이어진 줄\n\n```py\nx = 1. y = 2\n```\n| a | b |\n|---|---|\n![[p.png]]\n"
    s = units(b, "sentence")
    assert [u["text"] for u in s] == ["# 제목", "첫 문장은 3 MeV.", "둘째 문장 [@a].", "이어진 줄",
                                      "```py\nx = 1. y = 2\n```", "| a | b |\n|---|---|", "![[p.png]]"], s
    assert [u["needs"] for u in s][:3] == [False, True, False]
    assert s[2]["keys"] == ["a"] and s[1]["hash"] == hash_of("첫 문장은  3 MeV. [@x]")
    assert [u["text"] for u in units(b, "paragraph")][:2] == ["# 제목", "첫 문장은 3 MeV. 둘째 문장 [@a].\n이어진 줄"]
    assert len(units(b, "line")) == 6 and units(b, "doc")[0]["text"] == b
    assert cite("값은 3 MeV.", "k") == "값은 3 MeV [@k]." and cite("끝", "k") == "끝 [@k]"
    # a comment on a sentence: shown on its paragraph, kept through an edit, moved when gone
    r = {"id": "r1", "anchor": anchor(s[1], "sentence"), "state": "open"}
    p = place(b, [r], "paragraph")
    assert p["units"][1]["comments"][0]["id"] == "r1" and p["counts"]["none"] == 0   # the paragraph has [@a]
    assert place(b, [], "sentence")["counts"]["none"] == 1
    p = place(b.replace("3 MeV.", "3 MeV 정도."), [r], "sentence")
    assert p["units"][1]["comments"][0].get("drift")
    assert place("전혀 다른 글.", [r], "sentence")["moved"][0]["id"] == "r1"
    print("ok")
