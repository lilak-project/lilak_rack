"""The rack store's uploads: a file in, the same file out, and nothing else.

    service_manager/.venv/bin/python lilak_rack/tests/test_store_uploads.py
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

from rackstore.store import mount_uploads    # noqa: E402

AUTH = {"Authorization": "Bearer " + jwt.encode(
    {"sub": "1", "username": "kim", "email": "kim@x", "role": "user", "portal": True,
     "exp": time.time() + 600}, "test-secret", algorithm="HS256")}


class Uploads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = Path(os.environ["PORTAL_DATA_ROOT"])
        (data / "_portal").mkdir(parents=True)
        (data / "_portal" / "secret.key").write_text("test-secret")
        cls.root = TMP / "proj" / "uploads"
        app = FastAPI()
        mount_uploads(app, cls.root, cap_mb=1)
        cls.c = TestClient(app)

    def test_round_trip(self):
        r = self.c.post("/api/uploads", params={"name": "그림 1.png"}, content=b"\x89PNG", headers=AUTH)
        self.assertEqual(r.status_code, 200, r.text)
        got = r.json()
        self.assertEqual((got["name"], got["size"], got["type"], got["by"]), ("그림 1.png", 4, "image/png", "kim@x"))
        self.assertTrue((self.root / got["id"] / "그림 1.png").is_file())
        f = self.c.get(f"/api/uploads/{got['id']}/{got['name']}", headers=AUTH)
        self.assertEqual((f.status_code, f.content), (200, b"\x89PNG"))
        self.assertIn("inline", f.headers["content-disposition"])

    def test_name_cannot_leave_its_folder(self):
        r = self.c.post("/api/uploads", params={"name": "../../etc/passwd"}, content=b"x", headers=AUTH)
        self.assertEqual(r.json()["name"], "passwd")
        self.assertEqual(self.c.get("/api/uploads/../../x", headers=AUTH).status_code, 404)
        self.assertEqual(self.c.get("/api/uploads/notanid/x", headers=AUTH).status_code, 400)

    def test_needs_sign_in_and_a_size(self):
        self.assertEqual(self.c.post("/api/uploads", params={"name": "a"}, content=b"x").status_code, 401)
        self.assertEqual(self.c.post("/api/uploads", params={"name": "a"}, content=b"", headers=AUTH).status_code, 400)
        big = b"x" * (1024 * 1024 + 1)
        self.assertEqual(self.c.post("/api/uploads", params={"name": "a"}, content=big, headers=AUTH).status_code, 413)


if __name__ == "__main__":
    unittest.main()
