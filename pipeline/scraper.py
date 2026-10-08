# -*- coding: utf-8 -*-
from __future__ import annotations
"""
Avito Laptop Scraper
Fetches laptop listings from Avito.ma and normalizes their text.

Key guards applied at ingestion:
  - URL category filter: only /ordinateurs_portables/ links accepted
  - Price floor: listings under 800 DH are dropped (accessories, not laptops)
  - content_hash: MD5 of the title, used by refresh.py to detect rewritten listings

Pages are fetched until Avito returns an empty one, failed pages are retried
with backoff, and the result reports whether the scrape was complete (checked
against Avito's own listing total) so callers can decide if "not seen" really
means "gone".
"""
import hashlib
import re
import json
import math
import random
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL = "https://www.avito.ma/fr/maroc/ordinateurs_portables"
HARD_PAGE_LIMIT = 1500   # runaway guard; the category has ~700 pages
MIN_COVERAGE = 0.9       # share of Avito's listing total we must have seen to call a scrape complete
BATCH_SIZE = 25          # pages fetched concurrently
BATCH_DELAY = 2.0        # seconds between batches
REQUEST_TIMEOUT = 15
FETCH_ATTEMPTS = 3       # per page, with exponential backoff

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
]

# ---------------------------------------------------------------------------
# Text compression
# ---------------------------------------------------------------------------
def compress_text(title: str, description: str) -> str:
    """Join title + description, lowercase, strip noise and punctuation (letters of any
    script, digits and dots are kept), collapse runs of 3+ identical chars to one."""
    text = f"{title} {description}".lower()

    # Strip dynamic/relative time patterns
    text = re.sub(r"il y a \d+ (minutes?|heures?|jours?|semaines?)", " ", text)
    text = re.sub(r"refreshed \d+\w* ago", " ", text)
    text = re.sub(r"\d+ vues?", " ", text)

    # Strip common promotional/contact noise
    noise_patterns = [
        r"livraison (partout au maroc|gratuite|possible|disponible)",
        r"paiement (à|a) la livraison",
        r"contact(ez-nous|ez-moi| rapide| par| via)? (sur|via|par)? (whatsapp|avito|téléphone)",
        r"disponible (immédiatement|dès maintenant|maintenant)",
        r"garantie \d+ mois",
        r"prix (fixe|négociable|dh|dhs)",
    ]
    for pattern in noise_patterns:
        text = re.sub(pattern, " ", text)

    # Allow Arabic letters, French accents, basic latin, numbers
    text = re.sub(r"[^\w\s\.]", " ", text, flags=re.UNICODE)

    # Collapse 3+ identical consecutive characters -> 1
    text = re.sub(r"(.)\1{2,}", r"\1", text)

    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text

# ---------------------------------------------------------------------------
# Listing date
# ---------------------------------------------------------------------------
_AGE_UNITS = {
    "minute": timedelta(minutes=1),
    "heure": timedelta(hours=1),
    "jour": timedelta(days=1),
    "semaine": timedelta(weeks=1),
    "mois": timedelta(days=30),
    "an": timedelta(days=365),
}

def parse_listed_at(relative: str, now: datetime | None = None) -> datetime | None:
    """Convert Avito's relative age ("il y a 4 minutes", "il y a 2 jours") to a UTC timestamp.

    Returns None for anything unrecognized. The result is only as precise as the
    unit Avito shows.
    """
    m = re.search(r"il y a (\d+|une?) (minute|heure|jour|semaine|mois|an)", (relative or "").lower())
    if not m:
        return None
    count = 1 if m.group(1) in ("un", "une") else int(m.group(1))
    return (now or datetime.now(timezone.utc)) - count * _AGE_UNITS[m.group(2)]

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def _headers() -> dict:
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
        "Sec-Ch-Ua": '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }

def _extract_next_data(html: str) -> dict | None:
    """Pull the __NEXT_DATA__ JSON blob from the page."""
    if "__NEXT_DATA__" not in html:
        return None
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find("script", id="__NEXT_DATA__")
    if tag and tag.string:
        return json.loads(tag.string)
    if tag:
        content = tag.get_text()
        if content:
            return json.loads(content)
    # Regex fallback
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if m:
        return json.loads(m.group(1))
    return None

