-- Finish families: the maker's wording stays, filtering gets a family
-- (Alex, 2026-11-19).
--
-- product_variants.finish is free text holding each maker's exact wording
-- — 34 distinct spellings across 576 variants on 2026-11-19 — and several
-- are one coating written differently (DLC / High Polished Black DLC /
-- Satin DLC / Satin DLC Black). The catalog's Finish filter therefore
-- offers near-duplicates, and a shopper ticking "TiN" misses the Fdez
-- barrels filed as "High Polished Gold (TiN)". Free text is also how the
-- typos "Cerkote" and "Anodize" got in (cleaned by hand 2026-11-19).
--
-- This adds a filterable family BEHIND the wording, the same shape as
-- colors → color_family and products.material_family → materials:
--
--   finish_families(finish_family, sort_order)        mirrors materials
--   finishes(finish → finish_family, sort_order)      mirrors colors
--   product_variants.finish → finishes ON UPDATE CASCADE (the colors FK)
--   product_variants.finish_family, DERIVED by a trigger from finishes —
--     the way slide_specs.slide_class derives from platform_part_lengths,
--     and like set_part_class() it RAISES on a finish with no row. A NULL
--     finish derives a NULL family and raises nothing.
--
-- It changes NO displayed text: variant_label, the buy rows and the
-- product page keep the maker's spelling. The one exception is the data
-- merge below, which Alex asked for.
--
-- ONE DATA MERGE. "High Polished Gold" (2 variants: the Fdez Werx P365
-- 3.1" and FUSE 4.3" flush barrels) and "High Polished Gold (TiN)" (the
-- two Fdez ported barrels) are the same Fdez barrel finish recorded two
-- ways. The two plain rows take the (TiN) wording and its label "Gold ·
-- TiN"; only the (TiN) wording is seeded, so 33 finishes, not 34. The
-- variants' slugs (…-high-polished-gold) are addresses and are left alone.
--
-- Fresh database: product_variants is empty on a replay from zero, so the
-- merge and the backfill touch nothing and say so; the vocabulary rows are
-- inserted HERE, not in supabase/seed.sql (the seed loads after the
-- migrations, and db push never applies it — production needs the rows
-- from this file). A non-empty table that does not hold exactly the two
-- plain "High Polished Gold" rows, or holds a finish this file does not
-- seed, is drift and refuses before anything is constrained.
--
-- New finishes: add-a-part writes variants through create_product() /
-- add_variants() (SECURITY DEFINER), so an EXISTING finish saves as
-- before. A new maker wording is refused in words by the trigger until it
-- has a finishes row; finishes_admin_insert lets an admin write that row
-- (the colors_admin_insert precedent), which is what an "add a finish"
-- control on the page will use.

-- ── 1. the families ────────────────────────────────────────────────────────
create table public.finish_families (
  finish_family text primary key,
  sort_order    integer not null
);

comment on table public.finish_families is
  'Filterable finish families (Cerakote, DLC, Nitride, …). The catalog filters on a family; the maker''s own wording stays in product_variants.finish. Mirrors materials.';

insert into public.finish_families (finish_family, sort_order) values
  ('Cerakote',    10),
  ('DLC',         20),
  ('Nitride',     30),
  ('PVD',         40),
  ('TiN',         50),
  ('TiCN',        60),
  ('TiAlN',       70),
  ('Anodized',    80),
  ('Black Oxide', 85),
  ('Plated',      88),
  ('Uncoated',    90);

-- ── 2. the maker's wordings, each under its family ─────────────────────────
-- sort_order is left NULL: options are ordered by family, and no order
-- within a family was decided.
create table public.finishes (
  finish        text primary key,
  finish_family text not null
                references public.finish_families (finish_family) on update cascade,
  sort_order    integer
);

comment on table public.finishes is
  'Every finish wording a variant may carry, exactly as the maker writes it, and the family it belongs to. product_variants.finish references it; product_variants.finish_family is derived from it. Mirrors colors.';

insert into public.finishes (finish, finish_family) values
  ('Cerakote',                      'Cerakote'),
  ('Cerakote H-146 Graphite Black', 'Cerakote'),
  ('DLC',                           'DLC'),
  ('High Polished Black DLC',       'DLC'),
  ('Satin DLC Black',               'DLC'),
  ('Satin DLC',                     'DLC'),
  ('Nitride',                       'Nitride'),
  ('QPQ Nitride',                   'Nitride'),
  ('Black Nitride',                 'Nitride'),
  ('Nitron',                        'Nitride'),
  ('Black Nitride/QPQ',             'Nitride'),
  ('PVD',                           'PVD'),
  ('High Polished Copper',          'PVD'),
  ('High Polished Copper (rose)',   'PVD'),
  ('Copper PVD',                    'PVD'),
  ('Stainless Steel PVD',           'PVD'),
  ('Satin Copper',                  'PVD'),
  ('Satin Blue',                    'PVD'),
  ('TiN',                           'TiN'),
  ('High Polished Gold (TiN)',      'TiN'),
  ('Satin Gold',                    'TiN'),
  ('TiCN',                          'TiCN'),
  ('TiAlN',                         'TiAlN'),
  ('Anodized',                      'Anodized'),
  ('Hard Anodized',                 'Anodized'),
  ('Black Oxide',                   'Black Oxide'),
  ('High-Polish Gold Plate',        'Plated'),
  ('Satin',                         'Uncoated'),
  ('High Polished Stainless',       'Uncoated'),
  ('Polished',                      'Uncoated'),
  ('Satin Stainless',               'Uncoated'),
  ('Stainless',                     'Uncoated'),
  ('Plain Brass',                   'Uncoated');

