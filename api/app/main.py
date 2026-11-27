import json
import logging
import mimetypes
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse

from app import (
    links,
    routes_admin,
    routes_auth,
    routes_learn,
    routes_links_admin,
    routes_projects,
    seo,
)
from app.config import Settings, get_settings
from app.content import content_fingerprint, sync_content
from app.core import Database, RateLimiter
from app.models import AppMeta

logger = logging.getLogger("huntexams")
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
# Public, cookie-less writes that browsers send with navigator.sendBeacon (which can't add
# headers). They change nothing a visitor owns, so they skip the client-header check.
CSRF_EXEMPT = {"/api/links/event"}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.seed_content_on_startup:
            root = Path(settings.content_dir)
            if root.is_dir():  # noqa: ASYNC240 - one stat call at startup
                async with app.state.db.sessionmaker() as session:
                    # Lessons live in the repository: when a deploy changes them, apply the
                    # change (unpublishing removed topics, keeping admin edits).
                    stamp = content_fingerprint(root)
                    meta = await session.get(AppMeta, "content_version")
                    if meta is None or meta.value != stamp:
                        result = await sync_content(session, root, overwrite=True, prune=True)
                        meta = await session.get(AppMeta, "content_version")
                        if meta is None:
                            session.add(AppMeta(key="content_version", value=stamp))
                        else:
                            meta.value = stamp
                        await session.commit()
                        logger.info("content: %s", result)
        try:
            async with app.state.db.sessionmaker() as session:
                await links.owner_creator(session, settings)
        except Exception:  # the page also creates it on first visit
            logger.exception("links: could not seed the owner creator")
        yield
        await app.state.db.dispose()

    app = FastAPI(
        title="HuntExams API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs" if settings.app_env != "production" else None,
        openapi_url="/api/openapi.json" if settings.app_env != "production" else None,
    )
    app.state.settings = settings
    app.state.db = Database(settings.database_url)
    app.state.limiter = RateLimiter()

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-HX-Client", "X-Timezone"],
        )

    @app.middleware("http")
    async def csrf_and_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        # Cookies are SameSite=Lax; requiring a custom header on writes also blocks
        # cross-site form posts, because browsers can't add it without a CORS preflight.
        if (
            request.method in MUTATING
            and request.url.path not in CSRF_EXEMPT
            and request.headers.get("x-hx-client") != "web"
        ):
            return JSONResponse(
                status_code=403,
                content={"detail": {"code": "csrf", "message": "Missing client header."}},
            )
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        path = request.url.path
        if path.startswith(("/admin", "/api/admin")):
            response.headers.setdefault("X-Robots-Tag", "noindex, nofollow")
        if path in ("/api/curriculum", "/api/glossary") and response.status_code == 200:
            # The same for everyone and changes only when content is published.
            response.headers.setdefault(
                "Cache-Control", "public, max-age=300, stale-while-revalidate=86400"
            )
        if path.startswith(("/assets/", "/pyodide/")):
            response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
        else:
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(RequestValidationError)
    async def validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {"msg": "Invalid request"}
        msg = str(first.get("msg", "Invalid request")).removeprefix("Value error, ")
        field = first.get("loc", [])[-1] if first.get("loc") else None
        return JSONResponse(
            status_code=422, content={"detail": {"code": "invalid", "message": msg, "field": field}}
        )

    @app.get("/api/health")
    async def health() -> dict:
        return {"ok": True}

    for module in (routes_auth, routes_learn, routes_projects):
        app.include_router(module.router, prefix="/api")
    app.include_router(routes_auth.me, prefix="/api")
    app.include_router(routes_admin.router, prefix="/api")
    app.include_router(routes_links_admin.router, prefix="/api")
    app.include_router(links.api, prefix="/api")
    app.include_router(seo.api, prefix="/api")
    # /links, /go/*, /sitemap.xml and /robots.txt are served here, before the web catch-all.
    app.include_router(links.public)
    if settings.web_dist:
        _serve_web(app, Path(settings.web_dist))
    return app


