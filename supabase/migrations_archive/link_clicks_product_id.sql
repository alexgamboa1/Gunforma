-- ============================================================
-- Gunforma-v2 — link_clicks.product_id: count clicks to a maker's store
-- APPLIED 2026-10-07. See the record at the bottom of this file.
-- Rollback: link_clicks_product_id_rollback.sql
--
-- ORDER MATTERS, the usual way round. Merge and deploy the code first
-- (netlify/edge-functions/go.js, the /go/part/<product id> shape), confirm
-- it is live, THEN run this. The function tolerates both shapes: before
-- this column exists a maker click redirects and the insert fails with
-- PGRST204 ("Could not find the 'product_id' column"), which the function
-- swallows exactly as it swallows every other logging failure — the reader
-- is never delayed and the click is simply not counted. Measured on the
-- deploy preview with x-go-debug: 1 before this file was written; the PR
-- records what it returned.
--
-- WHY
-- /go/<affiliate_link_id> logs a click as a link_clicks row, and link_id is
-- NOT NULL with an FK to affiliate_links. A part with no partner listing now
-- links to its own products.url through /go/part/<product id>, so there is
-- no affiliate_links row to point at and the click cannot be stored. Those
-- clicks are the whole point — counted clicks to a maker are what we take to
-- that maker when we ask for a partnership — so the table needs a second
-- target.
--
-- SHAPE
-- Two nullable FKs and a check that exactly one is set. Not a polymorphic
-- (target_type, target_id) pair: that loses the FK, and an FK is what stops
-- a typo'd id from being counted forever against nothing.
--
-- PRIVACY UNCHANGED. RLS on, no policies, no grants to anon or
-- authenticated — the edge function writes as service_role, same as before.
-- No new column carries anything about the reader: product id, timestamp,
-- on-site path. privacy-policy.html describes it in those words.
-- ============================================================

alter table public.link_clicks
  add column product_id uuid references public.products(id) on delete restrict;

-- A maker click has no link_id. NOT NULL was the right rule when there was
-- only one kind of click; the check below is the same rule for two kinds.
alter table public.link_clicks
  alter column link_id drop not null;

-- Exactly one target. (a is null) <> (b is null) is true only when one side
-- is null and the other is not — both set and neither set are both refused.
alter table public.link_clicks
  add constraint link_clicks_exactly_one_target
  check ((link_id is null) <> (product_id is null));

-- Same shape as idx_link_clicks_link_ts, for the same "clicks on this thing,
-- newest first" read.
create index idx_link_clicks_product_ts
  on public.link_clicks (product_id, ts desc);

comment on table public.link_clicks is
  'Outbound click log. Written by the /go/ edge function as service_role. '
  'One row per click, on exactly one target: link_id for /go/<affiliate link> '
  '(a partner listing), product_id for /go/part/<product> (the part''s own '
  'products.url — a maker''s or seller''s store, unpaid). RLS on, no policies, '
  'no grants — private by design, same as price_history. No personal data: '
  'target id, timestamp, and the on-site path the click came from.';

-- ── verify ──────────────────────────────────────────────────────────────
-- Still private: expect ZERO rows for anon / authenticated.
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'link_clicks'
--      and grantee in ('anon', 'authenticated');
--
-- The check holds, in a rolled-back transaction:
--   begin;
--     insert into public.link_clicks (link_id, product_id) values (null, null);        -- must fail
--     insert into public.link_clicks (link_id, product_id)
--       select al.id, p.id from public.affiliate_links al, public.products p limit 1;  -- must fail
--   rollback;
--
-- Then, from outside: a /go/part/<live product id> request with x-go-debug: 1
-- must answer x-go-insert-status: 201. That header is the fact; "applied"
-- is the claim.

-- ============================================================
-- APPLIED 2026-10-07 as migration link_clicks_product_id (20261007055811)
-- to project lagjjcpclvzrjlrswojt, from this file as merged in #149 — after
-- #149 was merged (909a9ee) and its deploy preview had answered
-- x-go-insert-status: 400 / PGRST204 on /go/part/, i.e. the code was live
-- and tolerating the column's absence. The house order, and this one
-- needed it (see ORDER MATTERS above).
--
-- Verified live, read back rather than assumed (information_schema,
-- pg_constraint, pg_indexes, pg_policy, role_table_grants):
--   link_clicks.product_id ........ uuid, nullable, FK -> products(id)
--                                   ON DELETE RESTRICT
--   link_clicks.link_id ........... now nullable
--   link_clicks_exactly_one_target  CHECK ((link_id IS NULL) <> (product_id IS NULL))
--   idx_link_clicks_product_ts .... btree (product_id, ts DESC)
--   grants to anon/authenticated .. none (0 rows)
--   policies ...................... none; RLS still on
--   first product click ........... 1 row, ts 2026-10-07 06:00:23 UTC —
--                                   the live /go/part/ path writing a row,
--                                   which is the fact the whole change is for
-- ============================================================
