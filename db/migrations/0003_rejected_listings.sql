-- 0003_rejected_listings.sql

-- Listings the parser rejected (accessories, repair services, unusable parses).
-- They are not stored in `laptops`, so without this table every refresh would
-- see them as new and send them to the LLM again. A rejected listing is only
-- re-examined when its content_hash changes.
create table rejected_listings (
    avito_id      text primary key,
    content_hash  text not null default '',
    rejected_at   timestamptz not null default now()
);

alter table rejected_listings enable row level security;
