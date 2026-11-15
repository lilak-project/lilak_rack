"""What a candidate makes, and making it — on the server, so anything that shows
the inbox (this service's own page, the portal's Home and account menu) only
reads what comes from here and sends back a decision.

A candidate's `target` says which service it goes to; `destProj` which project
of it (left out: that service's main project). Yes makes the record there
through the portal, as the person deciding — with a token the portal delegates for
that one project and a few minutes (lilak_portal_auth.delegate), never the person's own:
  activity  POST academic_activities/api/records         (an update: /api/records/update)
  note      POST note/api/notes, then PUT its body        (an update: the body grows)
  job       POST jobboard/api/submit
A candidate's `project` links a project_manager project, whose tags it then wears.
"""
import json
import os
import re
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

SVC = {"activity": "academic_activities", "note": "note", "job": "jobboard"}
ACTIVITY = ("name", "kind", "start", "startTime", "end", "endTime", "place", "link", "comment")
# an update may also touch the trip/talk side of an existing activity
UPDATABLE = ACTIVITY + ("tripKind", "tripStart", "tripEnd", "role", "title", "host", "talkDate", "talkTime")
GMAIL = "https://mail.google.com/mail/u/0/"


class Refused(Exception):
    """What the service said, or why nothing was sent."""


def main_project(svc: str) -> str:
    """A service's main project, as the portal keeps it (registry.link_project)."""
    root = Path(os.environ.get("PORTAL_DATA_ROOT", ""))
    try:
        m = json.loads((root / svc / "service.json").read_text())
    except (OSError, ValueError):
        return ""
    if m.get("entry_project"):
        return m["entry_project"]
    projects = sorted(p.name for p in (root / svc / "projects").iterdir() if p.is_dir()) \
        if (root / svc / "projects").is_dir() else []
    return projects[0] if projects else ""


