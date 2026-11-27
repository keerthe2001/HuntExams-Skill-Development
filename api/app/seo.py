"""Server-rendered pages for search engines (and anyone with JavaScript off).

The learning world is a JavaScript app, which search engines read poorly. So every place in
it has a real URL whose HTML already contains the full text: the simple explanation, the
technical one, the words to know and the code. The world app then loads into the same page
and shows that same text in its "Read" panel, so people and Google see the same content.

Languages: English is published. Tamil (/ta/...) and Hindi (/hi/...) URLs already work and
show English until a translation exists; until then they are noindex with a canonical link to
the English page, so they never count as duplicate content.
"""

import json
import re
import time
from html import escape
from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import DbDep, SettingsDep
from app.learning import published_levels, published_path
from app.models import Guide, Lab, Level, PublishStatus, Topic

LANGS = {"en": "English", "ta": "தமிழ்", "hi": "हिन्दी"}
PUBLISHED_LANGS = ["en"]  # add "ta" / "hi" when their translations are reviewed

api = APIRouter(tags=["glossary"])  # mounted under /api


def _e(v: Any) -> str:
    return escape(str(v or ""), quote=True)


def term_slug(term: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", term.lower()).strip("-")[:80] or "term"


def md(text: str) -> str:
    """The lesson text's tiny markdown (**bold**, `code`) as safe HTML."""
    out = _e(text)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", out)


# ---------------------------------------------------------------- data


async def world_data(db: AsyncSession) -> dict[str, Any] | None:
    """Published levels and topics, plus the glossary built from every topic's words."""
    path = await published_path(db)
    if not path:
        return None
    levels = await published_levels(db, path.id)
    labs = {
        lab.topic_id: lab
        for lab in await db.scalars(select(Lab).where(Lab.status == PublishStatus.PUBLISHED))
    }
    worlds: list[dict[str, Any]] = []
    glossary: dict[str, dict[str, Any]] = {}
    for lv in levels:
        topics = []
        for t in lv.__dict__["published_topics"]:
            topics.append({"slug": t.slug, "title": t.title, "summary": t.summary})
            for pair in t.body.get("words") or []:
                if len(pair) < 2 or not str(pair[0]).strip():
                    continue
                term = str(pair[0]).strip()
                meaning = ", ".join(str(x).strip() for x in pair[1:])  # YAML may split on commas
                slug = term_slug(term)
                entry = glossary.setdefault(
                    slug, {"slug": slug, "term": term, "meaning": meaning, "topics": []}
                )
                if t.slug not in [x["slug"] for x in entry["topics"]]:
                    entry["topics"].append({"slug": t.slug, "title": t.title, "summary": t.summary})
            if t.id in labs:
                topics[-1]["lab"] = labs[t.id].slug
        worlds.append(
            {
                "number": lv.number,
                "slug": lv.slug,
                "title": lv.title,
                "summary": lv.summary,
                "topics": topics,
            }
        )
    terms = sorted(glossary.values(), key=lambda g: g["term"].lower())
    return {"title": path.title, "summary": path.summary, "worlds": worlds, "glossary": terms}


_CACHE: dict[str, Any] = {}


async def cached_world(db: AsyncSession) -> dict[str, Any] | None:
    """World data cached for a minute: it only changes when admins publish content."""
    hit = _CACHE.get("world")
    if hit and time.monotonic() - hit[0] < 60:
        return hit[1]
    data = await world_data(db)
    _CACHE["world"] = (time.monotonic(), data)
    return data


def clear_cache() -> None:
    _CACHE.clear()


@api.get("/glossary")
async def glossary(db: DbDep) -> list[dict[str, Any]]:
    data = await cached_world(db)
    return data["glossary"] if data else []


# ---------------------------------------------------------------- page shell

SSR_CSS = """
.ssr{max-width:760px;margin:0 auto;padding:32px 20px 64px;color:#e8eef9;font:17px/1.65 system-ui,
-apple-system,"Segoe UI",sans-serif}.ssr a{color:#7ee0a5}.ssr h1{font-size:34px;line-height:1.15;
margin:8px 0 12px}.ssr h2{font-size:22px;margin:32px 0 8px}.ssr h3{font-size:18px;margin:16px 0 4px}
.ssr pre{background:#0b1222;padding:14px;border-radius:10px;overflow:auto;font-size:14px}
.ssr code{font-family:ui-monospace,Menlo,monospace}.ssr nav{font-size:14px;color:#9fb0cc}
.ssr dt{font-weight:700;margin-top:10px}.ssr dd{margin:2px 0 0}.ssr .lead{font-size:19px;color:#c7d3e8}
"""


def _abs(settings: Any, path: str) -> str:
    return settings.public_site_url.rstrip("/") + path


def _lang_path(lang: str, path: str) -> str:
    if lang == "en":
        return path
    return f"/{lang}" + ("" if path == "/" else path)


def render_shell(
    template: str,
    settings: Any,
    *,
    path: str,
    lang: str,
    title: str,
    description: str,
    article: str,
    jsonld: list[dict[str, Any]] | None = None,
    image: str | None = None,
    extra_head: list[str] | None = None,
) -> str:
    """Put this page's meta tags and full text into the built index.html."""
    canonical = _abs(settings, path if lang not in PUBLISHED_LANGS else _lang_path(lang, path))
    head = [
        f"<title>{_e(title)}</title>",
        f'<meta name="description" content="{_e(description[:300])}" />',
        f'<link rel="canonical" href="{_e(canonical)}" />',
        f'<meta property="og:title" content="{_e(title)}" />',
        f'<meta property="og:description" content="{_e(description[:300])}" />',
        f'<meta property="og:url" content="{_e(canonical)}" />',
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="HuntExams" />',
        '<meta name="twitter:card" content="summary_large_image" />',
    ]
    if image:
        head.append(f'<meta property="og:image" content="{_e(image)}" />')
    if lang not in PUBLISHED_LANGS:
        head.append('<meta name="robots" content="noindex, follow" />')
    else:
        for code in PUBLISHED_LANGS:
            href = _abs(settings, _lang_path(code, path))
            head.append(f'<link rel="alternate" hreflang="{code}" href="{_e(href)}" />')
        head.append(
            f'<link rel="alternate" hreflang="x-default" href="{_e(_abs(settings, path))}" />'
        )
    for block in jsonld or []:
        data = json.dumps(block, ensure_ascii=False).replace("<", "\\u003c")
        head.append(f'<script type="application/ld+json">{data}</script>')
    head.append(f"<style>{SSR_CSS}</style>")
    head += extra_head or []

    html = re.sub(r"<title>.*?</title>", "", template, count=1, flags=re.S)
    html = re.sub(r'<meta name="description"[^>]*>\s*', "", html, count=1)
    html = html.replace("</head>", "    " + "\n    ".join(head) + "\n  </head>", 1)
    html = html.replace(
        '<html lang="en"', f'<html lang="{lang if lang in PUBLISHED_LANGS else "en"}"', 1
    )
    return html.replace('<div id="root"></div>', f'<div id="root">{article}</div>', 1)


def _crumbs(settings: Any, items: list[tuple[str, str]]) -> dict[str, Any]:
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": n, "name": name, "item": _abs(settings, href)}
            for n, (name, href) in enumerate(items, start=1)
        ],
    }


