"""Move each share set's inbox out of project_manager into the inbox service.

Until 2026-11 the inbox was a list inside project_manager. This, once per portal:
  - registers the inbox service (its seed manifest, as an install of the rack bundle would),
  - for every share set holding a project_manager project P and no inbox yet, gives the
    set an inbox project — `inbox` for the main projects' set, else P's own name — and
    copies P's candidates (data/inbox/), its mail drop (inbox-drop/) and its feedback
    log into it,
  - saves the sets (which redraws their sidebar groups).

It copies, never moves: project_manager no longer reads what it leaves behind, and a
second run finds the set already holding an inbox and does nothing.

    service_manager/.venv/bin/python lilak_rack/inbox/migrate.py            # what it would do
    service_manager/.venv/bin/python lilak_rack/inbox/migrate.py --apply

PORTAL_DATA_ROOT picks the data folder, as it does for the portal. Run it with the
portal stopped or idle: it writes share_sets.json as the portal does.
"""
import json
import shutil
import sys
import uuid
from pathlib import Path

STACK = Path(__file__).resolve().parents[2]          # lilak_rack/inbox/ → the stack
if not (STACK / "service_manager").is_dir():          # the image: services flat in /app
    STACK = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STACK / "service_manager"))

from app import registry                               # noqa: E402
from app import project_runtime as pr                  # noqa: E402
from app.routers import service_groups, store          # noqa: E402

PM, IB = "project_manager", "inbox"
WHAT = (("data", "inbox"), ("inbox-drop",), ("inbox-feedback.jsonl",))


def plan() -> tuple[list[dict], list[tuple[dict, str, str]]]:
    """Every set, and (set, its project_manager project, the inbox project it gets) for each to do."""
    main = registry.link_project(PM)
    sets, _ = registry.share_sets()
    return sets, [(s, s["members"][PM], IB if s["members"][PM] == main else s["members"][PM])
                  for s in sets if (s.get("members") or {}).get(PM) and not s["members"].get(IB)]


def copy_over(p: str, q: str, apply: bool) -> None:
    src, dst = pr.project_dir(PM, p), pr.project_dir(IB, q)
    for parts in WHAT:
        a, b = src.joinpath(*parts), dst.joinpath(*parts)
        if not a.exists():
            continue
        n = sum(1 for _ in a.rglob("*") if _.is_file()) if a.is_dir() else 1
        if b.exists() and (not b.is_dir() or any(b.iterdir())):
            print(f"  · {b} 이미 있음 — 그대로 둡니다")
            continue
        print(f"  {'→' if apply else '·'} {a} → {b} ({n} 파일)")
        if apply:
            b.parent.mkdir(parents=True, exist_ok=True)
            (shutil.copytree if a.is_dir() else shutil.copy2)(a, b, **({"dirs_exist_ok": True} if a.is_dir() else {}))


def main() -> None:
    apply = "--apply" in sys.argv
    print(f"data: {registry.config.DATA_ROOT}{'' if apply else '   (보기만 — --apply 로 실행)'}")
    if not registry.manifest_path(IB).exists():
        print(f"· {IB} 서비스 등록")
        if apply:
            rack = next(e for e in json.loads((STACK / "service_manager/app/store_catalog.json").read_text())["services"]
                        if IB in (e.get("bundle") or []))
            jid = uuid.uuid4().hex
            store._jobs[jid] = {"log": []}
            ok = store._register(jid, IB, rack)
            print("\n".join(f"  {m}" for m in store._jobs.pop(jid)["log"]))
            if not ok:
                sys.exit(1)
    sets, todo = plan()
    if not todo:
        print("· 할 일 없음: 받은편지함이 없는 project_manager 세트가 없습니다")
        return
    for s, p, q in todo:
        print(f"· 세트 '{s.get('name')}': {PM}/{p} → {IB}/{q}")
        if apply and not pr.project_dir(IB, q).exists():
            pr.create_project(IB, q)
        copy_over(p, q, apply)
        s["members"][IB] = q
    if apply:
        registry.write_share_sets(sets)
        service_groups.sync_set_groups()
        print("✓ 세트 저장")


if __name__ == "__main__":
    main()