def _ads_container(data: dict) -> dict:
    return (
        data.get("props", {})
        .get("pageProps", {})
        .get("componentProps", {})
        .get("ads", {})
    ) or {}

def _parse_ads(data: dict) -> list[dict]:
    """Extract raw ad dicts from the parsed JSON, applying category and price guards."""
    ads = _ads_container(data).get("ads", [])
    results = []
    for ad in ads:
        try:
            # --- Extract link first for category guard ---
            link = ad.get("href", "")
            if link and not link.startswith("http"):
                link = f"https://www.avito.ma{link}"

            # Guard 1: URL category filter: only laptop category URLs pass.
            # Every individual laptop listing on Avito contains /ordinateurs_portables/
            # in its path. Accessories, bags, stands, etc. live in different paths.
            if not link or "/ordinateurs_portables/" not in link:
                logger.debug("Skipped non-laptop URL: %s", link[:80])
                continue

            # --- Extract price ---
            price_data = ad.get("price", {})
            price = float(price_data.get("value", 0)) if isinstance(price_data, dict) else float(price_data or 0)

            # Guard 2: Price ceiling: overpriced listings are not real laptops
            if price > 100000:
                logger.debug("Skipped overpriced ad (price: %d): %s", price, link)
                continue

            # Guard 3: Price floor: the cheapest operational laptop on avito.ma is ~900 DH.
            # Sub-800 DH items are accessories, parts, repair services, or PC stands.
            if 0 < price < 800:
                logger.debug("Skipped sub-800 DH listing (price: %d): %s", price, link)
                continue

            # --- Extract avito_id ---
            avito_id = ad.get("id")
            if not avito_id and link:
                m = re.search(r"_(\d+)\.htm", link)
                if m:
                    avito_id = m.group(1)

            # --- Extract and compress text ---
            title = ad.get("subject", "")
            desc = ad.get("description", "")
            if not title:
                continue

            compressed = compress_text(title, desc)

            # Guard 4: content_hash: MD5 of the title only.
            # Description is unstable (view counts, timestamps) and causes false re-parses.
            content_hash = hashlib.md5(title.lower().encode("utf-8")).hexdigest()

            results.append({
                "avito_id": avito_id or "",
                "description": compressed,
                "price": price,
                "city": ad.get("location", ""),
                "link": link,
                "is_shop": ad.get("isShop", False),
                "has_delivery": ad.get("hasShipping", False) or ad.get("isDelivery", False),
                "content_hash": content_hash,
                "listed_at": parse_listed_at(ad.get("date", "")),
            })
        except Exception:
            logger.debug("Skipped malformed ad", exc_info=True)
    return results

# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------
@dataclass
class ScrapeResult:
    ads: list[dict] = field(default_factory=list)
    total_listed: int = 0          # listings Avito says exist in the category
    raw_seen: int = 0              # ads on fetched pages, before guards and de-duplication
    pages_fetched: int = 0
    failed_pages: list[int] = field(default_factory=list)
    partial: bool = False          # True when max_pages cut the scrape short
    reached_end: bool = False      # True when an empty page marked the end of the category

    @property
    def complete(self) -> bool:
        """The whole category was fetched, so an unseen listing is really gone.

        Besides reaching the end with no failed pages, the ads seen must add up to
        roughly what Avito says exists: a block page that renders as an empty
        listing would otherwise look like the end of the category.
        """
        return (
            not self.partial
            and self.reached_end
            and not self.failed_pages
            and self.raw_seen >= MIN_COVERAGE * self.total_listed
        )


@dataclass
class _Page:
    number: int
    ok: bool
    ads: list[dict] = field(default_factory=list)
    raw_count: int = 0             # ads on the page before guards; 0 means past the last page
    total_listed: int = 0


_req_session: requests.Session | None = None

