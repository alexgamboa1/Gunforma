-- MCARBO Short Stroke Flat Trigger, Black option: a new photo.
--
-- WHY. The Black option (mcarbo-short-stroke-flat-p365-black, the part's
-- default) showed MCARBO's resize--23-.png. Alex asked for the maker's
-- close-up of the trigger fitted in the frame instead, the same kind of
-- shot the Gold option already carries.
--
--   old  https://www.mcarbo.com/Shared/Images/Product/Sig-Sauer-P365-Short-Stroke-Flat-Trigger-Upgrade/resize--23-.png
--   new  https://www.mcarbo.com/resize/Shared/Images/Product/Sig-Sauer-P365-Short-Stroke-Flat-Trigger-Upgrade/resize.png?bw=600&w=600
--
-- VERIFIED 2026-11-02, before this file was written: the new URL answered
-- 200 with no redirect, content-type image/png, 197,701 bytes, and decoded
-- in full (macOS sips) to 800x800 grayscale — the server sends 800 wide
-- whatever w= asks for. Alex looked at the decoded image and approved it
-- ("Yes, use it"): a close-up of the black trigger in the frame, not a
-- whole pistol and not the part on its own. It passes both CHECKs from
-- *_https_image_urls.sql (https, no whitespace) and httpsOnly() in
-- _guide-og.mjs.
--
-- MEASURED on production 2026-11-02, read-only, the old URL is held by:
--   product_variants.primary_image_url   1 row  (the Black variant)
--   variant_images.url                   1 row  (its gallery mirror)
--   guides.parts_snapshot imageUrl       1 entry (Sig P365 Concealed Carry)
--   gun_guides.parts_snapshot imageUrl   0
--   builds.parts_snapshot imageUrl       0  (builds are not touched here)
--
-- WHAT THIS FILE CHANGES. Exactly those values. Each update names the row
-- and the URL it must hold now, and refuses if the count is not the one
-- measured, so a re-run, a changed row or a half-applied run stops the
-- whole file. A guide entry is rewritten only when its imageUrl is exactly
-- the old URL; order and every other key are kept. Gold and Red keep their
-- own photos.
--
-- On a fresh database (no catalog) it is a NOTICE and a no-op, the shape
-- every data migration here takes (check-migrations replays from zero).

do $$
declare
  v_old constant text := 'https://www.mcarbo.com/Shared/Images/Product/Sig-Sauer-P365-Short-Stroke-Flat-Trigger-Upgrade/resize--23-.png';
  v_new constant text := 'https://www.mcarbo.com/resize/Shared/Images/Product/Sig-Sauer-P365-Short-Stroke-Flat-Trigger-Upgrade/resize.png?bw=600&w=600';
  v_slug constant text := 'mcarbo-short-stroke-flat-p365-black';
  n integer;
  n_guides integer;
  n_gun_guides integer;
begin
  if not exists (select 1 from public.products) then
    raise notice 'mcarbo black trigger photo: products is empty (fresh database), nothing to rewrite';
    return;
  end if;

  -- the variant's own photo
  update public.product_variants
     set primary_image_url = v_new
   where slug = v_slug and primary_image_url = v_old;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'mcarbo black trigger photo: variant % does not hold the expected photo (matched % rows) — re-measure before applying', v_slug, n;
  end if;

  -- its gallery mirror
  update public.variant_images vi
     set url = v_new
    from public.product_variants pv
   where pv.id = vi.variant_id and pv.slug = v_slug and vi.url = v_old;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'mcarbo black trigger photo: variant % has % variant_images rows holding the old photo (expected 1) — re-measure before applying', v_slug, n;
  end if;

  -- nothing else in the catalog may still hold the old photo
  if exists (select 1 from public.product_variants where primary_image_url = v_old)
     or exists (select 1 from public.variant_images where url = v_old) then
    raise exception 'mcarbo black trigger photo: another catalog row holds the old photo — re-measure before applying';
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

  raise notice 'mcarbo black trigger photo: 1 variant, 1 variant_images row, % guides, % gun_guides rewritten',
    n_guides, n_gun_guides;
end
$$;
