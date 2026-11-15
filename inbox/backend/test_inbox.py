"""The inbox: dropped candidates taken in once and flattened
into records of the `inbox` class, kept undecided first then newest mail, an old discard dropped.

    service_manager/.venv/bin/python inbox/backend/test_inbox.py
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
os.environ["INBOX_DATA_DIR"] = str(TMP / "data")
os.environ["INBOX_DIST_DIR"] = str(TMP / "dist")
os.environ["INBOX_TIMER"] = "0"             # ticked by hand here
os.environ.pop("PORTAL_PORT", None)
(TMP / "dist").mkdir()
(TMP / "dist" / "index.html").write_text("<html></html>")
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "lilak_portal_auth"))   # the package, not its repo folder

import main                                    # noqa: E402
import approve as ap                           # noqa: E402


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

    def test_badge_counts_what_is_still_to_be_decided(self):
        with main.DOC.lock:
            d = main.DOC.read()
            main.DOC.write({**d, "inbox": [{"id": "w1", "status": "waiting"}, {"id": "w2"}, {"id": "a", "status": "approved"},
                                           {"id": "d", "status": "discarded"}]}, replaces=d)
        self.assertEqual(main.badge({}), {"count": 2})
        with main.DOC.lock:
            d = main.DOC.read()
            main.DOC.write({**d, "inbox": []}, replaces=d)

    def test_undecided_first_then_newest_mail(self):
        rows = [
            {"id": "done-new", "status": "approved", "date": "2026-11-03"},
            {"id": "wait-old", "status": "waiting", "date": "2026-10-01"},
            {"id": "gone-mid", "status": "discarded", "date": "2026-10-28~30"},
            {"id": "wait-new", "status": "waiting", "date": "2026-11-02"},
            {"id": "done-old", "status": "checked", "createdAt": "2026-10-20T10:00:00+09:00"},
        ]
        self.assertEqual([c["id"] for c in main._order(rows)], ["wait-new", "wait-old", "done-new", "gone-mid", "done-old"])


class Decide(unittest.TestCase):
    """Cards, opening one, and deciding — the service calls made here (approve.py), faked."""

    def setUp(self):
        self.calls = []

        def fake(auth, method, path, body=None):
            self.calls.append((method, path, body))
            if path.endswith("/api/notes") and method == "POST":
                return {"id": "n1", "version": "v1"}
            if "/api/notes/" in path and method == "GET":
                return {"id": "old", "title": "있던 노트", "version": "v7", "body": "본문\n"}
            if path.endswith("/api/records"):
                return {"record": {"id": "a1"}}
            if path.endswith("/api/submit"):
                return {"id": "j1"}
            if "academic_activities" in path and path.endswith("/api/data"):
                return {"activities": [{"id": "act", "name": "TAMU", "place": "College Station"}]}
            if "project_manager" in path:
                return {"projects": [{"id": "p1", "tags": ["STARK"]}]}
            return {}
        self.real, ap.call = ap.call, fake
        self.addCleanup(lambda: setattr(ap, "call", self.real))
        main.app.dependency_overrides[main.signed_in] = lambda: {"authenticated": True, "username": "u"}
        self.addCleanup(main.app.dependency_overrides.clear)
        self.put([
            {"id": "n", "target": "note", "status": "waiting", "title": "T", "body": "b", "noteTags": "#x",
             "project": {"svc": "project_manager", "proj": "projects", "id": "p1"}, "destProj": "notes-job", "from": "kim"},
            {"id": "u", "target": "activity", "status": "waiting", "mode": "update", "match": {"id": "act"}, "place": "Houston",
             "destProj": "activities"},
            {"id": "j", "target": "job", "status": "waiting", "recipe": "scan", "jobProject": "AToM-X", "params": '{"run": 1}',
             "destProj": "jobboard"},
            {"id": "bad", "target": "activity", "status": "waiting", "name": "no date"},
            {"id": "c", "target": "note", "status": "waiting", "mode": "checked", "title": "nothing new"},
            {"id": "old", "target": "note", "status": "approved", "title": "done"},
        ])
        from fastapi.testclient import TestClient
        self.c = TestClient(main.app)

    def put(self, rows):
        with main.DOC.lock:
            d = main.DOC.read()
            main.DOC.write({**d, "inbox": rows}, replaces=d)

    def status(self, cid):
        return next(c for c in main.DOC.read()["inbox"] if c["id"] == cid)

    def test_pending_cards_carry_what_to_draw_and_nothing_decided(self):
        got = self.c.get("/api/pending").json()
        self.assertEqual(got["count"], 5)
        cards = {x["id"]: x for x in got["items"]}
        self.assertNotIn("old", cards)
        self.assertEqual((cards["n"]["actions"], cards["n"]["goes"]), (["approve", "discard"], "note/notes-job"))
        self.assertEqual(cards["u"]["actions"], ["update", "discard"])
        self.assertEqual(cards["c"]["actions"], ["check"])
        self.assertTrue(cards["bad"]["blocked"])

    def test_opening_shows_what_it_makes_or_changes(self):
        n = self.c.get("/api/inbox/n").json()["sections"]
        self.assertIn("#x #STARK", n[0]["text"])                                     # the project's tags join the note's
        u = self.c.get("/api/inbox/u").json()["sections"][0]
        self.assertEqual(u["k"], "change")
        self.assertIn(["place", "College Station", "Houston"], u["rows"])

    def test_approving_makes_it_where_it_goes_then_saves_where_it_went(self):
        r = self.c.post("/api/inbox/n/decide", json={"action": "approve"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual([(m, p) for m, p, _ in self.calls if "note" in p],
                         [("POST", "/pp/note/notes-job/api/notes"), ("PUT", "/pp/note/notes-job/api/notes/n1")])
        self.assertEqual((self.status("n")["status"], self.status("n")["made"]), ("approved", {"svc": "note", "proj": "notes-job", "id": "n1"}))
        self.c.post("/api/inbox/u/decide", json={"action": "update"})
        self.assertIn(("POST", "/pp/academic_activities/activities/api/records/update",
                       {"key": "activities", "id": "act", "fields": {"place": "Houston"}}), self.calls)
        self.c.post("/api/inbox/j/decide", json={"action": "approve"})
        self.assertEqual(self.status("j")["made"]["id"], "j1")

    def test_a_second_yes_while_the_first_is_making_it_is_refused(self):
        seen = []
        slow = ap.call

        def during(auth, method, path, body=None):
            if path.endswith("/api/notes") and method == "POST":      # the first yes is in the middle of making it
                seen.append(self.c.post("/api/inbox/n/decide", json={"action": "approve"}).status_code)
            return slow(auth, method, path, body)
        ap.call = during
        self.assertEqual(self.c.post("/api/inbox/n/decide", json={"action": "approve"}).status_code, 200)
        self.assertEqual(seen, [409])
        self.assertEqual(sum(1 for m, p, _ in self.calls if m == "POST" and p.endswith("/api/notes")), 1)
        self.assertEqual(main._MAKING, set())

    def test_what_cannot_be_done_is_refused(self):
        self.assertEqual(self.c.post("/api/inbox/bad/decide", json={"action": "approve"}).status_code, 502)
        self.assertEqual(self.c.post("/api/inbox/c/decide", json={"action": "approve"}).status_code, 409)   # only [확인]
        self.assertEqual(self.c.post("/api/inbox/old/decide", json={"action": "discard"}).status_code, 409)
        self.assertEqual(self.status("bad")["status"], "waiting")

    def test_decided_lists_the_latest_decision_first(self):
        self.c.post("/api/inbox/c/decide", json={"action": "check"})
        self.c.post("/api/inbox/n/decide", json={"action": "discard"})
        got = self.c.get("/api/decided").json()
        self.assertEqual(got["count"], 3)                                            # and "old", decided before
        self.assertEqual([x["id"] for x in got["items"]][:2], ["n", "c"])
        self.assertEqual(got["items"][0]["actions"], ["restore"])
        self.assertEqual(len(self.c.get("/api/decided?limit=1").json()["items"]), 1)

    def test_check_discard_restore(self):
        self.c.post("/api/inbox/c/decide", json={"action": "check"})
        self.assertEqual(self.status("c")["status"], "checked")
        self.c.post("/api/inbox/n/decide", json={"action": "discard"})
        self.assertEqual(self.status("n")["status"], "discarded")
        self.c.post("/api/inbox/n/decide", json={"action": "restore"})
        self.assertEqual((self.status("n")["status"], self.status("n")["made"]), ("waiting", None))
        self.assertEqual(self.calls, [])                                             # none of these reach a service


if __name__ == "__main__":
    unittest.main()
