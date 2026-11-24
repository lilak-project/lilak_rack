"""The language a request's words come back in: the page sends the one its reader chose
(header `X-Lang` or `?lang=`, from lilak-ui's `currentLang()`), and a message the server writes for a person
is said in it.

    mount_lang(app)            reads the header on every request
    say("한국어", "English")    the one for this request (Korean when none was sent)
"""
from contextvars import ContextVar

_lang: ContextVar = ContextVar("rack_lang", default="ko")


def mount_lang(app) -> None:
    @app.middleware("http")
    async def _read(request, call_next):
        # The header, or `?lang=` (the portal's proxy passes on only a few headers, and not this one).
        want = request.headers.get("x-lang") or request.query_params.get("lang") or ""
        token = _lang.set("en" if want.lower().startswith("en") else "ko")
        try:
            return await call_next(request)
        finally:
            _lang.reset(token)


def say(ko: str, en: str) -> str:
    return en if _lang.get() == "en" else ko
