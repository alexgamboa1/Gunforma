-- fit_tier is derived, the same way slide_class is (Alex, 2026-11-18).
--
-- set_part_class() fills slide_class (and barrel_class) from the
-- platform_part_lengths row for (platform, kind, length) — but fit_tier,
-- the SAME length's fact on the P365 (3.1 → short, 3.7 → xmacro,
-- 4.3 → fuse), was only ever set by the fitment_tiers data migration. So
-- every slide added through create_product() since then saved with
-- fit_tier NULL and its "Fits on" grid read "Fit not confirmed" — hit
-- 2026-11-18 on the four Norsso bull sets, which still carried NULL when
-- this migration was written.
--
-- The mapping lives where the class mapping lives: a fit_tier column on
-- platform_part_lengths, read by the same trigger lookup. A registered
-- length whose row carries no tier derives NULL on purpose — P320 keeps
-- FrameFit permanently, so when its lengths are registered its rows
-- simply carry no tier. Guard 6 in scripts/check-fitment-data.mjs now
-- fails a NULL fit_tier on its own (same PR), and
-- supabase/tests/barrel-slide-fit.sql asserts the derivation against the
-- real create_product() on every PR.
--
-- Fresh database: platform_part_lengths' three P365 slide rows are part
-- of the replayed schema (create_product() fixtures depend on them), so
-- the fill asserts exactly 3 rows everywhere; the backfill then touches
-- zero rows and says so.

-- ── 1. the mapping ─────────────────────────────────────────────────────────
alter table public.platform_part_lengths
  add column fit_tier public.fit_tier;

comment on column public.platform_part_lengths.fit_tier is
  'The slide tier this length means on this platform (P365: 3.1 short, 3.7 xmacro, 4.3 fuse). Read by set_part_class() into slide_specs.fit_tier beside part_class. NULL on barrel rows, and on any platform the tier rule does not judge (P320 keeps FrameFit).';

do $$
declare n integer;
begin
  update public.platform_part_lengths ppl
     set fit_tier = case ppl.length_in
                      when 3.1 then 'short'::public.fit_tier
                      when 3.7 then 'xmacro'::public.fit_tier
                      when 4.3 then 'fuse'::public.fit_tier
                    end
    from public.platforms pl
   where pl.id = ppl.platform_id and pl.slug = 'p365' and ppl.part_kind = 'slide';
  get diagnostics n = row_count;
  if n <> 3 then
    raise exception 'expected exactly the 3 registered P365 slide lengths, touched % rows', n;
  end if;
end $$;

-- ── 2. the trigger derives it ──────────────────────────────────────────────
-- set_part_class(), with one addition: on slide_specs the SAME row lookup
-- also fills fit_tier. Everything else is byte-identical to the live
-- function. The trigger events are unchanged (BEFORE INSERT OR UPDATE OF
-- slide_length_in, platform_id), so a length change re-derives both facts
-- and nothing else touches them — the 1:1 rule guard 6 asserts.
create or replace function public.set_part_class()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_len numeric(4,2);
  v_kind text;
  v_class text;
  v_tier public.fit_tier;
  v_platform text;
begin
  if tg_table_name = 'slide_specs' then
    v_len := new.slide_length_in; v_kind := 'slide';
  else
    v_len := new.barrel_length_in; v_kind := 'barrel';
  end if;

  -- No length yet: nothing to look up, leave the class (and tier) empty.
  if v_len is null then
    if tg_table_name = 'slide_specs' then new.slide_class := null; new.fit_tier := null;
    else new.barrel_class := null; end if;
    return new;
  end if;

  select ppl.part_class, ppl.fit_tier into v_class, v_tier
  from platform_part_lengths ppl
  where ppl.platform_id = new.platform_id
    and ppl.part_kind = v_kind
    and ppl.length_in = v_len;

  if v_class is null then
    select name into v_platform from platforms where id = new.platform_id;
    raise exception
      'No % class registered for platform "%" at % in. Add a row to platform_part_lengths first (Runbook Step 1).',
      v_kind, coalesce(v_platform,'unknown'), v_len
      using errcode = 'foreign_key_violation';
  end if;

  if tg_table_name = 'slide_specs' then
    new.slide_class := v_class;
    -- fit_tier is the same row's fact: NULL where the platform's tier
    -- rule does not judge (P320), never a guess.
    new.fit_tier := v_tier;
  else new.barrel_class := v_class; end if;
  return new;
end $function$;

-- ── 3. backfill the slides that saved before the trigger knew ──────────────
-- Four on 2026-11-18 (the Norsso bull sets). Generic, not pinned to four:
-- any slide added between writing and pushing this file is the same gap.
-- The UPDATE does not fire the trigger (its events are length/platform),
-- so the set is direct from the same mapping.
do $$
declare n integer; bad text;
begin
  update public.slide_specs s
     set fit_tier = ppl.fit_tier
    from public.platform_part_lengths ppl
   where ppl.platform_id = s.platform_id
     and ppl.part_kind = 'slide'
     and ppl.length_in = s.slide_length_in
     and ppl.fit_tier is not null
     and s.fit_tier is null;
  get diagnostics n = row_count;
  raise notice 'fit_tier backfilled on % slide(s)', n;

  -- A tiered length must leave no NULL behind.
  select string_agg(p.slug, ', ' order by p.slug) into bad
    from public.slide_specs s
    join public.platform_part_lengths ppl
      on ppl.platform_id = s.platform_id and ppl.part_kind = 'slide' and ppl.length_in = s.slide_length_in
    join public.products p on p.id = s.product_id
   where ppl.fit_tier is not null and s.fit_tier is null;
  if bad is not null then
    raise exception 'fit_tier still NULL after backfill on: %', bad;
  end if;
end $$;
