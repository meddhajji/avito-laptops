# -*- coding: utf-8 -*-
"""
parser.py

Reads listings from the `new_laptops` staging queue, sends them to Gemini for
laptop/non-laptop classification and spec extraction, upserts confirmed laptops
into `laptops` (on conflict avito_id) and removes processed rows from the queue.

Design:
  - Structured output: Gemini is given a JSON schema, and every response is
    validated with pydantic before anything is written.
  - job_id anchoring: each listing is tagged with its staging row id and results
    are matched back by that id, never by position. If Gemini returns 97 results
    for 100 listings, exactly those 97 are stored.
  - No head-of-line blocking: every listing sent to the LLM has its `attempts`
    counter bumped first. A listing that fails MAX_ATTEMPTS times in a run is
    skipped (left in the queue for the next run) so it cannot stall the rest.
  - Rejections are remembered: a listing rejected as a non-laptop is recorded in
    `rejected_listings` so the next refresh does not queue it again.
  - Batches are parsed concurrently; database writes stay on one connection.
  - Rate limits and overloads (429/503) are retried with exponential backoff,
    other transient errors get MAX_RETRIES attempts, and a rejected request
    (any other 4xx: bad model name, bad key, bad config) aborts the run at once.

Usage:
    python parser.py                 # process the whole queue
    python parser.py -n 50           # stop after ~50 listings (test)
"""
from __future__ import annotations

import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Literal

import psycopg
from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel, TypeAdapter, ValidationError

import db
from score_laptops import calc_laptop_score

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
GEMINI_BATCH = int(os.getenv("GEMINI_BATCH", "50"))              # listings per request
PARSE_WORKERS = int(os.getenv("PARSE_WORKERS", "3"))             # concurrent requests
ROUND_DELAY = float(os.getenv("PARSE_ROUND_DELAY", "5"))         # seconds between rounds (rate limiting)

MAX_ATTEMPTS = 3            # LLM sends per listing per run
MAX_RETRIES = 3             # per request, for malformed output and unexpected API errors
MAX_OVERLOAD_RETRIES = 6    # per request, for 429/503
MIN_PRICE = 800             # DH; below this it is an accessory, not a laptop
MAX_PRICE = 100_000         # DH; above this the price is not real
OUTAGE_MIN_QUEUE = 20       # a queue this big yielding zero results means the LLM is down

NUMERIC_SPECS = ["ram", "storage", "gpu_vram", "screen_size", "refresh_rate"]
TEXT_SPECS = ["brand", "model", "cpu", "gpu"]
FLAG_SPECS = ["ssd", "new", "touchscreen"]  # stored as 0/1
GPU_TYPES = {"Integrated", "Dedicated"}


# ---------------------------------------------------------------------------
# LLM output schema
# ---------------------------------------------------------------------------
class Specs(BaseModel):
    brand: str | None = None
    model: str | None = None
    cpu: str | None = None
    ram: float | None = None
    storage: float | None = None
    ssd: int | None = None
    gpu: str | None = None
    gpu_type: Literal["Integrated", "Dedicated"] | None = None
    gpu_vram: float | None = None
    screen_size: float | None = None
    refresh_rate: float | None = None
    new: int | None = None
    touchscreen: int | None = None


class ListingResult(BaseModel):
    job_id: str
    is_laptop: bool
    specs: Specs | None = None


_RESULTS = TypeAdapter(list[ListingResult])

