"""
admin_score.py

Standalone utility for re-scoring rows in the laptops table, e.g. after the
scoring weights or cpu.csv change. NOT part of the automated daily pipeline.

Usage:
    python admin_score.py                # score laptops with missing scores
    python admin_score.py --all          # re-score all laptops in the DB
"""

import db
from score_laptops import calc_laptop_score

FIELDS = "id, cpu, gpu, gpu_vram, ram, storage, ssd, screen_size, refresh_rate, touchscreen, new, brand"


def score_all_laptops(score_all: bool = False):
    """Fetch laptops, calculate scores, write them back in one transaction."""
    where = "" if score_all else "where score is null or score = 0"
    with db.connect() as conn:
        rows = conn.execute(f"select {FIELDS} from laptops {where}").fetchall()
        print(f"Fetched {len(rows)} laptops (score_all={score_all}). Calculating scores...")
        if not rows:
            print("Done! No laptops to score.")
            return

        updates = [{"id": row["id"], "score": calc_laptop_score(row)} for row in rows]
        with conn.cursor() as cur:
            cur.executemany("update laptops set score = %(score)s where id = %(id)s", updates)

    scores = [u["score"] for u in updates]
    print(f"Done! Scored {len(updates)} laptops.")
    print(f"Score distribution: min={min(scores)}, max={max(scores)}, avg={sum(scores) // len(scores)}")


if __name__ == "__main__":
    import sys

    score_all_laptops("--all" in sys.argv)