def _nav(lang: str, items: list[tuple[str, str]]) -> str:
    links = " › ".join(f'<a href="{_e(_lang_path(lang, h))}">{_e(n)}</a>' for n, h in items)
    return f'<nav aria-label="Breadcrumb">{links}</nav>'


def world_name(w: dict[str, Any]) -> str:
    return "Starter world" if w["number"] == 0 else f"World {w['number']}"


# ---------------------------------------------------------------- pages


def map_page(data: dict[str, Any], lang: str) -> tuple[str, str, str]:
    parts = [
        '<main class="ssr"><p class="lead">HuntExams</p>',
        "<h1>Learn agentic AI by watching it move</h1>",
        f'<p class="lead">{_e(data["summary"])}</p>',
        "<p>Every topic has four steps: <b>see</b> it move, <b>try</b> it yourself, "
        "<b>build</b> it in real Python, then a short <b>quiz</b>. Guided labs join the "
        "topics into small projects. Simple English first; the technical explanation is one "
        'tap away. Hard words have a <a href="'
        + _e(_lang_path(lang, "/glossary"))
        + '">glossary</a>.</p>',
    ]
    for w in data["worlds"]:
        parts.append(f"<h2>{world_name(w)}: {_e(w['title'])}</h2><p>{_e(w['summary'])}</p><ol>")
        for t in w["topics"]:
            parts.append(
                f'<li><a href="{_e(_lang_path(lang, "/learn/" + t["slug"]))}">{_e(t["title"])}</a>'
                f" — {_e(t['summary'])}</li>"
            )
        parts.append("</ol>")
    parts.append("</main>")
    return (
        "HuntExams — learn agentic AI with visuals, step by step",
        "Learn agentic AI engineering by watching each idea move, trying it, and building it "
        "in real Python. Simple English first, technical depth when you want it. Free.",
        "".join(parts),
    )


