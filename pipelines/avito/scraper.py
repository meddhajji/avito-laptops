# -*- coding: utf-8 -*-
from __future__ import annotations
"""
Avito Laptop Scraper
Fetches laptop listings from Avito.ma, compresses text, outputs CSV.

Key guards applied at ingestion:
  - URL category filter: only /ordinateurs_portables/ links accepted
  - Price floor: listings under 800 DH are dropped (accessories, not laptops)
  - content_hash: MD5 of compressed text, used by refresh.py to detect URL recycling
"""
import hashlib
import re
import csv
import json
import random
import asyncio
import logging
import aiohttp
from pathlib import Path
from datetime import datetime, timedelta, timezone
from bs4 import BeautifulSoup
import unicodedata

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL = "https://www.avito.ma/fr/maroc/ordinateurs_portables"
MAX_PAGES = 500
BATCH_SIZE = 25
BATCH_DELAY = 2.0
REQUEST_TIMEOUT = 15
OUTPUT_DIR = Path(__file__).parent / "data"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
]

CSV_COLUMNS = [
    "avito_id", "description", "price", "city", "link",
    "is_shop", "has_delivery", "content_hash",
    # --- Empty spec columns (filled later by the parser) ---
    "brand", "model", "cpu", "ram", "storage", "ssd",
    "gpu", "gpu_type", "gpu_vram",
    "screen_size", "refresh_rate", "new", "touchscreen",
]

# ---------------------------------------------------------------------------
# Text compression
# ---------------------------------------------------------------------------
def compress_text(title: str, description: str) -> str:
    """Join title + description, normalize to ASCII, keep only basic letters/digits/dots/spaces,
    collapse runs of 3+ identical chars to one."""
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

def _parse_ads(data: dict) -> list[dict]:
    """Extract raw ad dicts from the parsed JSON, applying category and price guards."""
    ads = (
        data.get("props", {})
        .get("pageProps", {})
        .get("componentProps", {})
        .get("ads", {})
        .get("ads", [])
    )
    results = []
    for ad in ads:
        try:
            # --- Extract link first for category guard ---
            link = ad.get("href", "")
            if link and not link.startswith("http"):
                link = f"https://www.avito.ma{link}"

            # Guard 1: URL category filter — only laptop category URLs pass.
            # Every individual laptop listing on Avito contains /ordinateurs_portables/
            # in its path. Accessories, bags, stands, etc. live in different paths.
            if not link or "/ordinateurs_portables/" not in link:
                logger.debug("Skipped non-laptop URL: %s", link[:80])
                continue

            # --- Extract price ---
            price_data = ad.get("price", {})
            price = float(price_data.get("value", 0)) if isinstance(price_data, dict) else float(price_data or 0)

            # Guard 2: Price ceiling — overpriced listings are not real laptops
            if price > 100000:
                logger.debug("Skipped overpriced ad (price: %d): %s", price, link)
                continue

            # Guard 3: Price floor — the cheapest operational laptop on avito.ma is ~900 DH.
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

            # Guard 4: content_hash — MD5 of the title only.
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

import requests

_req_session: requests.Session | None = None

def _get_req_session() -> requests.Session:
    global _req_session
    if _req_session is None:
        _req_session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=30, pool_maxsize=30, max_retries=2)
        _req_session.mount("https://", adapter)
    return _req_session

def _fetch_url_requests(url: str) -> str | None:
    session = _get_req_session()
    try:
        r = session.get(url, headers=_headers(), timeout=REQUEST_TIMEOUT)
        if r.status_code == 200:
            return r.text
        logger.warning("HTTP %d for %s", r.status_code, url)
    except Exception as e:
        logger.warning("Error fetching %s: %s", url, e)
    return None

async def _fetch_page(session: aiohttp.ClientSession | None, page: int) -> list[dict]:
    url = f"{BASE_URL}?o={page}"
    html = await asyncio.to_thread(_fetch_url_requests, url)
    if not html:
        logger.warning("Page %d: failed to fetch HTML", page)
        return []

    data = _extract_next_data(html)
    if not data:
        logger.warning("Page %d: no __NEXT_DATA__", page)
        return []
    ads = _parse_ads(data)
    logger.info("Page %d: %d ads", page, len(ads))
    return ads

async def scrape(max_pages: int = MAX_PAGES) -> list[dict]:
    """Scrape `max_pages` pages and return de-duplicated listings."""
    all_ads: list[dict] = []
    seen: set[str] = set()

    connector = aiohttp.TCPConnector(limit=50)
    async with aiohttp.ClientSession(connector=connector) as session:
        for batch_start in range(1, max_pages + 1, BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, max_pages + 1)
            tasks = [_fetch_page(session, p) for p in range(batch_start, batch_end)]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for result in results:
                if isinstance(result, list):
                    for ad in result:
                        key = ad["link"] or ad["avito_id"]
                        if key and key not in seen:
                            seen.add(key)
                            all_ads.append(ad)

            done = min(batch_end - 1, max_pages)
            logger.info("Progress: %d/%d pages | %d unique ads", done, max_pages, len(all_ads))

            if batch_end <= max_pages:
                await asyncio.sleep(BATCH_DELAY)

    logger.info("Scraping complete: %d unique ads (category filter active)", len(all_ads))
    if len(all_ads) < 100:
        logger.warning(
            "Very few ads collected (%d) — verify /ordinateurs_portables/ URL filter is still valid. "
            "If Avito changed their URL structure, this filter is silently dropping everything.",
            len(all_ads),
        )
    return all_ads

# ---------------------------------------------------------------------------
# CSV output
# ---------------------------------------------------------------------------
def save_csv(ads: list[dict], path: Path | None = None) -> Path:
    """Write ads to CSV with empty spec columns."""
    if path is None:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        path = OUTPUT_DIR / f"laptops_{datetime.now():%Y%m%d_%H%M}.csv"

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for ad in ads:
            row = {col: ad.get(col, "") for col in CSV_COLUMNS}
            writer.writerow(row)

    logger.info("Saved %d rows to %s", len(ads), path)
    return path

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main(max_pages: int = MAX_PAGES):
    start = datetime.now()
    ads = asyncio.run(scrape(max_pages))
    path = save_csv(ads)
    elapsed = (datetime.now() - start).total_seconds()
    print(f"\nDone: {len(ads)} laptops saved to {path} in {elapsed:.1f}s")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Avito Laptop Scraper")
    parser.add_argument("-p", "--pages", type=int, default=MAX_PAGES, help="Number of pages to scrape (default: 500)")
    args = parser.parse_args()
    main(args.pages)