SYSTEM_PROMPT = """You are a data extraction pipeline for laptop listings from a Moroccan classifieds site (Avito.ma).

INPUT: A JSON array. Each element has exactly two fields:
  "job_id": a string identifier: copy it unchanged to your output
  "text": the raw listing text (title + description, lowercased, may mix French, Arabic and Darija)

OUTPUT: exactly one result per input element (in any order), with job_id, is_laptop and specs.

FILTER: set is_laptop=false for ALL of the following. Be strict:
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

SPECS (only when is_laptop=true; use null specs when is_laptop=false):
- brand, model: capitalize first letter of each word only. No consecutive capitals.
  Write "Hp" not "HP", "Msi" not "MSI", "Asus" not "ASUS", "Dell" not "DELL", "Lenovo" not "LENOVO".
- cpu: the processor exactly as far as the text identifies it. Never leave it null when the text names a processor.
  * Exact model given: use it. Keep the hyphen for Intel iX series, lowercase after the hyphen.
    Examples: "i7-1255u", "i5-8350u", "Ryzen 5 5500u", "Core Ultra 7 155h", "M3 Pro", "Celeron N4020".
  * Only family and generation given ("i5 8eme", "i7 13th gen", "core i5 de 6ème génération"):
    write family + generation as "i5 8th gen", "i7 13th gen", "Ryzen 5 3rd gen".
  * Only the family given: write just the family ("i5", "Ryzen 7", "Celeron").
  * Keep every part of a model number that the text gives: "ryzen 5 pro 4650u" -> "Ryzen 5 Pro 4650u",
    "i5 m480" -> "i5-m480", "pentium gold 7505" -> "Pentium Gold 7505". Do not shorten it to the family.
  * Never invent a model number that is not in the text.
- gpu: commercial name with spaces not dashes. First letter of brand prefix capitalized only.
  Examples: "Rtx 4060", "Gtx 1650 Ti", "Radeon Rx 6600m", "Mx 450", "Rtx 5090".
- gpu_type: "Integrated", "Dedicated", or null.
- ram, storage, gpu_vram: numbers in GB (1 TB = 1000 GB). ram and storage must be whole numbers.
- ssd: 1 if SSD/NVMe/M.2, 0 if HDD, null if unknown.
- screen_size: number in inches (e.g. 15.6), null if unknown. Punctuation is stripped from the text, so
  "écran 15 6 pouces" means 15.6, but "écran 14 3 usb" means 14 inches and 3 USB ports. Real sizes are
  11.6, 12.5, 13.3, 14, 15.6, 16, 17.3; if the digits do not form one of these, keep only the whole number.
- refresh_rate: number in Hz (e.g. 144), null if unknown.
- new: 1 only if explicitly brand new, sealed or never used (neuf, jamais utilisé, sous emballage, جديد).
  "comme neuf", "état neuf", "toujours neuf" and "nouveau" describe a used laptop: use 0. null if unclear.
- touchscreen: 1 if touchscreen/tactile mentioned, null if not mentioned.
- Use null for any spec that cannot be clearly determined from the text. Never guess."""


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def reset_attempts(conn: psycopg.Connection):
    """Give every queued listing a fresh set of attempts for this run."""
    conn.execute("update new_laptops set attempts = 0 where attempts <> 0")
    conn.commit()


def claim_batch(conn: psycopg.Connection, limit: int) -> list[dict]:
    """Take up to `limit` queued listings that still have attempts left, and count the attempt.

    The attempt is committed BEFORE the LLM call: whatever happens next, a
    listing can only be claimed MAX_ATTEMPTS times per run.
    """
    rows = conn.execute(
        "update new_laptops set attempts = attempts + 1 "
        "where id in (select id from new_laptops where attempts < %s order by attempts, id limit %s) "
        "returning *",
        (MAX_ATTEMPTS, limit),
    ).fetchall()
    conn.commit()
    return sorted(rows, key=lambda r: r["id"])


def count_new_laptops(conn: psycopg.Connection) -> int:
    """Count rows left in the staging queue."""
    n = conn.execute("select count(*) as n from new_laptops").fetchone()["n"]
    conn.commit()
    return n


def delete_from_new_laptops(conn: psycopg.Connection, ids: list[int]):
    """Remove processed rows from the staging queue. Caller commits."""
    if ids:
        conn.execute("delete from new_laptops where id = any(%s)", (ids,))


def remember_rejected(conn: psycopg.Connection, listings: list[dict]):
    """Record rejected listings so refresh does not queue them again. Caller commits."""
    if not listings:
        return
    with conn.cursor() as cur:
        cur.executemany(
            "insert into rejected_listings (avito_id, content_hash) values (%(avito_id)s, %(content_hash)s) "
            "on conflict (avito_id) do update set content_hash = excluded.content_hash, rejected_at = now()",
            listings,
        )


def forget_rejected(conn: psycopg.Connection, avito_ids: list[str]):
    """A listing rewritten into a real laptop is no longer a reject. Caller commits."""
    if avito_ids:
        conn.execute("delete from rejected_listings where avito_id = any(%s)", (avito_ids,))


# ---------------------------------------------------------------------------
# Gemini extraction
# ---------------------------------------------------------------------------
def build_prompt(items: list[dict]) -> str:
    """JSON payload of {job_id, text}; results are matched back by job_id, not position."""
    payload = [
        {"job_id": str(item["id"]), "text": item.get("description", "")}
        for item in items
    ]
    return json.dumps(payload, ensure_ascii=False)


def _is_overload(error: Exception) -> bool:
    return isinstance(error, genai_errors.APIError) and error.code in (429, 503)


