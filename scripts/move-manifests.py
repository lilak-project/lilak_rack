#!/usr/bin/env python3
"""Point registered rack services at their new home, lilak_rack/<name>.

The rack services moved from web_service/<name> (image: /app/<name>) into the
lilak_rack checkout (web_service/lilak_rack/<name>, image: /app/lilak_rack/<name>).
A manifest written before the move still starts the old path; this rewrites its
start cmd / cwd / env in place, keeping a copy (service.json.bak-<stamp>).

    python3 move-manifests.py <data root> [--dry-run]

laptop: ~/web_service/data   server: /app/data (docker exec … python3 - < this)
"""
import json
import re
import sys
import time
from pathlib import Path

RACK = ("academic_activities", "author_manager", "reference_manager", "asset_manager2", "note", "project_manager")


def moved(v: str, name: str) -> str:
    # …/<name> or …/<name>/… not already under lilak_rack/
    return re.sub(rf"(?<!/lilak_rack)/{name}(?=/|\s|$)", f"/lilak_rack/{name}", v)


def main(root: Path, dry: bool) -> None:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for name in RACK:
        p = root / name / "service.json"
        if not p.exists():
            print(f"  -  {name}: not registered")
            continue
        m = json.loads(p.read_text(encoding="utf-8"))
        st = m.get("start") or {}
        new = {**st, **{k: moved(st[k], name) for k in ("cmd", "cwd") if isinstance(st.get(k), str)},
               "env": {k: moved(v, name) if isinstance(v, str) else v for k, v in (st.get("env") or {}).items()}}
        if new == st:
            print(f"  =  {name}: already {st.get('cwd')}")
            continue
        print(f"  →  {name}: {st.get('cwd')}  →  {new.get('cwd')}")
        if not dry:
            p.with_name(f"service.json.bak-{stamp}").write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
            p.write_text(json.dumps({**m, "start": new}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    assert moved("sh /app/note/portal-serve.sh {port}", "note") == "sh /app/lilak_rack/note/portal-serve.sh {port}"
    assert moved("/Users/x/web_service/note", "note") == "/Users/x/web_service/lilak_rack/note"
    assert moved("/app/lilak_rack/note", "note") == "/app/lilak_rack/note"
    assert moved("/app/notebook", "note") == "/app/notebook"
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    main(Path(args[0] if args else "/app/data"), "--dry-run" in sys.argv)