do $$
declare n integer;
begin
  select count(*) into n from public.finishes;
  if n <> 33 then raise exception 'expected 33 finishes seeded, got %', n; end if;
  select count(*) into n from public.finish_families;
  if n <> 11 then raise exception 'expected 11 finish families seeded, got %', n; end if;
end $$;

-- ── 3. the one data merge, before anything is constrained ──────────────────
do $$
declare n integer; total integer;
begin
  select count(*) into total from public.product_variants;
  if total = 0 then
    raise notice 'product_variants is empty (fresh database) — no "High Polished Gold" rows to merge';
    return;
  end if;

  update public.product_variants v
     set finish        = 'High Polished Gold (TiN)',
         variant_label = case when v.variant_label = 'Gold · High Polish'
                              then 'Gold · TiN' else v.variant_label end
    from public.products p
   where p.id = v.product_id
     and v.finish = 'High Polished Gold'
     and p.slug in ('fdez-werx-p365-flush-barrel', 'fdez-werx-p365-fuse-flush-barrel');
  get diagnostics n = row_count;
  if n <> 2 then
    raise exception 'drift: expected exactly the 2 Fdez flush-barrel variants reading "High Polished Gold", merged %', n;
  end if;

  select count(*) into n from public.product_variants where finish = 'High Polished Gold';
  if n <> 0 then
    raise exception 'drift: % other variant(s) still read "High Polished Gold" — not the two this merge names', n;
  end if;

  select count(*) into n from public.product_variants
   where finish = 'High Polished Gold (TiN)' and variant_label = 'Gold · TiN';
  if n <> 4 then
    raise exception 'expected the 4 Fdez gold barrels to read "Gold · TiN" after the merge, found %', n;
  end if;
end $$;

-- Every wording a variant carries must have a row before the trigger and the
-- foreign key go on — refuse naming the strays, never half-apply.
do $$
declare bad text;
begin
  select string_agg(format('%L (%s)', finish, n), ', ' order by finish) into bad
    from (select v.finish, count(*) n
            from public.product_variants v
            left join public.finishes f on f.finish = v.finish
           where v.finish is not null and f.finish is null
           group by v.finish) s;
  if bad is not null then
    raise exception 'drift: product_variants carries finish wording(s) this migration does not seed: %', bad;
  end if;
end $$;

-- ── 4. the derived family on the variant ───────────────────────────────────
alter table public.product_variants
  add column finish_family text;

comment on column public.product_variants.finish_family is
  'The finish''s family, DERIVED from finishes by set_finish_family() — never written directly (a direct write is re-derived). What the catalog filters on; finish stays the maker''s wording for display.';

create or replace function public.set_finish_family()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- No finish: no family, and nothing to refuse.
  if new.finish is null then
    new.finish_family := null;
    return new;
  end if;

  select f.finish_family into new.finish_family
    from finishes f
   where f.finish = new.finish;

  if not found then
    raise exception
      'Finish "%" is not in the finishes list. Add it there with its family first, then save this variant.',
      new.finish
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $function$;

-- UPDATE OF finish_family too, so a direct write to the family is re-derived
-- rather than left out of step with its finish.
create trigger trg_set_finish_family
  before insert or update of finish, finish_family on public.product_variants
  for each row execute function public.set_finish_family();

-- A wording moved to another family (or a family renamed, which cascades
-- into finishes) re-derives every variant carrying it. Without this the
-- derived column would go stale the first time the taxonomy changes.
create or replace function public.sync_variant_finish_family()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  update product_variants
     set finish_family = new.finish_family
   where finish = new.finish
     and finish_family is distinct from new.finish_family;
  return null;
end $function$;

create trigger trg_sync_variant_finish_family
  after update of finish_family on public.finishes
  for each row execute function public.sync_variant_finish_family();

-- ── 5. backfill every existing variant, retired ones included ──────────────
do $$
declare n integer; expected integer; bad text;
begin
  select count(*) into expected from public.product_variants where finish is not null;

  update public.product_variants v
     set finish_family = f.finish_family
    from public.finishes f
   where f.finish = v.finish;
  get diagnostics n = row_count;
  if n <> expected then
    raise exception 'backfill set finish_family on % variant(s), expected % (every non-null finish)', n, expected;
  end if;
  raise notice 'finish_family backfilled on % variant(s)', n;

  select string_agg(distinct coalesce(finish, '<null>'), ', ') into bad
    from public.product_variants
   where (finish is null) <> (finish_family is null);
  if bad is not null then
    raise exception 'finish and finish_family disagree on nullness for: %', bad;
  end if;
end $$;

-- ── 6. the wording is constrained to the list (the colors FK) ──────────────
alter table public.product_variants
  add constraint product_variants_finish_fkey
  foreign key (finish) references public.finishes (finish) on update cascade;

-- ── 7. access: public read, admin may add a finish; nothing else ───────────
-- RLS and an explicit revoke on both new tables (CLAUDE.md, "Every new
-- public table needs RLS and an explicit revoke"): the default ACL would
-- otherwise hand anon and authenticated full privileges underneath RLS.
alter table public.finish_families enable row level security;
alter table public.finishes        enable row level security;

revoke all on public.finish_families from anon, authenticated;
revoke all on public.finishes        from anon, authenticated;

grant select on public.finish_families to anon, authenticated;
grant select on public.finishes        to anon, authenticated;
-- The admin "add a finish" write (colors_admin_insert's twin). A policy
-- without its grant reads as "permission denied", so both.
grant insert on public.finishes to authenticated;

create policy finish_families_public_read on public.finish_families
  for select to anon, authenticated using (true);

create policy finishes_public_read on public.finishes
  for select to anon, authenticated using (true);

create policy finishes_admin_insert on public.finishes
  for insert to authenticated with check (public.is_admin());
