-- ============================================================
-- Gunforma-v2 — prevent_role_self_escalation is a no-op; identify the CALLER
-- NOT YET APPLIED. Rollback: fix_prevent_role_self_escalation_rollback.sql
--
-- THE BUG
-- The guard opened with:
--     if current_user in ('postgres', 'service_role') then return new; end if;
-- The function is SECURITY DEFINER and owned by postgres. Inside a
-- SECURITY DEFINER function `current_user` is the function OWNER, not the
-- caller — so that test was ALWAYS true, the function returned immediately,
-- and neither check below it ever ran.
--
-- Proven, not inferred. As a simulated non-admin
-- (set local role authenticated + a real sub in request.jwt.claims):
--     update profiles set role = 'admin' where id = auth.uid();   -- SUCCEEDED
-- while at the call site current_user = 'authenticated' and is_admin() = false,
-- so the early return is the only path that explains it.
--
-- IMPACT
-- `authenticated` holds a table-level UPDATE on profiles and the RLS policy
-- permits its own row, so any signed-in user could make themselves an admin
-- and then pass both admin page gates and every is_admin() RLS policy. The
-- same early return also disabled the builder-agreement tampering check in
-- this function.
--
-- THE FIX
-- Identify the caller from the request JWT, which is what PostgREST sets per
-- request and what a SECURITY DEFINER context does not disturb:
--     current_setting('request.jwt.claims', true)::jsonb ->> 'role'
--
--   service_role   -> allowed (edge functions, the nightly sync, scripts)
--   no claims at all -> allowed (migrations, psql, the SQL editor: there is no
--                     PostgREST request context, and anyone with direct DB
--                     credentials is already past every guard)
--   anyone else    -> the checks actually run
--
-- Only this function used `current_user` to identify the caller. Every other
-- SECURITY DEFINER function in public was checked: is_admin(), stamp_build_review()
-- and get_my_profile() use auth.uid(), which is correct; the rest reference
-- neither. prevent_build_consent_tampering() on builds is NOT affected — it has
-- no bypass and goes straight to its is_admin() check.
--
-- ON THE CONSENT CHECK
-- Restoring it verbatim would break two live pages. builder-agreement.html and
-- gunforma-claim.html write builder_agreement_* directly as an ordinary user,
-- which only works today because the guard is dead. The trigger's message
-- ("can only be set via a build submission") describes the cascade path:
-- trg_cascade_builder_agreement fires on build INSERT, sets
-- app.bypass_consent_guard, writes the fields, and clears it.
--
-- So the consent rule is widened by exactly one case: a user may make the
-- first, forward-only acceptance on their OWN row (false -> true). Un-accepting,
-- backdating, or rewriting the version after the fact stays blocked, as does
-- touching anyone else's row. That keeps both pages working while restoring a
-- guard that currently does nothing at all.
-- ============================================================

create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  jwt_role text;
begin
  -- The CALLER's role, from the request JWT. Do NOT use current_user here:
  -- in a SECURITY DEFINER function it is the owner, which is what broke this.
  jwt_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );

  -- Trusted: the service role, and direct SQL with no request context.
  if jwt_role = 'service_role' or jwt_role = '' then
    return new;
  end if;

  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only admins can change role';
  end if;

  if (new.builder_agreement_accepted    is distinct from old.builder_agreement_accepted
      or new.builder_agreement_version     is distinct from old.builder_agreement_version
      or new.builder_agreement_accepted_at is distinct from old.builder_agreement_accepted_at)
     and not public.is_admin()
     and coalesce(current_setting('app.bypass_consent_guard', true), 'false') <> 'true'
     -- first, forward-only acceptance of your own agreement
     and not (new.id = auth.uid()
              and old.builder_agreement_accepted = false
              and new.builder_agreement_accepted = true)
  then
    raise exception 'Builder agreement fields can only be set by accepting the agreement or submitting a build';
  end if;

  return new;
end;
$function$;

-- ============================================================
-- APPLIED 2026-09-22 as migration fix_prevent_role_self_escalation.
-- Re-verified against the APPLIED function (writes rolled back, function live):
--
--                                          before (live)   after this change
--   non-admin sets own role=admin          SUCCEEDED       BLOCKED
--   admin promotes another user            SUCCEEDED       SUCCEEDED
--   ordinary profile update                SUCCEEDED       SUCCEEDED
--   builder-agreement.html acceptance      SUCCEEDED       SUCCEEDED
--   claim.html acceptance bundle           SUCCEEDED       SUCCEEDED
--   un-accepting your agreement            SUCCEEDED       BLOCKED
--   rewriting version after acceptance     SUCCEEDED       BLOCKED
--   service_role changes a role            SUCCEEDED       SUCCEEDED
--   direct SQL (no JWT) changes a role     SUCCEEDED       SUCCEEDED
--
-- One result needs reading carefully: a non-admin updating ANOTHER user's
-- role returns no error, because the RLS policy (auth.uid() = id) matches
-- zero rows and the trigger is never reached. Measured: rows affected = 0 and
-- the target's role is unchanged. Safe, but it does not raise — so an error
-- is not the signal to test for there; the row count is.
-- ============================================================
