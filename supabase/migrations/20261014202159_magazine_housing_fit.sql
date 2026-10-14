-- magazine_housing_fit: which factory grip-housing class each magazine fits,
-- in the maker's own words, one row per (magazine, housing class).
--
-- Why a table and not magazine_specs.fits_models: that column is SIG's
-- sentence ("P365, P365X, P365-XL, P365-XL COMP") and a page cannot be driven
-- by a sentence. The hub question is per factory gun, which is per housing
-- class (guns.housing_class), so the key is the housing class — not an
-- aftermarket frame product, which is what magazine_frame_requirements
-- keys on (left as it is; it is create_product()'s "frames" fits-with rule).
--
-- A combination the maker does not mention has NO row. The hub shows only
-- rows, so an absent row renders nothing — never a guess.
--
-- fit:
--   flush                   sits flush with the grip
--   extended                fits, sticks out below the grip
--   with_included_baseplate fits after swapping to a baseplate that ships in the box
--   not_compatible          the maker says it does not fit (or "not recommended")
--
-- Security: the same shape as magazine_frame_requirements and the other
-- reference tables — RLS on, every grant revoked, SELECT back for anon and
-- authenticated behind a read policy. No public write path.

create table public.magazine_housing_fit (
  magazine_product_id uuid not null references public.products (id) on delete cascade,
  housing_class       text not null references public.housing_classes (housing_class),
  fit                 text not null,
  note                text,
  source              text not null,
  primary key (magazine_product_id, housing_class),
  constraint magazine_housing_fit_fit check (fit in ('flush', 'extended', 'with_included_baseplate', 'not_compatible')),
  constraint magazine_housing_fit_source_url check (source ~ '^https?://')
);
create index magazine_housing_fit_housing_idx on public.magazine_housing_fit (housing_class);

comment on table public.magazine_housing_fit is
  'Per (magazine, grip-housing class): how the maker says the magazine fits. Only maker-stated combinations have rows; the gun hubs and magazine product pages render rows and nothing else.';

-- The product must be a magazine. A CHECK cannot look at another table, so
-- a trigger says it in words; compared as text like every other category
-- guard (CLAUDE.md), and never defaulting to anything.
create or replace function public.magazine_housing_fit_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_category text;
begin
  select p.category::text into v_category from public.products p where p.id = new.magazine_product_id;
  if v_category is distinct from 'magazine' then
    raise exception 'magazine_housing_fit: product % is a %, not a magazine', new.magazine_product_id, coalesce(v_category, 'missing product')
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.magazine_housing_fit_guard() from public, anon, authenticated;

create trigger trg_magazine_housing_fit_guard
  before insert or update of magazine_product_id on public.magazine_housing_fit
  for each row execute function public.magazine_housing_fit_guard();

alter table public.magazine_housing_fit enable row level security;
revoke all on public.magazine_housing_fit from public, anon, authenticated;
grant select on public.magazine_housing_fit to anon, authenticated;
create policy magazine_housing_fit_public_read
  on public.magazine_housing_fit for select to anon, authenticated using (true);
