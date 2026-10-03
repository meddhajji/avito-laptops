from datetime import datetime, timedelta, timezone

import pytest

import scraper
from scraper import _Page


def _ad(avito_id: str) -> dict:
    return {"avito_id": avito_id, "link": f"https://www.avito.ma/fr/x/ordinateurs_portables/a_{avito_id}.htm"}


def _fake_site(pages: dict[int, list[str]], total: int, failing: dict[int, int] | None = None):
    """A fake _fetch_page. `failing` maps page number -> how many calls fail before it works."""
    failing = dict(failing or {})
    calls: list[int] = []

    def fetch(number: int) -> _Page:
        calls.append(number)
        if failing.get(number, 0) > 0:
            failing[number] -= 1
            return _Page(number, ok=False)
        ids = pages.get(number, [])
        return _Page(number, ok=True, ads=[_ad(i) for i in ids], raw_count=len(ids), total_listed=total)

    return fetch, calls


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(scraper, "BATCH_DELAY", 0)
    monkeypatch.setattr(scraper, "BATCH_SIZE", 2)


def test_scrapes_until_an_empty_page(monkeypatch):
    pages = {1: ["a", "b"], 2: ["c", "d"], 3: ["e", "f"]}
    fetch, calls = _fake_site(pages, total=6)
    monkeypatch.setattr(scraper, "_fetch_page", fetch)

    result = scraper.scrape()

    assert [ad["avito_id"] for ad in result.ads] == ["a", "b", "c", "d", "e", "f"]
    assert result.total_listed == 6
    assert result.complete
    assert max(calls) <= 5  # stopped after the batch that hit the empty page


def test_early_empty_page_is_not_mistaken_for_the_end(monkeypatch):
    # Avito says 20 listings exist but serves an empty page 3 (e.g. a soft block).
    pages = {1: ["a", "b"], 2: ["c", "d"]}
    fetch, _ = _fake_site(pages, total=20)
    monkeypatch.setattr(scraper, "_fetch_page", fetch)

    result = scraper.scrape()

    assert len(result.ads) == 4
    assert not result.complete


def test_listing_appearing_on_two_pages_is_kept_once(monkeypatch):
    pages = {1: ["a", "b"], 2: ["b", "c"]}  # "b" shifted to page 2 while we were scraping
    fetch, _ = _fake_site(pages, total=4)
    monkeypatch.setattr(scraper, "_fetch_page", fetch)

    result = scraper.scrape()

    assert [ad["avito_id"] for ad in result.ads] == ["a", "b", "c"]


def test_failed_page_is_retried_and_recovered(monkeypatch):
    pages = {1: ["a", "b"], 2: ["c", "d"], 3: ["e", "f"]}
    fetch, calls = _fake_site(pages, total=6, failing={2: 1})
    monkeypatch.setattr(scraper, "_fetch_page", fetch)

    result = scraper.scrape()

    assert calls.count(2) == 2
    assert len(result.ads) == 6
    assert result.failed_pages == [] and result.complete


def test_page_that_keeps_failing_makes_the_scrape_incomplete(monkeypatch):
    pages = {1: ["a", "b"], 2: ["c", "d"], 3: ["e", "f"]}
    fetch, _ = _fake_site(pages, total=6, failing={2: 99})
    monkeypatch.setattr(scraper, "_fetch_page", fetch)

    result = scraper.scrape()

    assert result.failed_pages == [2]
    assert not result.complete
    assert len(result.ads) == 4


def test_page_limit_makes_the_scrape_partial(monkeypatch):
    pages = {n: [f"{n}a", f"{n}b"] for n in range(1, 6)}
    fetch, calls = _fake_site(pages, total=10)
    monkeypatch.setattr(scraper, "_fetch_page", fetch)

    result = scraper.scrape(max_pages=2)

    assert max(calls) == 2
    assert result.partial and not result.complete


def test_blocked_first_page_returns_an_empty_incomplete_result(monkeypatch):
    fetch, _ = _fake_site({}, total=0, failing={1: 99})
    monkeypatch.setattr(scraper, "_fetch_page", fetch)

    result = scraper.scrape()

    assert result.ads == [] and not result.complete


def _next_data(ads: list[dict]) -> dict:
    return {"props": {"pageProps": {"componentProps": {"ads": {"ads": ads, "totalListingAds": len(ads)}}}}}


def test_parse_ads_applies_category_and_price_guards():
    laptop_href = "/fr/casa/ordinateurs_portables/Dell_Latitude_123.htm"
    ads = scraper._parse_ads(_next_data([
        {"id": 1, "href": laptop_href, "subject": "Dell Latitude", "description": "i5 16go", "price": {"value": 3000},
         "location": "Casablanca", "isShop": True, "hasShipping": False, "date": "il y a 2 jours"},
        {"id": 2, "href": "/fr/casa/accessoires/Sacoche_124.htm", "subject": "Sacoche", "price": {"value": 1500}},   # wrong category
        {"id": 3, "href": laptop_href, "subject": "Chargeur", "price": {"value": 150}},                               # below floor
        {"id": 4, "href": laptop_href, "subject": "Pc", "price": {"value": 9_999_999}},                               # absurd price
        {"id": 5, "href": laptop_href, "subject": "", "price": {"value": 3000}},                                      # no title
        {"id": 6, "href": laptop_href, "subject": "Hp Elitebook", "price": {}},                                       # price not listed: kept
    ]))

    assert [ad["avito_id"] for ad in ads] == [1, 6]
    first = ads[0]
    assert first["link"] == "https://www.avito.ma" + laptop_href
    assert (first["price"], first["city"], first["is_shop"]) == (3000.0, "Casablanca", True)
    assert first["listed_at"] is not None
    assert ads[1]["price"] == 0.0


def test_content_hash_depends_on_title_only():
    href = "/fr/casa/ordinateurs_portables/x_1.htm"
    make = lambda title, desc: scraper._parse_ads(_next_data([{"id": 1, "href": href, "subject": title, "description": desc}]))[0]

    assert make("Dell XPS", "vu 12 fois")["content_hash"] == make("Dell XPS", "vu 99 fois")["content_hash"]
    assert make("Dell XPS", "")["content_hash"] != make("Hp Omen", "")["content_hash"]


def test_parse_listed_at():
    now = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)

    assert scraper.parse_listed_at("il y a 4 minutes", now) == now - timedelta(minutes=4)
    assert scraper.parse_listed_at("il y a 2 jours", now) == now - timedelta(days=2)
    assert scraper.parse_listed_at("il y a un mois", now) == now - timedelta(days=30)
    assert scraper.parse_listed_at("", now) is None
    assert scraper.parse_listed_at("hier", now) is None
