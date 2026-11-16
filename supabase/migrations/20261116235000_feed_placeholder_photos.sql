-- The Awin feed's "no image" placeholder, stored as a product photo
-- (https://images2.productserve.com/noimage.gif — Awin's grey "No image
-- available" gif). Two live variants carried it, the only two rows on the
-- productserve host at all, each the only variant of its product on that
-- URL — which is why the per-product photo audit never saw the share; the
-- cross-product and placeholder assertions added to check-routes.mjs in the
-- same change are what catch it now.
--
-- * timber-creek-extended-mag-release-p365-fde — no real FDE photo exists
--   anywhere found (probed 2026-11-16): OpticsPlanet photographs five of the
--   six colours and not FDE, GunMagWarehouse's FDE swatch shows their own
--   "coming soon" placeholder, TLO Outdoors does not carry the part, and
--   Timber Creek has no stored website. So the colour swatch is its picture:
--   primary_image_url goes to NULL and no_photo_ok is the waiver (the
--   approve_fuse_grips mechanism — the gap moves to optional_blank and the
--   part stays approved). Alex, 2026-11-16.
--
-- refresh-affiliate-prices.mjs's image backfill rejects these URLs at import
-- (feedImage(), same change) — without that, the next sync night would
-- refill exactly this placeholder onto the nulled row.
--
-- Fresh database: no variants exist when migrations replay (seed.sql is
-- reference data only), so this NOTICEs and returns. A drifted row refuses.

do $$
declare
  n integer;
begin
  select count(*) into n from public.product_variants;
  if n = 0 then
    raise notice 'feed_placeholder_photos: no variants (fresh database) — nothing to correct.';
    return;
  end if;

  -- Refuse drift: the variant must still carry the placeholder.
  if not exists (
    select 1 from public.product_variants v join public.products p on p.id = v.product_id
     where p.slug = 'timber-creek-extended-mag-release-p365'
       and v.slug = 'timber-creek-extended-mag-release-p365-fde'
       and v.retired_at is null
       and v.primary_image_url = 'https://images2.productserve.com/noimage.gif'
  ) then
    raise exception 'feed_placeholder_photos: timber-creek FDE is not on the noimage placeholder; refusing';
  end if;

  update public.product_variants v
     set primary_image_url = null, no_photo_ok = true
    from public.products p
   where p.id = v.product_id
     and p.slug = 'timber-creek-extended-mag-release-p365'
     and v.slug = 'timber-creek-extended-mag-release-p365-fde'
     and v.retired_at is null;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'feed_placeholder_photos: timber-creek FDE update touched % rows', n;
  end if;

  -- No live variant anywhere is left on a noimage/productserve URL except
  -- the Zaffiri Spectrum, which has its own ruling pending.
  select count(*) into n
    from public.product_variants v
   where v.retired_at is null
     and (v.primary_image_url ilike '%noimage%' or v.primary_image_url ilike '%productserve.com%')
     and v.slug <> 'zaffiri-p365-xl-flush-crown-spectrum';
  if n <> 0 then
    raise exception 'feed_placeholder_photos: % live variant(s) still on a placeholder URL', n;
  end if;
end $$;