def _get_req_session() -> requests.Session:
    global _req_session
    if _req_session is None:
        _req_session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=BATCH_SIZE, pool_maxsize=BATCH_SIZE)
        _req_session.mount("https://", adapter)
    return _req_session

def _fetch_html(url: str) -> str | None:
    """GET a page, retrying on errors and non-200 responses with exponential backoff."""
    session = _get_req_session()
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            r = session.get(url, headers=_headers(), timeout=REQUEST_TIMEOUT)
            if r.status_code == 200:
                return r.text
            logger.warning("HTTP %d for %s (attempt %d/%d)", r.status_code, url, attempt, FETCH_ATTEMPTS)
        except requests.RequestException as e:
            logger.warning("Error fetching %s (attempt %d/%d): %s", url, attempt, FETCH_ATTEMPTS, e)
        if attempt < FETCH_ATTEMPTS:
            time.sleep(2 ** attempt + random.random())
    return None

def _fetch_page(number: int) -> _Page:
    html = _fetch_html(f"{BASE_URL}?o={number}")
    if not html:
        return _Page(number, ok=False)
    try:
        data = _extract_next_data(html)
    except json.JSONDecodeError:
        data = None
    if not data:
        logger.warning("Page %d: no __NEXT_DATA__", number)
        return _Page(number, ok=False)

    container = _ads_container(data)
    return _Page(
        number,
        ok=True,
        ads=_parse_ads(data),
        raw_count=len(container.get("ads") or []),
        total_listed=int(container.get("totalListingAds") or 0),
    )

def scrape(max_pages: int | None = None) -> ScrapeResult:
    """Scrape the laptop category and return de-duplicated listings.

    With max_pages=None the whole category is scraped, stopping at the first
    empty page. With a number, only that many pages are fetched and the result
    is marked partial.
    """
    result = ScrapeResult(partial=max_pages is not None)
    seen: set[str] = set()

    def collect(page: _Page):
        result.pages_fetched += 1
        result.raw_seen += page.raw_count
        for ad in page.ads:
            key = ad["avito_id"] or ad["link"]
            if key and key not in seen:
                seen.add(key)
                result.ads.append(ad)

    first = _fetch_page(1)
    if not first.ok or first.raw_count == 0:
        logger.error("Page 1 could not be scraped: Avito is blocking us or changed its page structure.")
        result.failed_pages.append(1)
        return result
    collect(first)
    result.total_listed = first.total_listed

    last_page = min(max_pages or HARD_PAGE_LIMIT, HARD_PAGE_LIMIT)
    expected_pages = math.ceil(first.total_listed / max(first.raw_count, 1))
    logger.info("Avito lists %d ads (about %d pages)", first.total_listed, expected_pages)

    with ThreadPoolExecutor(max_workers=BATCH_SIZE) as pool:
        for batch_start in range(2, last_page + 1, BATCH_SIZE):
            numbers = range(batch_start, min(batch_start + BATCH_SIZE, last_page + 1))
            for page in pool.map(_fetch_page, numbers):
                if not page.ok:
                    result.failed_pages.append(page.number)
                elif page.raw_count == 0:
                    result.reached_end = True
                else:
                    collect(page)

            logger.info("Progress: page %d of ~%d | %d unique ads", numbers[-1], max_pages or expected_pages, len(result.ads))
            if result.reached_end or numbers[-1] >= last_page:
                break
            time.sleep(BATCH_DELAY)

        # One more pass over pages that failed all their attempts
        if result.failed_pages:
            logger.info("Retrying %d failed pages...", len(result.failed_pages))
            time.sleep(BATCH_DELAY * 5)
            still_failed = []
            for page in pool.map(_fetch_page, result.failed_pages):
                if page.ok:
                    collect(page)
                else:
                    still_failed.append(page.number)
            result.failed_pages = still_failed

    logger.info(
        "Scraping finished: %d unique ads from %d pages, %d pages failed (%s)",
        len(result.ads), result.pages_fetched, len(result.failed_pages),
        "complete" if result.complete else "incomplete",
    )
    return result
