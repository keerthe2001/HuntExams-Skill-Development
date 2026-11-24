"""Admin API for the /links page: settings, links, categories, campaigns, live preview,
analytics and CSV export. Admin-only (users whose email is in HX_ADMIN_EMAILS)."""

import csv
import io
import re
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import api_error, not_found
from app.deps import AdminUser, DbDep, SettingsDep
from app.links import (
    IST,
    category_out,
    creator_content,
    creator_out,
    ist_today,
    item_out,
    owner_creator,
    page_url,
)
from app.links_render import auto_thumbnail, normalise_item_url, render_page, safe_url
from app.models import (
    NIL_ITEM,
    AuditLog,
    LinkCampaign,
    LinkCategory,
    LinkCreator,
    LinkEvent,
    LinkItem,
    User,
)

router = APIRouter(prefix="/admin/links", tags=["admin-links"])

HEX = r"^#[0-9a-fA-F]{6}$"
SLOT = r"^[0-9]{0,20}$"
Platform = Literal[
    "instagram", "youtube", "linkedin", "telegram", "whatsapp", "x", "website", "email"
]
EMAIL_RE = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[^@\s<>\"']+$")


def _http_url(v: str | None, field: str, required: bool = False) -> str | None:
    v = (v or "").strip()
    if not v:
        if required:
            raise ValueError(f"Add the {field}.")
        return None
    if not safe_url(v):
        raise ValueError(f"The {field} must start with https:// (or http://).")
    return v


def _audit(db: AsyncSession, actor: User, action: str, target: str, **detail: Any) -> None:
    db.add(AuditLog(actor_id=actor.id, action=action, target=target, detail=detail))


# ---------------------------------------------------------------- settings


class SocialIn(BaseModel):
    platform: Platform
    url: str = Field(max_length=300)

    @field_validator("url")
    @classmethod
    def _url(cls, v: str, info: Any) -> str:
        v = v.strip()
        if info.data.get("platform") == "email":
            v = v.removeprefix("mailto:")
            if not EMAIL_RE.match(v):
                raise ValueError("Enter a valid email address.")
            return v
        return _http_url(v, "social link", required=True) or ""


class ThemeIn(BaseModel):
    accent: str = Field(default="#4ade80", pattern=HEX)
    highlight: str = Field(default="#f5c451", pattern=HEX)


class AdsIn(BaseModel):
    enabled: bool = False
    top: str = Field(default="", pattern=SLOT)
    middle: str = Field(default="", pattern=SLOT)
    bottom: str = Field(default="", pattern=SLOT)


class SettingsIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    tagline: str = Field(default="", max_length=160)
    bio: str = Field(default="", max_length=600)
    avatar_url: str | None = Field(default=None, max_length=500)
    logo_url: str | None = Field(default=None, max_length=500)
    verified: bool = True
    socials: list[SocialIn] = Field(default_factory=list, max_length=12)
    theme: ThemeIn = Field(default_factory=ThemeIn)
    ad_settings: AdsIn = Field(default_factory=AdsIn)
    published: bool = True

    @field_validator("name", "tagline", "bio")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("avatar_url", "logo_url")
    @classmethod
    def _img(cls, v: str | None) -> str | None:
        return _http_url(v, "image URL")

    def as_columns(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "tagline": self.tagline,
            "bio": self.bio,
            "avatar_url": self.avatar_url,
            "logo_url": self.logo_url,
            "verified": self.verified,
            "socials": [s.model_dump() for s in self.socials],
            "theme": self.theme.model_dump(),
            "ad_settings": self.ad_settings.model_dump(),
            "published": self.published,
        }


async def _owner(db: AsyncSession, request: Request) -> LinkCreator:
    return await owner_creator(db, request.app.state.settings)


@router.get("/settings")
async def get_settings(request: Request, db: DbDep, settings: SettingsDep, _: AdminUser) -> dict:
    creator = await _owner(db, request)
    return {
        "creator": creator_out(creator),
        "page_url": page_url(settings, creator.handle),
        "adsense_ready": bool(settings.adsense_publisher_id),
    }


@router.put("/settings")
async def put_settings(body: SettingsIn, request: Request, db: DbDep, user: AdminUser) -> dict:
    creator = await _owner(db, request)
    for key, value in body.as_columns().items():
        setattr(creator, key, value)
    if creator.owner_user_id is None:
        creator.owner_user_id = user.id
    _audit(db, user, "links.settings", creator.handle)
    await db.commit()
    return {"creator": creator_out(creator)}


