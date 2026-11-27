"""Server-rendered pages: every topic, world and glossary word has indexable HTML."""

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app import seo
from app.main import create_app

INDEX = """<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="default" />
    <title>HuntExams</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>"""


@pytest.fixture
async def web(app, tmp_path: Path):  # type: ignore[no-untyped-def]
    (tmp_path / "index.html").write_text(INDEX)
    settings = app.state.settings.model_copy(update={"web_dist": str(tmp_path)})
    site = create_app(settings)
    seo.clear_cache()
    async with AsyncClient(transport=ASGITransport(app=site), base_url="http://test") as c:
        yield c
    await site.state.db.dispose()


async def test_topic_page_has_full_text_and_meta(web) -> None:  # type: ignore[no-untyped-def]
    r = await web.get("/learn/variables")
    assert r.status_code == 200
    html = r.text
    assert html.count("<title>") == 1 and "explained simply" in html
    assert 'content="default"' not in html  # replaced by this page's description
    assert '<link rel="canonical" href="http://localhost:5174/learn/variables" />' in html
    assert 'hreflang="en"' in html and 'hreflang="x-default"' in html
    assert '"@type": "LearningResource"' in html and '"BreadcrumbList"' in html
    # The text sits inside #root, so the app replaces it and people see it in the Read panel.
    body = html.split('<div id="root">', 1)[1]
    assert "<h1>" in body and "In simple words" in body
    assert 'href="/glossary/' in body  # words link to their glossary pages
    assert "robots" not in html.split("<body>")[0] or "noindex" not in html


async def test_map_world_glossary_and_404(web) -> None:  # type: ignore[no-untyped-def]
    home = (await web.get("/")).text
    assert "Learn agentic AI by stepping into it" in home
    assert 'href="/world/' in home and 'href="/learn/variables"' in home
    assert (await web.get("/learn")).status_code == 200

    worlds = (await web.get("/api/curriculum")).json()["levels"]
    w = (await web.get(f"/world/{worlds[1]['slug']}")).text
    assert worlds[1]["title"] in w

    terms = (await web.get("/api/glossary")).json()
    assert len(terms) > 50
    g = terms[0]
    page = (await web.get(f"/glossary/{g['slug']}")).text
    assert f"What is {g['term']}" in page.replace("&#x27;", "'") and '"DefinedTerm"' in page
    assert (await web.get("/glossary")).status_code == 200

    missing = await web.get("/learn/no-such-topic")
    assert missing.status_code == 404 and "noindex" in missing.text
    assert (await web.get("/glossary/no-such-word")).status_code == 404


async def test_tamil_and_hindi_fall_back_to_english_without_duplicates(web) -> None:  # type: ignore[no-untyped-def]
    for lang in ("ta", "hi"):
        r = await web.get(f"/{lang}/learn/variables")
        assert r.status_code == 200
        assert '<meta name="robots" content="noindex, follow" />' in r.text
        # Canonical points to the English page until a translation is published.
        assert 'rel="canonical" href="http://localhost:5174/learn/variables"' in r.text
        assert f'href="/{lang}/glossary/' in r.text  # links stay in that language
        assert (await web.get(f"/{lang}")).status_code == 200


async def test_sitemap_lists_topics_and_glossary(web) -> None:  # type: ignore[no-untyped-def]
    xml = (await web.get("/sitemap.xml")).text
    assert "<loc>http://localhost:5174/learn/variables</loc>" in xml
    assert "/glossary/" in xml and "/world/" in xml
