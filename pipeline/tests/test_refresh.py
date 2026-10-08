import db
import refresh
from conftest import make_ad, make_laptop


def _run_diff(conn, ads, scrape_complete=True):
    stats = refresh.diff_and_act(conn, ads, refresh.fetch_db_items(conn), scrape_complete=scrape_complete)
    conn.commit()
    return stats


def _one(conn, sql, params=None):
    return conn.execute(sql, params).fetchone()


def _age_last_seen(conn, hours: int):
    """Pretend no run has seen these listings for `hours`."""
    conn.execute("update laptops set last_seen_at = now() - make_interval(hours => %s)", (hours,))


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


def test_listing_unseen_past_the_grace_period_is_marked_sold(conn):
    db.upsert_laptops(conn, [make_laptop("1"), make_laptop("2")])
    _age_last_seen(conn, refresh.SOLD_GRACE_HOURS + 1)

    stats = _run_diff(conn, [make_ad("1")])

    assert stats["marked_sold"] == 1
    sold = _one(conn, "select is_sold, sold_at from laptops where avito_id = '2'")
    assert sold["is_sold"] is True and sold["sold_at"] is not None
    assert _one(conn, "select is_sold from laptops where avito_id = '1'")["is_sold"] is False


def test_listing_missed_once_is_not_marked_sold(conn):
    # Seen by the previous daily run, missing from this one: could just have
    # shifted between pages while we were scraping.
    db.upsert_laptops(conn, [make_laptop("1"), make_laptop("2")])
    _age_last_seen(conn, 24)

    stats = _run_diff(conn, [make_ad("1")])

    assert stats["marked_sold"] == 0
    assert _one(conn, "select is_sold from laptops where avito_id = '2'")["is_sold"] is False


def test_incomplete_scrape_never_marks_sold(conn):
    db.upsert_laptops(conn, [make_laptop("1"), make_laptop("2")])
    _age_last_seen(conn, 500)

    stats = _run_diff(conn, [make_ad("1")], scrape_complete=False)

    assert stats["marked_sold"] == 0
    assert _one(conn, "select count(*) n from laptops where is_sold")["n"] == 0


def test_safety_guard_skips_mark_sold_when_scrape_is_suspiciously_small(conn):
    db.upsert_laptops(conn, [make_laptop(str(i)) for i in range(10)])
    _age_last_seen(conn, 500)

    # A "complete" scrape that found only 3 of 10 active listings: below the 40% threshold
    stats = _run_diff(conn, [make_ad(str(i)) for i in range(3)])

    assert stats["marked_sold"] == 0
    assert _one(conn, "select count(*) n from laptops where is_sold")["n"] == 0


def test_seen_listing_gets_its_last_seen_refreshed(conn):
    db.upsert_laptops(conn, [make_laptop("1")])
    _age_last_seen(conn, 500)

    _run_diff(conn, [make_ad("1")])

    assert _one(conn, "select last_seen_at > now() - interval '1 minute' as fresh from laptops")["fresh"] is True


def test_relisted_item_becomes_active_again(conn):
    db.upsert_laptops(conn, [make_laptop("1", is_sold=True)])
    assert _one(conn, "select sold_at from laptops")["sold_at"] is not None

    stats = _run_diff(conn, [make_ad("1")])

    assert stats["relisted"] == 1
    row = _one(conn, "select is_sold, sold_at from laptops")
    assert row["is_sold"] is False and row["sold_at"] is None
