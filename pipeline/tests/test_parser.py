import pytest

import parser as avito_parser
import refresh
from conftest import make_ad

GOOD_SPECS = {"brand": "Dell", "model": "Latitude 5420", "cpu": "i5-1145g7", "ram": 16, "storage": 256, "ssd": 1}


def _queue(conn, count: int) -> list[int]:
    """Queue `count` listings and return their staging ids."""
    refresh.insert_into_new_laptops(conn, [make_ad(str(i)) for i in range(count)])
    conn.commit()
    return [r["id"] for r in conn.execute("select id from new_laptops order by id")]


def _laptop(item) -> dict:
    return {"job_id": str(item["id"]), "is_laptop": True, "specs": GOOD_SPECS}


def _count(conn, table: str) -> int:
    return conn.execute(f"select count(*) n from {table}").fetchone()["n"]


@pytest.fixture(autouse=True)
def small_batches(monkeypatch):
    monkeypatch.setattr(avito_parser, "GEMINI_BATCH", 2)
    monkeypatch.setattr(avito_parser, "PARSE_WORKERS", 2)
    monkeypatch.setattr(avito_parser, "OUTAGE_MIN_QUEUE", 3)


def test_parsed_laptops_are_stored_and_leave_the_queue(conn):
    _queue(conn, 5)

    stats = avito_parser.process_staging(conn, lambda batch: [_laptop(i) for i in batch], round_delay=0)

    assert (stats["laptops"], stats["rejected"], stats["remaining"]) == (5, 0, 0)
    assert _count(conn, "laptops") == 5


def test_non_laptops_and_weak_parses_are_rejected(conn):
    ids = _queue(conn, 3)
    answers = {
        str(ids[0]): {"job_id": str(ids[0]), "is_laptop": False, "specs": None},                        # a laptop bag
        str(ids[1]): {"job_id": str(ids[1]), "is_laptop": True, "specs": {"brand": "Hp"}},               # no spec at all
        str(ids[2]): {"job_id": str(ids[2]), "is_laptop": True, "specs": GOOD_SPECS},
    }

    stats = avito_parser.process_staging(conn, lambda batch: [answers[str(i["id"])] for i in batch], round_delay=0)

    assert (stats["laptops"], stats["rejected"], stats["remaining"]) == (1, 2, 0)


def test_a_listing_that_always_fails_does_not_block_the_queue(conn):
    ids = _queue(conn, 6)
    poison = ids[0]  # first in line: the old parser re-sent this batch forever
    calls = []

    def parse(batch):
        calls.append([i["id"] for i in batch])
        if any(i["id"] == poison for i in batch):
            return []  # the whole request fails
        return [_laptop(i) for i in batch]

    stats = avito_parser.process_staging(conn, parse, round_delay=0)

    assert stats["laptops"] >= 4          # everything not batched with the poison listing
    assert stats["remaining"] <= 2
    sends_of_poison = sum(poison in call for call in calls)
    assert sends_of_poison == avito_parser.MAX_ATTEMPTS
    assert conn.execute("select attempts from new_laptops where id = %s", (poison,)).fetchone()["attempts"] == avito_parser.MAX_ATTEMPTS


def test_listings_the_llm_skips_stay_queued_and_are_retried(conn):
    ids = _queue(conn, 4)
    skipped_once = {ids[1]}

    def parse(batch):
        answered = [i for i in batch if i["id"] not in skipped_once]
        skipped_once.clear()  # answered on the next attempt
        return [_laptop(i) for i in answered]

    stats = avito_parser.process_staging(conn, parse, round_delay=0)

    assert (stats["laptops"], stats["remaining"]) == (4, 0)


def test_total_llm_outage_raises(conn):
    _queue(conn, 4)

    with pytest.raises(RuntimeError, match="no usable results"):
        avito_parser.process_staging(conn, lambda batch: [], round_delay=0)

    assert _count(conn, "new_laptops") == 4  # nothing lost


def test_overpriced_listings_are_dropped_without_calling_the_llm(conn):
    refresh.insert_into_new_laptops(conn, [make_ad("1", price=999_999.0)])
    conn.commit()
    calls = []

    stats = avito_parser.process_staging(conn, lambda batch: calls.append(batch) or [], round_delay=0)

    assert stats["rejected"] == 1 and stats["remaining"] == 0
    assert calls == []


def test_attempts_are_reset_at_the_start_of_each_run(conn):
    ids = _queue(conn, 1)
    conn.execute("update new_laptops set attempts = %s", (avito_parser.MAX_ATTEMPTS,))
    conn.commit()

    stats = avito_parser.process_staging(conn, lambda batch: [_laptop(i) for i in batch], round_delay=0)

    assert stats["laptops"] == 1 and ids


def test_llm_output_schema_rejects_malformed_results():
    valid = '[{"job_id": "7", "is_laptop": true, "specs": {"cpu": "i5", "ram": 8, "gpu_type": "Dedicated"}}]'
    parsed = avito_parser._RESULTS.validate_json(valid)
    assert parsed[0].specs.ram == 8 and parsed[0].specs.gpu_type == "Dedicated"

    for bad in ('{"job_id": "7"}', '[{"is_laptop": true}]', '[{"job_id": "7", "is_laptop": true, "specs": {"gpu_type": "Hybrid"}}]', "not json"):
        with pytest.raises(avito_parser.ValidationError):
            avito_parser._RESULTS.validate_json(bad)


class _FakeClient:
    """Stands in for genai.Client: every generate_content call raises `error`."""

    def __init__(self, error: Exception):
        self.calls = 0
        self.models = self
        self._error = error

    def generate_content(self, **kwargs):
        self.calls += 1
        raise self._error


def test_rejected_request_aborts_instead_of_retrying():
    bad_request = avito_parser.genai_errors.ClientError(400, {"error": {"message": "invalid argument"}})
    client = _FakeClient(bad_request)

    with pytest.raises(RuntimeError, match="rejected the request"):
        avito_parser.parse_batch_gemini(client, [{"id": 1, "description": "hp elitebook"}])

    assert client.calls == 1


def test_rejected_listing_is_not_requeued_until_its_content_changes(conn):
    ids = _queue(conn, 1)
    reject = lambda batch: [{"job_id": str(i["id"]), "is_laptop": False, "specs": None} for i in batch]
    avito_parser.process_staging(conn, reject, round_delay=0)
    assert ids and _count(conn, "rejected_listings") == 1

    # Next day: same listing, same title -> skipped without touching the queue
    stats = refresh.diff_and_act(conn, [make_ad("0")], refresh.fetch_db_items(conn))
    assert stats["new_items"] == 0 and _count(conn, "new_laptops") == 0

    # The seller rewrites it -> examined again, and this time it is a laptop
    stats = refresh.diff_and_act(conn, [make_ad("0", content_hash="hash-b")], refresh.fetch_db_items(conn))
    conn.commit()
    assert stats["new_items"] == 1
    avito_parser.process_staging(conn, lambda batch: [_laptop(i) for i in batch], round_delay=0)
    assert _count(conn, "laptops") == 1 and _count(conn, "rejected_listings") == 0


def test_laptop_without_cpu_is_kept_when_other_specs_are_stated():
    assert avito_parser.is_valid_parse({"brand": "Apple", "model": "Macbook Air 2018", "ram": 8, "storage": 256})
    assert avito_parser.is_valid_parse({"cpu": "i5 8th gen"})
    assert not avito_parser.is_valid_parse({"brand": "Lenovo", "model": "Thinkpad"})
