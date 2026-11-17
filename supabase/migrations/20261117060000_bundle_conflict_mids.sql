-- The six bundle conflicts: pin op_merchant_product_id to the component
-- (Alex's approval, 2026-11-16: "yes to the stored-merchant-id tiebreak").
--
-- OP gives a bundle the component's GTIN, so a single and its bundle share
-- the MPN AND the GTIN and the sync withholds the link as a candidate
-- conflict every night. The 2026-11-17 run names the six:
--
--   Leupold DeltaPoint Pro FDE    0f78961e  bare sight 5166322 beside 4 TRYBE-slide kits
--   Leupold DeltaPoint Pro Black  bc46647d  bare sight 5166392 beside 2 TRYBE-slide kits
--   Tyrant CNC Takedown Lever     8b65c4ec  bare lever 5853035 beside the lever+catch pair
--   Magpul AMAG 10                dcbe7ec2  single 6321968 beside the 3-pack
--   Magpul AMAG 15                17cc242b  single 6321966 beside the 3-pack
--   Magpul AMAG 12                3d198bad  single 6321967 beside the 3-pack
--
-- The merchant_product_id names the exact LISTING, so the component's mid
-- is what lets the sync's stored-mid tiebreak (same PR) resolve each pair
-- to the component from the next run on.
--
-- THREE OF THE SIX ARE CORRECTIONS, NOT FILLS — found when this file's
-- fill-only first draft refused them in the rolled-back validation run.
-- The overwrite-era sync (before "the sync never overwrites an
-- identifier") had pinned both DeltaPoint links to a TRYBE-slide BUNDLE
-- (mids 5540956 / 5540953, and the bundle's 659.99 stored as the sight's
-- price) and the Tyrant lever to the lever+catch combo (6282705, price
-- 63.45). Their stored MPN and GTIN are the bare component's own — the
-- bundles merely reuse them — so only the mid is wrong. Clearing it and
-- letting the next run refill (the documented re-point) cannot work here:
-- several candidates means conflict means no fill, forever. So this is the
-- deliberate re-point, each correction allowed ONLY from its named wrong
-- value; any other non-null value still refuses. The next run rewrites the
-- three bundle prices to the component's (both DPP links are stale today,
-- so no reader saw 659.99 as a live price).
--
-- Fresh database: no affiliate_links exist when migrations replay, so this
-- NOTICEs and returns. A missing link id on a non-empty table is drift and
-- refuses — links are never hard-deleted (Retirement, not deletion).

do $$
declare
  n integer;
  filled integer := 0;
  corrected integer := 0;
  r record;
  cur record;
begin
  select count(*) into n from public.affiliate_links;
  if n = 0 then
    raise notice 'affiliate_links is empty (fresh database) — nothing to fill';
    return;
  end if;

  for r in
    select * from (values
      ('0f78961e-94b9-4a80-a2c5-6675035abb15'::uuid, '5166322', 'leupold-deltapoint-pro',                 '5540956'),
      ('bc46647d-8f94-449c-9a5d-6c5d4a551bd5'::uuid, '5166392', 'leupold-deltapoint-pro',                 '5540953'),
      ('8b65c4ec-56f0-4ca9-bd27-c897af029448'::uuid, '5853035', 'tyrant-cnc-takedown-lever',              '6282705'),
      ('dcbe7ec2-a886-400e-ba99-b5e40e72a3f1'::uuid, '6321968', 'amag-sig-sauer-p365-9mm-luger-10-round', null),
      ('3d198bad-f125-40e5-9a6e-64b667ea155d'::uuid, '6321967', 'amag-sig-sauer-p365-9mm-luger-12-round', null),
      ('17cc242b-91b8-4066-981d-1f7b2cd255d4'::uuid, '6321966', 'amag-sig-sauer-p365-9mm-luger-15-round', null)
    ) as v(link_id, mid, url_fragment, wrong_mid)
  loop
    select id, url, op_merchant_product_id, retired_at into cur
      from public.affiliate_links where id = r.link_id;
    if not found then
      raise exception 'link % not found — the table has rows, so this is drift, not a fresh database', r.link_id;
    end if;
    if cur.url not like '%' || r.url_fragment || '%' then
      raise exception 'link % points at %, not a %-page — refusing to pin it', r.link_id, cur.url, r.url_fragment;
    end if;
    if cur.retired_at is not null then
      raise exception 'link % is retired — a retired link does not get pinned', r.link_id;
    end if;
    if cur.op_merchant_product_id = r.mid then
      raise notice 'link % already carries mid % — skipping', r.link_id, r.mid;
      continue;
    end if;
    if cur.op_merchant_product_id is not null
       and cur.op_merchant_product_id is distinct from r.wrong_mid then
      raise exception 'link % carries mid %, which is neither the target % nor the known-wrong % — refusing', r.link_id, cur.op_merchant_product_id, r.mid, coalesce(r.wrong_mid, '(none)');
    end if;

    update public.affiliate_links
       set op_merchant_product_id = r.mid
     where id = r.link_id
       and (op_merchant_product_id is null or op_merchant_product_id = r.wrong_mid);
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'fill on link % touched % rows, expected 1', r.link_id, n;
    end if;
    if cur.op_merchant_product_id is null then
      filled := filled + 1;
    else
      corrected := corrected + 1;
      raise notice 'link %: bundle mid % corrected to the component''s %', r.link_id, cur.op_merchant_product_id, r.mid;
    end if;
  end loop;

  raise notice 'bundle-conflict mids: % filled, % corrected of 6', filled, corrected;
end $$;
