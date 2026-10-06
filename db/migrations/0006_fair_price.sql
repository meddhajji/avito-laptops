-- 0006_fair_price.sql

-- Estimated market price for the listing's hardware, written by pricing.py.
alter table laptops
    add column fair_price integer;

-- How far the asking price is from the estimate, in percent.
-- -20 means 20% below what similar laptops are listed for.
alter table laptops
    add column deal_pct integer generated always as (
        case when price > 0 and fair_price > 0
             then round(((price - fair_price) / fair_price * 100)::numeric)::integer
        end
    ) stored;

create index laptops_active_deal_idx on laptops (deal_pct) where not is_sold and duplicate_of is null;

-- `value` (score per 1000 DH) is replaced by deal_pct: it rewarded any cheap
-- listing, including mispriced ones, and said nothing about the market.
drop index laptops_active_value_idx;
alter table laptops drop column value;

alter table pipeline_runs
    add column priced            integer,
    add column price_model_error real;      -- median absolute error of the price model, in percent
