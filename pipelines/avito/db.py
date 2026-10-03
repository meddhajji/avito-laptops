# -*- coding: utf-8 -*-
"""
db.py

PostgreSQL access for the pipeline: connection, migrations, sample-data seed
and pipeline run bookkeeping. Everything goes through DATABASE_URL, so the same
code runs against Supabase, any hosted Postgres, or a local container.

Usage:
    python db.py migrate     # apply pending migrations from db/migrations
    python db.py seed        # load db/seed/laptops_sample.csv (for local demos)
"""

import csv
import logging
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

load_dotenv()

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = Path(os.getenv("MIGRATIONS_DIR", REPO_ROOT / "db" / "migrations"))
SEED_CSV = Path(os.getenv("SEED_CSV", REPO_ROOT / "db" / "seed" / "laptops_sample.csv"))

# Columns written to `laptops` by the parser and the seed loader
LAPTOP_COLS = [
    "avito_id", "link", "description", "content_hash", "price", "city",
    "is_shop", "has_delivery", "brand", "model", "cpu", "ram", "storage", "ssd",
    "gpu", "gpu_type", "gpu_vram", "screen_size", "refresh_rate", "new",
    "touchscreen", "score", "is_sold", "listed_at",
]

RUN_STAT_COLS = [
    "scraped", "pages_failed", "new_items", "reparsed", "price_updates",
    "marked_sold", "relisted", "parsed", "rejected", "queue_remaining", "duplicates",
]


def connect() -> psycopg.Connection:
    """Open a connection. Raises if DATABASE_URL is missing or unreachable."""
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    # prepare_threshold=None: transaction-mode poolers (Supabase, PgBouncer)
    # do not support server-side prepared statements.
    return psycopg.connect(url, row_factory=dict_row, prepare_threshold=None)


# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------
def migrate(conn: psycopg.Connection) -> list[str]:
    """Apply every .sql file in MIGRATIONS_DIR not yet recorded. Returns applied names."""
    conn.execute(
        "create table if not exists schema_migrations ("
        "name text primary key, applied_at timestamptz not null default now())"
    )
    conn.commit()
    done = {r["name"] for r in conn.execute("select name from schema_migrations")}

    applied = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if path.name in done:
            continue
        logger.info("Applying migration %s", path.name)
        # Each migration and its bookkeeping row commit together or not at all
        with conn.transaction():
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("insert into schema_migrations (name) values (%s)", (path.name,))
        applied.append(path.name)
    return applied


# ---------------------------------------------------------------------------
# Laptop upsert (shared by parser and seed)
# ---------------------------------------------------------------------------
_UPSERT_SQL = (
    f"insert into laptops ({', '.join(LAPTOP_COLS)}, sold_at) "
    f"values ({', '.join(f'%({c})s' for c in LAPTOP_COLS)}, case when %(is_sold)s then now() end) "
    "on conflict (avito_id) do update set "
    + ", ".join(f"{c} = excluded.{c}" for c in LAPTOP_COLS if c != "avito_id")
    + ", sold_at = case when excluded.is_sold then coalesce(laptops.sold_at, now()) end"
    + ", last_seen_at = now()"
)


def upsert_laptops(conn: psycopg.Connection, rows: list[dict]):
    """Insert or update laptops by avito_id. Caller commits."""
    if not rows:
        return
    payload = [{c: row.get(c) for c in LAPTOP_COLS} for row in rows]
    with conn.cursor() as cur:
        cur.executemany(_UPSERT_SQL, payload)


# ---------------------------------------------------------------------------
# Pipeline runs
# ---------------------------------------------------------------------------
def start_run(conn: psycopg.Connection) -> int:
    run_id = conn.execute("insert into pipeline_runs default values returning id").fetchone()["id"]
    conn.commit()
    return run_id


def finish_run(conn: psycopg.Connection, run_id: int, status: str, stats: dict | None = None, error: str | None = None):
    stats = stats or {}
    sets = ", ".join(f"{c} = %({c})s" for c in RUN_STAT_COLS)
    conn.execute(
        f"update pipeline_runs set finished_at = now(), status = %(status)s, error = %(error)s, {sets} "
        "where id = %(id)s",
        {"id": run_id, "status": status, "error": error, **{c: stats.get(c) for c in RUN_STAT_COLS}},
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
def _num(val: str):
    return float(val) if val not in ("", None) else None


def seed(conn: psycopg.Connection) -> int:
    """Load the sample CSV into laptops. Safe to re-run (upserts by avito_id)."""
    numeric = {"price", "ram", "storage", "ssd", "gpu_vram", "screen_size",
               "refresh_rate", "new", "touchscreen", "score"}
    booleans = {"is_shop", "has_delivery", "is_sold"}

    rows = []
    with open(SEED_CSV, "r", encoding="utf-8") as f:
        for raw in csv.DictReader(f):
            row: dict = {}
            for col in LAPTOP_COLS:
                val = raw.get(col, "")
                if col in numeric:
                    row[col] = _num(val)
                elif col in booleans:
                    row[col] = str(val).lower() == "true"
                else:
                    row[col] = val or None
            row["description"] = row["description"] or ""
            row["content_hash"] = row["content_hash"] or ""
            rows.append(row)

    upsert_laptops(conn, rows)
    run_id = start_run(conn)
    finish_run(conn, run_id, "success", {"scraped": len(rows), "new_items": len(rows)})
    return len(rows)


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    arg_parser = argparse.ArgumentParser(description="Database utilities")
    arg_parser.add_argument("command", choices=["migrate", "seed"])
    args = arg_parser.parse_args()

    with connect() as connection:
        if args.command == "migrate":
            names = migrate(connection)
            print(f"Applied {len(names)} migration(s): {', '.join(names) or 'none pending'}")
        else:
            print(f"Seeded {seed(connection)} laptops from {SEED_CSV.name}")