# Pages from the previous huntexams.com. Ones with a real equivalent here move permanently
# (301). The old course library (HTML, PHP, C++, SQL, Bootstrap, blog posts...) has no
# equivalent, so it answers 410 Gone: search engines drop those URLs quickly instead of
# treating a redirect to an unrelated page as a "soft 404".
GONE = "gone"
LEGACY_REDIRECTS: list[tuple[str, str, bool]] = [
    # (old path prefix, target, also applies to sub-pages)
    ("courses/agentic-ai", "/", True),
    ("courses/gen-ai", "/", True),
    ("courses", "/", False),
    ("courses", GONE, True),
    ("visual", "/", False),
    ("visual", GONE, True),
    ("blog", "/guides", False),
    ("blog", GONE, True),
    ("interview-questions", GONE, True),
    ("interview-room", GONE, True),
    ("companies", GONE, True),
    ("resume", GONE, True),
    ("search", "/", True),
    ("start", "/signup", False),
    ("contact", "/about", False),
    ("disclaimer", "/terms", False),
]


def legacy_target(path: str) -> str | None:
    """Where an old URL goes: a path to redirect to, GONE, or None (not an old URL)."""
    path = path.strip("/")
    for prefix, target, deep in LEGACY_REDIRECTS:
        if path == prefix or (deep and path.startswith(prefix + "/")):
            return target
    return None


# Single-page-app routes. Everything here is personal or interactive, so search engines are
# told not to index it (X-Robots-Tag). Public, indexable pages are server-rendered in seo.py.
APP_ROUTES = (
    "roadmap",
    "dashboard",
    "practice",
    "missions",
    "profile",
    "certificate",
    "admin",
    "lab",
    "diagnostic",
    "login",
    "signup",
    "forgot-password",
    "reset-password",
    "onboarding",
    "verify",
)

GONE_HTML = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<meta name="robots" content="noindex"><title>This page was removed | HuntExams</title>'
    "<style>body{font:17px/1.6 system-ui,sans-serif;max-width:560px;margin:15vh auto;"
    "padding:0 20px;"
    "color:#e8eef9;background:#0a0f0c}a{color:#4ade80}</style></head><body>"
    "<h1>This page was removed</h1><p>HuntExams is now a visual course on agentic AI "
    'engineering. The old lessons are gone.</p><p><a href="/">Start learning →</a></p>'
    "</body></html>"
)


def _serve_web(app: FastAPI, dist: Path) -> None:
    """Serve the built single-page app: real files when they exist, index.html otherwise."""
    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("text/javascript", ".mjs")
    root = dist.resolve()
    index = root / "index.html"
    if not index.is_file():
        logger.warning("HX_WEB_DIST=%s has no index.html; website not served", dist)
        return
    # Server-rendered pages for the learning world (full text for search engines).
    manifest_path = root / ".vite" / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else None
    seo.register(app, index.read_text(encoding="utf-8"), manifest)

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path.startswith("api/") or path == "api":
            return JSONResponse(  # type: ignore[return-value]
                status_code=404, content={"detail": {"code": "not_found", "message": "Not found"}}
            )
        if (target := legacy_target(path)) is not None:
            if target == GONE:
                return HTMLResponse(  # type: ignore[return-value]
                    GONE_HTML, status_code=410, headers={"X-Robots-Tag": "noindex"}
                )
            return RedirectResponse(target, status_code=301)  # type: ignore[return-value]
        candidate = (root / path).resolve()
        # Never serve anything outside the dist folder (no ../ traversal).
        if path and candidate.is_relative_to(root) and candidate.is_file():
            return FileResponse(candidate)
        first = path.strip("/").split("/", 1)[0]
        if first in APP_ROUTES:
            return FileResponse(index, headers={"X-Robots-Tag": "noindex"})
        # Anything else doesn't exist: a real 404 (the app shows its "not found" page).
        return FileResponse(index, status_code=404, headers={"X-Robots-Tag": "noindex"})