def topic_page(
    data: dict[str, Any], t: Topic, w: dict[str, Any], lang: str
) -> tuple[str, str, str]:
    b = t.body
    slugs = [x["slug"] for x in w["topics"]]
    i = slugs.index(t.slug) if t.slug in slugs else -1
    prev_t = w["topics"][i - 1] if i > 0 else None
    next_t = w["topics"][i + 1] if 0 <= i < len(slugs) - 1 else None
    parts = [
        '<main class="ssr"><article>',
        _nav(lang, [("HuntExams", "/"), (t.title, "/learn/" + t.slug)]),
        f'<p class="lead">{world_name(w)}: {_e(w["title"])}</p>',
        f"<h1>{_e(t.title)}</h1>",
        f'<p class="lead">{_e(t.summary)}</p>',
        "<h2>In simple words</h2>",
        f"<p>{md(b.get('intro', ''))}</p>",
    ]
    for p in b.get("points") or []:
        parts.append(f"<h3>{_e(p.get('title'))}</h3><p>{md(p.get('text', ''))}</p>")
    eng = [p for p in b.get("points") or [] if p.get("eng")]
    if b.get("intro_eng") or eng:
        parts.append("<h2>The technical explanation</h2>")
        if b.get("intro_eng"):
            parts.append(f"<p>{md(b['intro_eng'])}</p>")
        for p in eng:
            parts.append(f"<h3>{_e(p.get('title'))}</h3><p>{md(p['eng'])}</p>")
    words = [w2 for w2 in b.get("words") or [] if len(w2) >= 2]
    if words:
        parts.append("<h2>Words to know</h2><dl>")
        for term, meaning in ((str(a), str(m)) for a, m, *_ in words):
            href = _lang_path(lang, "/glossary/" + term_slug(term))
            parts.append(f'<dt><a href="{_e(href)}">{_e(term)}</a></dt><dd>{md(meaning)}</dd>')
        parts.append("</dl>")
    if b.get("code"):
        parts.append(
            f"<h2>Build it in Python</h2><pre><code>{_e(b['code'].get('source', ''))}</code></pre>"
        )
    if b.get("objectives"):
        parts.append("<h2>After this you can</h2><ul>")
        parts += [f"<li>{md(o)}</li>" for o in b["objectives"]]
        parts.append("</ul>")
    links = []
    if prev_t:
        links.append(
            f'<a href="{_e(_lang_path(lang, "/learn/" + prev_t["slug"]))}">← {_e(prev_t["title"])}</a>'
        )
    if next_t:
        links.append(
            f'<a href="{_e(_lang_path(lang, "/learn/" + next_t["slug"]))}">{_e(next_t["title"])} →</a>'
        )
    if links:
        parts.append(f"<nav>{' · '.join(links)}</nav>")
    parts.append("</article></main>")
    description = re.sub(r"[*`]", "", f"{t.summary} {b.get('intro', '')}").strip()
    return (f"{t.title} — explained simply, with visuals | HuntExams", description, "".join(parts))