def call(auth: str, method: str, path: str, body=None) -> dict:
    """One call to a service through the portal's own proxy, for the caller: with a
    token delegated for that service/project only (`auth` is the caller's own header,
    shown to the portal to ask for it, and goes no further)."""
    from lilak_portal_auth import delegate
    svc, proj = path.split("/")[2:4]
    try:
        auth = delegate(auth, f"{svc}/{proj}")
    except PermissionError as e:
        raise Refused(str(e)) from None
    url = f"http://127.0.0.1:{os.environ.get('PORTAL_PORT', '8025')}{path}"
    req = urllib.request.Request(url, method=method, headers={"Authorization": auth, "Accept": "application/json",
                                                              **({"Content-Type": "application/json"} if body is not None else {})},
                                 data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            said = json.load(e).get("detail")
        except Exception:                  # noqa: BLE001
            said = None
        raise Refused(said or f"{path.split('/api/')[0]} → {e.code}") from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise Refused(f"{path.split('/api/')[0]}: {e}") from None


def where(c: dict) -> tuple[str, str]:
    """(service, project) a candidate goes to."""
    svc = SVC.get(c.get("target"), "")
    return svc, str(c.get("destProj") or main_project(svc))


def _words(v) -> list:
    return [t.lstrip("#") for t in str(v or "").split() if t.lstrip("#")]


def from_line(c: dict) -> str:
    line = ", ".join(str(c[k]) for k in ("from", "date") if c.get(k)) + (f", 「{c['subject']}」" if c.get("subject") else "")
    if re.fullmatch(r"[0-9a-f]+", str(c.get("threadId") or "")):
        line += f" {GMAIL}#all/{c['threadId']}"
    return line


def jobs_params(c: dict):
    try:
        p = json.loads(c.get("params") or "{}")
    except ValueError:
        return None
    return p if isinstance(p, dict) else None


def project_tags(c: dict, auth: str) -> list:
    """The tags of the project_manager project the candidate links ([] for none)."""
    p = c.get("project")
    p = p[0] if isinstance(p, list) and p else p
    if not isinstance(p, dict) or not p.get("id"):
        return []
    proj = p.get("proj") or main_project("project_manager")
    try:
        d = call(auth, "GET", f"/pp/project_manager/{proj}/api/data")
    except Refused:
        return []
    hit = next((x for x in d.get("projects") or [] if x.get("id") == p["id"]), None)
    return list((hit or {}).get("tags") or [])


def changes(c: dict) -> dict:
    """What an update lays over: the activity's filled fields, or the note's added part."""
    if c.get("target") == "activity":
        return {k: str(c[k]) for k in UPDATABLE if str(c.get(k) or "")}
    src = from_line(c)
    return {"add": f"\n\n## 업데이트 {date.today().isoformat()}\n\n{str(c.get('body') or '').strip()}\n"
                   + (f"\n출처: {src}\n" if src else "")}


def makes(c: dict, tags: list) -> dict:
    """{record} for an activity, {title, text} for a note, {job} for a job."""
    if c.get("target") == "job":
        return {"job": {"recipe": str(c.get("recipe") or ""), "project": str(c.get("jobProject") or ""),
                        "params": jobs_params(c) or {}, **({"server": str(c["server"])} if c.get("server") else {})}}
    if c.get("target") == "activity":
        rec = {k: str(c.get(k) or "") for k in ACTIVITY}
        return {"record": {**rec, "repeat": None, **({"tags": tags} if tags else {})}}
    src = from_line(c)
    every = " ".join(f"#{t}" for t in dict.fromkeys(_words(c.get("noteTags")) + list(tags)))
    return {"title": str(c.get("title") or "").strip(),
            "text": f"{every}\n\n{str(c.get('body') or '').strip()}\n" + (f"\n출처: {src}\n" if src else "")}


def blocked(c: dict) -> str:
    """Why yes cannot be pressed yet ('' when it can)."""
    t = c.get("target")
    if t == "job":
        return "" if c.get("recipe") and c.get("jobProject") and jobs_params(c) is not None \
            else "잡에는 recipe, project, 그리고 JSON으로 된 params가 필요합니다"
    if c.get("mode") == "update":
        ok = changes(c) if t == "activity" else str(c.get("body") or "").strip()
        return "" if ok else "바꿀 내용이 없습니다"
    if t == "activity":
        return "" if c.get("name") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(c.get("start") or "")) \
            else "일정에는 이름과 시작 날짜(YYYY-MM-DD)가 필요합니다"
    if t == "note":
        return "" if str(c.get("title") or "").strip() else "노트에는 제목이 필요합니다"
    return "알 수 없는 종류입니다"


def current(c: dict, auth: str) -> dict:
    """The record an update is about, as its service has it now."""
    svc, proj = where(c)
    mid = str((c.get("match") or {}).get("id") or "")
    if c.get("target") == "note":
        return call(auth, "GET", f"/pp/{svc}/{proj}/api/notes/{urllib.request.quote(mid, safe='')}")
    rec = next((x for x in call(auth, "GET", f"/pp/{svc}/{proj}/api/data").get("activities") or []
                if str(x.get("id")) == mid), None)
    if not rec:
        raise Refused("가리키는 기록이 이제 없습니다")
    return rec


def approve(c: dict, auth: str) -> dict:
    """Make it where it goes; the `made` the candidate is saved with."""
    why = blocked(c)
    if why:
        raise Refused(why)
    svc, proj = where(c)
    if not svc or not proj:
        raise Refused(f"{c.get('target')} 를 받을 서비스나 프로젝트가 없습니다")
    base = f"/pp/{svc}/{proj}/api"
    t = c.get("target")
    if c.get("mode") == "update":
        rid = str(c["match"]["id"])
        if t == "activity":
            call(auth, "POST", f"{base}/records/update", {"key": "activities", "id": rid, "fields": changes(c)})
        else:
            n = current(c, auth)
            call(auth, "PUT", f"{base}/notes/{urllib.request.quote(rid, safe='')}",
                 {"baseVersion": n["version"], "body": n["body"].rstrip() + changes(c)["add"]})
    elif t == "job":
        # Submitted as the person approving: the job is theirs, the agent only asked.
        rid = call(auth, "POST", f"{base}/submit", makes(c, [])["job"])["id"]
    elif t == "activity":
        rid = call(auth, "POST", f"{base}/records", {"key": "activities", "record": makes(c, project_tags(c, auth))["record"]})["record"]["id"]
    else:
        out = makes(c, project_tags(c, auth))
        n = call(auth, "POST", f"{base}/notes", {"title": out["title"]})
        call(auth, "PUT", f"{base}/notes/{urllib.request.quote(str(n['id']), safe='')}", {"baseVersion": n["version"], "body": out["text"]})
        rid = n["id"]
    return {"svc": svc, "proj": proj, "id": rid}


