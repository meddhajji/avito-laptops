-- 0004_chat_usage.sql

-- Request counters for the chat assistant's rate limits, one row per
-- (scope, time window, key). `key` is a salted hash of the visitor's IP, or
-- 'global' for the site-wide daily cap. No IP address is stored.
create table chat_usage (
    scope         text not null check (scope in ('minute', 'day')),
    window_start  timestamptz not null,
    key           text not null,
    count         integer not null default 0,
    primary key (scope, window_start, key)
);

create index chat_usage_window_idx on chat_usage (window_start);

alter table chat_usage enable row level security;
