"""
Test fixtures.

Database tests run against a real PostgreSQL pointed to by TEST_DATABASE_URL and
are skipped when it is not set. Each test gets its own throwaway schema with the
migrations applied, so tests never see each other's rows or touch real tables.
"""

import os
import sys
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db  # noqa: E402


@pytest.fixture
def conn():
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")

    schema = f"test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(url, row_factory=dict_row, prepare_threshold=None) as connection:
        connection.execute(f"create schema {schema}")
        connection.execute(f"set search_path to {schema}")
        connection.commit()
        db.migrate(connection)
        try:
            yield connection
        finally:
            connection.rollback()
            connection.execute(f"drop schema {schema} cascade")
            connection.commit()


def make_laptop(avito_id: str, **overrides) -> dict:
    """A parsed laptop row as the parser would produce it."""
    row = {
        "avito_id": avito_id,
        "link": f"https://www.avito.ma/fr/x/ordinateurs_portables/item_{avito_id}.htm",
        "description": "dell latitude 5420 i5 16gb 256gb",
        "content_hash": "hash-a",
        "price": 3000.0,
        "city": "Casablanca",
        "is_shop": False,
        "has_delivery": False,
        "brand": "Dell",
        "model": "Latitude 5420",
        "cpu": "i5-1145g7",
        "ram": 16.0,
        "storage": 256.0,
        "ssd": 1,
        "gpu": "",
        "gpu_type": None,
        "gpu_vram": None,
        "screen_size": 14.0,
        "refresh_rate": None,
        "new": 0,
        "touchscreen": None,
        "score": 300,
        "is_sold": False,
        "listed_at": None,
    }
    row.update(overrides)
    return row


def make_ad(avito_id: str, **overrides) -> dict:
    """A scraped ad as scraper._parse_ads would produce it."""
    ad = {
        "avito_id": avito_id,
        "link": f"https://www.avito.ma/fr/x/ordinateurs_portables/item_{avito_id}.htm",
        "description": "dell latitude 5420 i5 16gb 256gb",
        "content_hash": "hash-a",
        "price": 3000.0,
        "city": "Casablanca",
        "is_shop": False,
        "has_delivery": False,
        "listed_at": None,
    }
    ad.update(overrides)
    return ad
