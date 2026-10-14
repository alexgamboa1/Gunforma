-- ============================================================
-- Gunforma-v2 — sync_drift_review
-- Applied to project lagjjcpclvzrjlrswojt as migration sync_drift_review.
--
-- Queue of things the nightly affiliate sync REFUSED to write.
--
-- Why this exists
-- The sync used to set op_mpn / op_gtin / op_merchant_product_id from the feed
-- on every match, unconditionally. A stored identifier is what ties a link to
-- one specific product, so overwriting it on "drift" silently re-pointed the
-- link at a different product — and because T1/T2 match on the stored
-- identifier, the next run re-confirmed the new, wrong mapping forever. The
-- old code logged these as "drift warnings" and then wrote them anyway.
--
-- The rule now: the sync may FILL an identifier that is null, and must NEVER
-- overwrite one that is set. Contradictions land here instead.
--
-- kind:
--   identifier_drift  — feed disagrees with a stored identifier on one link
--   candidate_conflict— several feed rows resolved to the same link and
--                       disagree about which product it is
--
-- Both kinds mean NOTHING was written for that link on that run: not the
-- identifiers, and not the price or stock either, because a contradicted
-- identifier makes the whole match suspect.
--
-- Private, like price_history: RLS on, no policies, explicit revoke (Supabase's
-- default ACL grants anon/authenticated ALL privileges on new public tables).
-- ============================================================
create table if not exists public.sync_drift_review (
  id                bigint generated always as identity primary key,
  run_at            timestamptz not null,
  partner_id        uuid references public.partners(id) on delete set null,
  link_id           uuid not null,          -- deliberately NOT a FK: the row must
                                            -- outlive the link it complains about
  kind              text not null check (kind in ('identifier_drift','candidate_conflict')),
  field             text,
  stored_value      text,
  feed_value        text,
  feed_product_name text,
  matched_by        text,
  link_url          text,
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz not null default now()
);

comment on table public.sync_drift_review is
  'Things the nightly affiliate sync refused to write: a feed row contradicting a stored op_* identifier, or several feed rows claiming the same link. Nothing was written for these links on that run. Review, then either correct the link by hand or clear the stored identifier so the next run can refill it.';

create index if not exists idx_sync_drift_review_open
  on public.sync_drift_review (run_at desc)
  where resolved_at is null;

create index if not exists idx_sync_drift_review_link
  on public.sync_drift_review (link_id, run_at desc);

alter table public.sync_drift_review enable row level security;

revoke all on public.sync_drift_review from anon, authenticated;
