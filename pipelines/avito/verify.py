# -*- coding: utf-8 -*-
"""
verify.py: Spot-checks random active laptop rows by fetching their live Avito URLs.

For each sampled row, fetches the live page and checks whether tokens from the
stored description appear on the page. If < 2 tokens match, the row is flagged
as BAD (URL likely recycled or listing removed but not marked sold).

Run this monthly or after any pipeline change to confirm data integrity.

Usage:
    python verify.py          # check 20 random rows
    python verify.py -n 50    # check 50 random rows
    python verify.py -n 100   # more thorough check
"""

import argparse
import time

import requests

import db


def fetch_sample(n: int) -> list[dict]:
    """Return a random sample of n active rows."""
    with db.connect() as conn:
        rows = conn.execute(
            "select id, link, brand, cpu, model, description from laptops "
            "where not is_sold order by random() limit %s",
            (n,),
        ).fetchall()
    if not rows:
        print("No active rows found in laptops table.")
    return rows


def check_row(row: dict) -> tuple[bool | None, int | str]:
    """Fetch the listing URL and check if stored description tokens appear on the page.

    Returns:
        (True, status_code)  → page matches stored data   (OK)
        (False, status_code) → page does not match        (BAD: likely corrupted)
        (None, error_str)    → request failed              (ERROR)
    """
    try:
        r = requests.get(
            row["link"],
            timeout=12,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0"},
            allow_redirects=True,
        )
        page_text = r.text.lower()

        # Use the stored description tokens as ground truth
        stored = (row.get("description") or "").lower()
        tokens = [t for t in stored.split() if len(t) > 3][:8]  # first 8 meaningful tokens

        if not tokens:
            # No description stored: fall back to checking brand + model
            brand = (row.get("brand") or "").lower()
            cpu = (row.get("cpu") or "").lower()
            hits = sum(1 for t in [brand, cpu] if t and t in page_text)
            return hits >= 1, r.status_code

        hits = sum(1 for t in tokens if t in page_text)
        return hits >= 2, r.status_code

    except requests.Timeout:
        return None, "timeout"
    except Exception as e:
        return None, str(e)


def main():
    parser = argparse.ArgumentParser(description="Spot-check Avito laptop data integrity")
    parser.add_argument("-n", type=int, default=20, help="Number of rows to check (default: 20)")
    args = parser.parse_args()

    print(f"Fetching {args.n} random active rows from laptops table...")
    sample = fetch_sample(args.n)

    if not sample:
        return

    ok = bad = err = 0

    print(f"\n{'Status':<6}  {'ID':>6}  {'Brand':<10}  {'CPU':<22}  Link")
    print("-" * 85)

    for row in sample:
        valid, status = check_row(row)

        if valid is True:
            tag = "OK "
            ok += 1
        elif valid is False:
            tag = "BAD"
            bad += 1
        else:
            tag = "ERR"
            err += 1

        brand = (row.get("brand") or "")[:10]
        cpu = (row.get("cpu") or "")[:22]
        link_short = row["link"][:55]
        print(f"{tag:<6}  {row['id']:>6}  {brand:<10}  {cpu:<22}  {link_short}")

        time.sleep(1.0)  # be polite to Avito's servers

    print("-" * 85)
    print(f"\nResult: {ok} OK / {bad} BAD / {err} ERROR  (out of {len(sample)} checked)")

    bad_ratio = bad / max(len(sample), 1)
    if bad_ratio > 0.05:
        print(f"\nWARNING: {bad_ratio:.0%} corrupted rows (>{5}% threshold).")
        print("The pipeline may have a URL recycling detection issue.")
    elif bad == 0:
        print("\nAll checked rows look correct.")
    else:
        print(f"\n{bad} corrupted row(s) detected: acceptable if < 5% of sample.")


if __name__ == "__main__":
    main()
