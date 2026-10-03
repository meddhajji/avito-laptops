import db
import refresh
from conftest import make_ad, make_laptop


def _run_diff(conn, ads):
    stats = refresh.diff_and_act(conn, ads, refresh.fetch_db_items(conn))
    conn.commit()
    return stats


def _one(conn, sql, params=None):
    return conn.execute(sql, params).fetchone()


def test_new_listing_is_queued_for_parsing(conn):
    stats = _run_diff(conn, [make_ad("1")])

    assert stats["new_items"] == 1
    assert _one(conn, "select avito_id from new_laptops")["avito_id"] == "1"
    assert _one(conn, "select count(*) n from laptops")["n"] == 0


def test_requeueing_a_staged_listing_does_not_duplicate_it(conn):
    _run_diff(conn, [make_ad("1", price=3000.0)])
    _run_diff(conn, [make_ad("1", price=2800.0)])

    rows = conn.execute("select price from new_laptops").fetchall()
    assert [r["price"] for r in rows] == [2800.0]


def test_unchanged_listing_is_left_alone(conn):
    db.upsert_laptops(conn, [make_laptop("1")])

    stats = _run_diff(conn, [make_ad("1")])

    assert (stats["new_items"], stats["reparsed"], stats["price_updates"]) == (0, 0, 0)
    assert _one(conn, "select count(*) n from new_laptops")["n"] == 0


def test_price_change_updates_row_and_keeps_history(conn):
    db.upsert_laptops(conn, [make_laptop("1", price=3000.0)])

    stats = _run_diff(conn, [make_ad("1", price=2500.0)])

    assert stats["price_updates"] == 1
    assert _one(conn, "select price from laptops")["price"] == 2500.0
    history = conn.execute("select price from price_history order by id").fetchall()
    assert [h["price"] for h in history] == [3000.0, 2500.0]


def test_changed_content_hash_is_requeued(conn):
    db.upsert_laptops(conn, [make_laptop("1", content_hash="hash-a")])

    stats = _run_diff(conn, [make_ad("1", content_hash="hash-b")])

    assert stats["reparsed"] == 1
    assert _one(conn, "select content_hash from new_laptops")["content_hash"] == "hash-b"


def test_missing_listing_is_marked_sold(conn):
    db.upsert_laptops(conn, [make_laptop("1"), make_laptop("2")])

    stats = _run_diff(conn, [make_ad("1")])

    assert stats["marked_sold"] == 1
    sold = _one(conn, "select is_sold, sold_at from laptops where avito_id = '2'")
    assert sold["is_sold"] is True and sold["sold_at"] is not None
    assert _one(conn, "select is_sold from laptops where avito_id = '1'")["is_sold"] is False


def test_safety_guard_skips_mark_sold_on_a_bad_scrape(conn):
    db.upsert_laptops(conn, [make_laptop(str(i)) for i in range(10)])

    # 3 of 10 active listings scraped: below the 40% threshold
    stats = _run_diff(conn, [make_ad(str(i)) for i in range(3)])

    assert stats["marked_sold"] == 0
    assert _one(conn, "select count(*) n from laptops where is_sold")["n"] == 0


def test_relisted_item_becomes_active_again(conn):
    db.upsert_laptops(conn, [make_laptop("1", is_sold=True)])
    assert _one(conn, "select sold_at from laptops")["sold_at"] is not None

    stats = _run_diff(conn, [make_ad("1")])

    assert stats["relisted"] == 1
    row = _one(conn, "select is_sold, sold_at from laptops")
    assert row["is_sold"] is False and row["sold_at"] is None
