import evaluate


def _entry(listing_id, **expected):
    return {"id": listing_id, "text": "x", "expected": expected}


def _result(listing_id, is_laptop=True, **specs):
    return {"job_id": str(listing_id), "is_laptop": is_laptop, "specs": specs}


def test_matches_ignores_case_spacing_and_hyphens():
    assert evaluate.matches("i5-8250U", "i5 8250u")
    assert evaluate.matches(16.0, 16)
    assert evaluate.matches(None, None)
    assert not evaluate.matches("i5", "i5 7th gen")


def test_matches_accepts_any_listed_alternative():
    assert evaluate.matches("i5-6200u", ["i5-6200", "i5-6200u"])
    assert evaluate.matches(None, [15, None])
    assert not evaluate.matches(14.3, [14, None])


def test_fields_are_scored_only_on_listings_that_should_be_kept():
    entries = [
        _entry(1, kept=True, brand="Hp", cpu="i5-8250u", ram=8, storage=256, ssd=1, screen_size=14, gpu_type=None),
        _entry(2, kept=False),
    ]
    results = [
        _result(1, brand="Hp", cpu="i5", ram=8, storage=256, ssd=1, screen_size=14),
        _result(2, is_laptop=False),
    ]

    report = evaluate.evaluate(entries, results)

    assert report["scores"]["kept"] == [2, 2]
    assert report["scores"]["ram"] == [1, 1]
    assert report["scores"]["cpu"] == [0, 1]
    assert report["errors"] == [(1, "cpu", "i5", "i5-8250u")]


def test_a_wrongly_rejected_laptop_counts_against_kept_only():
    entries = [_entry(1, kept=True, brand="Hp", cpu="i5", ram=8, storage=256, ssd=1, screen_size=14, gpu_type=None)]

    report = evaluate.evaluate(entries, [_result(1, is_laptop=False)])

    assert report["scores"]["kept"] == [0, 1]
    assert report["scores"]["cpu"] == [0, 0]
