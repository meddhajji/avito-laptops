-- 0005_run_complete_flag.sql

-- Whether the run scraped the whole category. The site's "data refreshed" date
-- only counts complete runs, so a trial run on a few pages does not move it.
alter table pipeline_runs
    add column complete boolean not null default false;

-- Runs recorded before this column existed: only full-category runs scraped this many listings.
update pipeline_runs set complete = true where status = 'success' and scraped >= 5000;
