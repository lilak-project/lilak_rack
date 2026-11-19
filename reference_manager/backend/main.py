"""reference_manager backend — one shared document per portal project.

  references  the papers: citeKey, title, authors[], journal, year, tags[], cites[], pdf
  journals    a class with fields of its own (shortName, abbrev)
  authors     a class: one person, a #handle, and the spellings they appear under
  settings    service-wide, e.g. pdfRoots — where a linked PDF may live

The document is stored whole and guarded by a version (rackstore.store):
a save edited from an older version is refused with 409 and the current
document, so two people editing at once cannot silently overwrite each other.

The PDFs: a browser cannot open file:///… from an http page, so the service
reads the file for it — only from the roots the project lists, and only after
the path is resolved (store.mount_files). The screen is the kit's RackService.
"""
import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

from lilak_portal_auth import signed_in
from rackstore.store import Document, mount_files, mount_spa

from webread import image_ext, read_image, read_page

# The portal hands each project process its own data dir via {project_data}.
DATA = Path(os.environ.get("REFERENCE_DATA_DIR", "./data"))
PROJECT = os.environ.get("PORTAL_PROJECT", "")
DIST = Path(os.environ.get("REFERENCE_DIST_DIR", "/app/reference_manager/dist"))

DOC = Document(DATA / "data.json", keys=("references", "journals", "authors", "settings"),
               what="레퍼런스 데이터", links=(("references", "journal", "journals"),))

app = FastAPI(title="reference_manager")
DOC.mount(app, project=PROJECT)
mount_files(app, DOC, setting="pdfRoots", exts=(".pdf",))


class Fetch(BaseModel):
    url: str


@app.post("/api/fetch")
def fetch(body: Fetch, me: dict = Depends(signed_in)):
    """A web reference as it reads now: its title, its text's hash and a few
    lines to start the key information from. The page decides nothing here —
    the person keeps what they want of it."""
    return read_page(body.url)


# A web reference's figures are kept here, in the project's own data (decided
# 2026-11-19), named by the hash of the original — the same figure twice is
# one file. The page shrinks one over 2MB before it is kept (a canvas; no
# imaging library on the server).
WEB = DATA / "web"
KEEP_BYTES = 4_000_000


@app.post("/api/web-image")
def web_image(body: Fetch, me: dict = Depends(signed_in)):
    """The original bytes, to be kept as they are or shrunk first."""
    data, kind, digest = read_image(body.url)
    return Response(data, media_type=kind, headers={"X-Hash": digest, "Cache-Control": "no-store"})


@app.put("/api/web-image")
async def keep_image(hash: str, request: Request, me: dict = Depends(signed_in)):
    """Keep a figure (shrunk or not) under the hash of its original."""
    if len(hash) != 64 or any(c not in "0123456789abcdef" for c in hash):
        raise HTTPException(400, "해시가 아닙니다.")
    data = await request.body()
    if len(data) > KEEP_BYTES:
        raise HTTPException(413, "줄인 뒤에도 너무 큽니다.")
    ext = image_ext(data)
    if not ext:
        raise HTTPException(415, "그림 파일이 아닙니다.")
    WEB.mkdir(parents=True, exist_ok=True)
    name = hash[:20] + ext
    (WEB / name).write_bytes(data)
    return {"name": name, "size": len(data)}


@app.get("/api/web-image")
def show_image(name: str, me: dict = Depends(signed_in)):
    real = (WEB / name).resolve()
    if real.parent != WEB.resolve() or not real.is_file():
        raise HTTPException(404, "그림이 없습니다.")
    return FileResponse(real, headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})

# Must stay last: the catch-all would shadow /api/*.
mount_spa(app, DIST, name="reference_manager")
