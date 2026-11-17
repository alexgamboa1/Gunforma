-- Three affiliate links pinned to OpticsPlanet DEMO-UNIT listings, one dead
-- Olight link, and nine Olight links the feed can identify but has never
-- matched (Alex, 2026-11-16 — the unrefreshed-links review).
--
-- 1) THE DEMO IDENTIFIERS. Three links' stored op_mpn carries OP's demo-unit
--    suffix (EDEMO / DEMO): the link once matched the demo listing, that
--    listing has left the feed, and the RETAIL row now contradicts the
--    stored identifier every night (identifier_drift in sync_drift_review,
--    withheld since each link's last_checked):
--
--      norsso-rail-p365-xl       527f0a48  op_mpn N365XLRAIL507KBLKEDEMO
--      radian-tru17-basepad…     de654f99  op_mpn H0023EDEMO
--      osight-x                  09c2a466  op_mpn OsightXDEMO
--
--    The house rule (CLAUDE.md, "The sync never overwrites an identifier"):
--    to re-point a link, clear the stored identifier and let the next run
--    refill it. op_merchant_product_id is cleared WITH op_mpn — it is the
--    demo unit's id too, and left in place it would block the refill the
--    same way the MPN did. op_gtin is null on all three (nothing to clear).
--
--    The URLs were checked per Alex's instruction and are NOT repointed:
--    all three already point at the plain retail product page — the
--    2026-11-16 run's drift rows show the retail feed rows matching these
--    very URLs (url_only / url+mpn) — so there is no demo-unit URL to move
--    off. Before/after: unchanged.
--
--    The Baldr Mini's GTIN drift (df8a289f, stored 6972378121172 vs feed
--    6972378121165) is deliberately NOT here: a genuine two-GTIN
--    disagreement that needs a human colour check first (Alex: leave held).
--
-- 1b) THE STALE MERCHANT IDS. Two more links are the same shape one column
--     over: the Romeo2 (592ac232) and the Osight SE (ea8612f4) store an
--     op_merchant_product_id that now belongs to OP's OPEN-BOX listing
--     (the 2026-11-17 dry run shows the open-box twin carrying exactly the
--     stored mid — 6351237 and 6395407 — while the retail rows ship
--     5163085 and 6262938). The new condition rule picks the retail row,
--     and the stale mid then blocks the write as identifier drift. Their
--     op_mpn and op_gtin match the retail rows and are KEPT; only the mid
--     is cleared, and the next run fills the retail row's.
--
-- 2) THE DEAD VALKYRIE LINK. olight-pl-3r-valkyrie's Olight-store link
--    (b97ba4a5) 301s to the store root — the page is gone, the product is
--    already discontinued, and the link last saw a price 2026-07-23.
--    Retirement, never deletion.
--
-- 3) THE OLIGHT GTIN FILLS. Nine live Olight-partner links have never
--    matched: Olight's feed rows carry no MPN and URLs that differ from
--    ours, so only a GTIN can pin them, and their variants carry no UPC.
--    FIVE are filled here — the sanctioned fill: the sync may fill a null
--    identifier, and a hand fill of a known identifier is how a link is
--    pinned from the first run. T2 (stored_op_gtin) matches on it the
--    night Olight's feed carries the row. Each value comes from the
--    OpticsPlanet link ON THE SAME VARIANT, whose op_gtin the feed itself
--    verified (a GTIN is global, not per-retailer); the Baldr Pro R
--    Black value also appears on today's Olight feed row (BALDRPRORBK,
--    2026-11-17 dry run).
--
--      c35eefe7  baldr-pro-r  FL-OL-BALDRPROR-BK  6972378124586
--      1c17a557  baldr-s      FL-OL-BALDRS-BK     6972378123169
--      707fe8d4  osight-s     OSIGHT-S-GN         6978095650087
--      f0b619b2  osight-s     OSIGHT-S-RD         6978095650025
--      7ee2ed9d  osight-se    OSIGHT-SE-RD-6      6978095650438
--
--    FOUR are deliberately not filled:
--      a6662701 (Baldr Pro R Tan), 1bb93113 (Osight SE MOS) and 9382d779
--      (Osight SE GN-MRS) have no GTIN evidence anywhere in house — no OP
--      sibling link carries one and Olight's pages expose none; and
--      15152ff2 sits on the SECOND live "Black" Baldr S variant (sku
--      6972378123169, beside FL-OL-BALDRS-BK) — a duplicate variant pair
--      flagged for the edit path; filling both with the one Black GTIN
--      would make the T2 index a coin toss between them.
--
-- Fresh database: no affiliate links exist when migrations replay, so this
-- NOTICEs and returns. A drifted row refuses the whole migration.

