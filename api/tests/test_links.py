"""The /links link-in-bio page: public page, tracking rules, admin and analytics.

These follow the acceptance checklist in the rebuild spec.
"""

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta

from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, text, update

from app.links import browser_of, clean_campaign, device_of, is_bot, referrer_host
from app.links_render import auto_thumbnail, normalise_item_url
from app.models import LinkCampaign, LinkCategory, LinkDaily, LinkEvent, LinkItem, LinkRollupState
from tests.conftest import register

PHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Mobile/22B83 Instagram 356.0.0.24.84"
)


def visitor(n: int) -> dict[str, str]:
    return {"user-agent": PHONE, "cf-connecting-ip": f"203.0.113.{n}", "cf-ipcountry": "IN"}


async def admin_client(app) -> AsyncClient:  # type: ignore[no-untyped-def]
    c = AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"X-HX-Client": "web"}
    )
    await c.post("/api/auth/login", json={"email": "admin@test.dev", "password": "correct-horse-1"})
    if (await c.get("/api/me")).status_code != 200:
        await register(c, "admin@test.dev", name="Admin")
    return c


async def reset_links(app) -> None:  # type: ignore[no-untyped-def]
    async with app.state.db.sessionmaker() as db:
        for model in (LinkEvent, LinkDaily, LinkRollupState, LinkItem, LinkCategory, LinkCampaign):
            await db.execute(delete(model))
        await db.commit()


async def events(app) -> list[LinkEvent]:  # type: ignore[no-untyped-def]
    async with app.state.db.sessionmaker() as db:
        return list(await db.scalars(select(LinkEvent).order_by(LinkEvent.id)))


# ---------------------------------------------------------------- pure helpers


def test_helpers() -> None:
    assert clean_campaign("Insta") == "insta"
    assert clean_campaign("reel-12") == "reel-12"
    assert clean_campaign("bad campaign") is None
    assert clean_campaign("x" * 61) is None
    assert clean_campaign("<script>") is None
    assert is_bot("curl/8.5.0") and is_bot("") and is_bot("Googlebot/2.1")
    assert is_bot("facebookexternalhit/1.1") and is_bot("python-requests/2.32")
    assert not is_bot(PHONE)
    assert device_of(PHONE) == "mobile"
    assert device_of("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)") == "tablet"
    assert device_of("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0") == "desktop"
    assert browser_of(PHONE) == "Instagram"
    assert browser_of("Mozilla/5.0 (Linux; Android 14) SamsungBrowser/26.0 Chrome/122") == "Samsung"
    assert (
        browser_of("Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36 Edg/131.0") == "Edge"
    )
    assert referrer_host("https://l.instagram.com/?u=abc&e=xyz") == "l.instagram.com"
    assert referrer_host("https://www.huntexams.com/links", "huntexams.com") is None
    assert referrer_host("javascript:alert(1)") is None