def glossary_index(data: dict[str, Any], lang: str) -> tuple[str, str, str]:
    parts = [
        '<main class="ssr">',
        _nav(lang, [("AI roadmap", "/"), ("Glossary", "/glossary")]),
        "<h1>AI words, explained simply</h1>",
        f'<p class="lead">{len(data["glossary"])} words you meet while learning agentic AI, '
        "each in one plain sentence.</p><dl>",
    ]
    for g in data["glossary"]:
        href = _lang_path(lang, "/glossary/" + g["slug"])
        parts.append(
            f'<dt><a href="{_e(href)}">{_e(g["term"])}</a></dt><dd>{md(g["meaning"])}</dd>'
        )
    parts.append("</dl></main>")
    return (
        "AI glossary: agentic AI words explained in simple English | HuntExams",
        "Plain-English meanings of the words used in AI engineering: tokens, embeddings, RAG, "
        "agents, tool calling and more.",
        "".join(parts),
    )


def glossary_term(g: dict[str, Any], lang: str) -> tuple[str, str, str]:
    parts = [
        '<main class="ssr">',
        _nav(
            lang,
            [("HuntExams", "/"), ("Glossary", "/glossary"), (g["term"], "/glossary/" + g["slug"])],
        ),
        f"<h1>What is {_e(g['term'])}?</h1>",
        f'<p class="lead">{md(g["meaning"])}</p>',
        f"<p>{_e(g['term'])} is one of the words you meet while learning agentic AI "
        "engineering. Below are the lessons where it appears: each one shows the idea moving "
        "as a visual, lets you try it, then build it in Python.</p>",
        "<h2>Learn it visually</h2><ul>",
    ]
    for t in g["topics"]:
        parts.append(
            f'<li><a href="{_e(_lang_path(lang, "/learn/" + t["slug"]))}">{_e(t["title"])}</a>'
            f" — {_e(t.get('summary', ''))}</li>"
        )
    parts.append("</ul></main>")
    meaning = re.sub(r"[*`]", "", g["meaning"]).rstrip(".")
    lessons = ", ".join(t["title"] for t in g["topics"][:2])
    description = f"What is {g['term']}? {meaning}. Learn it visually in: {lessons}."
    return (
        f"What is {g['term']}? Simple meaning | HuntExams AI glossary",
        description,
        "".join(parts),
    )


# ---------------------------------------------------------------- routes


STATIC_PAGES: dict[str, tuple[str, str]] = {
    "/about": (
        "About HuntExams",
        "HuntExams teaches agentic AI engineering with motion visuals first, then hands-on "
        "Python, guided labs and reviewed projects. Built in Chennai, India.",
    ),
    "/privacy": (
        "Privacy policy | HuntExams",
        "What HuntExams stores and why, and how the links page counts visits without storing "
        "your IP address.",
    ),
    "/terms": ("Terms of use | HuntExams", "The terms for using HuntExams and its certificates."),
    "/pricing": (
        "Pricing | HuntExams",
        "Learn agentic AI free: every visual lesson, guided lab and practice question.",
    ),
}


def static_page(path: str) -> tuple[str, str, str]:
    """Meta and a short summary; the full text renders in the app on the same URL."""
    title, description = STATIC_PAGES[path]
    article = (
        f'<main class="ssr"><h1>{_e(title.split(" | ")[0])}</h1><p class="lead">'
        f'{_e(description)}</p><p><a href="/">Start learning</a></p></main>'
    )
    return title, description, article


def guides_index(guides: list[Any]) -> tuple[str, str, str]:
    parts = [
        '<main class="ssr"><h1>Guides</h1><p class="lead">Career guides for AI engineers.</p><ul>'
    ]
    for g in guides:
        parts.append(f'<li><a href="/guides/{_e(g.slug)}">{_e(g.title)}</a> — {_e(g.summary)}</li>')
    parts.append("</ul></main>")
    return (
        "Guides: careers in AI engineering | HuntExams",
        "Plain-English guides on becoming an agentic AI engineer: skills, projects and interviews.",
        "".join(parts),
    )