# ---------------------------------------------------------------- categories


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Give the section a name.")
        return v


class ReorderIn(BaseModel):
    ids: list[uuid.UUID] = Field(max_length=1000)


async def _category(db: AsyncSession, creator: LinkCreator, cid: uuid.UUID) -> LinkCategory:
    cat = await db.get(LinkCategory, cid)
    if not cat or cat.creator_id != creator.id:
        raise not_found("That section doesn't exist.")
    return cat


@router.get("/categories")
async def list_categories(request: Request, db: DbDep, _: AdminUser) -> list[dict]:
    creator = await _owner(db, request)
    cats, _items = await creator_content(db, creator, active_only=False)
    return cats


@router.post("/categories", status_code=201)
async def add_category(body: CategoryIn, request: Request, db: DbDep, user: AdminUser) -> dict:
    creator = await _owner(db, request)
    top = await db.scalar(
        select(func.max(LinkCategory.sort_order)).where(LinkCategory.creator_id == creator.id)
    )
    cat = LinkCategory(creator_id=creator.id, name=body.name, sort_order=(top or 0) + 1)
    db.add(cat)
    _audit(db, user, "links.category.add", body.name)
    await db.commit()
    return category_out(cat)


@router.put("/categories/reorder")
async def reorder_categories(
    body: ReorderIn, request: Request, db: DbDep, _: AdminUser
) -> list[dict]:
    creator = await _owner(db, request)
    cats = {
        c.id: c
        for c in await db.scalars(select(LinkCategory).where(LinkCategory.creator_id == creator.id))
    }
    if any(i not in cats for i in body.ids):
        raise api_error(400, "Unknown section in the new order.", "invalid")
    order = list(dict.fromkeys(body.ids)) + [c for c in cats if c not in body.ids]
    for n, cid in enumerate(order, start=1):
        cats[cid].sort_order = n
    await db.commit()
    return [category_out(cats[c]) for c in order]


@router.put("/categories/{cid}")
async def rename_category(
    cid: uuid.UUID, body: CategoryIn, request: Request, db: DbDep, user: AdminUser
) -> dict:
    creator = await _owner(db, request)
    cat = await _category(db, creator, cid)
    cat.name = body.name
    _audit(db, user, "links.category.rename", body.name)
    await db.commit()
    return category_out(cat)


@router.delete("/categories/{cid}", status_code=204)
async def delete_category(cid: uuid.UUID, request: Request, db: DbDep, user: AdminUser) -> Response:
    creator = await _owner(db, request)
    cat = await _category(db, creator, cid)
    # Its links stay, uncategorised (the foreign key is ON DELETE SET NULL; done here too so
    # it also holds on databases without that rule).
    for item in await db.scalars(select(LinkItem).where(LinkItem.category_id == cat.id)):
        item.category_id = None
    _audit(db, user, "links.category.delete", cat.name)
    await db.delete(cat)
    await db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- items


class ItemIn(BaseModel):
    kind: Literal["link", "pdf", "video", "course"] = "link"
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    url: str = Field(max_length=1000)
    backup_url: str | None = Field(default=None, max_length=1000)
    thumbnail_url: str | None = Field(default=None, max_length=1000)
    category_id: uuid.UUID | None = None
    badge: Literal["NEW", "FREE", "HOT", "LIVE"] | None = None
    featured: bool = False
    active: bool = True
    open_mode: Literal["preview", "download"] = "preview"

    @field_validator("title", "description")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        return _http_url(v, "link URL", required=True) or ""

    @field_validator("backup_url")
    @classmethod
    def _backup(cls, v: str | None) -> str | None:
        return _http_url(v, "backup URL")

    @field_validator("thumbnail_url")
    @classmethod
    def _thumb(cls, v: str | None) -> str | None:
        return _http_url(v, "thumbnail URL")

    @field_validator("badge", mode="before")
    @classmethod
    def _badge(cls, v: Any) -> Any:
        return v or None

    def as_columns(self) -> dict[str, Any]:
        url = normalise_item_url(self.url, self.kind, self.open_mode)
        thumb = self.thumbnail_url
        if not thumb and self.kind in ("pdf", "video", "course"):
            thumb = auto_thumbnail(self.url)
        backup = (
            normalise_item_url(self.backup_url, self.kind, self.open_mode)
            if self.backup_url
            else None
        )
        return {
            "kind": self.kind,
            "title": self.title,
            "description": self.description,
            "url": url,
            "backup_url": backup,
            "thumbnail_url": thumb,
            "category_id": self.category_id,
            "badge": self.badge,
            "featured": self.featured,
            "active": self.active,
            "open_mode": self.open_mode,
        }


