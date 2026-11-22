"""Give each share set an inbox of its own, in the inbox service.

Until 2026-11 the inbox was a list inside project_manager, one per share set. Now it
is the inbox service's, still one project per set (the set's `inbox` member), open to
whoever is in the set; a candidate says which project of its target service
approving makes it in (`destProj`). This, once per portal:
  - registers the inbox service (its seed manifest, as an install of the rack bundle
    would) — the portal's Home and account menu show the inbox,
  - gives every set with a project_manager project P and no inbox one: `inbox` for the
    main projects' set, else P's own name; copies P's candidates (each stamped with the
    set's project of the service it goes to), its mail drop and its feedback log,
  - spreads the candidates of an inbox project that is in no set (a per-account one,
    as this ran for a day) over the sets they go to, and sets it aside in data/_backups/,
  - saves the sets (which redraws their sidebar groups).

project_manager's copy is left where it was (nothing reads it now). A second run finds
every set with its inbox and does nothing.

    service_manager/.venv/bin/python lilak_rack/inbox/migrate.py            # what it would do
    service_manager/.venv/bin/python lilak_rack/inbox/migrate.py --apply

PORTAL_DATA_ROOT picks the data folder, as it does for the portal. Run it with the
portal idle: it writes share_sets.json and home.json as the portal does.
"""
import json
import shutil
import sys
import time
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
GOES = {"note": "note", "activity": "activities", "job": "jobboard"}


def records(src: Path) -> list[Path]:
    """A record a file; `_order.json` and the like are the store's own (the inbox orders itself on its next tick)."""
    d = src / "data" / "inbox"
    return sorted(f for f in d.glob("*.json") if not f.name.startswith("_")) if d.is_dir() else []


def put(files: list[Path], members: dict, dst: Path, apply: bool) -> int:
    """Candidates into `dst`, each stamped with where its set makes it; ones already there are left."""
    new = [f for f in files if not (dst / "data" / "inbox" / f.name).exists()]
    if apply:
        (dst / "data" / "inbox").mkdir(parents=True, exist_ok=True)
        for f in new:
            rec = json.loads(f.read_text(encoding="utf-8"))
            dest = members.get(GOES.get(rec.get("target"), ""), "")
            if dest and not rec.get("destProj"):
                rec["destProj"] = dest
            (dst / "data" / "inbox" / f.name).write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(new)


def carry(src: Path, dst: Path, apply: bool) -> None:
    """The mail drop (with what was taken in) and the feedback log."""
    drop = src / "inbox-drop"
    files = [f for f in drop.rglob("*") if f.is_file() and not (dst / "inbox-drop" / f.relative_to(drop)).exists()] \
        if drop.is_dir() else []
    if files:
        print(f"  {'→' if apply else '·'} 메일 파일 {len(files)}개")
    for f in files if apply else []:
        (dst / "inbox-drop" / f.relative_to(drop)).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst / "inbox-drop" / f.relative_to(drop))
    fb = src / "inbox-feedback.jsonl"
    if fb.is_file():
        have = set((dst / "inbox-feedback.jsonl").read_text(encoding="utf-8").splitlines()) \
            if (dst / "inbox-feedback.jsonl").exists() else set()
        lines = [x for x in fb.read_text(encoding="utf-8").splitlines() if x and x not in have]
        if lines:
            print(f"  {'→' if apply else '·'} 피드백 {len(lines)}줄")
        if apply and lines:
            dst.mkdir(parents=True, exist_ok=True)
            with (dst / "inbox-feedback.jsonl").open("a", encoding="utf-8") as out:
                out.write("\n".join(lines) + "\n")


def register(apply: bool) -> None:
    if registry.manifest_path(IB).exists():
        return
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


def settle() -> None:
    """The manifest saying what the cover reads it for, out of the tag sets, its main project
    the main set's. The card is not hidden here: a portal-wide hide (home.json) is one no
    account can undo in its own bar; each account hides the card there if it wants."""
    m = registry.read_manifest(IB)
    was = json.dumps(m, sort_keys=True)
    m.setdefault("capabilities", {}).update(inbox=True, tags=False)
    if pr.project_dir(IB, IB).exists():
        m["entry_project"] = IB
    elif m.get("entry_project") and not pr.project_dir(IB, m["entry_project"]).exists():
        m.pop("entry_project")
    if json.dumps(m, sort_keys=True) != was:
        registry.write_manifest(IB, m)
        print("  ✓ 매니페스트: capabilities.inbox, 세트 밖")


def main() -> None:
    apply = "--apply" in sys.argv
    print(f"data: {registry.config.DATA_ROOT}{'' if apply else '   (보기만 — --apply 로 실행)'}")
    register(apply)
    sets, _ = registry.share_sets()
    main_pm = registry.link_project(PM)
    changed, later = False, []
    for s in sets:
        m = s.setdefault("members", {})
        if m.get(IB) or not m.get(PM):
            continue
        q = IB if m[PM] == main_pm else m[PM]
        src, dst = pr.project_dir(PM, m[PM]), pr.project_dir(IB, q)
        if apply and not dst.exists():
            pr.create_project(IB, q)
        later.append((s, src, dst))       # copied last: a newer copy of the same candidate (below) wins
        m[IB] = q
        changed = True
    # An inbox project in no set (one per account, as it was for a day): its candidates go
    # to the set that makes them where they say, the rest — and the mail — to the main set's.
    in_sets = {(s.get("members") or {}).get(IB) for s in sets} - {None}
    home = next((s["members"] for s in sets if (s.get("members") or {}).get(IB) == IB), None) \
        or next((s["members"] for s in sets if (s.get("members") or {}).get(IB)), None)
    root = registry.config.DATA_ROOT / IB / "projects"
    strays = sorted(d for d in root.iterdir() if d.is_dir() and d.name not in in_sets) if root.is_dir() and home else []
    for stray in strays:
        print(f"· 세트 밖의 {IB}/{stray.name}: 세트마다 나눕니다")
        by_set: dict[str, list] = {}
        for f in records(stray):
            rec = json.loads(f.read_text(encoding="utf-8"))
            to = next((s["members"] for s in sets if (s.get("members") or {}).get(IB) and rec.get("destProj")
                       and s["members"].get(GOES.get(rec.get("target"), "")) == rec["destProj"]), home)
            by_set.setdefault(to[IB], []).append((f, to))
        for q, fs in by_set.items():
            if apply and not pr.project_dir(IB, q).exists():
                pr.create_project(IB, q)
            print(f"  {'→' if apply else '·'} {IB}/{q} 후보 {put([f for f, _ in fs], fs[0][1], pr.project_dir(IB, q), apply)}건")
        carry(stray, pr.project_dir(IB, home[IB]), apply)
        if apply:
            aside = registry.config.DATA_ROOT / "_backups" / f"inbox-{stray.name}-{time.strftime('%Y%m%d-%H%M%S')}"
            aside.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(stray), str(aside))
            print(f"  ✓ {IB}/{stray.name} → {aside.relative_to(registry.config.DATA_ROOT)}")
    for s, src, dst in later:
        print(f"· 세트 '{s.get('name')}': {PM}/{src.name} → {IB}/{dst.name}")
        print(f"  {'→' if apply else '·'} 후보 {put(records(src), s['members'], dst, apply)}건")
        carry(src, dst, apply)
    if apply:
        if changed:
            registry.write_share_sets(sets)
            service_groups.sync_set_groups()
            print("✓ 세트 저장")
        settle()
    elif not changed and not strays:
        print("· 세트마다 받은편지함이 있습니다")


if __name__ == "__main__":
    main()
