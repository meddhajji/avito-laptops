# Avito pipeline

Collects laptop listings from Avito.ma, extracts hardware specs with an LLM, scores them and keeps the database in sync with what is currently for sale.

```bash
python pipeline.py          # full run: refresh → parse → dedup
python refresh.py -p 5      # scrape and diff 5 pages only (never marks anything sold)
python parser.py -n 50      # parse about 50 queued listings
python dedup.py             # recompute duplicate flags
python admin_score.py --all # re-score every laptop after changing the scoring
python verify.py -n 20      # spot-check stored rows against their live Avito pages
```

## Stages

### 1. Scrape (`scraper.py`)

Reads the listing pages of the laptop category and extracts the ads from the page's embedded JSON.

- Pages are fetched until Avito returns an empty one, so the whole category is covered whatever its size.
- Each page gets 3 attempts with exponential backoff; pages that still fail get one more pass at the end.
- Guards at ingestion: only `/ordinateurs_portables/` links, no listings under 800 DH (accessories) or over 100,000 DH.
- The result says whether the scrape was **complete**: it reached the end, no page failed, and the ads seen add up to at least 90% of the total Avito reports. The last check stops a block page that renders as an empty listing from looking like the end of the category.

### 2. Diff (`refresh.py`)

Compares the scrape with the `laptops` table by Avito ID, in one transaction:

| Situation | Action |
| --- | --- |
| New ID, previously rejected, title unchanged | skipped |
| New ID | queued in `new_laptops` for extraction |
| Same ID, title changed (`content_hash`) | queued for re-extraction |
| Same ID, price or link changed | updated in place; the old price is kept in `price_history` |
| In the DB but not in the scrape | marked sold, under the conditions below |
| Sold in the DB but back in the scrape | marked active again |

A listing is marked sold only when the scrape was complete, the scrape found at least 40% of the listings the DB believes are active, **and** the listing has not been seen for 36 hours (two daily runs). Listings shift between pages while a scrape is running, so a single miss proves nothing.

### 3. Extract (`parser.py`)

Sends queued listings to Gemini in batches (50 listings per request, 3 requests in parallel by default).

- **Structured output**: the model is given a JSON schema and every response is validated with pydantic before anything is written.
- **Job-ID anchoring**: results are matched to listings by ID, never by position, so a skipped or reordered item cannot shift the others.
- **Classification**: bags, chargers, repair services and other non-laptops are rejected. A laptop must have a CPU and either RAM or storage to be stored.
- **No stuck queue**: each listing can be sent at most 3 times per run. One that keeps failing is left for the next run instead of blocking everything behind it.
- **Retries**: rate limits and overloads (429/503) back off exponentially. A rejected request (bad model, key or config) aborts the run immediately, and a run in which a sizeable queue yields no results at all fails loudly.

Tunable through environment variables: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), `GEMINI_BATCH`, `PARSE_WORKERS`, `PARSE_ROUND_DELAY`.

### 4. Score (`score_laptops.py`)

Each laptop gets a 0–1000 hardware score: the CPU is matched against a PassMark benchmark list (`cpu.csv`), the GPU against a tier table with a VRAM bonus, and RAM, storage, screen and condition against lookup tables. Weights: 35% CPU, 25% GPU, 12% RAM, 8% storage, 10% screen, 10% condition. The database derives `value` (score per 1000 DH) from it.

### 5. Deduplicate (`dedup.py`)

Shops often post the same laptop several times. Active listings with the same brand, model, CPU, RAM, storage, GPU, price, condition and city are grouped; the newest stays visible and the others get `duplicate_of` set. Rows are flagged rather than deleted, because a deleted listing that is still live would be scraped and extracted again the next day.

## Database

The pipeline connects through `DATABASE_URL`. The schema is defined in `db/migrations` at the repository root and applied with `python db.py migrate` (the full pipeline also applies pending migrations on start).

- `laptops` — main table, upserted by Avito ID.
- `new_laptops` — staging queue, emptied as listings are extracted.
- `price_history` — every price a listing has had (written by a trigger).
- `rejected_listings` — listings already rejected as non-laptops; refresh skips them unless their title changes.
- `pipeline_runs` — one row per run with its status and counters.

## Tests

```bash
pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgresql://... pytest
```

Database tests run against a real PostgreSQL, each in its own throwaway schema, and are skipped when `TEST_DATABASE_URL` is not set. The scraper and LLM are replaced by fakes, so tests need no network or API key.
