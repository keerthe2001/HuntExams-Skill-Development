"""Server-rendered HTML for the /links link-in-bio page.

One renderer serves the live page and the admin's live preview, so the preview always
matches what visitors see. Everything here works with JavaScript off: every item is a plain
link to /go/<id>, and the only script sends the page-view beacon (and AdSense when on).
"""

import json
import re
from html import escape
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_THEME = {"accent": "#4ade80", "highlight": "#f5c451"}
BADGES = {"NEW", "FREE", "HOT", "LIVE"}
YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
DRIVE_ID = re.compile(r"^[A-Za-z0-9_-]{10,200}$")

SOCIALS: dict[str, tuple[str, str]] = {
    # platform: (label, inline SVG body on a 24x24 stroke grid)
    "instagram": (
        "Instagram",
        '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>'
        '<circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>',
    ),
    "youtube": (
        "YouTube",
        '<rect x="2.5" y="5" width="19" height="14" rx="4"/>'
        '<path d="M10 9l5 3-5 3z" fill="currentColor"/>',
    ),
    "linkedin": (
        "LinkedIn",
        '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4'
        'a2 2 0 0 1 4 0v4M12 10v7"/>',
    ),
    "telegram": ("Telegram", '<path d="M21 4L3 11l6 2 2 6 3-4 5 4zM9 13l12-9"/>'),
    "whatsapp": (
        "WhatsApp",
        '<path d="M4 20l1.4-4.1A8 8 0 1 1 8.3 18.7z"/>'
        '<path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1-1.2 1.8.8"/>',
    ),
    "x": ("X", '<path d="M4 4l16 16M20 4L4 20"/>'),
    "website": (
        "Website",
        '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18'
        'M12 3c-2.5 3-2.5 15 0 18"/>',
    ),
    "email": ("Email", '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
}


# ---------------------------------------------------------------- URL helpers


def safe_url(url: str | None) -> str | None:
    """Only http(s) URLs ever reach an href or src."""
    if not url:
        return None
    url = url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return url


def youtube_id(url: str | None) -> str | None:
    if not url:
        return None
    p = urlparse(url.strip())
    host = (p.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    cand = None
    if host == "youtu.be":
        cand = p.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "music.youtube.com", "youtube-nocookie.com"):
        if p.path == "/watch":
            cand = (parse_qs(p.query).get("v") or [None])[0]
        else:
            parts = p.path.strip("/").split("/")
            if len(parts) >= 2 and parts[0] in ("shorts", "embed", "live", "v"):
                cand = parts[1]
    return cand if cand and YT_ID.match(cand) else None


def drive_id(url: str | None) -> str | None:
    if not url:
        return None
    p = urlparse(url.strip())
    if (p.hostname or "").lower() not in ("drive.google.com", "docs.google.com"):
        return None
    m = re.search(r"/d/([A-Za-z0-9_-]+)", p.path)
    cand = m.group(1) if m else (parse_qs(p.query).get("id") or [None])[0]
    return cand if cand and DRIVE_ID.match(cand) else None


def normalise_item_url(url: str, kind: str, open_mode: str) -> str:
    """Google Drive share links become direct preview/download links; YouTube gets one form."""
    if (fid := drive_id(url)) and "/document/" not in url and "/spreadsheets/" not in url:
        if open_mode == "download":
            return f"https://drive.google.com/uc?export=download&id={fid}"
        return f"https://drive.google.com/file/d/{fid}/preview"
    if kind == "video" and (vid := youtube_id(url)):
        return f"https://www.youtube.com/watch?v={vid}"
    return url.strip()


def auto_thumbnail(url: str | None) -> str | None:
    if vid := youtube_id(url):
        return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    if fid := drive_id(url):
        return f"https://drive.google.com/thumbnail?id={fid}&sz=w640"
    return None


def initials(name: str) -> str:
    words = [w for w in re.split(r"\s+", name.strip()) if w]
    if not words:
        return "?"
    if len(words) == 1:
        return words[0][:2].upper()
    return (words[0][0] + words[1][0]).upper()


# ---------------------------------------------------------------- rendering

CSS = """
:root{--bg:#0a0f0c;--card:#111a15;--card2:#16211b;--line:#223328;--fg:#eef5f0;--fg2:#b8c7bd;
--faint:#8ea195;color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg)}
body{color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;
-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
a{color:inherit;text-decoration:none}img{display:block;max-width:100%}
.glow{position:fixed;inset:-20vh -20vw auto;height:60vh;pointer-events:none;z-index:0;
background:radial-gradient(60% 60% at 50% 0,color-mix(in srgb,var(--acc) 22%,transparent),transparent 70%)}
main{position:relative;z-index:1;max-width:560px;margin:0 auto;padding:28px 16px 40px}
header{text-align:center;display:grid;justify-items:center;gap:6px;margin-bottom:22px}
.av{width:96px;height:96px;border-radius:50%;position:relative;display:grid;place-items:center;
background:linear-gradient(135deg,var(--acc),var(--hi));color:#06120b;font-weight:800;font-size:32px;
box-shadow:0 0 0 3px var(--bg),0 0 0 5px color-mix(in srgb,var(--acc) 60%,transparent);margin-bottom:8px}
.av img{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover}
h1{font-size:24px;line-height:1.2;margin:0;display:inline-flex;align-items:center;gap:6px;letter-spacing:-.01em}
.tick{width:20px;height:20px;color:var(--acc);flex:none}
.tag{color:var(--fg);font-weight:600;margin:0}
.bio{color:var(--fg2);margin:2px 0 0;max-width:46ch;font-size:15px;white-space:pre-line}
.logo{height:28px;width:auto;margin-top:4px}
.soc{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:10px;padding:0;list-style:none}
.soc a{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--card);
border:1px solid var(--line);color:var(--fg2)}
.soc a:hover,.soc a:focus-visible{color:var(--acc);border-color:var(--acc)}
.soc svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;
stroke-linejoin:round}
section{margin-top:22px}
h2{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:0 4px 10px;
font-weight:700}
.list{display:grid;gap:10px}
.it{position:relative;display:flex;gap:12px;align-items:center;min-height:56px;padding:12px 14px;
border-radius:14px;background:var(--card);border:1px solid var(--line);overflow:hidden;
transition:transform .15s ease,border-color .15s ease}
.it:hover,.it:focus-visible{border-color:color-mix(in srgb,var(--acc) 70%,var(--line));transform:translateY(-1px)}
.it:active{transform:scale(.99)}
.it .tx{flex:1;min-width:0}
.it .t{font-weight:650;line-height:1.3;display:block;overflow-wrap:anywhere}
.it .d{color:var(--fg2);font-size:14px;margin-top:2px;display:block;overflow-wrap:anywhere}
.it .go{flex:none;width:18px;height:18px;color:var(--faint);fill:none;stroke:currentColor;stroke-width:2}
.link .t{text-align:left}
.th{flex:none;width:64px;height:64px;border-radius:10px;background:var(--card2);overflow:hidden;
display:grid;place-items:center;color:var(--acc);font-weight:800;font-size:13px}
.th img{width:100%;height:100%;object-fit:cover}
.video{flex-direction:column;align-items:stretch;padding:0}
.video .pic{position:relative;aspect-ratio:16/9;background:var(--card2)}
.video .pic img{width:100%;height:100%;object-fit:cover}
.video .play{position:absolute;inset:0;margin:auto;width:56px;height:40px;border-radius:12px;
background:rgba(0,0,0,.65);display:grid;place-items:center}
.video .play svg{width:20px;height:20px;fill:#fff}
.video .tx{padding:12px 14px}
.cta{display:inline-block;margin-top:8px;font-size:13px;font-weight:700;color:var(--acc)}
.pill{display:inline-block;margin-top:8px;font-size:12px;font-weight:700;padding:3px 9px;
border-radius:99px;background:color-mix(in srgb,var(--acc) 16%,transparent);color:var(--acc)}
.badge{position:absolute;top:8px;right:8px;z-index:2;font-size:11px;font-weight:800;letter-spacing:.06em;
padding:2px 7px;border-radius:6px;background:var(--hi);color:#1a1400}
.badge.LIVE{background:#ff4d4d;color:#fff}.badge.FREE{background:var(--acc);color:#06120b}
.it.has-badge .tx{padding-right:44px}.video.has-badge .tx{padding-right:14px}
.feat{border-color:var(--hi);box-shadow:0 0 0 1px var(--hi),0 6px 24px color-mix(in srgb,var(--hi) 18%,transparent)}
.feat::after{content:"";position:absolute;inset:0;pointer-events:none;
background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.10) 50%,transparent 70%);
background-size:250% 100%;animation:shine 3.2s ease-in-out infinite}
@keyframes shine{0%{background-position:150% 0}60%,100%{background-position:-50% 0}}
@media (prefers-reduced-motion:reduce){.feat::after{animation:none}.it{transition:none}}
.empty{text-align:center;color:var(--fg2);padding:28px 16px;border:1px dashed var(--line);border-radius:14px}
.ad{margin:22px 0 0;text-align:center}
.ad span{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);
margin-bottom:6px}
.ad .ph{border:1px dashed var(--line);border-radius:12px;padding:22px;color:var(--faint);font-size:13px}
.learn{margin-top:30px;display:block;padding:16px;border-radius:14px;border:1px solid var(--line);
background:linear-gradient(135deg,color-mix(in srgb,var(--acc) 14%,var(--card)),var(--card))}
.learn b{display:block}.learn small{color:var(--fg2);font-size:14px}
footer{margin-top:24px;text-align:center;color:var(--faint);font-size:13px;display:grid;gap:8px}
footer a{color:var(--fg2);text-decoration:underline;text-underline-offset:3px;display:inline-flex;align-items:center;min-height:44px;padding:0 10px}
footer .pw{font-weight:700;color:var(--fg);text-decoration:none}
footer .pw span{color:var(--acc)}
@media (max-width:360px){main{padding:22px 12px 32px}.th{width:52px;height:52px}h1{font-size:21px}}
"""

TICK = (
    '<svg class="tick" viewBox="0 0 24 24" role="img" aria-label="Verified"><path fill="currentColor" '
    'd="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9'
    '-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z"/><path d="M8 12.2l2.6 2.6L16.2 9" fill="none" '
    'stroke="#06120b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)
ARROW = '<svg class="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
PLAY = '<span class="play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l14 8-14 8z"/></svg></span>'


def _e(v: Any) -> str:
    return escape(str(v or ""), quote=True)


def _social_href(platform: str, url: str) -> str | None:
    if platform == "email":
        addr = url.strip().removeprefix("mailto:")
        if re.fullmatch(r"[^@\s<>\"']+@[^@\s<>\"']+\.[^@\s<>\"']+", addr):
            return "mailto:" + addr
        return None
    return safe_url(url)


def _item_html(item: dict[str, Any], src: str | None, preview: bool) -> str:
    kind = item.get("kind") or "link"
    if preview or not item.get("id"):
        href = "#"
    else:
        href = f"/go/{item['id']}" + (f"?src={quote(src)}" if src else "")
    badge = item.get("badge") if item.get("badge") in BADGES else None
    classes = ["it", kind]
    if item.get("featured"):
        classes.append("feat")
    if badge:
        classes.append("has-badge")
    title = _e(item.get("title"))
    desc = item.get("description") or ""
    desc_html = f'<span class="d">{_e(desc)}</span>' if desc else ""
    badge_html = f'<span class="badge {badge}">{badge}</span>' if badge else ""
    thumb = safe_url(item.get("thumbnail_url")) or auto_thumbnail(item.get("url"))
    attrs = f'class="{" ".join(classes)}" href="{_e(href)}" rel="nofollow"'
    img = (
        f'<img src="{_e(thumb)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">'
        if thumb
        else ""
    )

    if kind == "video":
        pic = f'<span class="pic">{img}{PLAY}</span>'
        return (
            f'<a {attrs}>{badge_html}{pic}<span class="tx"><span class="t">{title}</span>'
            f'{desc_html}<span class="cta">Watch on YouTube</span></span></a>'
        )
    if kind == "pdf":
        label = "Download PDF" if item.get("open_mode") == "download" else "Preview PDF"
        th = f'<span class="th">{img or "PDF"}</span>'
        return (
            f'<a {attrs}>{badge_html}{th}<span class="tx"><span class="t">{title}</span>'
            f'{desc_html}<span class="pill">{label}</span></span></a>'
        )
    if kind == "course":
        th = f'<span class="th">{img or "▶"}</span>'
        return (
            f'<a {attrs}>{badge_html}{th}<span class="tx"><span class="t">{title}</span>'
            f'{desc_html}<span class="cta">View course</span></span>{ARROW}</a>'
        )
    return f'<a {attrs}>{badge_html}<span class="tx"><span class="t">{title}</span>{desc_html}</span>{ARROW}</a>'


def group_items(
    categories: list[dict[str, Any]], items: list[dict[str, Any]]
) -> list[tuple[str | None, list[dict[str, Any]]]]:
    """Sections in the admin's category order; items with no (or a missing) category go last."""
    known = {str(c["id"]) for c in categories}
    groups: list[tuple[str | None, list[dict[str, Any]]]] = []
    for c in categories:
        members = [i for i in items if str(i.get("category_id") or "") == str(c["id"])]
        if members:
            groups.append((c["name"], members))
    rest = [i for i in items if str(i.get("category_id") or "") not in known]
    if rest:
        groups.append((None, rest))
    return groups


def _ad(slot: str | None, pub: str | None, preview: bool, where: str) -> str:
    if preview:
        return (
            f'<div class="ad"><span>Advertisement</span><div class="ph">Ad slot · {_e(where)}'
            f"{' · ' + _e(slot) if slot else ''}</div></div>"
        )
    return (
        f'<div class="ad"><span>Advertisement</span><ins class="adsbygoogle" style="display:block" '
        f'data-ad-client="{_e(pub)}" data-ad-slot="{_e(slot)}" data-ad-format="auto" '
        f'data-full-width-responsive="true"></ins>'
        "<script>(window.adsbygoogle=window.adsbygoogle||[]).push({});</script></div>"
    )


def _js_literal(value: Any) -> str:
    return json.dumps(value).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def render_page(
    creator: dict[str, Any],
    categories: list[dict[str, Any]],
    items: list[dict[str, Any]],
    *,
    canonical: str,
    src: str | None = None,
    adsense_publisher_id: str | None = None,
    preview: bool = False,
) -> str:
    theme = {**DEFAULT_THEME, **(creator.get("theme") or {})}
    accent = theme["accent"] if HEX.match(str(theme["accent"])) else DEFAULT_THEME["accent"]
    hi = theme["highlight"] if HEX.match(str(theme["highlight"])) else DEFAULT_THEME["highlight"]
    name = creator.get("name") or creator.get("handle") or ""
    tagline = creator.get("tagline") or ""
    bio = creator.get("bio") or ""
    title = f"{name} — {tagline}" if tagline else name
    description = (bio or tagline or f"Links from {name}").strip().replace("\n", " ")[:160]
    avatar = safe_url(creator.get("avatar_url"))
    logo = safe_url(creator.get("logo_url"))

    ads = creator.get("ad_settings") or {}
    slots = {k: (ads.get(k) or "").strip() or None for k in ("top", "middle", "bottom")}
    ads_on = bool(ads.get("enabled")) and (preview or bool(adsense_publisher_id))

    def ad(where: str) -> str:
        if not ads_on or (not preview and not slots[where]):
            return ""
        return _ad(slots[where], adsense_publisher_id, preview, where)

    head = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
        f"<title>{_e(title)}</title>",
        f'<meta name="description" content="{_e(description)}">',
        f'<link rel="canonical" href="{_e(canonical)}">',
        '<meta name="theme-color" content="#0a0f0c">',
        '<meta property="og:type" content="profile">',
        f'<meta property="og:title" content="{_e(title)}">',
        f'<meta property="og:description" content="{_e(description)}">',
        f'<meta property="og:url" content="{_e(canonical)}">',
        '<meta property="og:site_name" content="HuntExams">',
        '<meta name="twitter:card" content="summary">',
        '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    ]
    if avatar:
        head.append(f'<meta property="og:image" content="{_e(avatar)}">')
    if preview:
        head.append('<meta name="robots" content="noindex">')
    if ads_on and not preview and any(slots.values()):
        head.append(
            '<script async crossorigin="anonymous" src="https://pagead2.googlesyndication.com/'
            f'pagead/js/adsbygoogle.js?client={quote(adsense_publisher_id or "")}"></script>'
        )
    head.append(f"<style>:root{{--acc:{accent};--hi:{hi}}}{CSS}</style>")

    av_img = (
        f'<img src="{_e(avatar)}" alt="" width="96" height="96" onerror="this.remove()">'
        if avatar
        else ""
    )
    socials = []
    for s in creator.get("socials") or []:
        platform = str(s.get("platform") or "").lower()
        if platform not in SOCIALS:
            continue
        href = _social_href(platform, str(s.get("url") or ""))
        if not href:
            continue
        label, svg = SOCIALS[platform]
        rel = ' rel="me noopener"' if platform != "email" else ""
        socials.append(
            f'<li><a href="{_e(href)}" aria-label="{label}" title="{label}"{rel}>'
            f'<svg viewBox="0 0 24 24" aria-hidden="true">{svg}</svg></a></li>'
        )
    header = (
        f'<header><div class="av" aria-hidden="true">{_e(initials(name))}{av_img}</div>'
        f"<h1>{_e(name)}{TICK if creator.get('verified', True) else ''}</h1>"
        + (f'<p class="tag">{_e(tagline)}</p>' if tagline else "")
        + (f'<p class="bio">{_e(bio)}</p>' if bio else "")
        + (f'<img class="logo" src="{_e(logo)}" alt="">' if logo else "")
        + (f'<ul class="soc">{"".join(socials)}</ul>' if socials else "")
        + "</header>"
    )

    groups = group_items(categories, items)
    body: list[str] = [header, ad("top")]
    if not groups:
        body.append(
            '<p class="empty">Fresh resources are on their way. Check back after the next reel.</p>'
        )
        body.append(ad("middle"))
    mid = (len(groups) + 1) // 2
    for i, (cat, members) in enumerate(groups):
        heading = f"<h2>{_e(cat)}</h2>" if cat else ("<h2>More</h2>" if len(groups) > 1 else "")
        links = "".join(_item_html(m, src, preview) for m in members)
        body.append(f'<section>{heading}<div class="list">{links}</div></section>')
        if i + 1 == mid:
            body.append(ad("middle"))
    body.append(ad("bottom"))
    body.append(
        '<a class="learn" href="/learn"><b>Learn AI engineering, visually</b>'
        "<small>Free interactive lessons and labs on HuntExams — start the Agentic AI Engineer "
        "path.</small></a>"
    )
    body.append(
        '<footer><a class="pw" href="/">Powered by Hunt<span>Exams</span></a>'
        '<div><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></div></footer>'
    )

    script = ""
    if not preview:
        payload = _js_literal({"handle": creator.get("handle"), "src": src or "", "ref": ""})
        script = (
            "<script>(function(){try{var d=" + payload + ';d.ref=document.referrer||"";'
            'var b=JSON.stringify(d),u="/api/links/event";'
            "if(navigator.sendBeacon&&navigator.sendBeacon(u,b))return;"
            'fetch(u,{method:"POST",body:b,keepalive:true,credentials:"omit",'
            'headers:{"Content-Type":"text/plain"}})}catch(e){}})();</script>'
        )

    return (
        '<!doctype html><html lang="en"><head>'
        + "".join(head)
        + '</head><body><div class="glow"></div><main>'
        + "".join(body)
        + "</main>"
        + script
        + "</body></html>"
    )


def not_found_page() -> str:
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="robots" content="noindex"><title>Page not found — HuntExams</title>'
        f"<style>:root{{--acc:{DEFAULT_THEME['accent']};--hi:{DEFAULT_THEME['highlight']}}}{CSS}</style>"
        "</head><body><main><header><h1>This page doesn't exist</h1>"
        '<p class="bio">The link may be old or mistyped.</p></header>'
        '<div class="list"><a class="it link" href="/links"><span class="tx"><span class="t">'
        f'Open Keertheology\'s links</span></span>{ARROW}</a><a class="it link" href="/">'
        f'<span class="tx"><span class="t">Go to HuntExams</span></span>{ARROW}</a></div>'
        "</main></body></html>"
    )
