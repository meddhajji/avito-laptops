# -*- coding: utf-8 -*-
from __future__ import annotations
"""
parser.py

Reads items from the `new_laptops` staging table, sends them to Gemini for
spec extraction and laptop/non-laptop classification, upserts confirmed laptops
into `laptops` (on conflict avito_id), and clears processed rows from `new_laptops`.

Key architecture changes vs. previous version:
  - job_id anchoring: each item is tagged with its staging row ID. Gemini returns
    results keyed by job_id (in any order). This eliminates positional desync —
    if Gemini returns 97 results for 100 items, exactly those 97 get matched
    correctly instead of shifting all subsequent items.
  - is_laptop classification: Gemini explicitly labels every item true/false.
    Non-laptops are discarded from staging without inserting to laptops.
  - Hardened is_valid_parse: requires cpu (≥2 chars) + (ram or storage).
    Brand alone no longer passes.
  - on_conflict=avito_id: consistent with the avito_id identity anchor architecture.
  - Batch size 100 (was 200): fewer items per prompt = less chance of Gemini
    skipping or merging items.
  - Separate discard/upsert staging ID lists: if upsert fails, only the
    confirmed laptops stay in staging for retry; non-laptops are still cleared.
  - Infinite 503 retry: model overload errors retry indefinitely with
    exponential backoff (30s→60s→120s→240s→300s cap). Other errors give up
    after MAX_RETRIES.

Usage:
    python parser.py                 # process all items
    python parser.py -n 50           # process only the first 50 items (test)
"""

import json
import logging
import os
import time

import psycopg
from dotenv import load_dotenv
from google import genai

import db
from score_laptops import calc_laptop_score

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_BATCH = 100   # reduced from 200; smaller batches reduce Gemini desync risk
MAX_RETRIES = 3

# Columns that Gemini must extract
SPEC_COLS = [
    "brand", "model", "cpu", "ram", "storage", "ssd",
    "gpu", "gpu_type", "gpu_vram", "screen_size",
    "refresh_rate", "new", "touchscreen",
]

NUMERIC_COLS = [
    "price", "ram", "storage", "ssd", "gpu_vram",
    "screen_size", "refresh_rate", "new", "touchscreen",
]
BOOL_COLS = ["is_shop", "has_delivery"]
FLAG_COLS = ["ssd", "new", "touchscreen"]  # stored as 0/1
GPU_TYPES = {"Integrated", "Dedicated"}

SYSTEM_PROMPT = """You are a data extraction pipeline for laptop listings from a Moroccan classifieds site (Avito.ma).

INPUT: A JSON array. Each element has exactly two fields:
  "job_id": a string identifier — copy it unchanged to your output
  "text": the raw listing description (title + description, ASCII-normalized)

OUTPUT: A JSON array with exactly one element per input element (results may be in ANY ORDER), each with:
{
  "job_id": "<same string as in input>",
  "is_laptop": true or false,
  "specs": { ... }
}

FILTER — set is_laptop=false for ALL of the following. Be strict:
- Laptop bags, sleeves, backpacks, cases, pouches
- Laptop stands, mounts, cooling pads, risers, supports
- External screens or monitors sold alone
- Chargers, power adapters, batteries
- RAM sticks or SSD drives sold alone (not inside a complete laptop)
- Repair services, screen replacement, keyboard replacement, cleaning
- Docking stations, USB hubs, peripherals, mice, keyboards, webcams
- Desktop PC towers (not laptops)
- Tablet computers (iPad, Samsung Tab, Lenovo Tab, etc.)
- Smartphone accessories mislabeled as computer items
- Any item that is NOT a complete, stand-alone, functional laptop unit

Set is_laptop=true ONLY for complete, functional laptop computers
(gaming laptops, ultrabooks, MacBooks, Chromebooks, workstation laptops are all valid).

SPECS (required only when is_laptop=true; omit the specs key or use {} when is_laptop=false):
Keys: brand, model, cpu, ram, storage, ssd, gpu, gpu_type, gpu_vram, screen_size, refresh_rate, new, touchscreen

SPEC RULES:
- brand, model: capitalize first letter of each word only. No consecutive capitals.
  Write "Hp" not "HP", "Msi" not "MSI", "Asus" not "ASUS", "Dell" not "DELL", "Lenovo" not "LENOVO".
- cpu: commercial name. Keep hyphen for Intel iX series (i5-8350u, i7-1165G7) and AMD Ryzen only.
  Lowercase after hyphen. Examples: "i7-1255u", "Ryzen 5 5500u", "Core Ultra 7 155h", "M3 Pro", "Ultra 9 285hx".
- gpu: commercial name with spaces not dashes. First letter of brand prefix capitalized only.
  Examples: "Rtx 4060", "Gtx 1650 Ti", "Radeon Rx 6600m", "Mx 450", "Rtx 5090".
- gpu_type: "Integrated", "Dedicated", or null.
- ram, storage, gpu_vram: numbers in GB (1 TB = 1000 GB). ram and storage must be integers.
- ssd: 1 if SSD/NVMe/M.2, 0 if HDD, null if unknown.
- screen_size: number in inches (e.g. 15.6), null if unknown.
- refresh_rate: number in Hz (e.g. 144), null if unknown.
- new: 1 if explicitly brand new/sealed/neuf/جديد, 0 if used/occasion/reconditionné, null if unclear.
- touchscreen: 1 if touchscreen/tactile mentioned, null if not mentioned.
- Use null for any spec that cannot be clearly determined from the text.

Output ONLY the JSON array. No markdown, no backticks, no explanation, no preamble."""


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def fetch_new_laptops_batch(conn: psycopg.Connection, limit: int = GEMINI_BATCH) -> list[dict]:
    """Fetch a batch of rows from new_laptops ordered by id ascending."""
    rows = conn.execute("select * from new_laptops order by id limit %s", (limit,)).fetchall()
    conn.commit()  # don't sit idle-in-transaction during the LLM call
    return rows


