-- ============================================================
-- Gunforma-v2 — ROLLBACK for retired_at_2a.sql
--
-- Restores the exact prior state, verified 2026-09-23:
--   price_history_link_id_fkey        ON DELETE CASCADE
--   affiliate_links_variant_id_fkey   ON DELETE CASCADE
--   no retired_at columns, no partial indexes, no retire trigger
--
-- ⚠️ Reverting the FKs re-enables the destructive cascade: deleting a link
-- again destroys its price_history, and deleting a variant again reaches
-- history through its links.
--
-- The retired_at COLUMNS are deliberately left in place. Dropping them would
-- destroy retirement records, which is the exact failure this work exists to
-- prevent. Drop them by hand only if you are certain nothing has been retired:
--   select count(*) from affiliate_links  where retired_at is not null;
--   select count(*) from product_variants where retired_at is not null;
-- ============================================================

drop trigger if exists trg_retire_links_with_variant on public.product_variants;
drop function if exists public.retire_links_with_variant();

drop index if exists public.idx_affiliate_links_live;
drop index if exists public.idx_product_variants_live;

alter table public.price_history drop constraint price_history_link_id_fkey;
alter table public.price_history add  constraint price_history_link_id_fkey
  foreign key (link_id) references public.affiliate_links(id) on delete cascade;

alter table public.affiliate_links drop constraint affiliate_links_variant_id_fkey;
alter table public.affiliate_links add  constraint affiliate_links_variant_id_fkey
  foreign key (variant_id) references public.product_variants(id) on delete cascade;

-- columns intentionally NOT dropped — see the note above.
