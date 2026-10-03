# -*- coding: utf-8 -*-
"""
dedup.py

Removes duplicate rows from the `laptops` table. Two active listings are
duplicates when they share:

    brand + model + cpu + ram + storage + gpu + price + new (condition) + city

Within each group the row with the HIGHEST `id` is kept (most recently
inserted) and the others are deleted.

Only active (is_sold=False) rows are considered — sold rows are left alone
because they are historical records and different sold listings with the
same specs are all valid data points.

Known limitation: a deleted duplicate that is still live on Avito is seen as a
new listing by the next refresh and gets parsed again.

Usage (standalone):
    python dedup.py

Called automatically at the end of pipeline.py.
"""

import logging

import db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Case- and whitespace-insensitive identity key, newest row first within a group
DEDUP_SQL = r"""
with ranked as (
    select id,
           row_number() over (
               partition by lower(regexp_replace(
                   concat_ws('-',
                       coalesce(brand, ''), coalesce(model, ''), coalesce(cpu, ''),
                       coalesce(ram, 0), coalesce(storage, 0), coalesce(gpu, ''),
                       coalesce(price, 0), coalesce(new, 0), coalesce(city, '')),
                   '\s+', '', 'g'))
               order by id desc
           ) as rn
    from laptops
    where not is_sold
)
delete from laptops where id in (select id from ranked where rn > 1)
"""


def main() -> int:
    """Run deduplication. Returns the number of rows deleted."""
    with db.connect() as conn:
        deleted = conn.execute(DEDUP_SQL).rowcount

    if deleted:
        logger.info("Deduplication complete — deleted %d rows (kept the most recent per group).", deleted)
    else:
        logger.info("No duplicates found. Database is clean.")
    return deleted


if __name__ == "__main__":
    main()
