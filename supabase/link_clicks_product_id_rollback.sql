-- ============================================================
-- Gunforma-v2 — rollback of link_clicks_product_id.sql
--
-- Restores the one-target shape: link_id NOT NULL, no product_id. The maker
-- clicks recorded in the meantime cannot live in that shape, so they are
-- ARCHIVED, not deleted — they are the count the whole change exists to
-- collect, and a rollback of the schema is not a decision to throw them out.
-- Same reasoning as affiliate_links_is_primary_archive.
-- ============================================================

create table if not exists public.link_clicks_product_archive as
  select id, product_id, ts, referrer_path, now() as archived_at
    from public.link_clicks
   where product_id is not null;

alter table public.link_clicks_product_archive add primary key (id);

-- Supabase's default ACL hands anon and authenticated full privileges on
-- every new public table. Revoke explicitly — same as price_history.
alter table public.link_clicks_product_archive enable row level security;
revoke all on public.link_clicks_product_archive from anon, authenticated;

delete from public.link_clicks where product_id is not null;

alter table public.link_clicks drop constraint if exists link_clicks_exactly_one_target;
drop index if exists public.idx_link_clicks_product_ts;
alter table public.link_clicks alter column link_id set not null;
alter table public.link_clicks drop column product_id;

comment on table public.link_clicks is
  'Outbound affiliate click log. Written by the /go/ edge function as '
  'service_role. RLS on, no policies, no grants — private by design, same as '
  'price_history. No personal data: link id, timestamp, and the on-site path '
  'the click came from.';
