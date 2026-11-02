-- MCARBO Short Stroke Flat Trigger, Red option: the maker's close-up photo.
--
-- WHY. The Red option (mcarbo-short-stroke-flat-p365-red) showed an image
-- from imagedelivery.net, not the maker's site. Alex asked for MCARBO's own
-- close-up of the red trigger fitted in the frame — the same kind of shot
-- the Black (*_mcarbo_black_trigger_photo.sql) and Gold options carry.
--
--   old  https://imagedelivery.net/hLbftUo2UZkJC9v2df2KHQ/8941ab1c-240b-43cd-ca29-11e9e2419f00/Product
--   new  https://www.mcarbo.com/resize/Shared/Images/Product/Sig-Sauer-P365-Short-Stroke-Flat-Trigger-Upgrade/resize--6-.png?bw=600&w=600
--
-- VERIFIED 2026-11-02, before this file was written: the new URL answered
-- 200 with no redirect, content-type image/png, 250,982 bytes, and decoded
-- in full (macOS sips) to 600x600 RGB: the red trigger in the frame. It
-- passes both CHECKs from *_https_image_urls.sql (https, no whitespace) and
-- httpsOnly() in _guide-og.mjs.
--
-- MEASURED on production 2026-11-02, read-only, the old URL is held by:
--   product_variants.primary_image_url   1 row  (the Red variant)
--   variant_images.url                   1 row  (its gallery mirror)
--   guides.parts_snapshot imageUrl       0
--   gun_guides.parts_snapshot imageUrl   0
--   builds.parts_snapshot imageUrl       0  (builds are not touched here)
--
-- WHAT THIS FILE CHANGES. Exactly those values. Each catalog update names
-- the row and the URL it must hold now, and refuses if the count is not the
-- one measured, so a re-run, a changed row or a half-applied run stops the
-- whole file. The guide snapshots are covered too, though none holds the
-- old URL today, so a guide saved with the Red option before this file is
-- pushed is caught: an entry is rewritten only when its imageUrl is exactly
-- the old URL, keeping order and every other key. Black and Gold keep their
-- own photos.
--
-- On a fresh database (no catalog) it is a NOTICE and a no-op, the shape
-- every data migration here takes (check-migrations replays from zero).

do $$
declare
  v_old constant text := 'https://imagedelivery.net/hLbftUo2UZkJC9v2df2KHQ/8941ab1c-240b-43cd-ca29-11e9e2419f00/Product';
  v_new constant text := 'https://www.mcarbo.com/resize/Shared/Images/Product/Sig-Sauer-P365-Short-Stroke-Flat-Trigger-Upgrade/resize--6-.png?bw=600&w=600';
  v_slug constant text := 'mcarbo-short-stroke-flat-p365-red';
  n integer;
  n_guides integer;
  n_gun_guides integer;
begin
  if not exists (select 1 from public.products) then
    raise notice 'mcarbo red trigger photo: products is empty (fresh database), nothing to rewrite';
    return;
  end if;

  -- the variant's own photo
  update public.product_variants
     set primary_image_url = v_new
   where slug = v_slug and primary_image_url = v_old;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'mcarbo red trigger photo: variant % does not hold the expected photo (matched % rows) — re-measure before applying', v_slug, n;
  end if;

  -- its gallery mirror
  update public.variant_images vi
     set url = v_new
    from public.product_variants pv
   where pv.id = vi.variant_id and pv.slug = v_slug and vi.url = v_old;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'mcarbo red trigger photo: variant % has % variant_images rows holding the old photo (expected 1) — re-measure before applying', v_slug, n;
  end if;

  -- nothing else in the catalog may still hold the old photo
  if exists (select 1 from public.product_variants where primary_image_url = v_old)
     or exists (select 1 from public.variant_images where url = v_old) then
    raise exception 'mcarbo red trigger photo: another catalog row holds the old photo — re-measure before applying';
  end if;

  -- Guide snapshots: only an entry whose imageUrl is exactly the old URL.
  update public.guides g
     set parts_snapshot = (
       select jsonb_agg(case when e->>'imageUrl' = v_old
                             then jsonb_set(e, '{imageUrl}', to_jsonb(v_new))
                             else e end order by i)
         from jsonb_array_elements(g.parts_snapshot) with ordinality as t(e, i))
   where jsonb_typeof(g.parts_snapshot) = 'array'
     and exists (select 1 from jsonb_array_elements(g.parts_snapshot) e where e->>'imageUrl' = v_old);
  get diagnostics n_guides = row_count;

  update public.gun_guides g
     set parts_snapshot = (
       select jsonb_agg(case when e->>'imageUrl' = v_old
                             then jsonb_set(e, '{imageUrl}', to_jsonb(v_new))
                             else e end order by i)
         from jsonb_array_elements(g.parts_snapshot) with ordinality as t(e, i))
   where jsonb_typeof(g.parts_snapshot) = 'array'
     and exists (select 1 from jsonb_array_elements(g.parts_snapshot) e where e->>'imageUrl' = v_old);
  get diagnostics n_gun_guides = row_count;

  raise notice 'mcarbo red trigger photo: 1 variant, 1 variant_images row, % guides, % gun_guides rewritten',
    n_guides, n_gun_guides;
end
$$;
