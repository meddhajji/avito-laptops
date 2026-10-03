-- 0002_duplicates_and_parse_attempts.sql

-- Duplicate listings are flagged instead of deleted. A deleted row that is still
-- live on Avito would look brand new to the next refresh and be parsed again.
alter table laptops
    add column duplicate_of integer references laptops (id) on delete set null;

create index laptops_duplicate_of_idx on laptops (duplicate_of) where duplicate_of is not null;

-- How many times the current parser run has sent a staged listing to the LLM.
-- Listings that keep failing are skipped so they cannot block the queue.
alter table new_laptops
    add column attempts integer not null default 0;

-- More detail per pipeline run
alter table pipeline_runs
    add column pages_failed    integer,
    add column parsed          integer,
    add column rejected        integer,
    add column queue_remaining integer;
