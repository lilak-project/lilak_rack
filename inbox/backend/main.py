"""inbox backend — the candidates waiting for a person's yes, one shared
document per portal project (a share set has its own: manage's, research's).

Something automatic proposes; a person decides. The Claude mail task drops
one file per candidate into `<project data>/inbox-drop/`:
    {id, createdAt, target: "note"|"activity", fields: {...},
     source: {from, subject, date, threadId, attachments: [names], text}, remark}
and every minute (and at start) they are taken in as records of the `inbox`
list — flat, so the kit's table and editor read them as any record: the
fields beside `target`, `status` (waiting | approved | checked | discarded),
`from`, `date`, `subject`, `remark` (the file goes to `inbox-drop/imported/`).
The portal's MCP posts its proposals (a note, an activity, a job) straight in
as records. The page approves one by making it in the service it belongs to
and saving the record with `status`, `decidedAt` and `made` ({svc, proj, id}).
A discard is dropped after DISCARD_KEEP_DAYS. The list is kept undecided first,
then newest mail.

The mail's text stays in the imported file, out of the document every page load
carries; a page asks for it (GET /api/inbox/{id}/mail).

What shows the inbox elsewhere (the portal's Home and account menu) knows no
candidate's fields: GET /api/pending gives each waiting one as a card (approve.py),
GET /api/inbox/{id} what opening it shows, and POST /api/inbox/{id}/decide takes
the decision — making the record is done here, for the person deciding. Each
share set has an inbox project of its own, open to whoever is in the set
(the portal's permissions.follows_its_set).

A manager may write `feedback` on a candidate: how such a mail should have been
handled. Once decided it goes, with the candidate as it stood, onto
`inbox-feedback.jsonl`, which outlives the discards; the mail task learns from it.

Until 2026-11 this lived in project_manager; migrate.py moves a project's.
"""
import copy
import json
import os
import re
import shutil
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException, Request
from lilak_portal_auth import signed_in

import approve as ap

from rackstore.store import Document, mount_spa

DATA = Path(os.environ.get("INBOX_DATA_DIR", "./data"))
PROJECT = os.environ.get("PORTAL_PROJECT", "")
DIST = Path(os.environ.get("INBOX_DIST_DIR", "./dist"))
DROP = DATA / "inbox-drop"
FEEDBACK = DATA / "inbox-feedback.jsonl"
DISCARD_KEEP_DAYS = 10

DOC = Document(DATA / "data.json", keys=("inbox", "settings",), keep_days=30)

app = FastAPI(title="inbox")
DOC.mount(app, project=PROJECT)


def _flat(c: dict) -> dict:
    """A candidate as the file has it → a record: its fields beside its target
    (a note's tags as `noteTags`), its mail's sender, date and subject as
    `from`, `date`, `subject`."""
    if "fields" not in c and "source" not in c:
        return c
    out = {k: v for k, v in c.items() if k not in ("fields", "source")}
    for k, v in (c.get("fields") or {}).items():
        out["noteTags" if k == "tags" else k] = " ".join(v) if isinstance(v, list) else v
    src = c.get("source") or {}
    out.update({k: src.get(k) or "" for k in ("from", "date", "subject", "threadId")})
    out["attachments"] = [str(a) for a in src.get("attachments") or []]
    out.setdefault("status", "waiting")
    return out


def _order(inbox: list) -> list:
    """What is still to be decided first; within that and the rest, the newest
    mail first (no mail date: the day it came in)."""
    def when(c: dict) -> tuple:
        return (str(c.get("date") or c.get("createdAt") or "")[:10], str(c.get("createdAt") or ""), str(c.get("id")))
    return sorted(sorted(inbox, key=when, reverse=True), key=lambda c: c.get("status", "waiting") != "waiting")


def _log_feedback(inbox: list) -> None:
    """Each decided candidate's feedback onto the log, once per wording."""
    worded = [c for c in inbox if str(c.get("feedback") or "").strip() and c.get("status", "waiting") != "waiting"]
    if not worded:
        return
    lines = FEEDBACK.read_text(encoding="utf-8").splitlines() if FEEDBACK.exists() else []
    logged = {(o.get("id"), o.get("feedback")) for o in map(json.loads, lines)}
    new = [c for c in worded if (c.get("id"), c.get("feedback")) not in logged]
    if new:
        FEEDBACK.parent.mkdir(parents=True, exist_ok=True)
        with FEEDBACK.open("a", encoding="utf-8") as f:
            for c in new:
                f.write(json.dumps(c, ensure_ascii=False) + "\n")


def tick() -> bool:
    """Take in what was dropped, flatten what came in before, drop old
    discards, keep the order. True when the document changed."""
    cutoff = (datetime.now().astimezone() - timedelta(days=DISCARD_KEEP_DAYS)).isoformat(timespec="seconds")
    files = sorted(DROP.glob("*.json")) if DROP.is_dir() else []
    with DOC.lock:
        cur = DOC.read()
        inbox = [_flat(c) for c in copy.deepcopy(cur.get("inbox") or [])]   # never edit cur in place
        have = {str(c.get("id")) for c in inbox}
        for f in files:
            try:
                c = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue                   # half-written: the next tick takes it
            if isinstance(c, dict) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", str(c.get("id") or "")) \
                    and c.get("target") in ("note", "activity") and str(c["id"]) not in have:
                inbox.append(_flat(c))
                have.add(str(c["id"]))
            (DROP / "imported").mkdir(parents=True, exist_ok=True)
            shutil.move(str(f), str(DROP / "imported" / f.name))
        _log_feedback(inbox)
        inbox = _order([c for c in inbox if not (c.get("status") == "discarded" and str(c.get("decidedAt") or "") < cutoff)])
        if inbox == (cur.get("inbox") or []):
            return False
        DOC.write({**cur, "inbox": inbox}, "inbox", replaces=cur)
        return True


