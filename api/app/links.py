"""Public side of the /links link-in-bio page: the page itself, click and view tracking,
the owner seed, and the sitemap/robots files.

Privacy: no raw IP address or user agent is stored. A visitor is a 32-character hash of
(daily salt + IP + user agent), and the salt changes every India-time day, so the same
person can't be followed from one day to the next.
"""

import hashlib
import hmac
import json
import logging
import re
import uuid
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core import api_error, not_found
from app.deps import DbDep, SettingsDep
from app.links_render import not_found_page, render_page
from app.models import Guide, LinkCategory, LinkCreator, LinkEvent, LinkItem, PublishStatus

logger = logging.getLogger("huntexams.links")

IST = timezone(timedelta(hours=5, minutes=30))
HANDLE_RE = re.compile(r"^[a-z0-9._]{2,40}$")
CAMPAIGN_RE = re.compile(r"^[a-z0-9-]{1,60}$")
BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|preview|headless|curl|wget|python|httpx|aiohttp|requests|java/|"
    r"go-http|okhttp|axios|node-fetch|undici|libwww|scrapy|facebookexternalhit|whatsapp/|"
    r"lighthouse|pagespeed|pingdom|uptime|monitor|phantom|selenium|playwright|puppeteer|"
    r"postman|insomnia|httpie|feedfetcher|embedly|quora link|vkshare|bingpreview",
    re.IGNORECASE,
)
MAX_EVENT_BYTES = 2000
VIEW_DEDUPE = timedelta(minutes=30)
CLICK_DEDUPE = timedelta(seconds=30)
EVENTS_PER_MINUTE = 20

public = APIRouter(include_in_schema=False)  # /links, /go, /sitemap.xml, /robots.txt
api = APIRouter(prefix="/links", tags=["links"])  # mounted under /api


# ---------------------------------------------------------------- creator helpers


def owner_defaults(handle: str) -> dict[str, Any]:
    return {
        "handle": handle,
        "name": "Keertheology",
        "tagline": "Career Hacks, AI Tools & Free Resources",
        "bio": "Every resource from my reels in one place: free PDFs, AI tools, videos and "
        "courses to grow your tech career.",
        "verified": True,
        "socials": [{"platform": "instagram", "url": "https://www.instagram.com/keertheology/"}],
        "theme": {"accent": "#4ade80", "highlight": "#f5c451"},
        "ad_settings": {"enabled": False, "top": "", "middle": "", "bottom": ""},
        "published": True,
    }


async def owner_creator(db: AsyncSession, settings: Settings) -> LinkCreator:
    """The owner's creator row, created with the default profile (and no links) if missing."""
    handle = settings.links_owner_handle.lower()
    creator = await db.scalar(select(LinkCreator).where(LinkCreator.handle == handle))
    if creator:
        return creator
    creator = LinkCreator(**owner_defaults(handle))
    db.add(creator)
    try:
        await db.commit()
    except IntegrityError:  # created by a concurrent request
        await db.rollback()
        creator = await db.scalar(select(LinkCreator).where(LinkCreator.handle == handle))
    if creator is None:
        raise RuntimeError("links owner creator missing")
    return creator


def creator_out(c: LinkCreator) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "handle": c.handle,
        "name": c.name,
        "tagline": c.tagline,
        "bio": c.bio,
        "avatar_url": c.avatar_url,
        "logo_url": c.logo_url,
        "verified": c.verified,
        "socials": c.socials or [],
        "theme": c.theme or {},
        "ad_settings": c.ad_settings or {},
        "published": c.published,
    }


def category_out(c: LinkCategory) -> dict[str, Any]:
    return {"id": str(c.id), "name": c.name, "sort_order": c.sort_order}


def item_out(i: LinkItem) -> dict[str, Any]:
    return {
        "id": str(i.id),
        "kind": i.kind,
        "title": i.title,
        "description": i.description,
        "url": i.url,
        "backup_url": i.backup_url,
        "thumbnail_url": i.thumbnail_url,
        "category_id": str(i.category_id) if i.category_id else None,
        "badge": i.badge,
        "featured": i.featured,
        "active": i.active,
        "sort_order": i.sort_order,
        "open_mode": i.open_mode,
    }


