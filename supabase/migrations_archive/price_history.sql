-- ============================================================
-- Gunforma-v2 — affiliate price history
-- Run in the Supabase SQL editor for project lagjjcpclvzrjlrswojt
--
-- scripts/refresh-affiliate-prices.mjs OVERWRITES
-- affiliate_links.street_price and .in_stock every night, so there is no
-- record of what a price was yesterday. This records one row per actual
-- CHANGE, giving later features (price-drop alerts, "lowest in 90 days",
-- price charts) something to read.
--
-- Everything below runs in ONE transaction. In particular the triggers are
-- created BEFORE the baseline seed, so there is no window in which an
-- affiliate_links write could slip through unrecorded.
-- ============================================================

begin;

-- ============================================================
-- TABLE
-- One row per change. bigint identity rather than uuid: append-only,
-- grows without bound, never addressed by URL.
-- old_* are NULL on a baseline row, meaning "no prior observation" —
-- which also keeps baselines out of the price-drop index below.
-- ============================================================
create table public.price_history (
  id           bigint generated always as identity primary key,
  link_id      uuid not null references public.affiliate_links(id) on delete cascade,
  old_price    numeric,
  new_price    numeric,
  old_in_stock boolean,
  new_in_stock boolean,
  changed_at   timestamptz not null default now()
);

comment on table public.price_history is
  'Append-only log of affiliate_links street_price / in_stock changes. Written only by the trigger below; no direct writers.';

-- ============================================================
-- INDEXES
-- ============================================================

-- "history for one link", newest first — a product-page price chart.
create index idx_price_history_link_time
  on public.price_history (link_id, changed_at desc);

-- "recent drops". Partial on purpose: only actual decreases are indexed, so
-- the index stays small and a "what dropped this week" query never scans
-- stock flips, price increases, or baseline rows.
create index idx_price_history_drops
  on public.price_history (changed_at desc)
  where old_price is not null and new_price is not null and new_price < old_price;

-- ============================================================
-- ACCESS — service role only, deliberately
--
-- This is a proprietary dataset and nothing reads it yet, so it is closed:
-- RLS on with NO policies (deny-all for anon and authenticated), plus an
-- explicit REVOKE.
--
-- The REVOKE is not redundant. Supabase's default ACL on the public schema
-- grants anon and authenticated ALL privileges on every new table — see
-- affiliate_links, which relies on RLS alone. Revoking means that if RLS were
-- ever disabled by accident the table would still not be readable.
--
-- The sync writes via the service role, which bypasses both.
--
-- WHEN A PRODUCT PAGE NEEDS A CHART: do not simply add a broad SELECT policy
-- here. Expose one link's history deliberately — either server-render it in
-- netlify/functions/product-page.mjs, or add a narrow SECURITY DEFINER RPC
-- that takes a single link_id and returns just that link's rows. Either keeps
-- the whole dataset from being enumerable over PostgREST.
-- ============================================================
alter table public.price_history enable row level security;

revoke all on public.price_history from anon, authenticated;

-- ============================================================
-- TRIGGER FUNCTION
--
-- security definer + search_path '' matches the house style (set_updated_at).
-- It matters here: with RLS on and no INSERT policy, a SECURITY INVOKER
-- trigger would fail for any non-service-role writer and take the whole
-- affiliate_links write down with it. Empty search_path means every name
-- below must be schema-qualified.
--
-- INSERT  -> baseline row (old_* NULL) as soon as a link exists.
-- UPDATE  -> only when street_price or in_stock actually moved.
--
-- `is distinct from`, not `<>`: NULL -> 200.00 is a real change and must be
-- recorded, and NULL -> NULL is not. `<>` returns NULL for both and would
-- silently skip every first-ever price.
--
-- This guard is load-bearing. The nightly sync always writes last_checked and
-- the four op_* columns, so every matched link gets an UPDATE every night —
-- roughly 466 of them — even when nothing about the price changed.
-- ============================================================
create or replace function public.record_price_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.price_history
      (link_id, old_price, new_price, old_in_stock, new_in_stock)
    values
      (new.id, null, new.street_price, null, new.in_stock);

  elsif new.street_price is distinct from old.street_price
     or new.in_stock    is distinct from old.in_stock then
    insert into public.price_history
      (link_id, old_price, new_price, old_in_stock, new_in_stock)
    values
      (old.id, old.street_price, new.street_price, old.in_stock, new.in_stock);
  end if;

  return null;   -- AFTER trigger: return value is ignored
end;
$$;

-- ============================================================
-- TRIGGERS — both AFTER, so only committed rows are recorded.
-- ============================================================
create trigger affiliate_links_price_history_ins
  after insert on public.affiliate_links
  for each row execute function public.record_price_change();

create trigger affiliate_links_price_history_upd
  after update on public.affiliate_links
  for each row execute function public.record_price_change();

-- ============================================================
-- BASELINE SEED — history starts today.
-- Inserts into price_history directly, so the AFTER INSERT trigger on
-- affiliate_links does not fire and nothing is double-counted.
-- ============================================================
insert into public.price_history
  (link_id, old_price, new_price, old_in_stock, new_in_stock)
select id, null, street_price, null, in_stock
from public.affiliate_links;

commit;
