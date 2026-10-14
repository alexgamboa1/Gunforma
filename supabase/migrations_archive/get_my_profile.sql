-- ============================================================
-- Gunforma-v2 — get_my_profile()
-- Applied to project lagjjcpclvzrjlrswojt as migration get_my_profile_rpc.
--
-- Step 1 of audit finding #5. ADDITIVE ONLY — the profiles column grants are
-- NOT revoked here. That is a separate change, applied only once the six
-- rewritten pages are live on production.
--
-- WHY THIS EXISTS
-- Column privileges are not row-aware. Revoking SELECT on `role` from
-- `authenticated` stops a user reading their OWN role, not just other
-- people's — which breaks sign-in routing, both admin gates, onboarding, the
-- builder agreement and build submission. This gives each user a narrow,
-- row-scoped way back to their own hidden columns.
--
-- It takes no arguments and is hard-scoped to auth.uid(), so it cannot be
-- aimed at another user. SECURITY DEFINER so it keeps working after the
-- revoke; search_path pinned, per project convention.
-- ============================================================
create or replace function public.get_my_profile()
returns table (
  id                            uuid,
  username                      text,
  onboarding_complete           boolean,
  role                          text,
  marketing_consent             boolean,
  builder_agreement_accepted    boolean,
  builder_agreement_accepted_at timestamptz,
  builder_agreement_version     text
)
language sql
security definer
stable
set search_path = public
as $$
  select p.id,
         p.username,
         p.onboarding_complete,
         p.role,
         p.marketing_consent,
         p.builder_agreement_accepted,
         p.builder_agreement_accepted_at,
         p.builder_agreement_version
  from public.profiles p
  where p.id = auth.uid();
$$;

comment on function public.get_my_profile() is
  'Returns the calling user''s own profile row only, including columns not readable table-wide. Hard-scoped to auth.uid(); takes no arguments so it cannot be aimed at another user.';

-- Supabase grants EXECUTE to PUBLIC on new functions by default; strip that
-- and hand it only to signed-in users. anon gets nothing: auth.uid() would be
-- null and it would return zero rows anyway, but an explicit revoke keeps it
-- off the anon API surface entirely.
revoke execute on function public.get_my_profile() from public, anon;
grant  execute on function public.get_my_profile() to authenticated;

-- ============================================================
-- VERIFIED before the pages were switched over:
--   as authenticated (non-admin sub)  -> 1 row, their own id, role 'user'
--   as authenticated (admin sub)      -> 1 row, role 'admin'
--   as anon                           -> ERROR 42501 permission denied
-- ============================================================