async def _item(db: AsyncSession, creator: LinkCreator, iid: uuid.UUID) -> LinkItem:
    item = await db.get(LinkItem, iid)
    if not item or item.creator_id != creator.id:
        raise not_found("That link doesn't exist.")
    return item


async def _check_category(db: AsyncSession, creator: LinkCreator, cid: uuid.UUID | None) -> None:
    if cid is not None:
        cat = await db.get(LinkCategory, cid)
        if not cat or cat.creator_id != creator.id:
            raise api_error(422, "Pick a section that exists.", "invalid")


@router.get("/items")
async def list_items(request: Request, db: DbDep, _: AdminUser) -> dict:
    creator = await _owner(db, request)
    cats, items = await creator_content(db, creator, active_only=False)
    return {"categories": cats, "items": items}


@router.post("/items", status_code=201)
async def add_item(body: ItemIn, request: Request, db: DbDep, user: AdminUser) -> dict:
    creator = await _owner(db, request)
    await _check_category(db, creator, body.category_id)
    top = await db.scalar(
        select(func.max(LinkItem.sort_order)).where(LinkItem.creator_id == creator.id)
    )
    item = LinkItem(creator_id=creator.id, sort_order=(top or 0) + 1, **body.as_columns())
    db.add(item)
    _audit(db, user, "links.item.add", body.title)
    await db.commit()
    return item_out(item)


@router.put("/items/reorder")
async def reorder_items(body: ReorderIn, request: Request, db: DbDep, _: AdminUser) -> list[dict]:
    creator = await _owner(db, request)
    items = {
        i.id: i for i in await db.scalars(select(LinkItem).where(LinkItem.creator_id == creator.id))
    }
    if any(i not in items for i in body.ids):
        raise api_error(400, "Unknown link in the new order.", "invalid")
    rest = sorted((i for i in items.values() if i.id not in body.ids), key=lambda i: i.sort_order)
    order = list(dict.fromkeys(body.ids)) + [i.id for i in rest]
    for n, iid in enumerate(order, start=1):
        items[iid].sort_order = n
    await db.commit()
    return [item_out(items[i]) for i in order]


@router.put("/items/{iid}")
async def update_item(
    iid: uuid.UUID, body: ItemIn, request: Request, db: DbDep, user: AdminUser
) -> dict:
    creator = await _owner(db, request)
    item = await _item(db, creator, iid)
    await _check_category(db, creator, body.category_id)
    for key, value in body.as_columns().items():
        setattr(item, key, value)
    _audit(db, user, "links.item.edit", body.title)
    await db.commit()
    return item_out(item)


@router.delete("/items/{iid}", status_code=204)
async def delete_item(iid: uuid.UUID, request: Request, db: DbDep, user: AdminUser) -> Response:
    creator = await _owner(db, request)
    item = await _item(db, creator, iid)
    _audit(db, user, "links.item.delete", item.title)
    await db.delete(item)
    await db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- campaigns


class CampaignIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    slug: str = Field(min_length=1, max_length=60)

    @field_validator("label")
    @classmethod
    def _label(cls, v: str) -> str:
        return v.strip()

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.fullmatch(r"[a-z0-9-]{1,60}", v):
            raise ValueError("Use lowercase letters, numbers and dashes only (like insta-bio).")
        return v


def _campaign_out(c: LinkCampaign, settings: Any) -> dict[str, Any]:
    base = settings.public_site_url.rstrip("/")
    return {
        "id": str(c.id),
        "slug": c.slug,
        "label": c.label,
        "created_at": c.created_at,
        "url": f"{base}/links?src={c.slug}",
    }


