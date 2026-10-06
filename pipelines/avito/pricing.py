# -*- coding: utf-8 -*-
"""
pricing.py

Estimates a fair market price for every active listing, so a shopper can see
at a glance whether an asking price is low, normal or high for the hardware.

How it works:
  - A gradient-boosted model learns asking prices from the listings themselves:
    CPU and GPU benchmark scores, RAM, storage, screen, condition, brand.
  - It predicts the MEDIAN price (absolute-error loss on log price), so a few
    absurd listings (a gaming laptop "for 850 DH") do not drag estimates down.
  - Each listing's estimate comes from a model that never saw that listing
    (5-fold out-of-fold prediction). Without this, the model would partly
    memorize each price and every listing would look fairly priced.
  - The same out-of-fold predictions give an honest error figure, stored with
    the pipeline run.

The result is written to `laptops.fair_price`; the database derives `deal_pct`
(how far the asking price is from the estimate) from it.

Usage (standalone):
    python pricing.py

Called automatically at the end of pipeline.py.
"""

import logging

import numpy as np
import psycopg
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import KFold, cross_val_predict

import db
from score_laptops import CPUScorer, gpu_score

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MIN_LISTINGS = 500      # below this there is not enough market to learn from
TOP_BRANDS = 12         # other brands share one "other" category
FOLDS = 5
PRICE_STEP = 50         # estimates are rounded to this many DH

FEATURES = [
    "cpu_score", "gpu_score", "ram", "storage", "ssd", "screen_size",
    "refresh_rate", "new", "touchscreen", "dedicated_gpu", "brand_code",
]
BRAND_COLUMN = FEATURES.index("brand_code")

SELECT_SQL = """
    select id, price, brand, cpu, gpu, gpu_type, gpu_vram, ram, storage, ssd,
           screen_size, refresh_rate, new, touchscreen
    from laptops
    where not is_sold and duplicate_of is null and price > 0
"""


def _number(value) -> float:
    return float(value) if value is not None else np.nan


def build_features(rows: list[dict]) -> np.ndarray:
    """Numeric feature matrix; missing specs stay NaN (the model handles them natively)."""
    counts: dict[str, int] = {}
    for row in rows:
        brand = (row["brand"] or "").strip().lower()
        counts[brand] = counts.get(brand, 0) + 1
    top = sorted((b for b in counts if b), key=lambda b: -counts[b])[:TOP_BRANDS]
    brand_codes = {brand: code for code, brand in enumerate(top, start=1)}  # 0 = other/unknown

    matrix = np.empty((len(rows), len(FEATURES)), dtype=float)
    for i, row in enumerate(rows):
        cpu = CPUScorer.get_score(row["cpu"] or "")
        matrix[i] = [
            cpu if cpu > 0 else np.nan,                      # 0 means "CPU unknown", not "slowest"
            gpu_score(row["gpu"] or "", row["gpu_vram"]),
            _number(row["ram"]),
            _number(row["storage"]),
            _number(row["ssd"]),
            _number(row["screen_size"]),
            _number(row["refresh_rate"]),
            _number(row["new"]),
            _number(row["touchscreen"]),
            1.0 if row["gpu_type"] == "Dedicated" else 0.0,
            brand_codes.get((row["brand"] or "").strip().lower(), 0),
        ]

    # A spec nobody stated carries no information, and an all-NaN column cannot be binned
    matrix[:, np.isnan(matrix).all(axis=0)] = 0.0
    return matrix


def estimate_prices(rows: list[dict]) -> tuple[np.ndarray, float]:
    """Out-of-fold fair price for each row, plus the model's median absolute error in percent."""
    features = build_features(rows)
    log_price = np.log(np.array([float(row["price"]) for row in rows]))

    model = HistGradientBoostingRegressor(
        loss="absolute_error",
        categorical_features=[BRAND_COLUMN],
        learning_rate=0.08,
        max_iter=300,
        min_samples_leaf=20,
        random_state=0,
    )
    folds = KFold(n_splits=FOLDS, shuffle=True, random_state=0)
    predicted_log = cross_val_predict(model, features, log_price, cv=folds)

    estimates = np.round(np.exp(predicted_log) / PRICE_STEP) * PRICE_STEP
    error_pct = float(np.median(np.abs(np.exp(predicted_log - log_price) - 1)) * 100)
    return estimates, error_pct


def update_fair_prices(conn: psycopg.Connection) -> dict:
    """Recompute fair prices for active listings. Returns counters for the run log."""
    rows = conn.execute(SELECT_SQL).fetchall()
    if len(rows) < MIN_LISTINGS:
        logger.warning("Only %d priced listings; skipping fair-price estimation.", len(rows))
        return {"priced": 0, "price_model_error": None}

    estimates, error_pct = estimate_prices(rows)

    ids = [row["id"] for row in rows]
    conn.execute(
        "update laptops l set fair_price = v.fair_price "
        "from unnest(%s::int[], %s::int[]) as v(id, fair_price) "
        "where l.id = v.id and l.fair_price is distinct from v.fair_price",
        (ids, [int(value) for value in estimates]),
    )
    # A duplicate is the same laptop at the same price as its keeper
    conn.execute(
        "update laptops d set fair_price = k.fair_price from laptops k "
        "where d.duplicate_of = k.id and d.fair_price is distinct from k.fair_price"
    )
    logger.info("Fair prices updated for %d listings (median error %.1f%%).", len(rows), error_pct)
    return {"priced": len(rows), "price_model_error": round(error_pct, 1)}


def main() -> dict:
    with db.connect() as conn:
        return update_fair_prices(conn)


if __name__ == "__main__":
    main()
