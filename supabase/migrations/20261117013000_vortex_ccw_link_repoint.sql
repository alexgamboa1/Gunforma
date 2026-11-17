-- The Vortex Defender CCW Enclosed's one buy link pointed at the Defender
-- ST's OpticsPlanet listing (Alex, 2026-11-16: "a buy button must never
-- send a buyer to a different product" — verify and fix now).
--
-- The evidence, measured 2026-11-17:
--   • link 905d7e86 (product vortex-defender-ccw-enclosed, variant
--     DFCCW-MRD3-E) had url AND affiliate_url (the Awin deep link's ued=)
--     on /vortex-defender-st-enclosed-solar-micro-1x-prismatic-red-dot-
--     sight.html — the ST's page by its own slug;
--   • its stored op_mpn "DFSTMRD3E" is the ST's model number — Vortex's
--     own pages show DFST-MRD3* = Defender ST, DFCCW-MRD3-E = Defender
--     CCW — so op_gtin 00843829142854 and op_merchant_product_id 6252434,
--     filled by the feed from the same rows, are the ST's too;
--   • the nightly sync matched the ST's feed row onto it (T1 on the ST
--     MPN, last_checked 2026-11-17), so the CCW page showed the ST's
--     $319.99 as a fresh price.
--
-- The fix: repoint url and affiliate_url to OpticsPlanet's own Defender
-- CCW listing (their slug spells it "cww" — OP's typo, consistent across
-- their listing and six review URLs; confirmed live by the paced page
-- probe, JSON-LD sku DFCCW-MRD3-E), clear every sync-owned column — the
-- stored identifiers are the ST's, and the price/stock/last_checked are
-- the ST's numbers wearing a fresh date, which is exactly what the stale
-- guard's op_last_matched_by clause exists to catch. The row reads "Check
-- price" until the next run matches the CCW row by URL and fills the
-- CCW's own identifiers (the house rule: clear and let the sync refill,
-- never hand-type).
--
-- The ST's own link (94528982, the /v/-shape URL, never matched) is not
-- touched: it points at its own product, and the /v/ URL question is the
-- overnight probe's to answer.
--
-- Fresh database: no affiliate links exist when migrations replay, so
-- this NOTICEs and returns. A drifted row refuses.

do $$
declare
  n integer;
  cur record;
begin
  select count(*) into n from public.affiliate_links;
  if n = 0 then
    raise notice 'affiliate_links is empty (fresh database) — nothing to do';
    return;
  end if;

  select url, op_mpn into cur
    from public.affiliate_links
   where id = '905d7e86-488e-4606-bed2-8ca49a63be3b';
  if not found then
    raise exception 'vortex ccw link not found';
  end if;

  if cur.url = 'https://www.opticsplanet.com/vortex-defender-cww-enclosed-solar-micro-1x-prismatic-red-dot-sight.html' then
    raise notice 'vortex ccw link already repointed — skipping';
    return;
  end if;

  if cur.url is distinct from 'https://www.opticsplanet.com/vortex-defender-st-enclosed-solar-micro-1x-prismatic-red-dot-sight.html'
     or cur.op_mpn is distinct from 'DFSTMRD3E' then
    raise exception 'vortex ccw link does not hold the mis-pointed state this ruling was made about (url %, op_mpn %) — refusing',
      cur.url, cur.op_mpn;
  end if;

  update public.affiliate_links
     set url           = 'https://www.opticsplanet.com/vortex-defender-cww-enclosed-solar-micro-1x-prismatic-red-dot-sight.html',
         affiliate_url = 'https://www.awin1.com/cread.php?awinmid=46059&awinaffid=2959345&clickref=build-detail_vtx-def-ccw-enc-rd-mrs-bl&ued=https%3A%2F%2Fwww.opticsplanet.com%2Fvortex-defender-cww-enclosed-solar-micro-1x-prismatic-red-dot-sight.html',
         op_mpn = null, op_gtin = null, op_merchant_product_id = null,
         op_last_matched_by = null,
         street_price = null, in_stock = null, last_checked = null
   where id = '905d7e86-488e-4606-bed2-8ca49a63be3b';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'vortex ccw repoint touched % rows, expected 1', n;
  end if;
end $$;