def title(c: dict) -> str:
    return str((c.get("title") if c.get("target") == "note" else c.get("name")) or c.get("matchName")
               or c.get("subject") or "")


def actions(c: dict) -> list:
    """The buttons a candidate has where it stands."""
    s = c.get("status", "waiting")
    if s == "discarded":
        return ["restore"]
    if s != "waiting":
        return []
    if c.get("mode") == "checked":
        return ["check"]
    return ["update" if c.get("mode") == "update" else "approve", "discard"]


def card(c: dict) -> dict:
    """One candidate as anything that shows the inbox draws it: no field it must know."""
    out = {"id": c.get("id"), "kind": c.get("target"), "title": title(c), "mode": c.get("mode") or "",
           "status": c.get("status", "waiting"), "from": c.get("from") or "", "date": c.get("date") or "",
           "subject": c.get("subject") or "", "remark": c.get("remark") or "", "actions": actions(c),
           "blocked": blocked(c) if c.get("status", "waiting") == "waiting" and c.get("mode") != "checked" else "",
           "goes": "/".join(where(c)), "attachments": c.get("attachments") or [], "decidedAt": c.get("decidedAt") or ""}
    if c.get("made"):
        out["made"] = c["made"]
    return out


def detail(c: dict, auth: str, mail: str) -> list:
    """What opening a candidate shows, as sections: {k, text} (mono text) or {k, rows: [[field, old, new]]}."""
    out = []
    try:
        if c.get("mode") == "update" and (c.get("match") or {}).get("id"):
            cur = current(c, auth)
            if c.get("target") == "activity":
                ch = changes(c)
                out.append({"k": "change", "title": str(cur.get("name") or ""),
                            "rows": [[k, str(cur.get(k) or ""), ch.get(k, str(cur.get(k) or ""))]
                                     for k in UPDATABLE if k in ch or (k != "name" and cur.get(k))]})
            else:
                out.append({"k": "adds", "title": str(cur.get("title") or ""), "text": changes(c)["add"].strip()})
        elif c.get("mode") != "checked":
            m = makes(c, project_tags(c, auth))
            text = (f"{m['job']['recipe']}{' @ ' + m['job']['server'] if m['job'].get('server') else ''}\n"
                    f"project: {m['job']['project']}\n{json.dumps(m['job']['params'], ensure_ascii=False, indent=2)}"
                    if "job" in m else "\n".join(f"{k}: {', '.join(v) if isinstance(v, list) else v}"
                                                 for k, v in m["record"].items() if v)
                    if "record" in m else f"{m['title']}\n\n{m['text']}")
            out.append({"k": "makes", "text": text})
    except Refused as e:
        out.append({"k": "error", "text": str(e)})
    if c.get("remark"):
        out.append({"k": "remark", "text": str(c["remark"])})
    if c.get("feedback"):
        out.append({"k": "feedback", "text": str(c["feedback"])})
    if mail or c.get("subject"):
        link = f"{GMAIL}#all/{c['threadId']}" if re.fullmatch(r"[0-9a-f]+", str(c.get("threadId") or "")) else ""
        out.append({"k": "mail", "text": mail, "link": link, "subject": c.get("subject") or "",
                    "attachments": c.get("attachments") or []})
    return out