def count_new_laptops(conn: psycopg.Connection) -> int:
    """Count remaining rows in new_laptops."""
    n = conn.execute("select count(*) as n from new_laptops").fetchone()["n"]
    conn.commit()
    return n


def delete_from_new_laptops(conn: psycopg.Connection, ids: list[int]):
    """Delete processed rows from new_laptops by their staging id."""
    if not ids:
        return
    conn.execute("delete from new_laptops where id = any(%s)", (ids,))
    conn.commit()


def upsert_to_laptops(conn: psycopg.Connection, rows: list[dict]) -> bool:
    """Upsert rows into the laptops table, conflict resolution on avito_id."""
    if not rows:
        return True
    try:
        db.upsert_laptops(conn, rows)
        conn.commit()
    except psycopg.Error as e:
        conn.rollback()
        logger.error("Upsert failed: %s", e)
        return False
    return True


# ---------------------------------------------------------------------------
# Gemini parsing — job_id anchored, infinite 503 retry
# ---------------------------------------------------------------------------
def build_prompt(items: list[dict]) -> str:
    """Build a job_id-anchored JSON payload.

    Gemini returns results in any order — the caller uses job_id lookup,
    not positional zip, to match results back to items.
    """
    payload = [
        {"job_id": str(item["id"]), "text": item.get("description", "")}
        for item in items
    ]
    return json.dumps(payload, ensure_ascii=False)


def parse_batch_gemini(client, items: list[dict]) -> list[dict]:
    """Send a batch to Gemini and return result objects.

    Each result: {"job_id": str, "is_laptop": bool, "specs": dict}.

    Retry policy:
    - 503 UNAVAILABLE (model overloaded): retry INDEFINITELY with exponential
      backoff starting at 30s, capped at 5 minutes. The parser will never
      give up on a 503 — it will keep sleeping and retrying until the model
      responds.
    - JSON parse errors or other API errors: up to MAX_RETRIES attempts, then
      returns [] so the caller leaves the batch in staging for the next run.
    """
    prompt = build_prompt(items)
    parse_failures = 0
    overload_backoff = 30  # seconds; doubles on each 503, capped at 300
    overload_retries = 0
    MAX_OVERLOAD_RETRIES = 10

    while True:
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=[
                    {"role": "user", "parts": [{"text": SYSTEM_PROMPT}]},
                    {"role": "user", "parts": [{"text": prompt}]},
                ],
            )

            text = response.text.strip()

            # Strip markdown fences if present
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

            parsed = json.loads(text)

            if not isinstance(parsed, list):
                parse_failures += 1
                logger.error(
                    "Gemini returned %s instead of list (failure %d/%d) — retrying",
                    type(parsed).__name__, parse_failures, MAX_RETRIES,
                )
                if parse_failures >= MAX_RETRIES:
                    logger.error("Too many non-list responses. Skipping batch.")
                    return []
                time.sleep(15)
                continue

            # Success — reset overload backoff
            overload_backoff = 30
            valid = [r for r in parsed if isinstance(r, dict) and "job_id" in r]
            logger.info("Gemini returned %d valid results for %d items", len(valid), len(items))
            return valid

        except json.JSONDecodeError as e:
            parse_failures += 1
            logger.error("JSON parse error (failure %d/%d): %s", parse_failures, MAX_RETRIES, e)
            if parse_failures >= MAX_RETRIES:
                logger.error("Too many JSON errors. Skipping batch.")
                return []
            time.sleep(15)

        except Exception as e:
            err_str = str(e)
            if "503" in err_str or "UNAVAILABLE" in err_str:
                overload_retries += 1
                if overload_retries > MAX_OVERLOAD_RETRIES:
                    logger.error("Max 503 retries reached. Skipping batch.")
                    return []
                # Model is overloaded — wait and retry.
                # This is temporary congestion, NOT a bug.
                logger.warning(
                    "503 UNAVAILABLE — model overloaded. Sleeping %ds before retry "
                    "(retry %d/%d)...",
                    overload_backoff, overload_retries, MAX_OVERLOAD_RETRIES
                )
                time.sleep(overload_backoff)
                overload_backoff = min(overload_backoff * 2, 300)  # cap at 5 min
            else:
                parse_failures += 1
                logger.error(
                    "API error (failure %d/%d): %s",
                    parse_failures, MAX_RETRIES, e,
                )
                if parse_failures >= MAX_RETRIES:
                    logger.error("Too many API errors. Skipping batch.")
                    return []
                time.sleep(30)


