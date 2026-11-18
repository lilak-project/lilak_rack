"""Reading a web page for a `web` reference: what it says and its hash.

The hash is over the page's visible text, whitespace folded, so a later reading
that hashes differently says the page has changed (decided 2026-11-11: change
is told by hash, the time is kept beside it for people). The service fetches
on a person's behalf, so it refuses anything but a public http(s) address —
never this machine, the local network or a cloud metadata address (SSRF).
"""
import hashlib
import ipaddress
import re
import socket
from datetime import datetime
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import HTTPException

MAX_BYTES = 3_000_000      # ponytail: one cap for every page; raise it if a real source is cut short
HOPS = 5


def public(url: str) -> str:
    """The url, if it is http(s) to a host whose every address is public."""
    # ponytail: checked by name, then httpx resolves again — a host that answers
    # differently the second time (DNS rebinding) gets past. Pin the address if that matters.
    u = urlsplit(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise HTTPException(400, "http(s) 주소만 가져올 수 있습니다.")
    try:
        addrs = {a[4][0] for a in socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80))}
    except socket.gaierror:
        raise HTTPException(400, f"주소를 찾을 수 없습니다: {u.hostname}")
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%")[0])
        if not ip.is_global:
            raise HTTPException(400, "내부 주소는 가져오지 않습니다.")
    return url.strip()


class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "template", "svg", "head"}

    def __init__(self):
        super().__init__()
        self.title, self.desc, self.parts, self._skip, self._in_title = "", "", [], 0, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag == "meta" and (a.get("name") or a.get("property") or "").lower() in ("description", "og:description"):
            self.desc = self.desc or (a.get("content") or "").strip()
        if tag in self.SKIP:
            self._skip += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in self.SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)


def fold(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def extract(html: str) -> dict:
    p = _Text()
    p.feed(html)
    text = fold(" ".join(p.parts))
    return {"title": fold(p.title), "text": text, "desc": fold(p.desc),
            "hash": hashlib.sha256(text.encode()).hexdigest()}


def read_page(url: str) -> dict:
    """Follow at most HOPS redirects, checking each address, and read the page."""
    with httpx.Client(timeout=20, follow_redirects=False, headers={"User-Agent": "lilak-reference/1"}) as c:
        for _ in range(HOPS + 1):
            url = public(url)
            with c.stream("GET", url) as r:
                if r.is_redirect:
                    url = urljoin(url, r.headers.get("location", ""))
                    continue
                if r.status_code >= 400:
                    raise HTTPException(502, f"페이지가 {r.status_code}을(를) 돌려주었습니다.")
                body = b""
                for chunk in r.iter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        raise HTTPException(413, "페이지가 너무 큽니다.")
                kind = r.headers.get("content-type", "")
                if "html" not in kind and "text" not in kind:
                    raise HTTPException(415, f"글로 된 페이지가 아닙니다 ({kind or '형식 모름'}).")
                page = extract(body.decode(r.encoding or "utf-8", errors="replace"))
                now = datetime.now().astimezone()
                return {"url": url, "title": page["title"], "hash": page["hash"],
                        "keyInfo": page["desc"] or page["text"][:600],
                        "fetched": now.strftime("%Y-%m-%d"), "fetchedTime": now.strftime("%H:%M")}
    raise HTTPException(502, "다시 보내기가 너무 많습니다.")


if __name__ == "__main__":
    # The checks that need no network.
    for bad in ("file:///etc/passwd", "http://127.0.0.1/", "http://localhost:8025/", "http://10.0.0.1/",
                "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "ftp://example.com/"):
        try:
            public(bad)
        except HTTPException:
            continue
        raise AssertionError(f"let through: {bad}")
    a = extract("<html><head><title> A  page </title><meta name=description content='Short.'>"
                "<style>x{}</style></head><body><p>Hello</p> <script>no()</script><p>world</p></body></html>")
    assert a["title"] == "A page" and a["desc"] == "Short." and a["text"] == "Hello world", a
    assert extract("<p>Hello   world</p>")["hash"] == a["hash"], "whitespace must not change the hash"
    assert extract("<p>Hello world!</p>")["hash"] != a["hash"], "a changed word must"
    print("webread: ok")
