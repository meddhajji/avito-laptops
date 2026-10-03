# Avito Laptops

A data pipeline and web app that turn messy laptop classifieds from [Avito.ma](https://www.avito.ma) into a structured, searchable market database, with an AI assistant on top.

- **Pipeline** — scrapes listings daily, uses an LLM to extract hardware specs from free-text seller descriptions, scores each laptop against CPU benchmarks, and tracks price changes and sold listings over time.
- **Dashboard** (`/avito`) — full-text search, filters and sorting over the processed listings.
- **AvitoPT** (`/avitopt`) — a chat assistant that answers questions like *"cheapest 3 ThinkPads in Casablanca"* by querying the database through tool calls.

## Architecture

```text
Avito.ma ──► scraper ──► diff vs DB ──► staging queue ──► Gemini extraction ──► scoring ──► PostgreSQL
                              │                                                               ▲
                              └── price changes, sold / re-listed flags ──────────────────────┤
                                                                                              │
                                              Next.js dashboard + chat assistant (Groq) ──────┘
```

| Part | Stack |
| --- | --- |
| Pipeline | Python 3.11+, `requests`, `beautifulsoup4`, `google-genai` (Gemini), `psycopg` |
| Database | PostgreSQL 14+ (any host: Supabase, Neon, local container) |
| Web app | Next.js 16 (App Router), React 19, Tailwind CSS v4, Vercel AI SDK, Groq |
| Automation | GitHub Actions (daily cron) |

Both the pipeline and the web app talk to the database through a single `DATABASE_URL`.

## Repository layout

```text
db/
  migrations/          SQL schema, applied in order by `python db.py migrate`
  seed/                Sample of ~600 parsed listings for local demos
pipelines/avito/
  pipeline.py          Orchestrator: refresh → parse → dedup, recorded in pipeline_runs
  scraper.py           Fetches listing pages and extracts ads
  refresh.py           Diffs the scrape against the DB (new, changed, price update, sold)
  parser.py            LLM spec extraction and laptop / non-laptop classification
  score_laptops.py     Hardware scoring (CPU benchmarks, GPU tiers, RAM, storage, screen)
  dedup.py             Removes duplicate active listings
  db.py                Connection, migrations, seed, run bookkeeping
  tests/               pytest suite (runs against a real PostgreSQL)
frontend/
  app/avito/           Dashboard
  app/avitopt/         Chat assistant UI
  app/api/chat/        Chat endpoint (tool-calling over the laptops table)
  lib/                 Database client and query builders
.github/workflows/     Daily pipeline run
```

## Data model

| Table | Purpose |
| --- | --- |
| `laptops` | One row per listing: raw fields, extracted specs, score, `value` (score per 1000 DH), sold status, timestamps |
| `new_laptops` | Staging queue of scraped listings waiting for LLM extraction |
| `price_history` | Every price a listing has had (written by a trigger) |
| `pipeline_runs` | One row per pipeline execution with status and counters |

The schema lives in [`db/migrations`](db/migrations).

## Running locally

You need a PostgreSQL database and its connection string.

### 1. Database and pipeline

```bash
cd pipelines/avito
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                 # set DATABASE_URL and GEMINI_API_KEY

python db.py migrate        # create the schema
python db.py seed           # optional: load the sample listings
```

Run the pipeline, in full or step by step:

```bash
python pipeline.py          # full run: scrape 500 pages, parse, dedup
python refresh.py -p 5      # scrape and diff 5 pages only
python parser.py            # extract specs for everything in the staging queue
```

### 2. Web app

```bash
cd frontend
npm install
cp .env.example .env.local  # set DATABASE_URL and GROQ_API_KEY
npm run dev
```

The dashboard works with only `DATABASE_URL`; `GROQ_API_KEY` is needed for the chat assistant.

### 3. Tests

```bash
cd pipelines/avito
pip install pytest
TEST_DATABASE_URL=postgresql://... pytest
```

Each test runs in its own throwaway schema. Without `TEST_DATABASE_URL`, database tests are skipped.

## Automation

[`avito-refresh.yml`](.github/workflows/avito-refresh.yml) runs the pipeline on demand, and daily at 01:00 UTC once its schedule is enabled. It needs two repository secrets: `DATABASE_URL` and `GEMINI_API_KEY`. The run exits non-zero if any step fails, and every run is logged in `pipeline_runs`.

## Scraping notes

The scraper reads public listing pages at a limited rate and stores only listing content (title, description, price, city, link). Seller names and phone numbers are not stored, and every row links back to the original listing on Avito.
