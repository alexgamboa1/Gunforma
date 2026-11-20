-- Finish families (20261120001514_finish_families.sql): the maker's wording
-- stays in product_variants.finish, and finish_family is DERIVED from the
-- finishes table — never typed.
--
-- Run by .github/workflows/check-migrations.yml against the database the
-- job just replayed from zero, so it drives the REAL create_product() and
-- the REAL triggers — not a copy of either. psql -v ON_ERROR_STOP=1 turns
-- any raise here into a red job. Everything is rolled back.
--
-- Asserts:
--   - the vocabulary the migration seeds: 11 families, 33 finishes, and
--     no plain "High Polished Gold" (merged into the (TiN) wording)
--   - a variant saved with a listed finish derives its family
--   - a NULL finish saves, with a NULL family
--   - a finish with no finishes row is REFUSED, in words, through
--     create_product() — the add-a-part path
--   - a direct write to finish_family is re-derived from the finish
--   - moving a finish to another family re-derives every variant carrying it
--   - anon reads both tables and cannot write either

begin;

do $$
declare
  n int;
  fam text;
  msg text := null;
begin
  -- ── the vocabulary ────────────────────────────────────────────────────────
  select count(*) into n from public.finish_families;
  if n <> 11 then raise exception 'finish_families: % rows, expected 11', n; end if;
  select count(*) into n from public.finishes;
  if n <> 33 then raise exception 'finishes: % rows, expected 33', n; end if;
  if exists (select 1 from public.finishes where finish = 'High Polished Gold') then
    raise exception 'finishes still lists "High Polished Gold" — it was merged into "High Polished Gold (TiN)"';
  end if;
  select finish_family into fam from public.finishes where finish = 'High Polished Gold (TiN)';
  if fam is distinct from 'TiN' then
    raise exception '"High Polished Gold (TiN)" is filed under %, expected TiN', coalesce(fam, '<NULL>');
  end if;

  -- ── a listed finish derives its family, through create_product() ─────────
  perform public.create_product(
    '{"brand":"Finishtest","name":"Finish Test Slide","category":"slide","platforms":["p365"],"url":"https://example.com/finish-slide","slug":"finish-test-slide"}'::jsonb,
    '[{"color":"Black","finish":"Satin DLC","msrp":100,"image_url":"https://example.com/f1.jpg","is_default":true},
      {"color":"Gold","msrp":100,"image_url":"https://example.com/f2.jpg"}]'::jsonb,
    '{"slide_length_in":3.7,"barrel_length_in":3.7,"comp_style":"none","barrel_included":false,"comes_with_sights":false,"integrated_comp":false,"lightening_cuts":false,"required_spring_weight":"P365XL/X-MACRO Recoil Spring Assembly","threaded_barrel_ok":true}'::jsonb);

  select v.finish_family into fam
    from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = 'finish-test-slide' and v.finish = 'Satin DLC';
  if fam is distinct from 'DLC' then
    raise exception 'Satin DLC derived family %, expected DLC', coalesce(fam, '<NULL>');
  end if;

  -- ── a NULL finish saves with a NULL family ────────────────────────────────
  select count(*) into n
    from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = 'finish-test-slide' and v.finish is null and v.finish_family is null;
  if n <> 1 then
    raise exception 'the finish-less Gold variant: % row(s) with NULL finish and NULL family, expected 1', n;
  end if;

  -- ── an unlisted finish is refused, in words, on the add-a-part path ───────
  begin
    perform public.create_product(
      '{"brand":"Finishtest","name":"Finish Test Slide Two","category":"slide","platforms":["p365"],"url":"https://example.com/finish-slide-2","slug":"finish-test-slide-two"}'::jsonb,
      '[{"color":"Black","finish":"Moon Dust","msrp":100,"image_url":"https://example.com/f3.jpg","is_default":true}]'::jsonb,
      '{"slide_length_in":3.7,"barrel_length_in":3.7,"comp_style":"none","barrel_included":false,"comes_with_sights":false,"integrated_comp":false,"lightening_cuts":false,"required_spring_weight":"P365XL/X-MACRO Recoil Spring Assembly","threaded_barrel_ok":true}'::jsonb);
  exception when others then
    msg := sqlerrm;
  end;
  if msg is null then
    raise exception 'create_product() saved a variant with finish "Moon Dust", which has no finishes row';
  end if;
  if msg not like '%Moon Dust%finishes%' then
    raise exception 'the unlisted-finish refusal does not say what to do: %', msg;
  end if;

  -- ── a direct write to the family is re-derived ────────────────────────────
  update public.product_variants v set finish_family = 'PVD'
    from public.products p
   where p.id = v.product_id and p.slug = 'finish-test-slide' and v.finish = 'Satin DLC';
  select v.finish_family into fam
    from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = 'finish-test-slide' and v.finish = 'Satin DLC';
  if fam is distinct from 'DLC' then
    raise exception 'a direct write left finish_family = %, expected it re-derived to DLC', coalesce(fam, '<NULL>');
  end if;

  -- ── moving a finish to another family re-derives its variants ─────────────
  update public.finishes set finish_family = 'Nitride' where finish = 'Satin DLC';
  select v.finish_family into fam
    from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = 'finish-test-slide' and v.finish = 'Satin DLC';
  if fam is distinct from 'Nitride' then
    raise exception 'after moving Satin DLC to Nitride its variant reads %, expected Nitride', coalesce(fam, '<NULL>');
  end if;

  raise notice 'finish-families: all assertions passed';
end $$;

-- ── anon reads the vocabulary and cannot write it ───────────────────────────
set local role anon;

do $$
declare n int; wrote boolean := false;
begin
  select count(*) into n from public.finishes;
  if n < 33 then raise exception 'anon reads % finishes, expected the full list', n; end if;
  select count(*) into n from public.finish_families;
  if n <> 11 then raise exception 'anon reads % finish families, expected 11', n; end if;
  begin
    insert into public.finishes (finish, finish_family) values ('Anon Finish', 'DLC');
    wrote := true;
  exception when others then null;
  end;
  if wrote then raise exception 'anon inserted into finishes'; end if;
end $$;

reset role;

rollback;
