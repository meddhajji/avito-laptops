# -*- coding: utf-8 -*-
"""
dedup.py

Flags duplicate rows in the `laptops` table. Two active listings are duplicates
when they share:

    brand + model + cpu + ram + storage + gpu + price + new (condition) + city

Within each group the row with the HIGHEST `id` is the keeper (most recently
inserted); the others get `duplicate_of = <keeper id>` and are hidden from the
app. Rows are never deleted: a deleted listing that is still live on Avito would
look new to the next refresh and be sent to the LLM again, every day.

Flags are recomputed from scratch on each run, so a listing stops being a
duplicate as soon as its twin is sold or changes price.

Only active (is_sold=False) rows are considered — sold rows are historical
records and different sold listings with the same specs are all valid data points.

Usage (standalone):
    python dedup.py

Called automatically at the end of pipeline.py.
"""

import logging

import psycopg

import db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Case- and whitespace-insensitive identity key; `keeper` is the newest row of each group
DEDUP_SQL = r"""
with ranked as (
    select id,
           max(id) over (
               partition by lower(regexp_replace(
                   concat_ws('-',
                       coalesce(brand, ''), coalesce(model, ''), coalesce(cpu, ''),
                       coalesce(ram, 0), coalesce(storage, 0), coalesce(gpu, ''),
                       coalesce(price, 0), coalesce(new, 0), coalesce(city, '')),
                   '\s+', '', 'g'))
           ) as keeper
    from laptops
    where not is_sold
)
update laptops l
set duplicate_of = nullif(r.keeper, l.id)
from ranked r
where r.id = l.id
  and l.duplicate_of is distinct from nullif(r.keeper, l.id)
"""

COUNT_SQL = "select count(*) as n from laptops where duplicate_of is not null and not is_sold"


def flag_duplicates(conn: psycopg.Connection) -> int:
    """Recompute duplicate flags. Returns the number of active rows flagged as duplicates."""
    conn.execute(DEDUP_SQL)
    return conn.execute(COUNT_SQL).fetchone()["n"]


def main() -> int:
    with db.connect() as conn:
        flagged = flag_duplicates(conn)

    logger.info("Deduplication complete — %d active listings flagged as duplicates.", flagged)
    return flagged


if __name__ == "__main__":
    main()