def guide_page(g: Any) -> tuple[str, str, str]:
    parts = [
        '<main class="ssr"><article>',
        _nav("en", [("HuntExams", "/"), ("Guides", "/guides"), (g.title, "/guides/" + g.slug)]),
        f'<h1>{_e(g.title)}</h1><p class="lead">{_e(g.summary)}</p>',
    ]
    for sec in (g.body or {}).get("sections", []):
        if sec.get("heading"):
            parts.append(f"<h2>{_e(sec['heading'])}</h2>")
        for para in str(sec.get("text") or "").split("\n\n"):
            if para.strip():
                parts.append(f"<p>{md(para)}</p>")
        if sec.get("bullets"):
            parts.append("<ul>" + "".join(f"<li>{md(b)}</li>" for b in sec["bullets"]) + "</ul>")
    parts.append("</article></main>")
    return (f"{g.title} | HuntExams guides", g.summary, "".join(parts))


def preload_files(manifest: dict[str, Any] | None, key: str) -> list[str]:
    """The JS chunks a lazy page needs (from Vite's manifest), minus the main entry."""
    if not manifest or key not in manifest:
        return []
    entry = next((v["file"] for v in manifest.values() if v.get("isEntry")), None)
    out: list[str] = []
    stack = [key]
    while stack:
        item = manifest.get(stack.pop())
        if not item or item["file"] == entry or item["file"] in out:
            continue
        out.append(item["file"])
        stack += item.get("imports", [])
    return out


def boot_script(data: dict[str, Any]) -> str:
    """The page's first API responses, so the app renders without waiting for requests."""
    raw = json.dumps(jsonable_encoder(data), ensure_ascii=False, separators=(",", ":"))
    safe = raw.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return f"<script>window.__HX__={safe}</script>"


