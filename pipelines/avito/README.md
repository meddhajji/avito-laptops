# Avito Laptop Scraper Pipeline

This directory contains the data pipeline responsible for gathering, parsing, and scoring laptop listings from Avito.ma. It operates in three distinct stages: scraping, AI parsing, and scoring.

## Pipeline Architecture

### 1. Refreshing and Scraping
The first stage is handled by `refresh.py`. It scrapes up to 500 pages of laptop listings and diffs them against the database by **Avito ID**. A **content_hash** (MD5 of the listing title) detects when an existing listing has been rewritten into a different item, which forces a re-parse. New or changed items are queued in the `new_laptops` staging table; price changes, sold flags and re-listings are applied directly, all in one transaction.

### 2. AI Specification Extraction
The second stage is executed by `parser.py`. It pulls new listings from the staging table in batches of 100. Key design points:
- **Job-ID Anchoring**: Each listing is tagged with its staging ID, ensuring Gemini's output is perfectly synchronized regardless of the order it returns items.
- **503 Retries**: Handles Gemini API capacity spikes with exponential backoff (up to 10 retries per batch) instead of crashing.
- **Classification**: Gemini explicitly classifies items as laptops/non-laptops; junk listings (bags, chargers, etc.) are automatically discarded from staging.
- **Structured Extraction**: Extracts 13 structured fields including brand, model, CPU, RAM, storage, and GPU details.

### 3. Hardware Scoring Engine
During the parsing stage, `score_laptops.py` acts as the scoring engine. It assigns a CPU score by fuzzy matching the extracted processor details against a PassMark benchmark database, normalizing the result to a 0-1000 scale. The GPU score is determined by a rule-based lookup table that includes bonuses for VRAM. Secondary components like RAM, storage, screen specifications, and device condition are also scored using custom lookup tables. The final composite score is a weighted combination: 35% CPU, 25% GPU, 12% RAM, 8% storage, 10% screen, and 10% condition.

## Database

The pipeline connects to PostgreSQL through `DATABASE_URL`. The schema is defined in `db/migrations` at the repository root and applied with `python db.py migrate` (the full pipeline also applies pending migrations on start).

- `laptops` is the main table, upserted by Avito ID.
- `new_laptops` is the staging queue, cleared as items are parsed.
- `price_history` records every price a listing has had (written by a trigger).
- `pipeline_runs` logs each execution with its status and counters.