def parse_batch_gemini(client: genai.Client, items: list[dict]) -> list[dict]:
    """Send one batch to Gemini and return validated results.

    Each result: {"job_id": str, "is_laptop": bool, "specs": dict | None}.
    Returns [] if the request keeps failing; the caller leaves those listings
    in the queue. Raises if Gemini rejects the request itself, since retrying
    or moving on to the next batch cannot fix a bad model name, key or config.
    """
    config = genai_types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        response_schema=list[ListingResult],
        temperature=0,
        automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(disable=True),
    )
    prompt = build_prompt(items)
    failures = 0
    overloads = 0
    backoff = 15  # seconds; doubles on each 429/503, capped at 4 minutes

    while True:
        try:
            response = client.models.generate_content(model=MODEL, contents=prompt, config=config)
            results = _RESULTS.validate_json(response.text or "")
            return [r.model_dump() for r in results]

        except ValidationError as e:
            failures += 1
            logger.error("Invalid LLM output (failure %d/%d): %s", failures, MAX_RETRIES, str(e)[:200])
            if failures >= MAX_RETRIES:
                return []
            time.sleep(5)

        except Exception as e:
            if isinstance(e, genai_errors.ClientError) and e.code != 429:
                raise RuntimeError(f"Gemini rejected the request ({e.code}): {str(e)[:200]}") from e
            if _is_overload(e):
                overloads += 1
                if overloads > MAX_OVERLOAD_RETRIES:
                    logger.error("Still rate-limited/overloaded after %d retries. Skipping batch.", MAX_OVERLOAD_RETRIES)
                    return []
                logger.warning("Gemini %s: sleeping %ds (retry %d/%d)", e.code, backoff, overloads, MAX_OVERLOAD_RETRIES)
                time.sleep(backoff)
                backoff = min(backoff * 2, 240)
            else:
                failures += 1
                logger.error("API error (failure %d/%d): %s", failures, MAX_RETRIES, str(e)[:200])
                if failures >= MAX_RETRIES:
                    return []
                time.sleep(15)


# ---------------------------------------------------------------------------
# Row building
# ---------------------------------------------------------------------------
def truncate_description(desc: str, target: int = 80) -> str:
    if not desc or len(desc) <= target:
        return desc
    idx = desc.find(" ", target)
    return desc[:idx] if idx != -1 else desc


def is_valid_parse(specs: dict) -> bool:
    """A listing classified as a laptop is kept when it states at least one core spec.

    The LLM's is_laptop flag does the classification; this only filters out
    listings with nothing to store (e.g. a shop advertising "PC portables,
    contactez-nous"). A missing CPU is not a reason to drop a real laptop:
    plenty of sellers write only "MacBook Air 2018, 8 Go, 256 Go".
    """
    cpu = str(specs.get("cpu") or "").strip()
    return bool(len(cpu) >= 2 or specs.get("ram") or specs.get("storage"))


def _to_float(value) -> float | None:
    try:
        return float(value) if value not in (None, "", "null") else None
    except (ValueError, TypeError):
        return None


def _to_text(value) -> str | None:
    if value in (None, "null"):
        return None
    return str(value).strip() or None


def to_db_row(raw_item: dict, specs: dict) -> dict | None:
    """Merge scraped data + extracted specs + score into a `laptops` row.

    Returns None if the item fails post-parse sanity checks.
    """
    price = _to_float(raw_item.get("price")) or 0.0
    if 0 < price < MIN_PRICE:
        logger.info("Discarding staging id=%s: price %.0f DH below laptop floor", raw_item.get("id"), price)
        return None

    out: dict = {
        "avito_id": str(raw_item.get("avito_id", "")),
        "description": truncate_description(str(raw_item.get("description", ""))),
        "link": str(raw_item.get("link", "")),
        "city": str(raw_item.get("city") or ""),
        "content_hash": str(raw_item.get("content_hash") or ""),
        "price": price,
        "is_shop": bool(raw_item.get("is_shop", False)),
        "has_delivery": bool(raw_item.get("has_delivery", False)),
        "listed_at": raw_item.get("listed_at"),
        "is_sold": False,
    }

    for col in TEXT_SPECS:
        out[col] = _to_text(specs.get(col))
    for col in NUMERIC_SPECS:
        out[col] = _to_float(specs.get(col))
    for col in FLAG_SPECS:
        value = _to_float(specs.get(col))
        out[col] = None if value is None else int(value > 0)

    gpu_type = str(specs.get("gpu_type") or "").strip().capitalize()
    out["gpu_type"] = gpu_type if gpu_type in GPU_TYPES else None

    out["score"] = calc_laptop_score(out)
    return out


