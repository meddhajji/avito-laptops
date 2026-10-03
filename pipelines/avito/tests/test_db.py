import db
import dedup
import parser as avito_parser
from conftest import make_laptop


def test_migrate_is_idempotent(conn):
    assert db.migrate(conn) == []


def test_upsert_updates_existing_row_by_avito_id(conn):
    db.upsert_laptops(conn, [make_laptop("1", ram=8.0)])
    db.upsert_laptops(conn, [make_laptop("1", ram=16.0)])

    rows = conn.execute("select ram from laptops").fetchall()
    assert [r["ram"] for r in rows] == [16]


def test_value_is_score_per_1000_dh_and_null_without_price(conn):
    db.upsert_laptops(conn, [
        make_laptop("1", price=4000.0, score=600),
        make_laptop("2", price=0.0, score=600),
    ])

    values = {r["avito_id"]: r["value"] for r in conn.execute("select avito_id, value from laptops")}
    assert values == {"1": 150.0, "2": None}


def test_listing_without_price_gets_no_price_history(conn):
    db.upsert_laptops(conn, [make_laptop("1", price=0.0)])

    assert conn.execute("select count(*) n from price_history").fetchone()["n"] == 0


def test_search_vector_matches_prefix_across_fields(conn):
    db.upsert_laptops(conn, [
        make_laptop("1", brand="Lenovo", model="Thinkpad T14", city="Rabat"),
        make_laptop("2", brand="Dell", model="Latitude 5420", city="Casablanca"),
    ])

    hits = conn.execute(
        "select avito_id from laptops where search_vector @@ to_tsquery('simple', 'thinkp:* & rabat:*')"
    ).fetchall()
    assert [h["avito_id"] for h in hits] == ["1"]


def test_dedup_flags_older_duplicates_and_ignores_sold(conn):
    db.upsert_laptops(conn, [
        make_laptop("1"),
        make_laptop("2", brand="DELL", city="CASABLANCA"),  # same key, different case
        make_laptop("3", price=9999.0),                     # different price: not a duplicate
        make_laptop("4", is_sold=True),                     # sold rows are never touched
    ])

    flagged = dedup.flag_duplicates(conn)

    assert flagged == 1
    rows = {r["avito_id"]: r for r in conn.execute("select avito_id, id, duplicate_of from laptops")}
    assert rows["1"]["duplicate_of"] == rows["2"]["id"]  # the newer row is the keeper
    assert all(rows[k]["duplicate_of"] is None for k in ("2", "3", "4"))
    assert len(rows) == 4                                # nothing deleted


def test_dedup_clears_the_flag_when_listings_stop_matching(conn):
    db.upsert_laptops(conn, [make_laptop("1"), make_laptop("2")])
    assert dedup.flag_duplicates(conn) == 1

    conn.execute("update laptops set price = 2500 where avito_id = '2'")

    assert dedup.flag_duplicates(conn) == 0


def test_flagged_duplicate_is_not_requeued_by_the_next_refresh(conn):
    import refresh
    from conftest import make_ad

    db.upsert_laptops(conn, [make_laptop("1"), make_laptop("2")])
    dedup.flag_duplicates(conn)

    stats = refresh.diff_and_act(conn, [make_ad("1"), make_ad("2")], refresh.fetch_db_items(conn))

    assert stats["new_items"] == 0
    assert conn.execute("select count(*) n from new_laptops").fetchone()["n"] == 0


def test_to_db_row_normalizes_constrained_columns(conn):
    raw = {"id": 1, "avito_id": "1", "link": "https://x/1.htm", "description": "hp", "price": 2500,
           "city": "Fes", "content_hash": "h", "is_shop": True, "has_delivery": False}
    specs = {"brand": "Hp", "cpu": "i5-8250u", "ram": 8, "storage": 256, "ssd": 1,
             "gpu_type": "dedicated", "new": 2, "touchscreen": None}

    row = avito_parser.to_db_row(raw, specs)
    db.upsert_laptops(conn, [row])  # would violate check constraints if not normalized

    stored = conn.execute("select gpu_type, new, touchscreen, ssd from laptops").fetchone()
    assert stored == {"gpu_type": "Dedicated", "new": 1, "touchscreen": None, "ssd": 1}


def test_to_db_row_drops_unknown_gpu_type():
    raw = {"id": 1, "avito_id": "1", "link": "l", "description": "d", "price": 2500}
    row = avito_parser.to_db_row(raw, {"cpu": "i5", "ram": 8, "gpu_type": "Hybrid"})

    assert row["gpu_type"] is None
