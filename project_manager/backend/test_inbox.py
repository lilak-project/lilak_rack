"""project_manager's inbox: dropped candidates taken in once and flattened
into records of the `inbox` class, kept undecided first then newest mail, an old discard dropped.

    service_manager/.venv/bin/python project_manager/backend/test_inbox.py
"""
import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

TMP = Path(tempfile.mkdtemp())
os.environ["PORTAL_SECRET_KEY"] = "test-secret"
os.environ["PORTAL_DATA_ROOT"] = str(TMP / "root")
os.environ["PROJECT_MANAGER_DATA_DIR"] = str(TMP / "data")
os.environ["PROJECT_MANAGER_DIST_DIR"] = str(TMP / "dist")
os.environ["PM_INBOX_TIMER"] = "0"             # ticked by hand here
os.environ.pop("PORTAL_PORT", None)
(TMP / "dist").mkdir()
(TMP / "dist" / "index.html").write_text("<html></html>")
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "lilak_portal_auth"))   # the package, not its repo folder

import main                                    # noqa: E402


class Inbox(unittest.TestCase):
    def test_take_in_flatten_order_prune(self):
        main.DROP.mkdir(parents=True, exist_ok=True)
        (main.DROP / "a.json").write_text(json.dumps({
            "id": "a", "target": "note", "createdAt": "2026-10-31T10:00:00+09:00",
            "fields": {"title": "T", "tags": "#x #y", "body": "b"}, "source": {"from": "kim", "date": "2026-10-30", "subject": "S"}}))
        (main.DROP / "b.json").write_text(json.dumps({"id": "b", "target": "activity", "createdAt": "2026-10-31T09:00:00+09:00",
                                                      "fields": {"name": "Talk", "start": "2026-11-02"}}))
        (main.DROP / "bad.json").write_text("{half")
        self.assertTrue(main.tick())
        inbox = main.DOC.read()["inbox"]
        self.assertEqual([c["id"] for c in inbox], ["b", "a"])                       # newest first (b: no mail date, its day in)
        a = inbox[1]
        self.assertEqual((a["title"], a["noteTags"], a["from"], a["subject"], a["status"]), ("T", "#x #y", "kim", "S", "waiting"))
        self.assertNotIn("fields", a)
        self.assertTrue((main.DROP / "bad.json").exists())                           # half-written: next tick
        self.assertFalse(main.tick())                                                # nothing new
        # Decided ones go after the waiting; a discard older than the keep is dropped.
        with main.DOC.lock:
            d = main.DOC.read()
            n = copy.deepcopy(d)
            n["inbox"][0].update(status="approved", decidedAt="2026-10-31T11:00:00+09:00")
            n["inbox"][1].update(status="discarded", decidedAt="2000-01-01T00:00:00+09:00")
            main.DOC.write(n, replaces=d)
        main.tick()
        self.assertEqual([(c["id"], c["status"]) for c in main.DOC.read()["inbox"]], [("b", "approved")])
        self.assertEqual(main.DOC.read()["projects"], [])

    def test_mail_stays_out_of_the_document_and_is_asked_for(self):
        main.DROP.mkdir(parents=True, exist_ok=True)
        (main.DROP / "m.json").write_text(json.dumps({"id": "m", "target": "note", "createdAt": "2026-11-03T10:00:00+09:00", "fields": {"title": "M"},
            "source": {"from": "kim", "threadId": "1a0f", "attachments": ["a.pdf"], "text": "hello"}}))
        main.tick()
        m = next(c for c in main.DOC.read()["inbox"] if c["id"] == "m")
        self.assertEqual((m["threadId"], m["attachments"]), ("1a0f", ["a.pdf"]))
        self.assertNotIn("text", m)
        self.assertEqual(main.inbox_mail("m", {})["text"], "hello")
        self.assertEqual(main.inbox_mail("nobody", {})["text"], "")
        with self.assertRaises(main.HTTPException):
            main.inbox_mail("../x", {})
        with main.DOC.lock:                                                          # leave the inbox as it was
            d = main.DOC.read()
            main.DOC.write({**d, "inbox": [c for c in d["inbox"] if c["id"] != "m"]}, replaces=d)

    def test_feedback_logged_once_decided_once_per_wording(self):
        def lines():
            return [json.loads(x) for x in main.FEEDBACK.read_text(encoding="utf-8").splitlines()] if main.FEEDBACK.exists() else []
        before = len(lines())
        row = {"id": "f", "status": "waiting", "feedback": "미팅이면 일정으로", "subject": "s"}
        main._log_feedback([row])
        self.assertEqual(len(lines()), before)                                       # not decided yet
        row["status"] = "discarded"
        main._log_feedback([row])
        main._log_feedback([row])
        self.assertEqual(len(lines()), before + 1)
        self.assertEqual(lines()[-1]["feedback"], "미팅이면 일정으로")
        row["feedback"] = "다시 쓴 말"
        main._log_feedback([row])
        self.assertEqual(len(lines()), before + 2)

    def test_undecided_first_then_newest_mail(self):
        rows = [
            {"id": "done-new", "status": "approved", "date": "2026-11-03"},
            {"id": "wait-old", "status": "waiting", "date": "2026-10-01"},
            {"id": "gone-mid", "status": "discarded", "date": "2026-10-28~30"},
            {"id": "wait-new", "status": "waiting", "date": "2026-11-02"},
            {"id": "done-old", "status": "checked", "createdAt": "2026-10-20T10:00:00+09:00"},
        ]
        self.assertEqual([c["id"] for c in main._order(rows)], ["wait-new", "wait-old", "done-new", "gone-mid", "done-old"])


if __name__ == "__main__":
    unittest.main()
