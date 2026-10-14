-- ============================================================
-- Gunforma-v2 — security audit findings #4, #6, #7, #9
--
-- NOT YET APPLIED. Rollback: security_audit_4_6_7_9_rollback.sql
--
-- Finding #5 (profiles column exposure) is deliberately NOT here. A column
-- revoke on profiles breaks six self-scoped reads — sign-in, both admin
-- pages, onboarding, the builder agreement and build submission — because
-- column privileges are not row-aware: revoking SELECT on `role` stops a user
-- reading their OWN role, not just other people's. That needs a
-- get_my_profile() RPC and six page edits, so it gets its own PR.
--
-- Findings #2/#3 (the default INSERT/UPDATE/DELETE/TRUNCATE grants on all 53
-- tables) are also separate: bigger blast radius, and RLS currently blocks
-- the writes anyway.
-- ============================================================


-- ─── #4  partners: business columns readable by any signed-up user ──────────
-- commission_pct, notes and awin_merchant_id were readable by `authenticated`
-- via a table-level SELECT grant plus a USING (true) policy. `anon` was
-- already correctly limited to (id, name, slug) by column grants; this just
-- mirrors that for authenticated.
--
-- Safe with no code change: every browser and server read is the embed
-- `partners(name)` (js/affiliate.js, gunforma-build-detail.html,
-- netlify/functions/product-page.mjs). The only reader of awin_merchant_id is
-- scripts/refresh-affiliate-prices.mjs, which uses the service role and
-- bypasses grants entirely. Nothing reads commission_pct or notes at all.
--
-- `id` is granted because PostgREST needs it to resolve the
-- affiliate_links.partner_id -> partners.id embed.
revoke select on public.partners from authenticated;
grant  select (id, name, slug) on public.partners to authenticated;


-- ─── #6  trigger functions exposed as RPCs ──────────────────────────────────
-- Both are trigger functions that were never meant to be called directly, but
-- were reachable at /rest/v1/rpc/<name> as SECURITY DEFINER. Calling them
-- outside a trigger errors, so impact was low — but the project already has a
-- rule about this (migration lock_down_trigger_and_helper_function_execute_grants)
-- and these two slipped past it. record_price_change is from today's
-- price_history migration.
--
-- Revoking EXECUTE does NOT stop the triggers firing: trigger execution does
-- not check EXECUTE privilege on the trigger function.
revoke execute on function public.record_price_change()               from public, anon, authenticated;
revoke execute on function public.prevent_owner_edit_history_change() from public, anon, authenticated;


-- ─── #7  SECURITY DEFINER view ──────────────────────────────────────────────
-- v_slide_frame_fit runs with its creator's rights, bypassing RLS for whoever
-- queries it. Impact is low here — it reads only slide_specs, frame_specs and
-- housing_classes, all of which are public-read anyway — but the pattern is
-- wrong and the linter flags it as ERROR.
--
-- ALTER VIEW avoids recreating the body. Invoker mode reads identically: all
-- three source tables have USING (true) policies and anon SELECT grants.
-- Nothing in the codebase queries this view, or any other v_ view.
alter view public.v_slide_frame_fit set (security_invoker = true);


-- ─── #9  unpinned search_path ───────────────────────────────────────────────
-- The only function without a pinned search_path. It is SECURITY INVOKER, so
-- it runs with the caller's own rights and there is no privilege escalation —
-- this is hygiene, and clears the last linter warning in this family.
alter function public.set_part_class() set search_path = public;


-- ============================================================
-- VERIFICATION — run before and after, results must match except where noted.
--
--   -- as a signed-in non-admin
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<real non-admin user uuid>","role":"authenticated"}';
--
--   -- 1. partner names still resolve through the embed   EXPECT: unchanged
--   select al.id, p.name from affiliate_links al join partners p on p.id = al.partner_id limit 5;
--
--   -- 2. business column                                  EXPECT: before = rows, after = DENIED
--   select commission_pct from partners limit 1;
--
--   -- 3. view row count                                   EXPECT: identical
--   select count(*) from v_slide_frame_fit;
--
--   reset role;
--
--   -- 4. trigger function as RPC                          EXPECT: before = reachable, after = DENIED
--   --    (POST /rest/v1/rpc/record_price_change with the anon key)
--
--   -- 5. price_history trigger still fires                EXPECT: +1 row, then ROLLBACK
--   begin;
--     select count(*) from price_history;
--     update affiliate_links set street_price = street_price + 0.01
--      where id = '<some link id>';
--     select count(*) from price_history;   -- must be +1
--   rollback;
-- ============================================================