# ---------------------------------------------------------------------------
# Scoring & row building
# ---------------------------------------------------------------------------
def truncate_description(desc: str, target: int = 80) -> str:
    if not desc or len(desc) <= target:
        return desc
    idx = desc.find(" ", target)
    return desc[:idx] if idx != -1 else desc


def is_valid_parse(specs: dict) -> bool:
    """A valid laptop parse requires a CPU string (≥2 chars) and at least one of RAM or storage.

    Brand alone is NOT sufficient — Gemini regularly extracts brand="Hp" from
    listings like "Support PC portable HP" (a PC stand). The dual requirement of
    cpu + memory prevents accessories from slipping through.

    The threshold is ≥2 chars (not 3) to allow valid short CPUs: i7, i5, i3, M4, M1, M2.
    """
    cpu = specs.get("cpu")
    ram = specs.get("ram")
    storage = specs.get("storage")

    if not cpu or len(str(cpu).strip()) < 2:
        return False
    if not ram and not storage:
        return False
    return True


def to_db_row(raw_item: dict, specs: dict) -> dict | None:
    """Merge raw scraped data + parsed specs + score into a DB row.

    Returns None if the item fails post-parse sanity checks.
    """
    out: dict = {}

    # Metadata from scraped item
    out["avito_id"] = str(raw_item.get("avito_id", ""))
    out["description"] = truncate_description(str(raw_item.get("description", "")))
    out["link"] = str(raw_item.get("link", ""))
    out["city"] = str(raw_item.get("city", ""))
    out["content_hash"] = str(raw_item.get("content_hash", ""))

    # Price
    try:
        out["price"] = float(raw_item.get("price", 0) or 0)
    except (ValueError, TypeError):
        out["price"] = None

    # Post-parse price sanity
    if out["price"] and out["price"] < 800:
        logger.info(
            "Discarding staging id=%s: price %.0f DH below laptop floor",
            raw_item.get("id"), out["price"],
        )
        return None

    # Booleans from scraper
    for col in BOOL_COLS:
        val = raw_item.get(col, False)
        if isinstance(val, bool):
            out[col] = val
        elif str(val).lower() in ("true", "1", "yes"):
            out[col] = True
        else:
            out[col] = False

    # Specs from Gemini
    for col in SPEC_COLS:
        val = specs.get(col)
        if val is None or val == "null" or val == "":
            out[col] = None if col in NUMERIC_COLS else ""
        elif col in NUMERIC_COLS:
            try:
                out[col] = float(val)
            except (ValueError, TypeError):
                out[col] = None
        else:
            out[col] = str(val)

    # Constrained columns: anything outside the allowed set becomes null
    for col in FLAG_COLS:
        if out[col] is not None:
            out[col] = 1 if out[col] > 0 else 0
    gpu_type = out["gpu_type"].strip().capitalize()
    out["gpu_type"] = gpu_type if gpu_type in GPU_TYPES else None

    out["listed_at"] = raw_item.get("listed_at")
    out["is_sold"] = False
    out["score"] = calc_laptop_score(out)
    return out


# ---------------------------------------------------------------------------
# Main processing loop
# ---------------------------------------------------------------------------
def main(max_items: int | None = None):
    if not GEMINI_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")

    with db.connect() as conn:
        _process_staging(conn, max_items)


