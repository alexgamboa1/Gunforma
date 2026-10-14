-- ============================================================
-- Gunforma-v2 — profiles: revoke the hidden columns from authenticated
-- Audit finding #5, step 2 of 2.  Rollback: profiles_revoke_hidden_columns_rollback.sql
--
-- PREREQUISITE, already merged (PR #26): every self-scoped read of these
-- columns goes through get_my_profile(). Applying this before that change
-- would break sign-in routing, both admin gates, onboarding, the builder
-- agreement and build submission — because column privileges are NOT
-- row-aware, so revoking SELECT on `role` stops a user reading their OWN
-- role, not just other people's.
--
-- WHAT WAS EXPOSED
-- `authenticated` held a TABLE-level SELECT grant on profiles plus a
-- USING (true) policy, so any signed-up user could read every other user's
--   role                          -> a list of who the admins are
--   marketing_consent             -> personal data
--   builder_agreement_accepted    \
--   builder_agreement_accepted_at  > agreement status of every builder
--   builder_agreement_version     /
--
-- AFTER THIS
-- authenticated is limited to exactly the 8 columns anon already has. Own-row
-- access to the 5 hidden columns is via get_my_profile(), which is hard-scoped
-- to auth.uid().
--
-- NOT TOUCHED: the table-level UPDATE grant. The three flows that WRITE hidden
-- columns (complete-profile, claim, builder-agreement) keep working — none of
-- them chains .select(), so none needs read privilege back, and
-- trg_prevent_role_self_escalation still blocks self-promotion to admin.
-- anon's grants are not touched in either direction.
-- ============================================================

revoke select on public.profiles from authenticated;

grant select (
  id,
  username,
  bio,
  avatar_url,
  instagram_url,
  youtube_url,
  created_at,
  onboarding_complete
) on public.profiles to authenticated;

-- KNOWN CONSEQUENCE — read-modify-write on a hidden column now fails.
-- A statement like
--     update profiles set marketing_consent = not marketing_consent ...
-- reads the column to compute the new value, so it needs SELECT and is now
-- denied. Every current write passes a literal value and is unaffected:
--   complete-profile  marketing_consent = <checkbox>
--   claim             builder_agreement_* = literals
--   builder-agreement builder_agreement_accepted = true, version = literal
-- Anything added later that toggles a hidden column off its own value must
-- read it through get_my_profile() first.
--
-- ============================================================
-- VERIFICATION — run before and after; see the PR for recorded results.
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<user uuid>","role":"authenticated"}';
--     select count(*) from get_my_profile();            -- 1, both before and after
--     select role from profiles limit 1;                -- before: rows / after: DENIED
--     select marketing_consent from profiles limit 1;   -- before: rows / after: DENIED
--     select builder_agreement_accepted from profiles limit 1;  -- ditto
--     select id, username, bio, avatar_url from profiles limit 1;  -- works throughout
--   rollback;
--
--   -- the three hidden-column writes must still succeed (roll back after)
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<user uuid>","role":"authenticated"}';
--     update profiles set marketing_consent = marketing_consent where id = auth.uid();
--     update profiles set builder_agreement_accepted = builder_agreement_accepted where id = auth.uid();
--   rollback;
-- ============================================================
