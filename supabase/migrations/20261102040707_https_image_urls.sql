-- Catalog photos over https only: six http:// photo URLs rewritten to their
-- https:// form (two of them with their spaces encoded as %20), and a CHECK
-- so an http:// photo, or one containing whitespace, cannot be stored again.
--
-- WHY. A page served over https that loads an http:// image is mixed
-- content: browsers upgrade it or block it, depending on the browser. The
-- Gun Guide share image (guide-og.mjs) fetches photos server-side and takes
-- https only (`httpsOnly()` in _guide-og.mjs), so every part below drew as a
-- colour swatch on the share cards: the MCARBO trigger on Concealed Carry,
-- Duty, Home Defense and Range / Competition, and the Align Tactical mag
-- release on Duty. Add-a-part has refused a non-https photo since it was
-- written (`isHttps()` in gunforma-admin-part.html); these six came in by
-- other routes.
--
-- MEASURED on production, 2026-11-02, read-only. Every http:// photo in the
-- database (columns read: product_variants.primary_image_url,
-- variant_images.url, the imageUrl of every guides / gun_guides / builds
-- parts_snapshot entry, platforms.image_url, manufacturers.logo_url,
-- guides.hero_image_path):
--
--   variant (product_variants + its variant_images mirror)  old URL
--   align-tactical-offset-mag-release-p365-rh      http://www.aligntactical.com/cdn/shop/products/P365Release3_1200x1200.jpg?v=1662665555
--   align-tactical-thumb-rest-takedown-p365-dlc    http://www.aligntactical.com/cdn/shop/files/P365ThumbRestDLC2_1200x1200.jpg?v=1744306336
--   mcarbo-comp-p365-black                         http://www.mcarbo.com/Shared/images/product/Sig P365 Compensator/compensator.jpg
--   mcarbo-short-stroke-flat-p365-black            http://www.mcarbo.com/Shared/Images/Product/Sig-Sauer-P365-Short-Stroke-Flat-Trigger-Upgrade/resize--23-.png
--   mcarbo-tbarrel-comp-p365-black-black           http://www.mcarbo.com/Shared/images/product/Sig Sauer P365 Threaded Barrel and Compensator/main-photo.jpg
--   tactical-development-dual-flat-face-p365-black http://tactical.dev/cdn/shop/products/IMG_2949.jpg?v=1633466474
--
--   6 product_variants rows, all live, none discontinued; 6 variant_images
--   rows, one per variant, the same URL; 1 guides snapshot entry (Sig P365
--   Concealed Carry, the MCARBO trigger); 0 gun_guides entries; 0 builds
--   entries (86 build parts, 65 carry an imageUrl, all https); 0 in the
--   other columns. The only photo URLs anywhere in those places that hold
--   whitespace are the two MCARBO comp rows (and their variant_images
--   mirrors): literal spaces in the path.
--
-- VERIFIED before this file was written, 2026-11-02: the https:// form of
-- each URL fetched with curl (spaces sent as %20), every one answering 200
-- with no redirect, and every body decoded in full to pixels (macOS sips):
--
--   align offset mag release   200  image/jpeg  1099x1200   37 KB
--   align thumb rest takedown  200  image/jpeg  1200x847    64 KB
--   mcarbo comp                200  image/jpeg  2484x2280  395 KB
--   mcarbo short stroke flat   200  image/png    800x800   108 KB
--   mcarbo threaded barrel     200  image/jpeg  4956x4000  2.3 MB
--   tactical.dev dual flat     200  image/jpeg   800x800   126 KB
--
-- WHAT THIS FILE CHANGES. Only exactly those values, each to the address
-- verified above. No blanket replace: each row names its variant, the URL
-- it must hold now and the URL it gets, and refuses if it holds anything
-- else, so a re-run, a changed row or a half-applied run stops the whole
-- file. Four rows change only the scheme. The two MCARBO comp rows also
-- get their spaces written as %20 (Alex, on #236) — the exact address
-- fetched above, and the form the share image accepts: httpsOnly() in
-- _guide-og.mjs refuses a URL with whitespace in it, so stored with
-- spaces either part would still draw as a swatch on a guide's card.
--
-- Guide snapshots: an entry's imageUrl is rewritten only when it is
-- exactly one of the six old URLs, to that row's new URL. guides holds one
-- such entry and gun_guides none; both tables are covered so a community
-- guide saved before this file is pushed is caught too. Builds are NOT
-- touched here (their own guards, their own decision); there are none to
-- touch today.
--
-- THE GUARD. product_variants.primary_image_url and variant_images.url get
-- a CHECK refusing a value that starts with http:// (any case) or contains
-- whitespace anywhere. NULL stays allowed (a variant with no photo draws
-- its swatch). Add-a-part already refuses both on the page (isHttps() in
-- gunforma-admin-part.html); this holds every other writer to the same
-- rule. Adding the CHECKs is also this file's postcondition: it fails if
-- either kind of photo is left in either column, including one that
-- arrived after the measurement above.
--
-- On a fresh database (no catalog) the rewrite is a NOTICE and a no-op,
-- the shape every data migration here takes (check-migrations replays
-- from zero); the CHECKs are added either way.

do $$
declare
  r record;
  n integer;
  n_variants integer := 0; n_images integer := 0; n_guides integer := 0; n_gun_guides integer := 0;
  urls text[];
begin
  if not exists (select 1 from public.products) then
    raise notice 'https image urls: products is empty (fresh database), nothing to rewrite';
    return;
  end if;

  create temporary table _https_fix (variant_slug text primary key, old_url text not null, new_url text not null) on commit drop;
  insert into _https_fix values
    ('align-tactical-offset-mag-release-p365-rh',
     'http://www.aligntactical.com/cdn/shop/products/P365Release3_1200x1200.jpg?v=1662665555',
     'https://www.aligntactical.com/cdn/shop/products/P365Release3_1200x1200.jpg?v=1662665555'),
    ('align-tactical-thumb-rest-takedown-p365-dlc',
     'http://www.aligntactical.com/cdn/shop/files/P365ThumbRestDLC2_1200x1200.jpg?v=1744306336',
     'https://www.aligntactical.com/cdn/shop/files/P365ThumbRestDLC2_1200x1200.jpg?v=1744306336'),
    ('mcarbo-comp-p365-black',
     'http://www.mcarbo.com/Shared/images/product/Sig P365 Compensator/compensator.jpg',
     'https://www.mcarbo.com/Shared/images/product/Sig%20P365%20Compensator/compensator.jpg'),
    ('mcarbo-short-stroke-flat-p365-black',
     'http://www.mcarbo.com/Shared/Images/Product/Sig-Sauer-P365-Short-Stroke-Flat-Trigger-Upgrade/resize--23-.png',
     'https://www.mcarbo.com/Shared/Images/Product/Sig-Sauer-P365-Short-Stroke-Flat-Trigger-Upgrade/resize--23-.png'),
    ('mcarbo-tbarrel-comp-p365-black-black',
     'http://www.mcarbo.com/Shared/images/product/Sig Sauer P365 Threaded Barrel and Compensator/main-photo.jpg',
     'https://www.mcarbo.com/Shared/images/product/Sig%20Sauer%20P365%20Threaded%20Barrel%20and%20Compensator/main-photo.jpg'),
    ('tactical-development-dual-flat-face-p365-black',
     'http://tactical.dev/cdn/shop/products/IMG_2949.jpg?v=1633466474',
     'https://tactical.dev/cdn/shop/products/IMG_2949.jpg?v=1633466474');

  for r in select * from _https_fix order by variant_slug loop
    -- the variant's own photo
    update public.product_variants
       set primary_image_url = r.new_url
     where slug = r.variant_slug and primary_image_url = r.old_url;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'https image urls: variant % does not hold the expected photo % (matched % rows) — re-measure before applying',
        r.variant_slug, r.old_url, n;
    end if;
    n_variants := n_variants + n;

    -- its gallery mirror: exactly one row per variant was measured
    update public.variant_images vi
       set url = r.new_url
      from public.product_variants pv
     where pv.id = vi.variant_id and pv.slug = r.variant_slug and vi.url = r.old_url;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'https image urls: variant % has % variant_images rows holding % (expected 1) — re-measure before applying',
        r.variant_slug, n, r.old_url;
    end if;
    n_images := n_images + n;
  end loop;

  urls := array(select old_url from _https_fix);

  -- Guide snapshots: rewrite only an entry whose imageUrl is exactly one of
  -- the six old URLs, to that row's new URL. Order is kept (with
  -- ordinality); every other key is untouched.
  update public.guides g
     set parts_snapshot = (
       select jsonb_agg(case when f.new_url is not null
                             then jsonb_set(e, '{imageUrl}', to_jsonb(f.new_url))
                             else e end order by i)
         from jsonb_array_elements(g.parts_snapshot) with ordinality as t(e, i)
         left join _https_fix f on f.old_url = e->>'imageUrl')
   where jsonb_typeof(g.parts_snapshot) = 'array'
     and exists (select 1 from jsonb_array_elements(g.parts_snapshot) e where e->>'imageUrl' = any (urls));
  get diagnostics n_guides = row_count;

  update public.gun_guides g
     set parts_snapshot = (
       select jsonb_agg(case when f.new_url is not null
                             then jsonb_set(e, '{imageUrl}', to_jsonb(f.new_url))
                             else e end order by i)
         from jsonb_array_elements(g.parts_snapshot) with ordinality as t(e, i)
         left join _https_fix f on f.old_url = e->>'imageUrl')
   where jsonb_typeof(g.parts_snapshot) = 'array'
     and exists (select 1 from jsonb_array_elements(g.parts_snapshot) e where e->>'imageUrl' = any (urls));
  get diagnostics n_gun_guides = row_count;

  -- Nothing http:// may remain in a guide snapshot. A URL that is not one
  -- of the six was not verified, so it is refused rather than rewritten.
  if exists (select 1 from public.guides g, jsonb_array_elements(g.parts_snapshot) e
              where jsonb_typeof(g.parts_snapshot) = 'array' and e->>'imageUrl' ilike 'http://%')
     or exists (select 1 from public.gun_guides g, jsonb_array_elements(g.parts_snapshot) e
              where jsonb_typeof(g.parts_snapshot) = 'array' and e->>'imageUrl' ilike 'http://%') then
    raise exception 'https image urls: a guide snapshot still holds an http:// imageUrl this file did not verify — re-measure before applying';
  end if;

  raise notice 'https image urls: % variants, % variant_images rows, % guides, % gun_guides rewritten',
    n_variants, n_images, n_guides, n_gun_guides;
end
$$;

alter table public.product_variants
  add constraint product_variants_primary_image_https
  check (primary_image_url is null
         or (primary_image_url !~* '^http://' and primary_image_url !~ '[[:space:]]'));

alter table public.variant_images
  add constraint variant_images_url_https
  check (url !~* '^http://' and url !~ '[[:space:]]');
