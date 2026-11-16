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
-- * zaffiri-p365-xl-flush-crown-spectrum — RETIRED (Alex, 2026-11-16):
--   Zaffiri no longer offers the Spectrum finish on this barrel (their
--   page's variations list Black Nitride, Gold PVD and Polished Stainless;
--   the Spectrum they still sell is the threaded barrel, a different
--   product) and its one retailer link was out of stock at the feed's last
--   word (2026-11-01). Retirement, never deletion —
--   trg_retire_links_with_variant retires its link with it — and the
--   placeholder URL is nulled so no row anywhere keeps the noimage gif.
--
-- refresh-affiliate-prices.mjs's image backfill rejects these URLs at import
-- (feedImage(), same change) — without that, the next sync night would
-- refill exactly this placeholder onto the nulled row.
--
-- And three variants wearing ANOTHER PRODUCT's photo (the cross-product
-- audit's first sweep, 2026-11-16; Alex approved each replacement as
-- tabled). The rule: a photo may sit on two products only if it genuinely
-- shows both — these three did not, so each gets its own verified photo:
--
-- * grey-ghost-precision-v2-p365-black-rmsc wore the V1 slide's bigcommerce
--   png; replaced with OpticsPlanet's own v2-black photo (eyeballed: black
--   V2 slide; same URL pattern as its FDE / Grey / OD siblings).
-- * sig-sauer-romeo-x-enclosed-compact-red-circle-dot-rose-black wore the
--   OPEN-emitter Compact's rose hero; replaced with SIG's SKU-named
--   sorx1408 hero (eyeballed: enclosed housing, rose-gold buttons — the FDE
--   sibling already uses the SKU-named sorx1402 hero).
-- * streamlight-tlr-1-hl-x-black (69500) wore OpticsPlanet's photo of the
--   69501 USB model; replaced with Streamlight's own TLR-1 HL-X hero from
--   the stored product page (eyeballed: body marked TLR-1 HL-X).
--
-- The two remaining cross-product shares — the Holosun 407C-X3/507C-X3 set
-- and ECM's R11 Edge Fuse / Fuse-for-comp — are RULINGS, not fixes: no
-- distinct photo exists for either (Alex, 2026-11-16), so they live in
-- CROSS_PRODUCT_PHOTO_ALLOWED in scripts/check-routes.mjs, not here.
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

  -- Refuse drift: the Spectrum must still be live and on the placeholder.
  if not exists (
    select 1 from public.product_variants v join public.products p on p.id = v.product_id
     where p.slug = 'zaffiri-p365-xl-flush-crown'
       and v.slug = 'zaffiri-p365-xl-flush-crown-spectrum'
       and v.retired_at is null
       and v.primary_image_url = 'https://images2.productserve.com/noimage.gif'
  ) then
    raise exception 'feed_placeholder_photos: zaffiri spectrum is not live on the noimage placeholder; refusing';
  end if;

  update public.product_variants v
     set retired_at = now(), primary_image_url = null
    from public.products p
   where p.id = v.product_id
     and p.slug = 'zaffiri-p365-xl-flush-crown'
     and v.slug = 'zaffiri-p365-xl-flush-crown-spectrum'
     and v.retired_at is null;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'feed_placeholder_photos: zaffiri spectrum retire touched % rows', n;
  end if;

  -- The three wrong-product photos. Same shape each time: refuse unless the
  -- variant is live and still wearing exactly the photo this ruling was made
  -- about, then replace it, one row.

  -- Grey Ghost v2 black: the V1 slide's png → OP's own v2-black photo.
  if not exists (
    select 1 from public.product_variants v join public.products p on p.id = v.product_id
     where p.slug = 'grey-ghost-precision-v2-p365'
       and v.slug = 'grey-ghost-precision-v2-p365-black-rmsc'
       and v.retired_at is null
       and v.primary_image_url = 'https://cdn11.bigcommerce.com/s-uufzxxrapg/products/493/images/1287/GGP-365__34746.1581442004.386.513.png?c=2'
  ) then
    raise exception 'feed_placeholder_photos: GGP v2 black is not on the V1 png; refusing';
  end if;

  update public.product_variants v
     set primary_image_url = 'https://op1.0ps.us/640-640/opplanet-grey-ghost-precision-sig-p365-pistol-slide-version-2-black-ggp-365-blk-2-main.jpg'
    from public.products p
   where p.id = v.product_id
     and p.slug = 'grey-ghost-precision-v2-p365'
     and v.slug = 'grey-ghost-precision-v2-p365-black-rmsc'
     and v.retired_at is null;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'feed_placeholder_photos: GGP v2 black update touched % rows', n;
  end if;

  -- Romeo-X Enclosed rose/black: the open-emitter Compact's rose hero →
  -- SIG's SKU-named enclosed hero (sorx1408).
  if not exists (
    select 1 from public.product_variants v join public.products p on p.id = v.product_id
     where p.slug = 'sig-sauer-romeo-x-enclosed-compact'
       and v.slug = 'sig-sauer-romeo-x-enclosed-compact-red-circle-dot-rose-black'
       and v.retired_at is null
       and v.primary_image_url = 'https://www.sigsauer.com/media/catalog/product/cache/2f7933e2ff16f0ec074a16ab6b6195f2/r/o/romeo-x-rose-hero-left_1.jpg'
  ) then
    raise exception 'feed_placeholder_photos: Romeo-X Enclosed rose is not on the open-emitter hero; refusing';
  end if;

  update public.product_variants v
     set primary_image_url = 'https://www.sigsauer.com/media/catalog/product/cache/2f7933e2ff16f0ec074a16ab6b6195f2/s/o/sorx1408-hero-left.jpg'
    from public.products p
   where p.id = v.product_id
     and p.slug = 'sig-sauer-romeo-x-enclosed-compact'
     and v.slug = 'sig-sauer-romeo-x-enclosed-compact-red-circle-dot-rose-black'
     and v.retired_at is null;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'feed_placeholder_photos: Romeo-X Enclosed rose update touched % rows', n;
  end if;

  -- Streamlight TLR-1 HL-X (69500): OP's photo of the 69501 USB model →
  -- Streamlight's own hero from the stored product page.
  if not exists (
    select 1 from public.product_variants v join public.products p on p.id = v.product_id
     where p.slug = 'streamlight-tlr-1-hl-x'
       and v.slug = 'streamlight-tlr-1-hl-x-black'
       and v.retired_at is null
       and v.primary_image_url = 'https://www.opticsplanet.com/i/978-550-ffffff-no-upscale/opplanet-streamlight-tlr-1-hl-x-usb-multi-fuel-high-lumen-rail-mounted-tactical-light-black-69501-main.webp'
  ) then
    raise exception 'feed_placeholder_photos: TLR-1 HL-X black is not on the USB model''s photo; refusing';
  end if;

  update public.product_variants v
     set primary_image_url = 'https://www.streamlight.com/images/default-source/product-large-images/tlr-1-hl-x/tlr-1-hl-x_1.jpg'
    from public.products p
   where p.id = v.product_id
     and p.slug = 'streamlight-tlr-1-hl-x'
     and v.slug = 'streamlight-tlr-1-hl-x-black'
     and v.retired_at is null;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'feed_placeholder_photos: TLR-1 HL-X black update touched % rows', n;
  end if;

  -- No variant anywhere — retired included — is left on a placeholder URL.
  select count(*) into n
    from public.product_variants v
   where v.primary_image_url ilike '%noimage%' or v.primary_image_url ilike '%productserve.com%';
  if n <> 0 then
    raise exception 'feed_placeholder_photos: % variant(s) still on a placeholder URL', n;
  end if;
end $$;
