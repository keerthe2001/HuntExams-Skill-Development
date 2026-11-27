from app.main import GONE, legacy_target


def test_old_huntexams_urls() -> None:
    # Old pages with a real equivalent move permanently.
    assert legacy_target("courses/agentic-ai") == "/"
    assert legacy_target("courses") == "/"
    assert legacy_target("blog") == "/guides"
    assert legacy_target("start") == "/signup"
    # The old course library and blog posts are gone (410), not redirected to unrelated pages.
    assert legacy_target("courses/sql") == GONE
    assert legacy_target("courses/bootstrap/bootstrap-floating-labels") == GONE
    assert legacy_target("courses/php/php-variables") == GONE
    assert legacy_target("blog/ats-friendly-resume-for-freshers") == GONE
    assert legacy_target("visual/what-is-an-api") == GONE
    # New pages are untouched.
    assert legacy_target("learn/rag-architecture") is None
    assert legacy_target("startup") is None
    assert legacy_target("links") is None
    assert legacy_target("go/abc") is None
