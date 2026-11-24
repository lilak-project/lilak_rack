"""The rack's browsing tab, backend half: folders on the host a service may look into, for a person
to pick one (or a file) and the service to do the rest with it (racklist `openBrowse`).

    mount_browse(app, doc, why="…")
        GET /api/browse?path=        one folder: {path, up, dirs: [{name, mtime}], files: [{name, size, mtime}],
                                     roots, saved, places}. No path: the first root.
        PUT /api/browse/places       {roots?: [folder], places?: [{path, label}]}: the allowed folders, the shortcuts

Where it may look: the folders in the document's settings.roots (none until some are set; the home folder or
inside it, or a folder a portal manager approved by hand),
each only once the portal allows this service that path (lilak_portal_auth.reach: a portal manager
approves it on the account menu's Outside paths page; the browsing tab asks there too). `saved` is
the list as set, approved or not, so the page can say which still wait. A path is checked as given
and through any link on the way. Both routes are a manager's (a host read). The service uses
`in_roots(doc, path, why)` for anything it then makes or links there.
"""
import os
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException
from lilak_portal_auth import manager, reach, reach_info, reach_status

from .lang import say


def deep_enough(q: Path) -> bool:
    """The user's home folder or inside it (/home/<user>, /Users/<user>). Only these may be asked for: the
    portal makes no approval request for anything else (it answers "outside"), it only lets through
    what a portal manager put on its list by hand (a data disk)."""
    home = Path.home().resolve()
    return q == home or home in q.parents


def roots(doc, why: str = "") -> list:
    """The allowed folders as set, each one the portal lets this service reach. None set: none (asking
    the portal for the home folder unasked would read as a request for all of it)."""
    got = [Path(r).expanduser().resolve() for r in (doc.read().get("settings") or {}).get("roots") or []]
    return [r for r in got if reach(r, why)]


def statuses(doc, why: str = "") -> dict:
    """Each folder as set → the portal's word on it: approved | waiting | held | blocked | outside | unreachable."""
    return {r: v["status"] for r, v in infos(doc, why).items()}


def infos(doc, why: str = "") -> dict:
    """Each folder as set → {status, comments}: what a portal manager wrote holding it, oldest first."""
    out = {}
    for r in (doc.read().get("settings") or {}).get("roots") or []:
        i = reach_info(Path(r).expanduser().resolve(), why)
        out[str(r)] = {"status": i.get("status"), "comments": i.get("comments") or []}
    return out


def under(q: Path, rs: list) -> bool:
    """`q` is one of the folders `rs` or inside one (a folder with the same start is not)."""
    return any(q == r or r in q.parents for r in rs)


def in_roots(doc, path: str, why: str = "") -> Path:
    """`path` made absolute (not resolved: it may not be there yet), refused unless it and where it
    really leads both sit in an allowed folder."""
    q = Path(os.path.abspath(os.path.expanduser(str(path))))
    rs = roots(doc, why)
    if not under(q, rs) or not under(Path(os.path.realpath(q)), rs):
        raise HTTPException(403, say("허용된 경로 밖입니다 (허용 경로 가운데 포털에서 승인된 것: "
                                     + (", ".join(map(str, rs)) or "없음 — 매니저가 계정 메뉴의 '바깥 경로'에서 승인") + ").",
                                     "Outside the allowed folders (those the portal approved: "
                                     + (", ".join(map(str, rs)) or "none — a manager approves them on the account menu's Outside paths") + ")."))
    return q


def mount_browse(app: FastAPI, doc, why: str = "") -> None:
    @app.get("/api/browse")
    def browse(path: str = "", _: dict = Depends(manager)) -> dict:
        rs = roots(doc, why)
        st = doc.read().get("settings") or {}
        if not rs:      # nothing to look in yet: the page says to set the folders (and have them approved)
            return {"path": "", "up": "", "dirs": [], "files": [], "roots": [], "saved": st.get("roots") or [],
                    "status": statuses(doc, why), "info": infos(doc, why), "places": st.get("places") or []}
        q = in_roots(doc, path or str(rs[0]), why)
        while not q.is_dir() and any(r in q.parents for r in rs):
            q = q.parent                       # not there yet: the nearest folder that is
        dirs, files = [], []
        try:
            for e in sorted(os.scandir(q), key=lambda e: e.name.lower()):
                if e.name.startswith("."):
                    continue
                try:
                    fs = e.stat()
                except OSError:
                    continue
                if e.is_dir():
                    dirs.append({"name": e.name, "mtime": fs.st_mtime})
                else:
                    files.append({"name": e.name, "size": fs.st_size, "mtime": fs.st_mtime})
        except OSError as e:
            raise HTTPException(400, str(e))
        return {"path": str(q), "up": str(q.parent) if under(q.parent, rs) and q not in rs else "",
                "dirs": dirs, "files": files[:2000], "more": len(files) > 2000, "roots": [str(r) for r in rs],
                "saved": st.get("roots") or [], "status": statuses(doc, why), "info": infos(doc, why),
                "places": st.get("places") or []}

    @app.post("/api/browse/again")
    def ask_again(body: dict = Body(...), _: dict = Depends(manager)) -> dict:
        """A folder the portal holds, asked for again (after changing what a manager commented on):
        it waits again. Only one of the folders as set."""
        r = str(body.get("path") or "")
        if r not in ((doc.read().get("settings") or {}).get("roots") or []):
            raise HTTPException(400, say("허용 경로에 적힌 폴더만 다시 요청할 수 있습니다.", "Only a folder in the allowed list can be asked for again."))
        reach_info(Path(r).expanduser().resolve(), why, again=True)
        return {"status": statuses(doc, why), "info": infos(doc, why)}

    @app.put("/api/browse/places")
    def put_places(body: dict = Body(...), me: dict = Depends(manager)) -> dict:
        cur = doc.read()
        st = dict(cur.get("settings") or {})
        if "roots" in body:
            rs = [str(Path(os.path.expanduser(str(r))).resolve()) for r in body["roots"] or [] if str(r).strip()]
            for r in rs:
                if not Path(r).is_dir():
                    raise HTTPException(400, say(f"폴더가 아닙니다: {r}", f"Not a folder: {r}"))
                if not deep_enough(Path(r)) and reach_status(Path(r), why) != "approved":
                    raise HTTPException(400, say(f"이 경로는 홈 폴더({Path.home()}) 밖입니다. 매니저가 포털의 바깥 경로 페이지에서 "
                                                 f"먼저 승인해야 합니다: {r}",
                                                 f"This path is outside the home folder ({Path.home()}): a manager approves it on the "
                                                 f"portal's Outside paths page first: {r}"))
            st["roots"] = list(dict.fromkeys(rs))
        if "places" in body:
            st["places"] = [{"path": str(x.get("path")), "label": str(x.get("label") or Path(str(x.get("path"))).name)}
                            for x in body["places"] or [] if isinstance(x, dict) and x.get("path")][:100]
        doc.write({**cur, "settings": st}, me.get("email") or me.get("username") or "", replaces=cur)
        return {"roots": [str(r) for r in roots(doc, why)], "saved": st.get("roots") or [], "status": statuses(doc, why),
                "info": infos(doc, why), "places": st.get("places") or []}
