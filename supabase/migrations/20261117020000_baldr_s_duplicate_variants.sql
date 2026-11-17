-- The Olight Baldr S carried its two real colorways TWICE each (Alex,
-- 2026-11-16 — approved after the duplicate-variant review):
--
--   keep   FL-OL-BALDRS-BK  "Black"       the green-laser Black (default; its
--                                         photo verified showing the GREEN
--                                         beam before this was written)
--   retire 6972378123169    "Black"       the same green-laser Black again —
--                                         that sku IS the green Black's GTIN
--                                         (multiple retailers) — wearing the
--                                         photo of the Baldr S BL, Olight's
--                                         BLUE-laser model, which is not in
--                                         the catalog at all
--   keep   6972378123176    "Tan"         the green-laser Desert Tan (its sku
--                                         is that colorway's GTIN); relabelled
--                                         "Desert Tan", Olight's own name
--   retire BALDRS           "FDE"         the same Desert Tan under
--                                         OpticsPlanet's parent sku
--
-- Retirement, never deletion: trg_retire_links_with_variant retires each
-- retired variant's links with it (asserted below rather than assumed —
-- the links are 15152ff2, Olight, never matched; and b36b0e1c, OP, stale
-- since 2026-07-23). No build, Armory build or Gunforma guide references
-- either retired variant (checked 2026-11-17: zero rows).
--
-- The relabel touches variant_label only (variantLabel() returns a stored
-- label verbatim); color stays 'Tan' — it feeds the swatch vocabulary and
-- variant_identity, and 'Desert Tan' is not a colors row.
--
-- The Baldr S BL (blue laser, GTIN 6972378125552) is deliberately NOT
-- added (Alex: skip it).
--
-- Fresh database: no variants exist when migrations replay, so this
-- NOTICEs and returns. A drifted row refuses.

do $$
declare
  n integer;
  r record;
  cur record;
begin
  select count(*) into n from public.product_variants;
  if n = 0 then
    raise notice 'product_variants is empty (fresh database) — nothing to do';
    return;
  end if;

  -- retire the two duplicates, refusing drift
  for r in
    select * from (values
      ('c7f4d99f-9fa4-5c73-9cd4-fe8b666ce667'::uuid, '6972378123169', 'Black'),
      ('dd75cced-bf06-5103-9c2c-5992e4042ed3'::uuid, 'BALDRS',        'FDE')
    ) as t(variant_id, want_sku, want_label)
  loop
    select v.sku, v.variant_label, v.is_default, v.retired_at into cur
      from public.product_variants v where v.id = r.variant_id;
    if not found then
      raise exception 'variant % not found', r.variant_id;
    end if;
    if cur.retired_at is not null then
      raise notice 'variant % already retired — skipping', r.variant_id;
      continue;
    end if;
    if cur.sku is distinct from r.want_sku or cur.variant_label is distinct from r.want_label then
      raise exception 'variant % is not the row this ruling was made about (sku %, label %) — refusing',
        r.variant_id, cur.sku, cur.variant_label;
    end if;
    if cur.is_default then
      raise exception 'variant % is the default variant — refusing to retire it', r.variant_id;
    end if;
    update public.product_variants set retired_at = now() where id = r.variant_id;
  end loop;

  -- the retire trigger's work is a claim until read back: both variants''
  -- live links must now be retired
  select count(*) into n
    from public.affiliate_links al
   where al.variant_id in ('c7f4d99f-9fa4-5c73-9cd4-fe8b666ce667',
                           'dd75cced-bf06-5103-9c2c-5992e4042ed3')
     and al.retired_at is null;
  if n > 0 then
    raise exception 'retire trigger left % live link(s) on the retired variants', n;
  end if;

  -- relabel the kept Desert Tan
  select v.variant_label into cur from public.product_variants v
   where v.id = '98e38fc7-cf0e-5c20-86e2-197885163cf4';
  if not found then
    raise exception 'desert tan variant not found';
  end if;
  if cur.variant_label = 'Desert Tan' then
    raise notice 'desert tan already relabelled — skipping';
  elsif cur.variant_label is distinct from 'Tan' then
    raise exception 'desert tan variant label is "%" not "Tan" — refusing', cur.variant_label;
  else
    update public.product_variants
       set variant_label = 'Desert Tan'
     where id = '98e38fc7-cf0e-5c20-86e2-197885163cf4';
  end if;
end $$;