def test_drive_and_youtube_links_are_converted() -> None:
    share = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing"
    assert normalise_item_url(share, "pdf", "preview") == (
        "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview"
    )
    assert normalise_item_url(share, "pdf", "download") == (
        "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp"
    )
    assert normalise_item_url("https://youtu.be/dQw4w9WgXcQ?t=3", "video", "preview") == (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    )
    assert auto_thumbnail("https://www.youtube.com/shorts/dQw4w9WgXcQ") == (
        "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    )
    assert "thumbnail?id=1AbCdEfGhIjKlMnOp" in (auto_thumbnail(share) or "")


# ---------------------------------------------------------------- public page


async def test_owner_page_is_seeded_server_rendered_and_seo_ready(app, client) -> None:  # type: ignore[no-untyped-def]
    await reset_links(app)
    r = await client.get("/links")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    html = r.text
    assert "<title>Keertheology — Career Hacks, AI Tools &amp; Free Resources</title>" in html
    assert 'rel="canonical" href="http://localhost:5174/links"' in html
    assert "Powered by Hunt" in html and 'href="/privacy"' in html and 'href="/terms"' in html
    assert "Fresh resources are on their way" in html  # empty link list
    assert "adsbygoogle" not in html  # ads are off by default
    assert "/api/links/event" in html and "sendBeacon" in html

    # The owner handle 301s to /links and keeps the campaign.
    r = await client.get("/links/Keertheology?src=insta")
    assert r.status_code == 301 and r.headers["location"] == "/links?src=insta"
    # Unknown handle: 404 page.
    r = await client.get("/links/nobody-here")
    assert r.status_code == 404 and "doesn" in r.text
    # Not caught by the legacy redirects, and in the sitemap.
    r = await client.get("/sitemap.xml")
    assert r.status_code == 200 and "<loc>http://localhost:5174/links</loc>" in r.text
    assert "Disallow: /go/" in (await client.get("/robots.txt")).text

    data = (await client.get("/api/links/keertheology")).json()
    assert data["creator"]["name"] == "Keertheology" and data["items"] == []
    assert (await client.get("/api/links/nobody-here")).status_code == 404


async def test_view_beacon_rules(app, client) -> None:  # type: ignore[no-untyped-def]
    await reset_links(app)
    await client.get("/links")
    body = '{"handle":"keertheology","src":"Insta","ref":"https://l.instagram.com/x?y=1"}'
    # sendBeacon posts text/plain with no custom header: must still be accepted.
    plain = {"content-type": "text/plain;charset=UTF-8", **visitor(1)}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        r = await anon.post("/api/links/event", content=body, headers=plain)
        assert r.status_code == 204, r.text
        # Same visitor within 30 minutes: accepted but not stored again.
        assert (await anon.post("/api/links/event", content=body, headers=plain)).status_code == 204
        stored = await events(app)
        assert len(stored) == 1
        ev = stored[0]
        assert (ev.type, ev.campaign, ev.referrer, ev.country) == (
            "view",
            "insta",
            "l.instagram.com",
            "IN",
        )
        assert (ev.device, ev.browser, len(ev.visitor)) == ("mobile", "Instagram", 32)

        # 30 minutes later the same visitor counts again.
        async with app.state.db.sessionmaker() as db:
            await db.execute(
                update(LinkEvent).values(created_at=datetime.now(UTC) - timedelta(minutes=31))
            )
            await db.commit()
        await anon.post("/api/links/event", content=body, headers=plain)
        assert len(await events(app)) == 2

        # Bots and curl are never counted.
        for ua in ("curl/8.5.0", "Mozilla/5.0 (compatible; Googlebot/2.1)", ""):
            h = {**visitor(9), "user-agent": ua}
            assert (await anon.post("/api/links/event", content=body, headers=h)).status_code == 204
        assert len(await events(app)) == 2

        # Bad input.
        big = '{"handle":"keertheology","ref":"' + "x" * 2100 + '"}'
        assert (await anon.post("/api/links/event", content=big, headers=plain)).status_code == 413
        assert (
            await anon.post("/api/links/event", content="nope", headers=plain)
        ).status_code == 400
        assert (
            await anon.post("/api/links/event", content='{"handle":5}', headers=plain)
        ).status_code == 400
        assert (
            await anon.post("/api/links/event", content='{"handle":"ghost"}', headers=plain)
        ).status_code == 404

        # A bad campaign is stored as no campaign.
        bad = '{"handle":"keertheology","src":"DROP TABLE;"}'
        await anon.post("/api/links/event", content=bad, headers={**plain, **visitor(2)})
        assert (await events(app))[-1].campaign is None

        # More than 20 events a minute from one visitor: 429.
        app.state.limiter.reset()
        codes = [
            (await anon.post("/api/links/event", content=body, headers=visitor(3))).status_code
            for _ in range(22)
        ]
        assert codes[:20] == [204] * 20 and codes[-1] == 429

    # No raw IP or user agent anywhere in the events table.
    async with app.state.db.sessionmaker() as db:
        dump = str([tuple(r) for r in (await db.execute(text("SELECT * FROM link_events")))])
    assert "203.0.113" not in dump and "iPhone" not in dump and "Mozilla" not in dump


# ---------------------------------------------------------------- admin + clicks + analytics


async def test_admin_manage_click_and_analytics(app, client) -> None:  # type: ignore[no-untyped-def]
    await reset_links(app)
    # Only admins.
    await register(client)
    assert (await client.get("/api/admin/links/settings")).status_code == 403
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
        assert (await anon.get("/api/admin/links/analytics")).status_code == 401

    admin = await admin_client(app)
    try:
        s = (await admin.get("/api/admin/links/settings")).json()["creator"]
        assert s["handle"] == "keertheology"

        cat = (await admin.post("/api/admin/links/categories", json={"name": "Free PDFs"})).json()
        tools = (await admin.post("/api/admin/links/categories", json={"name": "AI tools"})).json()
        pdf = (
            await admin.post(
                "/api/admin/links/items",
                json={
                    "kind": "pdf",
                    "title": "SQL cheat sheet",
                    "url": "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing",
                    "open_mode": "download",
                    "category_id": cat["id"],
                    "badge": "FREE",
                    "featured": True,
                },
            )
        ).json()
        assert pdf["url"] == "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp"
        assert pdf["thumbnail_url"].startswith("https://drive.google.com/thumbnail")
        video = (
            await admin.post(
                "/api/admin/links/items",
                json={
                    "kind": "video",
                    "title": "Reel explained",
                    "url": "https://youtu.be/dQw4w9WgXcQ",
                },
            )
        ).json()
        assert video["thumbnail_url"] == "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
        link = (
            await admin.post(
                "/api/admin/links/items",
                json={
                    "title": "ChatGPT prompts",
                    "url": "https://example.com/prompts",
                    "category_id": tools["id"],
                },
            )
        ).json()
        bad = await admin.post(
            "/api/admin/links/items", json={"title": "x", "url": "javascript:alert(1)"}
        )
        assert bad.status_code == 422

        # Reorder: AI tools section first.
        await admin.put(
            "/api/admin/links/categories/reorder", json={"ids": [tools["id"], cat["id"]]}
        )
        html = (await client.get("/links?src=insta")).text
        assert html.index("AI tools") < html.index("Free PDFs") < html.index("Reel explained")
        assert f'href="/go/{pdf["id"]}?src=insta"' in html  # never the target directly
        assert "drive.google.com/uc" not in html
        assert "i.ytimg.com/vi/dQw4w9WgXcQ" in html and "Watch on YouTube" in html
        assert "Download PDF" in html and 'class="badge FREE"' in html and " feat" in html

        # Live preview uses the same renderer.
        cats, items = (await admin.get("/api/admin/links/items")).json().values()
        settings_body = {
            k: s[k]
            for k in (
                "name",
                "tagline",
                "bio",
                "verified",
                "socials",
                "theme",
                "ad_settings",
                "published",
            )
        }
        prev = (
            await admin.post(
                "/api/admin/links/preview",
                json={
                    "settings": {**settings_body, "tagline": "Unsaved tagline"},
                    "categories": cats,
                    "items": items,
                },
            )
        ).json()["html"]
        assert "Unsaved tagline" in prev and "Reel explained" in prev and "sendBeacon" not in prev

        # Clicks go through /go, PDFs count as downloads, and bad ids fall back to /links.
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anon:
            r = await anon.get(f"/go/{link['id']}?src=insta", headers=visitor(5))
            assert r.status_code == 302 and r.headers["location"] == "https://example.com/prompts"
            assert r.headers["x-robots-tag"].startswith("noindex")
            assert r.headers["cache-control"] == "no-store"
            await anon.get(f"/go/{link['id']}?src=insta", headers=visitor(5))  # repeat: skipped
            r = await anon.get(f"/go/{pdf['id']}", headers=visitor(5))
            assert r.headers["location"].startswith("https://drive.google.com/uc")
            await anon.get(f"/go/{pdf['id']}", headers={"user-agent": "curl/8"})  # bot
            assert (await anon.get("/go/not-a-uuid")).headers["location"] == "/links"
            assert (await anon.get(f"/go/{uuid.uuid4()}")).headers["location"] == "/links"
            await anon.post(
                "/api/links/event",
                content='{"handle":"keertheology","src":"insta"}',
                headers=visitor(5),
            )
        kinds = sorted((e.type, e.campaign) for e in await events(app))
        assert kinds == [("click", "insta"), ("download", None), ("view", "insta")]

        # Older events: two finished days, to check the rollup and CSV.
        creator_id = (await events(app))[0].creator_id
        async with app.state.db.sessionmaker() as db:
            old = datetime.now(UTC) - timedelta(days=3)
            for n, kind in enumerate(["view", "view", "click"]):
                db.add(
                    LinkEvent(
                        creator_id=creator_id,
                        item_id=None if kind == "view" else uuid.UUID(link["id"]),
                        type=kind,
                        visitor=f"v{n}".ljust(32, "0"),
                        campaign="reel-1",
                        device="mobile",
                        browser="Chrome",
                        created_at=old,
                    )
                )
            db.add(
                LinkEvent(
                    creator_id=creator_id,
                    type="view",
                    visitor="ancient".ljust(32, "0"),
                    device="desktop",
                    browser="Other",
                    created_at=datetime.now(UTC) - timedelta(days=420),
                )
            )
            await db.commit()

        a = (await admin.get("/api/admin/links/analytics")).json()
        t = a["totals"]
        assert (t["views"], t["clicks"], t["downloads"]) == (3, 2, 1)
        assert t["unique_visitors"] == 3 and t["ctr"] == 1.0
        assert len(a["daily"]) == 30
        top = a["items"][0]
        assert top["title"] == "ChatGPT prompts" and top["clicks"] == 2 and top["last_clicked"]
        camps = {c["campaign"]: c for c in a["campaigns"]}
        assert camps["insta"]["views"] == 1 and camps["reel-1"]["views"] == 2
        assert {d["name"] for d in a["devices"]} == {"mobile"}
        assert "IN" in {c["name"] for c in a["countries"]}

        async with app.state.db.sessionmaker() as db:
            rolled = list(await db.scalars(select(LinkDaily)))
            left = list(await db.scalars(select(LinkEvent.visitor)))
        assert sum(r.events for r in rolled if r.type == "view") == 3  # 2 old + the ancient one
        assert not any(v.startswith("ancient") for v in left)  # >13 months: purged

        r = await admin.get("/api/admin/links/export.csv")
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
        rows = list(csv.DictReader(io.StringIO(r.text)))
        for kind, key in (("view", "views"), ("click", "clicks"), ("download", "downloads")):
            assert sum(int(x["events"]) for x in rows if x["type"] == kind) == t[key]
        assert sum(int(x["uniques"]) for x in rows if x["type"] == "view") == t["unique_visitors"]
        assert {x["item"] for x in rows} >= {"(page)", "ChatGPT prompts", "SQL cheat sheet"}

        # Edit, delete a section (its links stay, uncategorised), delete a link.
        r = await admin.put(
            f"/api/admin/links/items/{link['id']}",
            json={**{k: link[k] for k in ("kind", "url")}, "title": "Prompt pack", "active": False},
        )
        assert r.json()["title"] == "Prompt pack"
        assert "Prompt pack" not in (await client.get("/links")).text  # inactive: hidden
        assert (await admin.delete(f"/api/admin/links/categories/{cat['id']}")).status_code == 204
        items = (await admin.get("/api/admin/links/items")).json()["items"]
        assert next(i for i in items if i["id"] == pdf["id"])["category_id"] is None
        assert (await admin.delete(f"/api/admin/links/items/{video['id']}")).status_code == 204
        assert "Reel explained" not in (await client.get("/links")).text

        # Campaigns.
        c = await admin.post(
            "/api/admin/links/campaigns", json={"label": "Instagram bio", "slug": "insta-bio"}
        )
        assert c.status_code == 201 and c.json()["url"].endswith("/links?src=insta-bio")
        dup = await admin.post(
            "/api/admin/links/campaigns", json={"label": "Again", "slug": "insta-bio"}
        )
        assert dup.status_code == 409
        bad = await admin.post(
            "/api/admin/links/campaigns", json={"label": "x", "slug": "Bad Slug"}
        )
        assert bad.status_code == 422
        assert (
            await admin.delete(f"/api/admin/links/campaigns/{c.json()['id']}")
        ).status_code == 204

        # Ads: none unless switched on AND a publisher id is configured.
        on = {
            **settings_body,
            "ad_settings": {"enabled": True, "top": "1234567890", "middle": "", "bottom": ""},
        }
        assert (await admin.put("/api/admin/links/settings", json=on)).status_code == 200
        assert "adsbygoogle" not in (await client.get("/links")).text  # no publisher id in tests
        app.state.settings.adsense_publisher_id = "ca-pub-0000000000000000"
        try:
            html = (await client.get("/links")).text
            assert html.count('class="adsbygoogle"') == 1 and "Advertisement" in html
            off = {**on, "ad_settings": {**on["ad_settings"], "enabled": False}}
            await admin.put("/api/admin/links/settings", json=off)
            assert "adsbygoogle" not in (await client.get("/links")).text
        finally:
            app.state.settings.adsense_publisher_id = None

        # Unpublished page: 404.
        await admin.put("/api/admin/links/settings", json={**settings_body, "published": False})
        assert (await client.get("/links")).status_code == 404
        await admin.put("/api/admin/links/settings", json=settings_body)
        assert (await client.get("/links")).status_code == 200
    finally:
        await admin.aclose()