@router.get("/campaigns")
async def list_campaigns(
    request: Request, db: DbDep, settings: SettingsDep, _: AdminUser
) -> list[dict]:
    creator = await _owner(db, request)
    rows = await db.scalars(
        select(LinkCampaign)
        .where(LinkCampaign.creator_id == creator.id)
        .order_by(LinkCampaign.created_at.desc())
    )
    return [_campaign_out(c, settings) for c in rows]


@router.post("/campaigns", status_code=201)
async def add_campaign(
    body: CampaignIn, request: Request, db: DbDep, settings: SettingsDep, user: AdminUser
) -> dict:
    creator = await _owner(db, request)
    c = LinkCampaign(creator_id=creator.id, slug=body.slug, label=body.label)
    db.add(c)
    _audit(db, user, "links.campaign.add", body.slug)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise api_error(409, "A campaign with that slug already exists.", "duplicate") from None
    return _campaign_out(c, settings)


@router.delete("/campaigns/{cid}", status_code=204)
async def delete_campaign(cid: uuid.UUID, request: Request, db: DbDep, user: AdminUser) -> Response:
    creator = await _owner(db, request)
    c = await db.get(LinkCampaign, cid)
    if not c or c.creator_id != creator.id:
        raise not_found("That campaign doesn't exist.")
    _audit(db, user, "links.campaign.delete", c.slug)
    await db.delete(c)
    await db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- live preview


class PreviewItem(BaseModel):
    id: str | None = None
    kind: Literal["link", "pdf", "video", "course"] = "link"
    title: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=500)
    url: str = Field(default="", max_length=1000)
    thumbnail_url: str | None = Field(default=None, max_length=1000)
    category_id: str | None = None
    badge: str | None = None
    featured: bool = False
    active: bool = True
    open_mode: Literal["preview", "download"] = "preview"


class PreviewCategory(BaseModel):
    id: str
    name: str = Field(max_length=80)


class PreviewIn(BaseModel):
    settings: SettingsIn
    categories: list[PreviewCategory] = Field(default_factory=list, max_length=200)
    items: list[PreviewItem] = Field(default_factory=list, max_length=500)


@router.post("/preview")
async def preview(
    body: PreviewIn, request: Request, db: DbDep, settings: SettingsDep, _: AdminUser
) -> dict:
    """Render unsaved settings and links with the same renderer as the live page."""
    creator = await _owner(db, request)
    data = {"handle": creator.handle, **body.settings.as_columns()}
    items = [i.model_dump() for i in body.items if i.active and i.title.strip()]
    for i in items:
        i["thumbnail_url"] = safe_url(i["thumbnail_url"])
        i["url"] = safe_url(i["url"]) or ""
    html = render_page(
        data,
        [c.model_dump() for c in body.categories],
        items,
        canonical=page_url(settings, creator.handle),
        adsense_publisher_id=settings.adsense_publisher_id,
        preview=True,
    )
    return {"html": html}


# ---------------------------------------------------------------- analytics

ROLLUP_SQL = text(
    """
    INSERT INTO link_daily (creator_id, item_id, day, type, campaign, events, uniques)
    SELECT creator_id, COALESCE(item_id, :nil), (created_at AT TIME ZONE 'Asia/Kolkata')::date,
           type, COALESCE(campaign, ''), count(*), count(DISTINCT visitor)
    FROM link_events
    WHERE creator_id = :c AND created_at >= :lo AND created_at < :hi
    GROUP BY 1, 2, 3, 4, 5
    ON CONFLICT (creator_id, item_id, day, type, campaign)
    DO UPDATE SET events = EXCLUDED.events, uniques = EXCLUDED.uniques
    """
)
LIVE_SQL = text(
    """
    SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           COALESCE(item_id, :nil) AS item_id,
           type, COALESCE(campaign, '') AS campaign, count(*) AS events,
           count(DISTINCT visitor) AS uniques
    FROM link_events
    WHERE creator_id = :c AND created_at >= :lo AND created_at < :hi
    GROUP BY 1, 2, 3, 4
    """
)
STATE_SQL = text(
    """
    INSERT INTO link_rollup_state (creator_id, last_day) VALUES (:c, :d)
    ON CONFLICT (creator_id) DO UPDATE
    SET last_day = GREATEST(link_rollup_state.last_day, EXCLUDED.last_day)
    """
)


def ist_midnight(d: date) -> datetime:
    """The UTC instant at which India-time day `d` starts."""
    return datetime.combine(d, time.min, tzinfo=IST).astimezone(UTC)