def _ticker() -> None:
    while True:
        try:
            tick()
        except Exception as e:             # noqa: BLE001 — a bad file must not stop the inbox
            print(f"[inbox] tick failed: {e}", flush=True)
        time.sleep(60)


if os.environ.get("INBOX_TIMER", "1") != "0":
    threading.Thread(target=_ticker, daemon=True, name="inbox").start()


@app.get("/api/badge")
def badge(_: dict = Depends(signed_in)) -> dict:
    """The number on this service's icon: the candidates still to be decided."""
    return {"count": sum(1 for c in DOC.read().get("inbox") or [] if c.get("status", "waiting") == "waiting")}


def _mail(cid: str) -> str:
    p = DROP / "imported" / f"{cid}.json"
    src = json.loads(p.read_text(encoding="utf-8")).get("source") or {} if p.is_file() else {}
    return str(src.get("text") or "")


def _one(cid: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", cid):
        raise HTTPException(404, "그 후보가 없습니다.")
    hit = next((c for c in DOC.read().get("inbox") or [] if str(c.get("id")) == cid), None)
    if not hit:
        raise HTTPException(404, "그 후보가 없습니다.")
    return copy.deepcopy(hit)


@app.get("/api/inbox/{cid}/mail")
def inbox_mail(cid: str, _: dict = Depends(signed_in)) -> dict:
    """The mail a candidate came from, as the task copied it ('' from before it did)."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", cid):
        raise HTTPException(404, "그 후보가 없습니다.")
    return {"text": _mail(cid)}


@app.get("/api/pending")
def pending(_: dict = Depends(signed_in)) -> dict:
    """The candidates still to be decided, oldest decision first as the list keeps them, as cards."""
    waiting = [c for c in DOC.read().get("inbox") or [] if c.get("status", "waiting") == "waiting"]
    return {"count": len(waiting), "items": [ap.card(c) for c in waiting]}


@app.get("/api/decided")
def decided(limit: int = 50, _: dict = Depends(signed_in)) -> dict:
    """What was decided, the latest decision first, as cards (a discard keeps DISCARD_KEEP_DAYS)."""
    done = [c for c in DOC.read().get("inbox") or [] if c.get("status", "waiting") != "waiting"]
    done.sort(key=lambda c: str(c.get("decidedAt") or ""), reverse=True)
    return {"count": len(done), "items": [ap.card(c) for c in done[:max(1, min(limit, 500))]]}


@app.get("/api/inbox/{cid}")
def inbox_detail(cid: str, request: Request, _: dict = Depends(signed_in)) -> dict:
    """One candidate opened: its card, and what it makes (an update: before and after), the remark, the mail."""
    c = _one(cid)
    return {**ap.card(c), "sections": ap.detail(c, request.headers.get("authorization", ""), _mail(cid))}


DECISION = {"check": "checked", "discard": "discarded", "restore": "waiting"}
_MAKING: set = set()      # candidates being made right now (one backend per project, so in memory is enough)


@app.post("/api/inbox/{cid}/decide")
def decide(cid: str, request: Request, body: dict = Body(...), _: dict = Depends(signed_in)) -> dict:
    """approve / update / trash (make it where it goes), check, discard or restore — what the card's
    actions offered. `pick` (a tags candidate): the indices of the items to do, the rest left out."""
    act = str(body.get("action") or "")
    c = _one(cid)
    # retitle: a note_delete kept with a title (`title`) — offered wherever trash is.
    ok = act in ap.actions(c) or (act == "retitle" and c.get("target") == "note_delete" and "trash" in ap.actions(c))
    if not ok:
        raise HTTPException(409, "이 후보에 지금 할 수 없는 일입니다.")
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    making = act in ("approve", "update", "trash", "retitle")
    pick = body.get("pick")
    pick = {int(i) for i in pick if isinstance(i, int) or str(i).isdigit()} if isinstance(pick, list) else None
    if making:
        # Made outside the document's lock (a service call may take seconds), so the candidate
        # is claimed first: a second yes while the first is still making it is refused, and one
        # that arrives after it was decided finds it no longer waiting.
        with DOC.lock:
            if cid in _MAKING or _one(cid).get("status", "waiting") != "waiting":
                raise HTTPException(409, "이 후보는 이미 처리되었거나 지금 처리되고 있습니다.")
            _MAKING.add(cid)
    try:
        if making:
            try:
                if act == "retitle":       # kept, not deleted: checked, with the note it named
                    change = {"status": "checked", "decidedAt": now,
                              "made": ap.retitle(c, request.headers.get("authorization", ""), body.get("title"))}
                else:
                    change = {"status": "approved", "decidedAt": now, "made": ap.approve(c, request.headers.get("authorization", ""), pick),
                              **({"picked": sorted(pick)} if pick is not None else {})}
            except ap.Refused as e:
                raise HTTPException(502, str(e)) from None
        else:
            change = {"status": DECISION[act], "decidedAt": "" if act == "restore" else now,
                      **({"made": None} if act == "restore" else {})}
        with DOC.lock:
            cur = DOC.read()
            inbox = copy.deepcopy(cur.get("inbox") or [])
            for x in inbox:
                if str(x.get("id")) == cid:
                    x.update(change)
                    c = x
            DOC.write({**cur, "inbox": _order(inbox)}, "inbox", replaces=cur)
    finally:
        _MAKING.discard(cid)            # released only once the decision is written
    return ap.card(c)


# Must stay last: the catch-all would shadow /api/*.
mount_spa(app, DIST, name="inbox")
