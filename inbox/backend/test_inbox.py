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
    def test_an_activitys_clock_times_say_they_are_korean(self):
        import approve
        self.assertEqual([approve.tz(k) for k in ("startTime", "endTime", "talkTime", "start", "place")],
                         [" (KST)", " (KST)", " (KST)", "", ""])

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
            if "activities" in path and path.endswith("/api/data"):
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
        self.assertIn(("POST", "/pp/activities/activities/api/records/update",
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



class Kinds(unittest.TestCase):
    """note_delete (into the bin, only if still as shown) and tags (each picked item's tags added)."""

    def setUp(self):
        self.calls, self.body = [], ""

        def fake(auth, method, path, body=None):
            self.calls.append((method, path, body))
            if "/api/notes/" in path and method == "GET":
                return {"id": path.rsplit("/", 1)[1], "title": "T", "version": "v3", "body": self.body}
            if path.endswith("/api/data"):
                return {"authors": [{"id": "a1", "name": "Kim", "tags": ["STARK"]}], "settings": {}}
            return {}
        self.real, ap.call = ap.call, fake
        self.addCleanup(lambda: setattr(ap, "call", self.real))
        main.app.dependency_overrides[main.signed_in] = lambda: {"authenticated": True, "username": "u"}
        self.addCleanup(main.app.dependency_overrides.clear)
        with main.DOC.lock:
            d = main.DOC.read()
            main.DOC.write({**d, "inbox": [
                {"id": "del", "target": "note_delete", "status": "waiting", "title": "Untitled", "noteId": "2026-11-19-x",
                 "destProj": "note", "excerpt": ""},
                {"id": "tg", "target": "tags", "status": "waiting", "remark": "r", "items": [
                    {"service": "authors", "project": "authors", "id": "a1", "title": "Kim", "add": ["#stark", "ELARK"]},
                    {"service": "note", "project": "note", "id": "n9", "title": "N", "add": ["ELARK"]}]},
            ]}, replaces=d)
        from fastapi.testclient import TestClient
        self.c = TestClient(main.app)

    def status(self, cid):
        return next(c for c in main.DOC.read()["inbox"] if c["id"] == cid)

    def test_a_note_delete_says_so_and_goes_to_the_bin_only_if_unchanged(self):
        card = next(x for x in self.c.get("/api/pending").json()["items"] if x["id"] == "del")
        self.assertEqual((card["actions"], card["title"]), (["trash", "discard"], "Untitled"))
        self.assertEqual(self.c.post("/api/inbox/del/decide", json={"action": "approve"}).status_code, 409)
        self.body = "someone wrote here"
        self.assertEqual(self.c.post("/api/inbox/del/decide", json={"action": "trash"}).status_code, 502)
        self.assertNotIn("DELETE", [m for m, _, _ in self.calls])
        self.body = "  \n"
        r = self.c.post("/api/inbox/del/decide", json={"action": "trash"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn(("DELETE", "/pp/note/note/api/notes/2026-11-19-x", None), self.calls)
        self.assertEqual(self.status("del")["made"]["id"], "2026-11-19-x")

    def test_a_note_up_for_the_bin_can_be_kept_with_a_title(self):
        card = next(x for x in self.c.get("/api/pending").json()["items"] if x["id"] == "del")
        self.assertTrue(card.get("retitle"))
        self.assertEqual(self.c.post("/api/inbox/del/decide", json={"action": "retitle", "title": "  "}).status_code, 502)
        r = self.c.post("/api/inbox/del/decide", json={"action": "retitle", "title": "Kept"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn(("PUT", "/pp/note/note/api/notes/2026-11-19-x", {"title": "Kept"}), self.calls)
        self.assertNotIn("DELETE", [m for m, _, _ in self.calls])
        self.assertEqual((self.status("del")["status"], self.status("del")["made"]["label"]), ("checked", "Kept"))

    def test_a_record_delete_goes_only_while_the_record_is_as_it_was(self):
        snap = {"id": "a1", "name": "Kim", "tags": ["STARK"]}
        with main.DOC.lock:
            d = main.DOC.read()
            main.DOC.write({**d, "inbox": d["inbox"] + [
                {"id": "rd", "target": "record_delete", "status": "waiting", "title": "authors authors a1",
                 "svc": "authors", "destProj": "authors", "key": "authors", "recordId": "a1", "snapshot": {**snap, "name": ""}}]},
                replaces=d)
        card = next(x for x in self.c.get("/api/pending").json()["items"] if x["id"] == "rd")
        self.assertEqual((card["actions"], card["goes"]), (["trash", "discard"], "authors/authors"))
        self.assertEqual(self.c.post("/api/inbox/rd/decide", json={"action": "trash"}).status_code, 502)   # named since
        self.assertFalse([c for c in self.calls if c[1].endswith("/records/delete")])
        with main.DOC.lock:
            d = main.DOC.read()
            n = copy.deepcopy(d)
            next(x for x in n["inbox"] if x["id"] == "rd")["snapshot"] = snap
            main.DOC.write(n, replaces=d)
        r = self.c.post("/api/inbox/rd/decide", json={"action": "trash"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn(("POST", "/pp/authors/authors/api/records/delete", {"key": "authors", "id": "a1"}), self.calls)

    def test_tags_are_added_to_the_picked_items_keeping_what_they_had(self):
        d = self.c.get("/api/inbox/tg").json()["sections"][0]
        self.assertEqual((d["k"], d["pick"], [r["add"] for r in d["rows"]]), ("items", True, [["stark", "ELARK"], ["ELARK"]]))
        r = self.c.post("/api/inbox/tg/decide", json={"action": "approve", "pick": [0]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn(("POST", "/pp/authors/authors/api/records/update",
                       {"key": "authors", "id": "a1", "fields": {"tags": ["STARK", "ELARK"]}}), self.calls)   # STARK had it
        self.assertFalse([c for c in self.calls if "/pp/note/" in c[1]])                                    # left out
        self.assertEqual((self.status("tg")["picked"], self.status("tg")["made"]["label"]), ([0], "태그 1건"))

    def test_a_notes_tag_line_grows_or_one_is_put_first(self):
        self.assertEqual(ap.with_tags("#a #b\n\ntext", ["B", "c"]), "#a #b #c\n\ntext")
        self.assertEqual(ap.with_tags("text\nmore", ["c"]), "#c\n\ntext\nmore")
        self.assertEqual(ap.with_tags("", ["c"]), "#c\n")


if __name__ == "__main__":
    unittest.main()