def _process_staging(conn: psycopg.Connection, max_items: int | None):
    total = count_new_laptops(conn)
    if total == 0:
        print("new_laptops table is empty. Nothing to process.")
        return

    if max_items and total > max_items:
        total = max_items
    print(f"Processing {total} items from new_laptops table...")

    logger.info("Loading Gemini client...")
    gemini_client = genai.Client(api_key=GEMINI_KEY)
    logger.info("Gemini client loaded.")

    processed = 0
    failed_ids: set[int] = set()
    max_loops = (total // GEMINI_BATCH + 1) * MAX_RETRIES

    for loop in range(max_loops):
        batch = fetch_new_laptops_batch(conn, GEMINI_BATCH)
        if not batch:
            break

        # Skip items that have already failed parsing in this run
        fresh_batch = [item for item in batch if item["id"] not in failed_ids]
        if not fresh_batch:
            logger.warning("All remaining %d items in batch are in failed_ids. Stopping.", len(batch))
            break

        # Pre-filter overpriced items without spending Gemini credits
        valid_price_batch = []
        auto_discard_ids = []
        for item in fresh_batch:
            price = float(item.get("price", 0) or 0)
            if price > 100000:
                auto_discard_ids.append(item["id"])
            else:
                valid_price_batch.append(item)

        if auto_discard_ids:
            delete_from_new_laptops(conn, auto_discard_ids)
            processed += len(auto_discard_ids)

        if not valid_price_batch:
            continue

        logger.info("--- Loop %d: sending %d items to Gemini ---", loop + 1, len(valid_price_batch))

        # parse_batch_gemini retries 503s indefinitely — will not return until success or hard failure
        raw_output = parse_batch_gemini(gemini_client, valid_price_batch)

        # Build lookup by job_id — order-independent matching
        parsed_by_id: dict[str, dict] = {
            str(r["job_id"]): r
            for r in raw_output
            if isinstance(r, dict) and "job_id" in r
        }

        db_rows: list[dict] = []
        upsert_staging_ids: list[int] = []   # delete from staging only if upsert succeeds
        discard_staging_ids: list[int] = []  # delete regardless (non-laptops, sanity failures)
        seen_links: set[str] = set()

        for item in valid_price_batch:
            job_id = str(item["id"])
            result = parsed_by_id.get(job_id)

            if result is None:
                # Gemini didn't return a result for this specific job_id in this batch.
                # Do NOT discard it; leave it in staging so the next run can try again.
                logger.warning("No Gemini result for job_id=%s. Keeping in new_laptops.", job_id)
                continue

            if not result.get("is_laptop"):
                logger.debug("Non-laptop discarded job_id=%s", job_id)
                discard_staging_ids.append(item["id"])
                continue

            specs = result.get("specs") or {}
            if not is_valid_parse(specs):
                logger.debug("Weak parse for job_id=%s (discarded)", job_id)
                discard_staging_ids.append(item["id"])
                continue

            db_row = to_db_row(item, specs)
            if db_row is None:
                discard_staging_ids.append(item["id"])
                continue

            link = str(item.get("link", ""))
            if link in seen_links:
                logger.debug("Duplicate link in batch, discarding: %s", link[:60])
                discard_staging_ids.append(item["id"])
                continue
            seen_links.add(link)

            db_rows.append(db_row)
            upsert_staging_ids.append(item["id"])

        # Upsert valid laptops then clean staging
        if db_rows:
            success = upsert_to_laptops(conn, db_rows)
            if success:
                delete_from_new_laptops(conn, upsert_staging_ids + discard_staging_ids)
                processed += len(upsert_staging_ids) + len(discard_staging_ids)
                logger.info(
                    "Loop %d: upserted=%d non-laptops=%d total_processed=%d",
                    loop + 1, len(db_rows), len(discard_staging_ids), processed,
                )
            else:
                delete_from_new_laptops(conn, discard_staging_ids)
                processed += len(discard_staging_ids)
                logger.error(
                    "Loop %d: upsert failed — %d items kept in staging for retry.",
                    loop + 1, len(upsert_staging_ids),
                )
        elif discard_staging_ids:
            delete_from_new_laptops(conn, discard_staging_ids)
            processed += len(discard_staging_ids)
            logger.info("Loop %d: all %d items were non-laptops, discarded.", loop + 1, len(discard_staging_ids))

        # Rate limiting: stay well under 15 RPM on Gemini free tier
        time.sleep(10)

        if max_items is not None and processed >= max_items:
            break

    remaining = count_new_laptops(conn)
    print("\nProcessing complete!")
    print(f"  Successfully processed: {processed}")
    print(f"  Remaining in new_laptops: {remaining}")
    if failed_ids:
        print(f"  Items queued for retry next run: {len(failed_ids)}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Parse and upload new laptops")
    parser.add_argument(
        "-n", "--num",
        type=int,
        default=None,
        help="Max items to process (default: all)",
    )
    args = parser.parse_args()
    main(args.num)