def register(app: FastAPI, template: str, manifest: dict[str, Any] | None = None) -> None:
    """Add the server-rendered routes. Call before the web app's catch-all route."""
    router = APIRouter(include_in_schema=False)
    del manifest  # the lesson player is in the main bundle; nothing extra to preload

    async def respond(
        request: Request, db: Any, settings: Any, lang: str, path: str
    ) -> HTMLResponse:
        data = await cached_world(db)
        status = 200
        jsonld: list[dict[str, Any]] = []
        found: tuple[str, str, str] | None = None
        if data:
            org = {"@type": "Organization", "name": "HuntExams", "url": _abs(settings, "/")}
            if path in STATIC_PAGES:
                found = static_page(path)
            elif path == "/guides":
                rows = await db.scalars(
                    select(Guide).where(Guide.status == PublishStatus.PUBLISHED).order_by(Guide.id)
                )
                found = guides_index(list(rows))
            elif path.startswith("/guides/"):
                g = await db.scalar(
                    select(Guide).where(Guide.slug == path.removeprefix("/guides/"))
                )
                if g and g.status == PublishStatus.PUBLISHED:
                    found = guide_page(g)
                    jsonld.append(
                        {
                            "@context": "https://schema.org",
                            "@type": "Article",
                            "headline": g.title,
                            "description": g.summary,
                            "url": _abs(settings, path),
                            "publisher": org,
                        }
                    )
            elif path == "/":
                found = map_page(data, lang)
                jsonld.append(
                    {
                        "@context": "https://schema.org",
                        "@type": "WebSite",
                        "name": "HuntExams",
                        "url": _abs(settings, "/"),
                    }
                )
            elif path.startswith("/learn/"):
                slug = path.removeprefix("/learn/")
                topic = await db.scalar(select(Topic).where(Topic.slug == slug))
                w = None
                if topic and topic.status == PublishStatus.PUBLISHED:
                    level = await db.get(Level, topic.level_id)
                    w = next((x for x in data["worlds"] if level and x["slug"] == level.slug), None)
                if topic and w:
                    found = topic_page(data, topic, w, lang)
                    jsonld += [
                        _crumbs(
                            settings,
                            [("HuntExams", "/"), (topic.title, path)],
                        ),
                        {
                            "@context": "https://schema.org",
                            "@type": "LearningResource",
                            "name": topic.title,
                            "description": topic.summary,
                            "url": _abs(settings, path),
                            "inLanguage": "en",
                            "learningResourceType": "Interactive lesson",
                            "educationalLevel": "Beginner" if w["number"] <= 1 else "Intermediate",
                            "isAccessibleForFree": True,
                            "provider": org,
                        },
                    ]
            elif path == "/glossary":
                found = glossary_index(data, lang)
            elif path.startswith("/glossary/"):
                slug = path.removeprefix("/glossary/")
                g = next((x for x in data["glossary"] if x["slug"] == slug), None)
                if g:
                    found = glossary_term(g, lang)
                    jsonld += [
                        _crumbs(
                            settings,
                            [("AI roadmap", "/"), ("Glossary", "/glossary"), (g["term"], path)],
                        ),
                        {
                            "@context": "https://schema.org",
                            "@type": "DefinedTerm",
                            "name": g["term"],
                            "description": re.sub(r"[*`]", "", g["meaning"]),
                            "url": _abs(settings, path),
                            "inDefinedTermSet": _abs(settings, "/glossary"),
                        },
                    ]
        if not found:
            status = 404
            found = (
                "Not found | HuntExams",
                "This page doesn't exist.",
                '<main class="ssr"><h1>This place doesn\'t exist</h1>'
                '<p><a href="/">Back to the AI roadmap</a></p></main>',
            )
        title, description, article = found
        extra: list[str] = []
        if status == 200:
            from app import routes_learn

            boot: dict[str, Any] = {}
            first = next(
                (w["topics"][0]["slug"] for w in (data or {}).get("worlds", []) if w["topics"]),
                None,
            )
            slug = path.removeprefix("/learn/") if path.startswith("/learn/") else None
            if path == "/":
                slug = first
            if slug:
                # The lesson player renders at once: curriculum and topic come with the page.
                boot["/curriculum"] = await routes_learn.curriculum(db)
                boot[f"/topics/{slug}"] = await routes_learn.get_topic(slug, db, None)
            if boot:
                extra.append(boot_script(boot))
        html = render_shell(
            template,
            settings,
            path=path,
            lang=lang,
            title=title,
            description=description,
            article=article,
            jsonld=jsonld,
            extra_head=extra,
        )
        if status == 404:
            html = html.replace("</head>", '<meta name="robots" content="noindex" /></head>', 1)
        return HTMLResponse(html, status_code=status, headers={"Cache-Control": "no-cache"})

    def add(path_pattern: str, lang: str | None) -> None:
        async def handler(request: Request, db: DbDep, settings: SettingsDep) -> Response:
            code = lang or "en"
            path = request.url.path
            if code != "en":
                path = path.removeprefix(f"/{code}") or "/"
            path = path.rstrip("/") or "/"
            # Pages that merged into the lesson player: one permanent redirect each.
            if path == "/learn":
                return RedirectResponse(_lang_path(code, "/"), status_code=301)
            if path.startswith("/world/"):
                data = await cached_world(db)
                worlds = (data or {}).get("worlds", [])
                w = next((x for x in worlds if x["slug"] == path[7:]), None)
                if w and w["topics"]:
                    target = _lang_path(code, "/learn/" + w["topics"][0]["slug"])
                    return RedirectResponse(target, status_code=301)
            return await respond(request, db, settings, code, path)

        router.add_api_route(path_pattern, handler, methods=["GET"])

    for prefix, lang in [("", None), ("/ta", "ta"), ("/hi", "hi")]:
        for p in ["/learn", "/world/{slug}", "/learn/{slug}", "/glossary", "/glossary/{slug}"]:
            add(prefix + p, lang)
        add(prefix or "/", lang)
    for p in ["/guides", "/guides/{slug}", *STATIC_PAGES]:
        add(p, None)
    app.include_router(router)


def sitemap_paths(data: dict[str, Any] | None) -> list[str]:
    if not data:
        return []
    paths = ["/glossary"]
    for w in data["worlds"]:
        paths += ["/learn/" + t["slug"] for t in w["topics"]]
    paths += ["/glossary/" + g["slug"] for g in data["glossary"]]
    return paths
