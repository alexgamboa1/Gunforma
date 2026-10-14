-- ============================================================
-- Gunforma-v2 — retired_at, step 2a: schema + the sync's own filter
-- NOT YET APPLIED. Rollback: retired_at_2a_rollback.sql
--
-- WHY
-- affiliate_links and product_variants must never be hard-deleted. Today
-- deleting a link CASCADEs its price_history away, and deleting a variant
-- CASCADEs to its links and then to their history — two hops, silently. Every
-- one of the 493 links currently has history, so any hard delete destroys a
-- record. A deleted row also leaves nothing behind to audit: that is exactly
-- why "were the 6 missing variants duplicates or real products?" could not be
-- answered.
--
-- Retire instead: keep the row, keep its history, hide it from readers.
--
-- 2a is schema + the sync. It changes NOTHING a visitor sees — no reader is
-- filtered yet, and retired_at is null on every existing row. The 13 reader
-- call sites are 2b, deliberately separate: PostgREST embed filters fail OPEN
-- (a wrong filter shows retired listings while looking correct), so they need
-- verifying against real data one at a time.
-- ============================================================

-- ─── the columns ────────────────────────────────────────────────────────────
alter table public.affiliate_links  add column if not exists retired_at timestamptz;
alter table public.product_variants add column if not exists retired_at timestamptz;

comment on column public.affiliate_links.retired_at is
  'When this listing stopped being offered. Retired links keep their price_history, are skipped by the nightly sync, and are hidden from buy rows. Never hard-delete a link.';
comment on column public.product_variants.retired_at is
  'When this variant stopped being sold. Retiring a variant auto-retires its affiliate_links via trg_retire_links_with_variant.';

-- ─── stop deletion destroying history, on BOTH hops ─────────────────────────
-- RESTRICT on price_history alone is not enough: a variant delete would still
-- reach history through affiliate_links. Both edges have to refuse.
alter table public.price_history drop constraint price_history_link_id_fkey;
alter table public.price_history add  constraint price_history_link_id_fkey
  foreign key (link_id) references public.affiliate_links(id) on delete restrict;

alter table public.affiliate_links drop constraint affiliate_links_variant_id_fkey;
alter table public.affiliate_links add  constraint affiliate_links_variant_id_fkey
  foreign key (variant_id) references public.product_variants(id) on delete restrict;

-- variant_images keeps CASCADE on purpose: images are derived, not a record.

-- ─── partial indexes for the "live rows only" reads 2b will add ─────────────
create index if not exists idx_affiliate_links_live
  on public.affiliate_links (variant_id) where retired_at is null;
create index if not exists idx_product_variants_live
  on public.product_variants (product_id) where retired_at is null;

-- ─── retiring a variant retires its links ───────────────────────────────────
-- Otherwise a retired variant's links keep matching nightly and keep appearing
-- in buy rows.
--
-- THE RULE: this only ever SETS retired_at. It never clears it. Un-retiring is
-- deliberate and manual, on each row — a variant coming back does not silently
-- revive listings that may have been retired for their own reasons.
--
-- SECURITY DEFINER so it works whatever grants the caller holds, search_path
-- pinned per project convention. It identifies no caller, so the current_user
-- trap that disabled prevent_role_self_escalation does not apply here.
create or replace function public.retire_links_with_variant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Only act on a transition INTO retired. Clearing retired_at does nothing.
  if new.retired_at is not null and old.retired_at is null then
    update public.affiliate_links
       set retired_at = new.retired_at
     where variant_id = new.id
       and retired_at is null;   -- never overwrite an earlier retirement date
  end if;
  return null;
end;
$function$;

comment on function public.retire_links_with_variant() is
  'Retires a variant''s affiliate_links when the variant is retired. Only ever sets retired_at; never clears it.';

drop trigger if exists trg_retire_links_with_variant on public.product_variants;
create trigger trg_retire_links_with_variant
  after update of retired_at on public.product_variants
  for each row execute function public.retire_links_with_variant();

revoke execute on function public.retire_links_with_variant() from public, anon, authenticated;
