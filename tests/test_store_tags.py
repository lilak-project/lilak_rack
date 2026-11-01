"""The rack store's shared tags: what it wears, who wears one, and renaming
one (or merging several) in every record, whatever the case.

    service_manager/.venv/bin/python lilak_rack/tests/test_store_tags.py
"""
import os
import tempfile
import time
import unittest
from pathlib import Path

TMP = Path(tempfile.mkdtemp())
os.environ["PORTAL_SECRET_KEY"] = "test-secret"
os.environ["PORTAL_DATA_ROOT"] = str(TMP / "data")
os.environ.pop("PORTAL_PORT", None)

from fastapi import FastAPI                  # noqa: E402
from fastapi.testclient import TestClient    # noqa: E402
from jose import jwt                         # noqa: E402

from rackstore.store import Document  # noqa: E402

H = {"Authorization": "Bearer " + jwt.encode({"sub": "1", "username": "kim", "email": "kim@x", "role": "user",
                                              "portal": True, "exp": time.time() + 600}, "test-secret", algorithm="HS256")}


class Tags(unittest.TestCase):
    def setUp(self):
        (TMP / "data" / "_portal").mkdir(parents=True, exist_ok=True)
        (TMP / "data" / "_portal" / "secret.key").write_text("test-secret")
        self.doc = Document(TMP / f"s{time.time_ns()}.json", keys=("items", "groups", "settings"))
        d = self.doc.read()
        d["items"] = [{"id": "a", "tags": ["SpiRIT", "TPC"], "mainTag": "spirit"},
                      {"id": "b", "tags": ["spirit"]}, {"id": "c", "tags": ["EOS"]}]
        d["groups"] = [{"id": "g", "tags": ["Spirit"]}]
        self.doc.write(d)
        app = FastAPI()
        self.doc.mount(app)
        self.c = TestClient(app)

    def test_counts_and_tagged(self):
        self.assertEqual(self.c.get("/api/tags", headers=H).json()["tags"]["SpiRIT"], 1)
        got = self.c.get("/api/tagged?tag=SPIRIT", headers=H).json()["items"]
        self.assertEqual(sorted(x["rec"]["id"] for x in got), ["a", "b", "g"])

    def test_rename_merges_every_spelling_once(self):
        r = self.c.post("/api/tags/rename", json={"from": ["spirit", "tpc"], "to": "S-TPC"}, headers=H).json()
        self.assertEqual(r["changed"], 3)
        d = self.doc.read()
        by = {x["id"]: x for x in d["items"] + d["groups"]}
        self.assertEqual(by["a"]["tags"], ["S-TPC"])
        self.assertEqual(by["a"]["mainTag"], "S-TPC")
        self.assertEqual(by["b"]["tags"], ["S-TPC"])
        self.assertEqual(by["g"]["tags"], ["S-TPC"])
        self.assertEqual(by["c"]["tags"], ["EOS"])

    def test_empty_name_deletes_the_tag(self):
        r = self.c.post("/api/tags/rename", json={"from": ["SPIRIT"], "to": ""}, headers=H).json()
        self.assertEqual(r["changed"], 3)
        d = self.doc.read()
        by = {x["id"]: x for x in d["items"] + d["groups"]}
        self.assertEqual((by["a"]["tags"], by["a"]["mainTag"]), (["TPC"], ""))
        self.assertEqual((by["b"]["tags"], by["g"]["tags"], by["c"]["tags"]), ([], [], ["EOS"]))


class Records(Tags):
    def test_add_record_gets_an_id_and_goes_on_top(self):
        r = self.c.post("/api/records", json={"key": "items", "record": {"name": "new", "tags": ["X"]}}, headers=H).json()["record"]
        self.assertTrue(r["id"] and r["createdAt"])
        self.assertEqual(self.doc.read()["items"][0]["name"], "new")
        self.assertEqual(self.c.post("/api/records", json={"key": "settings", "record": {}}, headers=H).status_code, 400)
        self.assertEqual(self.c.post("/api/records", json={"key": "items", "record": {"id": "a"}}, headers=H).status_code, 409)

    def test_update_record_lays_fields_over_one(self):
        r = self.c.post("/api/records/update", json={"key": "items", "id": "b", "fields": {"place": "Zoom", "id": "x"}}, headers=H).json()["record"]
        self.assertEqual((r["id"], r["place"], r["tags"]), ("b", "Zoom", ["spirit"]))
        self.assertTrue(r["updatedAt"])
        self.assertEqual(self.c.post("/api/records/update", json={"key": "items", "id": "zz", "fields": {}}, headers=H).status_code, 404)


class Trash(unittest.TestCase):
    """The bin (Bin, shared with note): a record deleted is listed, and comes back."""
    def test_delete_list_restore(self):
        (TMP / "data" / "_portal").mkdir(parents=True, exist_ok=True)
        (TMP / "data" / "_portal" / "secret.key").write_text("test-secret")
        doc = Document(TMP / f"t{time.time_ns()}.json", keys=("items", "settings"))
        d = doc.read()
        d["items"] = [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]
        doc.write(d)
        app = FastAPI()
        doc.mount(app)
        c = TestClient(app)
        d = doc.read()
        doc.write({**d, "items": [r for r in d["items"] if r["id"] != "a"]}, "kim@x")
        got = c.get("/api/trash", headers=H).json()
        self.assertEqual([(t["key"], t["record"]["id"], t["by"]) for t in got], [("items", "a", "kim@x")])
        back = c.post("/api/trash/restore", json={"key": "items", "id": "a"}, headers=H).json()
        self.assertEqual([r["id"] for r in back["items"]], ["a", "b"])
        self.assertEqual(c.get("/api/trash", headers=H).json(), [])
        self.assertEqual(c.post("/api/trash/restore", json={"key": "items", "id": "a"}, headers=H).status_code, 404)


if __name__ == "__main__":
    unittest.main()