async def creator_content(
    db: AsyncSession, creator: LinkCreator, *, active_only: bool
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cats = await db.scalars(
        select(LinkCategory)
        .where(LinkCategory.creator_id == creator.id)
        .order_by(LinkCategory.sort_order, LinkCategory.name)
    )
    q = select(LinkItem).where(LinkItem.creator_id == creator.id)
    if active_only:
        q = q.where(LinkItem.active.is_(True))
    items = await db.scalars(q.order_by(LinkItem.sort_order, LinkItem.created_at))
    return [category_out(c) for c in cats], [item_out(i) for i in items]


def page_url(settings: Settings, handle: str) -> str:
    base = settings.public_site_url.rstrip("/")
    if handle == settings.links_owner_handle.lower():
        return f"{base}/links"
    return f"{base}/links/{handle}"


# ---------------------------------------------------------------- tracking helpers


def clean_campaign(src: Any) -> str | None:
    if not isinstance(src, str):
        return None
    src = src.strip().lower()
    return src if CAMPAIGN_RE.match(src) else None


def is_bot(ua: str) -> bool:
    return not ua.strip() or bool(BOT_RE.search(ua))


def device_of(ua: str) -> str:
    u = ua.lower()
    if "ipad" in u or "tablet" in u or ("android" in u and "mobile" not in u):
        return "tablet"
    if "mobi" in u or "iphone" in u or "ipod" in u or "android" in u:
        return "mobile"
    return "desktop"


def browser_of(ua: str) -> str:
    u = ua.lower()
    if "instagram" in u:
        return "Instagram"
    if "samsungbrowser" in u:
        return "Samsung"
    if "edg/" in u or "edga/" in u or "edgios/" in u:
        return "Edge"
    if "firefox/" in u or "fxios/" in u:
        return "Firefox"
    if "chrome/" in u or "crios/" in u:
        return "Chrome"
    if "safari/" in u:
        return "Safari"
    return "Other"


def client_ip(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip", "").strip()
    if cf:
        return cf
    fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if fwd:
        return fwd
    return request.client.host if request.client else ""


def ist_today(now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(IST).date()


def visitor_id(settings: Settings, ip: str, ua: str, now: datetime | None = None) -> str:
    key = (settings.links_salt or settings.secret_key).encode()
    salt = hmac.new(key, ist_today(now).isoformat().encode(), hashlib.sha256).hexdigest()
    return hashlib.sha256(f"{salt}{ip}{ua}".encode()).hexdigest()[:32]


def referrer_host(ref: Any, own_host: str | None = None) -> str | None:
    if not isinstance(ref, str) or not ref.strip():
        return None
    try:
        host = (urlparse(ref.strip()).hostname or "").lower()
    except ValueError:
        return None
    host = host.removeprefix("www.")
    if not host or len(host) > 255 or not re.fullmatch(r"[a-z0-9.-]+", host):
        return None
    if own_host and host == own_host.lower().removeprefix("www."):
        return None
    return host


def country_of(request: Request) -> str | None:
    c = request.headers.get("cf-ipcountry", "").strip().upper()
    return c if re.fullmatch(r"[A-Z]{2}", c) and c not in ("XX", "T1") else None


async def record(
    request: Request,
    db: AsyncSession,
    creator: LinkCreator,
    kind: str,
    *,
    item_id: uuid.UUID | None = None,
    campaign: str | None = None,
    referrer: str | None = None,
) -> str:
    """Store one event. Returns 'stored', 'bot', 'duplicate' or 'limited'."""
    settings: Settings = request.app.state.settings
    ua = request.headers.get("user-agent", "")[:512]
    if is_bot(ua):
        return "bot"
    visitor = visitor_id(settings, client_ip(request), ua)
    if not request.app.state.limiter.hit(f"links:{visitor}", EVENTS_PER_MINUTE):
        return "limited"
    now = datetime.now(UTC)
    window = VIEW_DEDUPE if kind == "view" else CLICK_DEDUPE
    dup = select(LinkEvent.id).where(
        LinkEvent.creator_id == creator.id,
        LinkEvent.visitor == visitor,
        LinkEvent.created_at > now - window,
    )
    if kind == "view":
        dup = dup.where(LinkEvent.type == "view")
    else:
        dup = dup.where(LinkEvent.item_id == item_id, LinkEvent.type != "view")
    if await db.scalar(dup.limit(1)):
        return "duplicate"
    db.add(
        LinkEvent(
            creator_id=creator.id,
            item_id=item_id,
            type=kind,
            visitor=visitor,
            campaign=campaign,
            referrer=referrer,
            country=country_of(request),
            device=device_of(ua),
            browser=browser_of(ua),
            created_at=now,
        )
    )
    await db.commit()
    return "stored"


# ---------------------------------------------------------------- public page


def _html(body: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(body, status_code=status, headers={"Cache-Control": "no-cache"})


async def _render(request: Request, db: AsyncSession, settings: Settings, handle: str) -> Response:
    owner = settings.links_owner_handle.lower()
    if handle == owner:
        await owner_creator(db, settings)
    creator = await db.scalar(select(LinkCreator).where(LinkCreator.handle == handle))
    if not creator or not creator.published:
        return _html(not_found_page(), 404)
    categories, items = await creator_content(db, creator, active_only=True)
    return _html(
        render_page(
            creator_out(creator),
            categories,
            items,
            canonical=page_url(settings, creator.handle),
            src=clean_campaign(request.query_params.get("src")),
            adsense_publisher_id=settings.adsense_publisher_id,
        )
    )


@public.get("/links")
async def links_home(request: Request, db: DbDep, settings: SettingsDep) -> Response:
    return await _render(request, db, settings, settings.links_owner_handle.lower())


@public.get("/links/{handle}")
async def links_handle(handle: str, request: Request, db: DbDep, settings: SettingsDep) -> Response:
    handle = handle.lower().strip()
    if handle == settings.links_owner_handle.lower():
        src = request.query_params.get("src")
        target = "/links" + (f"?src={quote(src, safe='')}" if src else "")
        return RedirectResponse(target, status_code=301)
    if not HANDLE_RE.match(handle):
        return _html(not_found_page(), 404)
    return await _render(request, db, settings, handle)


@public.get("/links/")
async def links_slash(request: Request) -> Response:
    q = request.url.query
    return RedirectResponse("/links" + (f"?{q}" if q else ""), status_code=301)


def _go_redirect(url: str) -> RedirectResponse:
    return RedirectResponse(
        url,
        status_code=302,
        headers={"X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store"},
    )


@public.get("/go/{item_id}")
async def go(item_id: str, request: Request, db: DbDep) -> Response:
    try:
        iid = uuid.UUID(item_id)
    except ValueError:
        return _go_redirect("/links")
    item = await db.get(LinkItem, iid)
    if not item or not item.active:
        return _go_redirect("/links")
    target = item.url
    try:
        creator = await db.get(LinkCreator, item.creator_id)
        if creator:
            await record(
                request,
                db,
                creator,
                "download" if item.kind == "pdf" else "click",
                item_id=item.id,
                campaign=clean_campaign(request.query_params.get("src")),
                referrer=referrer_host(request.headers.get("referer"), request.url.hostname),
            )
    except Exception:  # counting must never break the visitor's tap
        logger.exception("links: could not record click for %s", item_id)
        await db.rollback()
    return _go_redirect(target)


@api.post("/event", status_code=204)
async def view_event(request: Request, db: DbDep) -> Response:
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_EVENT_BYTES:
        raise api_error(413, "Event too large.", "too_large")
    raw = b""
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > MAX_EVENT_BYTES:
            raise api_error(413, "Event too large.", "too_large")
    try:
        data = json.loads(raw or b"null")
    except (ValueError, UnicodeDecodeError):
        raise api_error(400, "Invalid event.", "invalid") from None
    if not isinstance(data, dict) or not isinstance(data.get("handle"), str):
        raise api_error(400, "Invalid event.", "invalid")
    for key in ("src", "ref"):
        if data.get(key) is not None and not isinstance(data[key], str):
            raise api_error(400, "Invalid event.", "invalid")
    handle = data["handle"].strip().lower()
    creator = (
        await db.scalar(select(LinkCreator).where(LinkCreator.handle == handle))
        if HANDLE_RE.match(handle)
        else None
    )
    if not creator or not creator.published:
        raise not_found("No such links page.")
    outcome = await record(
        request,
        db,
        creator,
        "view",
        campaign=clean_campaign(data.get("src")),
        referrer=referrer_host(data.get("ref"), request.url.hostname),
    )
    if outcome == "limited":
        raise api_error(429, "Too many events.", "rate_limited")
    return Response(status_code=204)


@api.get("/{handle}")
async def links_json(handle: str, db: DbDep, settings: SettingsDep) -> dict:
    handle = handle.lower().strip()
    if handle == settings.links_owner_handle.lower():
        await owner_creator(db, settings)
    creator = await db.scalar(select(LinkCreator).where(LinkCreator.handle == handle))
    if not creator or not creator.published:
        raise not_found("No such links page.")
    categories, items = await creator_content(db, creator, active_only=True)
    out = creator_out(creator)
    out.pop("ad_settings")
    out.pop("id")
    public_items = [
        {k: v for k, v in i.items() if k not in ("url", "backup_url", "active")}
        | {"href": f"/go/{i['id']}"}
        for i in items
    ]
    return {"creator": out, "categories": categories, "items": public_items}


# ---------------------------------------------------------------- SEO files

STATIC_PAGES = ["/", "/learn", "/guides", "/pricing", "/links", "/about", "/privacy", "/terms"]


@public.get("/sitemap.xml")
async def sitemap(db: DbDep, settings: SettingsDep) -> Response:
    base = settings.public_site_url.rstrip("/")
    paths = list(STATIC_PAGES)
    owner = settings.links_owner_handle.lower()
    for handle in await db.scalars(
        select(LinkCreator.handle).where(LinkCreator.published.is_(True))
    ):
        if handle != owner:
            paths.append(f"/links/{handle}")
    for slug in await db.scalars(
        select(Guide.slug).where(Guide.status == PublishStatus.PUBLISHED).order_by(Guide.id)
    ):
        paths.append(f"/guides/{slug}")
    urls = "".join(f"<url><loc>{base}{p}</loc></url>" for p in paths)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    )
    return Response(
        xml, media_type="application/xml", headers={"Cache-Control": "public, max-age=3600"}
    )


@public.get("/robots.txt")
async def robots(settings: SettingsDep) -> PlainTextResponse:
    base = settings.public_site_url.rstrip("/")
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        "Disallow: /go/\n"
        "Disallow: /admin\n"
        "Disallow: /dashboard\n"
        f"\nSitemap: {base}/sitemap.xml\n"
    )
    return PlainTextResponse(body, headers={"Cache-Control": "public, max-age=3600"})