do $$
declare
  n integer;
  r record;
  cur_mpn  text;
  cur_mid  text;
  cur_gtin text;
begin
  select count(*) into n from public.affiliate_links;
  if n = 0 then
    raise notice 'affiliate_links is empty (fresh database) — nothing to do';
    return;
  end if;

  -- 1) demo identifier clears, refusing drift
  for r in
    select * from (values
      ('527f0a48-2532-4c50-88a6-a1ae7c3ce0b1'::uuid, 'N365XLRAIL507KBLKEDEMO', '6397553'),
      ('de654f99-4e78-439f-a297-3bb414c78dec'::uuid, 'H0023EDEMO',             '6489593'),
      ('09c2a466-247d-4f41-8fe8-c78805296f0c'::uuid, 'OsightXDEMO',            '6486258')
    ) as t(link_id, demo_mpn, demo_mid)
  loop
    select op_mpn, op_merchant_product_id into cur_mpn, cur_mid
      from public.affiliate_links where id = r.link_id;
    if not found then
      raise exception 'link % not found', r.link_id;
    end if;
    if cur_mpn is null and cur_mid is null then
      raise notice 'link %: identifiers already cleared — skipping', r.link_id;
      continue;
    end if;
    if cur_mpn is distinct from r.demo_mpn or cur_mid is distinct from r.demo_mid then
      raise exception 'link %: stored identifiers (%, %) are not the demo values this ruling was made about (%, %) — refusing',
        r.link_id, cur_mpn, cur_mid, r.demo_mpn, r.demo_mid;
    end if;
    update public.affiliate_links
       set op_mpn = null, op_merchant_product_id = null
     where id = r.link_id;
  end loop;

  -- 1b) stale merchant ids: clear the mid alone, keeping op_mpn/op_gtin
  for r in
    select * from (values
      ('592ac232-8430-4f27-a6ff-8a1c5a99f811'::uuid, '6351237'),
      ('ea8612f4-60e0-4a95-9711-609d053c3655'::uuid, '6395407')
    ) as t(link_id, stale_mid)
  loop
    select op_merchant_product_id into cur_mid
      from public.affiliate_links where id = r.link_id;
    if not found then
      raise exception 'link % not found', r.link_id;
    end if;
    if cur_mid is null then
      raise notice 'link %: merchant id already cleared — skipping', r.link_id;
      continue;
    end if;
    if cur_mid is distinct from r.stale_mid then
      raise exception 'link %: stored merchant id % is not the stale value this ruling was made about (%) — refusing',
        r.link_id, cur_mid, r.stale_mid;
    end if;
    update public.affiliate_links
       set op_merchant_product_id = null
     where id = r.link_id;
  end loop;

  -- 2) retire the dead Valkyrie link
  update public.affiliate_links
     set retired_at = now()
   where id = 'b97ba4a5-533a-46e4-84f7-529acb606289' and retired_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'valkyrie link already retired — skipping';
  end if;

  -- 3) olight op_gtin fills (each value feed-verified on the OP sibling
  --    link of the same variant), filling nulls only and refusing a
  --    different stored value
  for r in
    select * from (values
      ('c35eefe7-b059-4e85-ad0d-0e828f44068c'::uuid, '6972378124586'),
      ('1c17a557-c3e5-423a-943f-c49566a53cbb'::uuid, '6972378123169'),
      ('707fe8d4-30eb-411e-9f7a-e5ca2160e424'::uuid, '6978095650087'),
      ('f0b619b2-bb08-428c-9988-3396715c7b29'::uuid, '6978095650025'),
      ('7ee2ed9d-fafe-46b8-816e-0242a71d4f41'::uuid, '6978095650438')
    ) as t(link_id, gtin)
  loop
    select op_gtin into cur_gtin from public.affiliate_links where id = r.link_id;
    if not found then
      raise exception 'link % not found', r.link_id;
    end if;
    if cur_gtin = r.gtin then
      raise notice 'link %: op_gtin already % — skipping', r.link_id, r.gtin;
      continue;
    end if;
    if cur_gtin is not null then
      raise exception 'link %: op_gtin already holds a DIFFERENT value % (ruling was for %) — refusing',
        r.link_id, cur_gtin, r.gtin;
    end if;
    update public.affiliate_links set op_gtin = r.gtin where id = r.link_id;
  end loop;

end $$;
