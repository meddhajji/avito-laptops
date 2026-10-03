-- 0001_init.sql
-- Core schema. Plain PostgreSQL (14+): works on Supabase, Neon, or a local container.

-- ---------------------------------------------------------------------------
-- laptops: one row per Avito listing that was classified as a laptop
-- ---------------------------------------------------------------------------
create table laptops (
    id            integer generated always as identity primary key,
    avito_id      text not null unique,          -- identity key used by the pipeline
    link          text not null,
    description   text not null default '',      -- truncated, normalized listing text
    content_hash  text not null default '',      -- detects a listing ID reused for new content

    price         double precision,              -- DH; 0 or null = not listed
    city          text,
    is_shop       boolean not null default false,
    has_delivery  boolean not null default false,

    -- specs extracted by the LLM
    brand         text,
    model         text,
    cpu           text,
    ram           integer,                       -- GB
    storage       integer,                       -- GB
    ssd           smallint check (ssd in (0, 1)),
    gpu           text,
    gpu_type      text check (gpu_type in ('Integrated', 'Dedicated')),
    gpu_vram      double precision,              -- GB
    screen_size   double precision,              -- inches
    refresh_rate  integer,                       -- Hz
    new           smallint check (new in (0, 1)),
    touchscreen   smallint check (touchscreen in (0, 1)),

    score         integer,                       -- hardware score, 0-1000
    -- score points per 1000 DH; null when the price is unknown
    value         double precision generated always as (
                      case when price > 0 and score is not null
                           then round((score / price * 1000)::numeric, 2)::double precision
                      end
                  ) stored,

    is_sold       boolean not null default false,
    sold_at       timestamptz,
    listed_at     timestamptz,                   -- when the seller posted it (approximate)
    last_seen_at  timestamptz not null default now(),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    search_vector tsvector generated always as (
        to_tsvector(
            'simple'::regconfig,
            coalesce(brand, '') || ' ' || coalesce(model, '') || ' ' ||
            coalesce(cpu, '')   || ' ' || coalesce(gpu, '')   || ' ' ||
            coalesce(city, '')  || ' ' || coalesce(description, '')
        )
    ) stored
);

create index laptops_search_idx on laptops using gin (search_vector);
create index laptops_active_value_idx on laptops (value desc nulls last) where not is_sold;
create index laptops_active_price_idx on laptops (price) where not is_sold;
create index laptops_active_score_idx on laptops (score desc nulls last) where not is_sold;
create index laptops_created_at_idx on laptops (created_at desc);

-- ---------------------------------------------------------------------------
-- new_laptops: staging queue of scraped listings waiting for LLM extraction
-- ---------------------------------------------------------------------------
create table new_laptops (
    id            bigint generated always as identity primary key,
    avito_id      text not null unique,
    link          text not null,
    description   text not null default '',
    content_hash  text not null default '',
    price         double precision,
    city          text,
    is_shop       boolean not null default false,
    has_delivery  boolean not null default false,
    listed_at     timestamptz,
    created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- price_history: every price a listing has had, written by trigger
-- ---------------------------------------------------------------------------
create table price_history (
    id           bigint generated always as identity primary key,
    laptop_id    integer not null references laptops (id) on delete cascade,
    price        double precision not null,
    observed_at  timestamptz not null default now()
);

create index price_history_laptop_idx on price_history (laptop_id, observed_at);

-- ---------------------------------------------------------------------------
-- pipeline_runs: one row per pipeline execution
-- ---------------------------------------------------------------------------
create table pipeline_runs (
    id             bigint generated always as identity primary key,
    started_at     timestamptz not null default now(),
    finished_at    timestamptz,
    status         text not null default 'running'
                       check (status in ('running', 'success', 'failed')),
    scraped        integer,
    new_items      integer,
    reparsed       integer,
    price_updates  integer,
    marked_sold    integer,
    relisted       integer,
    duplicates     integer,
    error          text
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function set_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger laptops_set_updated_at
    before update on laptops
    for each row execute function set_updated_at();

create function record_price_change() returns trigger
language plpgsql as $$
begin
    if new.price > 0 and (tg_op = 'INSERT' or new.price is distinct from old.price) then
        insert into price_history (laptop_id, price) values (new.id, new.price);
    end if;
    return null;
end;
$$;

create trigger laptops_record_price
    after insert or update of price on laptops
    for each row execute function record_price_change();

-- ---------------------------------------------------------------------------
-- Row-level security
-- The app and pipeline connect directly as the table owner, which bypasses RLS.
-- Enabling it with no policies shuts the tables to any auto-generated public
-- API (e.g. Supabase's anon REST endpoint).
-- ---------------------------------------------------------------------------
alter table laptops       enable row level security;
alter table new_laptops   enable row level security;
alter table price_history enable row level security;
alter table pipeline_runs enable row level security;
