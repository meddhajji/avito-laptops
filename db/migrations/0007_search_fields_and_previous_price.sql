-- 0007_search_fields_and_previous_price.sql

-- Search matched the seller's free text too, so "hp" returned a Dell whose
-- description said "lot chromebook dell hp". Search now covers the structured
-- fields only: what the laptop is, not every word the seller wrote.
drop index laptops_search_idx;
alter table laptops drop column search_vector;
alter table laptops
    add column search_vector tsvector generated always as (
        to_tsvector(
            'simple'::regconfig,
            coalesce(brand, '') || ' ' || coalesce(model, '') || ' ' ||
            coalesce(cpu, '')   || ' ' || coalesce(gpu, '')   || ' ' ||
            coalesce(city, '')
        )
    ) stored;
create index laptops_search_idx on laptops using gin (search_vector);

-- The price a listing had before its latest change, so the site can mark price drops
-- without joining price_history for every row.
alter table laptops
    add column previous_price double precision;

create function track_previous_price() returns trigger
language plpgsql as $$
begin
    if old.price > 0 and new.price is distinct from old.price then
        new.previous_price := old.price;
    end if;
    return new;
end;
$$;

create trigger laptops_track_previous_price
    before update of price on laptops
    for each row execute function track_previous_price();
