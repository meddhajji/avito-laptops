# -*- coding: utf-8 -*-
"""
pipeline.py

The master script that runs the entire daily Avito data refresh pipeline.
It executes the following steps in sequence:
1. refresh.py       (Scrape Avito, diff with DB by avito_id, populate new_laptops)
2. parser.py        (Loop: parse specs, score, upsert to laptops, clear new_laptops)
3. dedup.py         (Remove duplicate active listings)

Every execution is recorded in the `pipeline_runs` table, and the process exits
non-zero if any step fails.

Usage:
    python pipeline.py
"""

import sys
import time
import logging
import importlib.util
from pathlib import Path

import db
from refresh import main as refresh_main
from dedup import main as dedup_main

# 'parser' shadows the Python stdlib module of the same name — load by file path
_parser_spec = importlib.util.spec_from_file_location(
    "avito_parser", Path(__file__).parent / "parser.py"
)
_parser_mod = importlib.util.module_from_spec(_parser_spec)
_parser_spec.loader.exec_module(_parser_mod)
parser_main = _parser_mod.main

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

def run_step(script_name: str, func, *args, **kwargs):
    """Run a step, log its duration and return (result, elapsed seconds)."""
    logger.info("=" * 60)
    logger.info("STARTING: %s", script_name)
    logger.info("=" * 60)

    start_time = time.time()
    result = func(*args, **kwargs)
    elapsed = time.time() - start_time
    logger.info("%s finished in %.1fs\n", script_name, elapsed)
    return result, elapsed

def main():
    total_start = time.time()
    logger.info("Starting Daily Avito Pipeline")

    # Pre-flight: cpu.csv must exist for scoring to work
    cpu_csv = Path(__file__).parent / "cpu.csv"
    if not cpu_csv.exists():
        logger.error("FATAL: cpu.csv not found in %s. CPU scoring would be zero for all items. Aborting.", cpu_csv.parent)
        sys.exit(1)

    with db.connect() as conn:
        db.migrate(conn)
        run_id = db.start_run(conn)
        stats: dict = {}
        try:
            # Step 1: Scrape & Diff (populate new_laptops table)
            refresh_stats, t1 = run_step("refresh", refresh_main, max_pages=500)
            stats.update(refresh_stats)

            # Step 2: Parse, score & upload (loop until new_laptops is empty)
            _, t2 = run_step("parser", parser_main)

            # Step 3: Remove duplicate rows from the laptops table
            stats["duplicates"], t3 = run_step("dedup", dedup_main)
        except Exception as e:
            logger.exception("Pipeline failed")
            db.finish_run(conn, run_id, "failed", stats, error=str(e)[:500])
            sys.exit(1)

        db.finish_run(conn, run_id, "success", stats)

    total_time = time.time() - total_start
    logger.info("=" * 60)
    logger.info("PIPELINE COMPLETE")
    logger.info("=" * 60)
    logger.info("Refresh:  %.1fs", t1)
    logger.info("Parse:    %.1fs", t2)
    logger.info("Dedup:    %.1fs", t3)
    logger.info("Total:    %.1fs (%.1f mins)", total_time, total_time / 60)
    logger.info("=" * 60)

if __name__ == "__main__":
    main()