async def rollup(db: AsyncSession, creator: LinkCreator) -> date | None:
    """Roll finished India-time days into link_daily, then drop raw events over 13 months old.

    Runs lazily when analytics opens (the free plan has no cron). Returns the last day rolled.
    """
    yesterday = ist_today() - timedelta(days=1)
    state = await db.scalar(
        text("SELECT last_day FROM link_rollup_state WHERE creator_id = :c"), {"c": creator.id}
    )
    if state is not None:
        start = state + timedelta(days=1)
    else:
        first = await db.scalar(
            select(func.min(LinkEvent.created_at)).where(LinkEvent.creator_id == creator.id)
        )
        if first is None:
            return None
        start = first.astimezone(IST).date()
    if start <= yesterday:
        await db.execute(
            ROLLUP_SQL,
            {
                "nil": NIL_ITEM,
                "c": creator.id,
                "lo": ist_midnight(start),
                "hi": ist_midnight(yesterday + timedelta(days=1)),
            },
        )
        await db.execute(STATE_SQL, {"c": creator.id, "d": yesterday})
        state = yesterday
    if state is not None:
        cutoff = min(
            datetime.now(UTC) - timedelta(days=396),  # ~13 months
            ist_midnight(state + timedelta(days=1)),
        )
        await db.execute(
            delete(LinkEvent).where(
                LinkEvent.creator_id == creator.id, LinkEvent.created_at < cutoff
            )
        )
    await db.commit()
    return state


async def daily_rows(
    db: AsyncSession, creator: LinkCreator, frm: date, to: date, last_day: date | None
) -> list[dict[str, Any]]:
    """Daily totals for [frm, to]: rolled-up days from link_daily, newer days live from events.

    Analytics and the CSV export both read this, so their totals always match.
    """
    rows: list[dict[str, Any]] = []
    if last_day is not None and frm <= last_day:
        res = await db.execute(
            text(
                "SELECT day, item_id, type, campaign, events, uniques FROM link_daily "
                "WHERE creator_id = :c AND day >= :f AND day <= :t"
            ),
            {"c": creator.id, "f": frm, "t": min(to, last_day)},
        )
        rows += [dict(r._mapping) for r in res]
    live_from = frm if last_day is None else max(frm, last_day + timedelta(days=1))
    if live_from <= to:
        res = await db.execute(
            LIVE_SQL,
            {
                "nil": NIL_ITEM,
                "c": creator.id,
                "lo": ist_midnight(live_from),
                "hi": ist_midnight(to + timedelta(days=1)),
            },
        )
        rows += [dict(r._mapping) for r in res]
    rows.sort(key=lambda r: (r["day"], r["type"], str(r["item_id"]), r["campaign"]))
    return rows


def _range(frm: date | None, to: date | None) -> tuple[date, date]:
    to = to or ist_today()
    frm = frm or (to - timedelta(days=29))
    if frm > to:
        raise api_error(422, "The start date is after the end date.", "invalid")
    if (to - frm).days > 400:
        raise api_error(422, "Pick a range of 400 days or less.", "invalid")
    return frm, to


FromQ = Query(default=None, alias="from")
ToQ = Query(default=None, alias="to")


async def _breakdown(
    db: AsyncSession, creator: LinkCreator, column: Any, frm: date, to: date
) -> list[dict[str, Any]]:
    res = await db.execute(
        select(column, func.count())
        .where(
            LinkEvent.creator_id == creator.id,
            LinkEvent.type == "view",
            LinkEvent.created_at >= ist_midnight(frm),
            LinkEvent.created_at < ist_midnight(to + timedelta(days=1)),
        )
        .group_by(column)
        .order_by(func.count().desc())
        .limit(20)
    )
    return [{"name": name or "Direct / unknown", "views": n} for name, n in res]


