# -*- coding: utf-8 -*-
"""
refresh.py

Scrapes Avito, diffs against the `laptops` table by avito_id + content_hash, and:
  1. Queues genuinely new items in the `new_laptops` staging table
  2. Queues items whose content changed (same ID, new content hash) for re-parse
  3. Updates price/link changes directly in `laptops` (old prices go to price_history)
  4. Marks items not found in the scrape as is_sold=True
  5. Un-sells items that reappeared and stamps last_seen_at

All database writes happen in a single transaction.

Safety guard: mark_sold is skipped if scraped_count < 40% of ACTIVE (not total) DB
items. This avoids bulk-marking valid data as sold when the scraper has a bad run,
without triggering on a table inflated with already-sold rows.

Usage:
    python refresh.py              # scrape 500 pages (default)
    python refresh.py -p 5         # scrape 5 pages (quick test)
"""

import asyncio
import logging
from datetime import datetime

import psycopg

import db
from scraper import scrape

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Database helpers (all run inside the caller's transaction)
# ---------------------------------------------------------------------------
def fetch_db_items(conn: psycopg.Connection) -> list[dict]:
    """Fetch avito_id, link, price, content_hash, is_sold from every row in laptops."""
    rows = conn.execute(
        "select avito_id, link, price, content_hash, is_sold from laptops"
    ).fetchall()
    logger.info("Fetched %d items from database.", len(rows))
    return rows


def insert_into_new_laptops(conn: psycopg.Connection, items: list[dict]):
    """Queue items in the new_laptops staging table.

    An item already waiting in staging (e.g. left over from a failed parse) is
    refreshed in place instead of being queued twice.
    """
    if not items:
        return
    payload = [
        {
            "avito_id": str(item.get("avito_id", "")),
            "description": str(item.get("description", "")),
            "price": float(item.get("price", 0) or 0),
            "city": str(item.get("city", "")),
            "link": str(item.get("link", "")),
            "is_shop": bool(item.get("is_shop", False)),
            "has_delivery": bool(item.get("has_delivery", False)),
            "content_hash": str(item.get("content_hash", "")),
            "listed_at": item.get("listed_at"),
        }
        for item in items
    ]
    with conn.cursor() as cur:
        cur.executemany(
            "insert into new_laptops "
            "(avito_id, description, price, city, link, is_shop, has_delivery, content_hash, listed_at) "
            "values (%(avito_id)s, %(description)s, %(price)s, %(city)s, %(link)s, "
            "%(is_shop)s, %(has_delivery)s, %(content_hash)s, %(listed_at)s) "
            "on conflict (avito_id) do update set "
            "description = excluded.description, price = excluded.price, city = excluded.city, "
            "link = excluded.link, is_shop = excluded.is_shop, has_delivery = excluded.has_delivery, "
            "content_hash = excluded.content_hash, listed_at = excluded.listed_at",
            payload,
        )
    logger.info("Queued %d items in new_laptops.", len(payload))


def patch_prices(conn: psycopg.Connection, updates: list[dict]):
    """Update price and link for items that changed, identified by avito_id.

    The old price is preserved: a trigger appends every change to price_history.
    """
    if not updates:
        return
    with conn.cursor() as cur:
        cur.executemany(
            "update laptops set price = coalesce(%(price)s, price), link = coalesce(%(link)s, link) "
            "where avito_id = %(avito_id)s",
            [{"avito_id": u["avito_id"], "price": u.get("price"), "link": u.get("link")} for u in updates],
        )
    logger.info("Updated price/link for %d items.", len(updates))


def mark_sold(conn: psycopg.Connection, ids_not_found: set[str], scraped_count: int, active_count: int) -> int:
    """Set is_sold=True for DB items whose avito_id was NOT in the scrape.

    Safety guard: if scraped_count < 40% of active_count, the scraper likely had
    a bad run (timeouts, Cloudflare blocks) and we must not mass-mark valid items
    as sold. We compare against ACTIVE count only — not total — to avoid the
    death spiral where an inflated total DB count permanently trips the guard.

    Returns the number of rows newly marked sold.
    """
    if not ids_not_found:
        return 0

    if active_count > 0 and scraped_count < 0.4 * active_count:
        logger.warning(
            "SAFETY GUARD: scraped %d items < 40%% of %d active DB items. "
            "Skipping mark_sold to prevent accidental data loss.",
            scraped_count, active_count,
        )
        return 0

    marked = conn.execute(
        "update laptops set is_sold = true, sold_at = now() "
        "where avito_id = any(%s) and not is_sold",
        (list(ids_not_found),),
    ).rowcount
    logger.info("Marked %d items as sold.", marked)
    return marked


def touch_seen(conn: psycopg.Connection, ids_found: set[str]) -> int:
    """Record that these DB items are still live; un-sell any that were re-listed.

    Returns the number of rows flipped back from sold to active.
    """
    if not ids_found:
        return 0
    ids = list(ids_found)
    relisted = conn.execute(
        "update laptops set is_sold = false, sold_at = null where avito_id = any(%s) and is_sold",
        (ids,),
    ).rowcount
    conn.execute("update laptops set last_seen_at = now() where avito_id = any(%s)", (ids,))
    if relisted:
        logger.info("Confirmed %d re-listed items as active (is_sold=False).", relisted)
    return relisted


# ---------------------------------------------------------------------------
# Diff logic
# ---------------------------------------------------------------------------
def diff_and_act(conn: psycopg.Connection, scraped_ads: list[dict], db_items: list[dict]) -> dict:
    """
    Compare scraped ads against DB by avito_id + content_hash.

    Categories:
      1. New ID                            → insert into new_laptops (full parse)
      2. Same ID, hash changed             → insert into new_laptops (content updated, re-parse)
      3. Same ID, same hash, price/link diff → PATCH price/link only
      4. Same ID, same hash, same price    → skip
      5. DB ID not in scrape               → mark is_sold=True
    """
    # Build DB index by avito_id
    db_by_id: dict[str, dict] = {}
    active_count = 0

    for row in db_items:
        aid = str(row.get("avito_id", "")).strip()
        if aid:
            db_by_id[aid] = {
                "link": str(row.get("link", "")).strip(),
                "price": float(row.get("price", 0) or 0),
                "hash": str(row.get("content_hash", "") or ""),
                "is_sold": bool(row.get("is_sold", False)),
            }
        if not row.get("is_sold"):
            active_count += 1

    new_items: list[dict] = []
    updates: list[dict] = []
    scraped_ids: set[str] = set()
    stats = {"new": 0, "recycled": 0, "updated": 0, "unchanged": 0}

    for ad in scraped_ads:
        aid = str(ad.get("avito_id", "")).strip()
        if not aid:
            continue
        scraped_ids.add(aid)

        link = str(ad.get("link", "")).strip()
        price = float(ad.get("price", 0) or 0)
        current_hash = ad.get("content_hash", "")

        if aid not in db_by_id:
            # Category 1: genuinely new listing
            stats["new"] += 1
            new_items.append(ad)
        else:
            db = db_by_id[aid]
            if current_hash and db["hash"] and current_hash != db["hash"]:
                # Category 2: same ID, different content → re-parse needed.
                stats["recycled"] += 1
                new_items.append(ad)
            else:
                # Check for price or link changes
                price_changed = abs(price - db["price"]) > 0.01
                link_changed = link != db["link"]

                if price_changed or link_changed:
                    stats["updated"] += 1
                    u = {"avito_id": aid}
                    if price_changed: u["price"] = price
                    if link_changed: u["link"] = link
                    updates.append(u)
                else:
                    # Category 4: unchanged
                    stats["unchanged"] += 1

    # Category 5: DB IDs not seen in this scrape
    ids_not_found = set(db_by_id.keys()) - scraped_ids
    ids_found = set(db_by_id.keys()) & scraped_ids

    logger.info("=" * 50)
    logger.info("DIFF SUMMARY")
    logger.info("=" * 50)
    logger.info("  New listings (new ID):     %d", stats["new"])
    logger.info("  Content changed (re-parse): %d", stats["recycled"])
    logger.info("  Price/Link updated:        %d", stats["updated"])
    logger.info("  Unchanged (skipped):       %d", stats["unchanged"])
    logger.info("  Not found (sold?):         %d", len(ids_not_found))
    logger.info("  Active in DB:              %d", active_count)
    logger.info("=" * 50)

    insert_into_new_laptops(conn, new_items)
    patch_prices(conn, updates)
    marked_sold = mark_sold(conn, ids_not_found, len(scraped_ads), active_count)
    relisted = touch_seen(conn, ids_found)

    return {
        "scraped": len(scraped_ads),
        "new_items": stats["new"],
        "reparsed": stats["recycled"],
        "price_updates": stats["updated"],
        "marked_sold": marked_sold,
        "relisted": relisted,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(max_pages: int = 500) -> dict:
    """Scrape, diff against the DB and apply the result. Returns the run stats."""
    start = datetime.now()

    # 1. Scrape Avito (before opening a connection: this takes minutes)
    scraped_ads = asyncio.run(scrape(max_pages))
    logger.info("Scraped %d unique ads from %d pages.", len(scraped_ads), max_pages)

    # 2. Diff and act — one transaction, so a failure leaves the DB untouched
    with db.connect() as conn:
        with conn.transaction():
            db_items = fetch_db_items(conn)
            stats = diff_and_act(conn, scraped_ads, db_items)

    # 3. Summary
    elapsed = (datetime.now() - start).total_seconds()
    queued = stats["new_items"] + stats["reparsed"]
    print(f"\nRefresh complete in {elapsed:.1f}s")
    print(f"  {queued} items queued in new_laptops for parsing")
    return stats


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Avito refresh pipeline")
    parser.add_argument("-p", "--pages", type=int, default=500,
                        help="Number of pages to scrape (default: 500)")
    args = parser.parse_args()
    main(args.pages)
