# -*- coding: utf-8 -*-
"""
evaluate.py

Measures how accurately the LLM extracts specs, against a hand-checked set of
real listings (eval/golden.json). Run it after changing the prompt or the model:

    python evaluate.py            # prints per-field accuracy
    python evaluate.py --errors   # also lists every mismatch

Each golden entry holds the listing text exactly as the parser receives it and
the expected value of each checked field. A field may list several acceptable
values where the text supports more than one reading (e.g. a seller writes
"i5 6200" for what is an i5-6200U).

"kept" is the end-to-end decision: classified as a laptop AND has enough specs
to be stored. The other fields are scored only on listings that should be kept.
"""

import argparse
import json
import re
from pathlib import Path

from google import genai

import parser as avito_parser

GOLDEN = Path(__file__).parent / "eval" / "golden.json"
FIELDS = ["brand", "cpu", "ram", "storage", "ssd", "screen_size", "gpu_type"]


def _normalize(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return re.sub(r"[\s\-]+", "", str(value)).lower() or None


def matches(predicted, expected) -> bool:
    """True if the prediction equals the expected value, or any of them when a list is given."""
    options = expected if isinstance(expected, list) else [expected]
    return _normalize(predicted) in {_normalize(option) for option in options}


def evaluate(entries: list[dict], results: list[dict]) -> dict:
    """Compare parser results with golden entries. Returns per-field counts and the mismatches."""
    by_id = {str(r["job_id"]): r for r in results}
    scores = {field: [0, 0] for field in ["kept", *FIELDS]}  # [correct, total]
    errors = []

    for entry in entries:
        result = by_id.get(str(entry["id"]))
        specs = (result or {}).get("specs") or {}
        kept = bool(result and result.get("is_laptop") and avito_parser.is_valid_parse(specs))
        expected = entry["expected"]

        scores["kept"][1] += 1
        if kept == expected["kept"]:
            scores["kept"][0] += 1
        else:
            errors.append((entry["id"], "kept", kept, expected["kept"]))
        if not expected["kept"] or not kept:
            continue

        for field in FIELDS:
            scores[field][1] += 1
            if matches(specs.get(field), expected.get(field)):
                scores[field][0] += 1
            else:
                errors.append((entry["id"], field, specs.get(field), expected.get(field)))

    return {"scores": scores, "errors": errors}


def main(show_errors: bool = False):
    if not avito_parser.GEMINI_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")
    entries = json.loads(GOLDEN.read_text(encoding="utf-8"))
    items = [{"id": entry["id"], "description": entry["text"]} for entry in entries]

    client = genai.Client(api_key=avito_parser.GEMINI_KEY)
    results = []
    for start in range(0, len(items), avito_parser.GEMINI_BATCH):
        results += avito_parser.parse_batch_gemini(client, items[start:start + avito_parser.GEMINI_BATCH])

    report = evaluate(entries, results)
    print(f"Model: {avito_parser.MODEL} | listings: {len(entries)}")
    for field, (correct, total) in report["scores"].items():
        print(f"  {field:<12} {correct:>3}/{total:<3} {100 * correct / max(total, 1):5.1f}%")
    if show_errors:
        for listing_id, field, predicted, expected in report["errors"]:
            print(f"  #{listing_id} {field}: got {predicted!r}, expected {expected!r}")
    return report


if __name__ == "__main__":
    arg_parser = argparse.ArgumentParser(description="Evaluate spec extraction against the golden set")
    arg_parser.add_argument("--errors", action="store_true", help="list every mismatch")
    main(arg_parser.parse_args().errors)