@router.get("/analytics")
async def analytics(
    request: Request, db: DbDep, _: AdminUser, frm: date | None = FromQ, to: date | None = ToQ
) -> dict:
    creator = await _owner(db, request)
    frm, to = _range(frm, to)
    last_day = await rollup(db, creator)
    rows = await daily_rows(db, creator, frm, to, last_day)

    def total(kind: str, key: str) -> int:
        return sum(r[key] for r in rows if r["type"] == kind)

    views, clicks, downloads = (
        total("view", "events"),
        total("click", "events"),
        total("download", "events"),
    )
    days: dict[date, dict[str, Any]] = {}
    d = frm
    while d <= to:
        days[d] = {"day": d.isoformat(), "views": 0, "clicks": 0, "downloads": 0}
        d += timedelta(days=1)
    for r in rows:
        days[r["day"]][
            {"view": "views", "click": "clicks", "download": "downloads"}[r["type"]]
        ] += r["events"]

    _cats, items = await creator_content(db, creator, active_only=False)
    titles = {i["id"]: i for i in items}
    per_item: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r["type"] == "view":
            continue
        iid = str(r["item_id"])
        meta = titles.get(iid)
        row = per_item.setdefault(
            iid,
            {
                "id": iid,
                "title": meta["title"] if meta else "(deleted link)",
                "kind": meta["kind"] if meta else None,
                "clicks": 0,
                "uniques": 0,
                "last_clicked": None,
            },
        )
        row["clicks"] += r["events"]
        row["uniques"] += r["uniques"]
    last = await db.execute(
        select(LinkEvent.item_id, func.max(LinkEvent.created_at))
        .where(
            LinkEvent.creator_id == creator.id,
            LinkEvent.type != "view",
            LinkEvent.created_at < ist_midnight(to + timedelta(days=1)),
        )
        .group_by(LinkEvent.item_id)
    )
    for iid, ts in last:
        if str(iid) in per_item:
            per_item[str(iid)]["last_clicked"] = ts

    labels = {
        c.slug: c.label
        for c in await db.scalars(select(LinkCampaign).where(LinkCampaign.creator_id == creator.id))
    }
    per_campaign: dict[str, dict[str, Any]] = {}
    for r in rows:
        row = per_campaign.setdefault(
            r["campaign"],
            {
                "campaign": r["campaign"] or None,
                "label": labels.get(r["campaign"])
                or ("No campaign" if not r["campaign"] else None),
                "views": 0,
                "clicks": 0,
                "downloads": 0,
            },
        )
        row[{"view": "views", "click": "clicks", "download": "downloads"}[r["type"]]] += r["events"]

    return {
        "from": frm.isoformat(),
        "to": to.isoformat(),
        "rolled_up_to": last_day.isoformat() if last_day else None,
        "totals": {
            "views": views,
            "unique_visitors": total("view", "uniques"),
            "clicks": clicks,
            "unique_clickers": total("click", "uniques"),
            "downloads": downloads,
            "unique_downloaders": total("download", "uniques"),
            "ctr": round((clicks + downloads) / views, 4) if views else 0,
        },
        "daily": list(days.values()),
        "items": sorted(per_item.values(), key=lambda x: (-x["clicks"], x["title"])),
        "campaigns": sorted(
            per_campaign.values(), key=lambda x: -(x["views"] + x["clicks"] + x["downloads"])
        ),
        "referrers": await _breakdown(db, creator, LinkEvent.referrer, frm, to),
        "countries": await _breakdown(db, creator, LinkEvent.country, frm, to),
        "devices": await _breakdown(db, creator, LinkEvent.device, frm, to),
        "browsers": await _breakdown(db, creator, LinkEvent.browser, frm, to),
    }


def _csv_cell(v: Any) -> Any:
    # Stop spreadsheet apps from running a title as a formula.
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


@router.get("/export.csv")
async def export_csv(
    request: Request, db: DbDep, _: AdminUser, frm: date | None = FromQ, to: date | None = ToQ
) -> Response:
    creator = await _owner(db, request)
    frm, to = _range(frm, to)
    last_day = await rollup(db, creator)
    rows = await daily_rows(db, creator, frm, to, last_day)
    _cats, items = await creator_content(db, creator, active_only=False)
    titles = {i["id"]: i["title"] for i in items}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["day", "item", "type", "campaign", "events", "uniques"])
    for r in rows:
        iid = r["item_id"]
        item = "(page)" if iid == NIL_ITEM else titles.get(str(iid), "(deleted link)")
        w.writerow(
            [
                r["day"].isoformat(),
                _csv_cell(item),
                r["type"],
                r["campaign"],
                r["events"],
                r["uniques"],
            ]
        )
    name = f"links-{frm.isoformat()}-to-{to.isoformat()}.csv"
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
