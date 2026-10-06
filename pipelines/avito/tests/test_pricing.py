import random

import db
import pricing
from conftest import make_laptop

CPUS = [("i3-8130u", 1500), ("i5-8250u", 2600), ("i7-8650u", 3400), ("i5-1235u", 4800), ("i7-13620h", 8500)]


def _market(count: int, seed: int = 0) -> list[dict]:
    """A synthetic market where price follows the hardware, with 10% noise."""
    rng = random.Random(seed)
    rows = []
    for i in range(count):
        cpu, base = rng.choice(CPUS)
        ram = rng.choice([4, 8, 16, 32])
        storage = rng.choice([128, 256, 512, 1000])
        price = (base + ram * 60 + storage * 1.5) * rng.uniform(0.9, 1.1)
        rows.append({
            "id": i, "price": round(price), "brand": rng.choice(["Hp", "Dell", "Lenovo"]), "cpu": cpu,
            "gpu": None, "gpu_type": "Integrated", "gpu_vram": None, "ram": ram, "storage": storage, "ssd": 1,
            "screen_size": 14.0, "refresh_rate": None, "new": 0, "touchscreen": None,
        })
    return rows


def test_estimates_track_hardware_and_report_a_small_error():
    rows = _market(800)

    estimates, error_pct = pricing.estimate_prices(rows)

    assert error_pct < 12  # the market has 10% noise; the model should not be far above it
    low = [e for e, r in zip(estimates, rows) if r["cpu"] == "i3-8130u" and r["ram"] == 4]
    high = [e for e, r in zip(estimates, rows) if r["cpu"] == "i7-13620h" and r["ram"] == 32]
    assert max(low) < min(high)


def test_a_mispriced_listing_does_not_get_a_matching_estimate():
    rows = _market(800)
    rows[0].update(cpu="i7-13620h", ram=32, storage=1000, price=900)  # worth ~12,000

    estimates, _ = pricing.estimate_prices(rows)

    assert estimates[0] > 5 * rows[0]["price"]


def test_estimates_are_rounded_to_the_price_step():
    estimates, _ = pricing.estimate_prices(_market(600))

    assert all(value % pricing.PRICE_STEP == 0 for value in estimates)


def test_missing_specs_do_not_break_the_model():
    rows = _market(600)
    for row in rows[:50]:
        row.update(cpu=None, ram=None, storage=None, brand=None, screen_size=None, ssd=None, new=None)

    estimates, _ = pricing.estimate_prices(rows)

    assert len(estimates) == 600 and all(value > 0 for value in estimates)


def test_small_market_is_skipped(conn):
    db.upsert_laptops(conn, [make_laptop("1")])

    stats = pricing.update_fair_prices(conn)

    assert stats == {"priced": 0, "price_model_error": None}
    assert conn.execute("select fair_price from laptops").fetchone()["fair_price"] is None


def test_fair_price_is_stored_and_deal_pct_derived(conn, monkeypatch):
    monkeypatch.setattr(pricing, "MIN_LISTINGS", 1)
    db.upsert_laptops(conn, [
        make_laptop("1", price=3000.0),
        make_laptop("2", price=4000.0, model="Other"),
        make_laptop("3", price=0.0, model="Unpriced"),
        make_laptop("4", price=5000.0, model="Sold", is_sold=True),
    ])
    conn.execute("update laptops set duplicate_of = (select id from laptops where avito_id = '1') where avito_id = '2'")
    # Pin the model's output so the stored values can be checked exactly
    monkeypatch.setattr(pricing, "estimate_prices", lambda rows: ([3750 for _ in rows], 12.34))

    stats = pricing.update_fair_prices(conn)

    assert stats == {"priced": 1, "price_model_error": 12.3}
    rows = {r["avito_id"]: r for r in conn.execute("select avito_id, fair_price, deal_pct from laptops")}
    assert (rows["1"]["fair_price"], rows["1"]["deal_pct"]) == (3750, -20)
    assert (rows["2"]["fair_price"], rows["2"]["deal_pct"]) == (3750, 7)   # duplicate inherits its keeper's estimate
    assert rows["3"]["fair_price"] is None and rows["3"]["deal_pct"] is None
    assert rows["4"]["fair_price"] is None                                  # sold listings are not re-estimated