# ---------------------------------------------------------------------------
# Processing
# ---------------------------------------------------------------------------
def store_results(conn: psycopg.Connection, items: list[dict], results: list[dict]) -> dict:
    """Write one batch's results in a single transaction.

    Listings the LLM returned nothing for stay in the queue. Returns counters.
    """
    by_job_id = {str(r["job_id"]): r for r in results if isinstance(r, dict) and "job_id" in r}

    rows: list[dict] = []
    done_ids: list[int] = []   # staging rows to remove: stored laptops and rejected listings
    rejected: list[dict] = []

    for item in items:
        result = by_job_id.get(str(item["id"]))
        if result is None:
            continue

        done_ids.append(item["id"])
        specs = result.get("specs") or {}
        row = to_db_row(item, specs) if result.get("is_laptop") and is_valid_parse(specs) else None
        if row is None:
            rejected.append({"avito_id": str(item["avito_id"]), "content_hash": item.get("content_hash") or ""})
        else:
            rows.append(row)

    with conn.transaction():
        db.upsert_laptops(conn, rows)
        remember_rejected(conn, rejected)
        forget_rejected(conn, [row["avito_id"] for row in rows])
        delete_from_new_laptops(conn, done_ids)

    return {"laptops": len(rows), "rejected": len(rejected), "unanswered": len(items) - len(done_ids)}


def process_staging(
    conn: psycopg.Connection,
    parse_fn: Callable[[list[dict]], list[dict]],
    max_items: int | None = None,
    round_delay: float = ROUND_DELAY,
) -> dict:
    """Drain the staging queue. `parse_fn` maps a batch of listings to LLM results."""
    totals = {"laptops": 0, "rejected": 0, "unanswered": 0}
    queued = count_new_laptops(conn)
    if queued == 0:
        return {**totals, "queued": 0, "remaining": 0}

    logger.info("Processing %d queued listings (batch=%d, workers=%d)", queued, GEMINI_BATCH, PARSE_WORKERS)
    reset_attempts(conn)

    with ThreadPoolExecutor(max_workers=PARSE_WORKERS) as pool:
        while True:
            claimed = claim_batch(conn, GEMINI_BATCH * PARSE_WORKERS)
            if not claimed:
                break

            # Absurd prices are dropped without spending LLM tokens
            overpriced = {r["id"] for r in claimed if (r.get("price") or 0) > MAX_PRICE}
            if overpriced:
                delete_from_new_laptops(conn, list(overpriced))
                conn.commit()
                totals["rejected"] += len(overpriced)
                claimed = [r for r in claimed if r["id"] not in overpriced]

            batches = [claimed[i:i + GEMINI_BATCH] for i in range(0, len(claimed), GEMINI_BATCH)]
            for batch, results in zip(batches, pool.map(parse_fn, batches)):
                counts = store_results(conn, batch, results)
                for key, value in counts.items():
                    totals[key] += value

            done = totals["laptops"] + totals["rejected"]
            logger.info("Progress: %d/%d processed (%d laptops, %d rejected)", done, queued, totals["laptops"], totals["rejected"])
            if max_items is not None and done >= max_items:
                break
            time.sleep(round_delay)

    remaining = count_new_laptops(conn)
    if totals["laptops"] + totals["rejected"] == 0 and queued >= OUTAGE_MIN_QUEUE:
        raise RuntimeError(f"LLM returned no usable results for any of the {queued} queued listings")
    if remaining:
        logger.warning("%d listings left in the queue; they will be retried next run.", remaining)
    return {**totals, "queued": queued, "remaining": remaining}


def main(max_items: int | None = None) -> dict:
    if not GEMINI_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")

    client = genai.Client(api_key=GEMINI_KEY)
    with db.connect() as conn:
        stats = process_staging(conn, lambda batch: parse_batch_gemini(client, batch), max_items)

    print("\nProcessing complete!")
    print(f"  Laptops stored:         {stats['laptops']}")
    print(f"  Rejected (not laptops): {stats['rejected']}")
    print(f"  Remaining in queue:     {stats['remaining']}")
    return stats


if __name__ == "__main__":
    import argparse

    arg_parser = argparse.ArgumentParser(description="Extract specs for queued listings")
    arg_parser.add_argument("-n", "--num", type=int, default=None, help="Stop after about this many listings (default: all)")
    args = arg_parser.parse_args()
    main(args.num)
