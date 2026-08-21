-- ============================================================
-- Gunforma-v2 — follow-up migrations applied after
-- profiles_builds_rls.sql, for reference/audit trail.
-- Both have already been applied to project lagjjcpclvzrjlrswojt.
-- ============================================================

-- ------------------------------------------------------------
-- Migration: lock_down_trigger_and_helper_function_execute_grants
-- Why: Supabase grants EXECUTE on new public-schema functions to
-- anon/authenticated by default, independent of `revoke ... from
-- public`. The security advisor flagged handle_new_user() and
-- prevent_role_self_escalation() as directly callable via
-- /rest/v1/rpc/... — they're trigger-only functions and should
-- never be invoked that way.
-- ------------------------------------------------------------
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_role_self_escalation() from public, anon, authenticated;

-- is_admin() must stay executable by `authenticated` because the builds
-- RLS policies call it during normal queries — but `anon` never hits a
-- policy branch that calls it, so that grant is dropped.
revoke execute on function public.is_admin() from anon;

-- ------------------------------------------------------------
-- Migration: add_builder_agreement_fields_to_profiles
-- Why: gunforma-signup.html added a Builder Agreement checkbox that
-- sends builder_agreement_accepted / builder_agreement_version as
-- signup metadata. Nothing was persisting it to profiles.
-- ------------------------------------------------------------
alter table public.profiles
  add column builder_agreement_accepted boolean not null default false,
  add column builder_agreement_version text,
  add column builder_agreement_signed_at timestamptz;

-- Copy the agreement fields from signup metadata, stamping signed_at with
-- the server's own clock (never a client-supplied timestamp).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted boolean := coalesce((new.raw_user_meta_data ->> 'builder_agreement_accepted')::boolean, false);
begin
  insert into public.profiles (
    id, username, marketing_consent,
    builder_agreement_accepted, builder_agreement_version, builder_agreement_signed_at
  )
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false),
    accepted,
    new.raw_user_meta_data ->> 'builder_agreement_version',
    case when accepted then now() else null end
  );
  return new;
end;
$$;

-- Extend the existing protected-column guard: agreement fields are a
-- consent record and must not be editable via a normal profile update,
-- same reasoning as role.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only admins can change role';
  end if;

  if (new.builder_agreement_accepted is distinct from old.builder_agreement_accepted
      or new.builder_agreement_version is distinct from old.builder_agreement_version
      or new.builder_agreement_signed_at is distinct from old.builder_agreement_signed_at)
     and not public.is_admin() then
    raise exception 'Builder agreement fields cannot be edited directly';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- NOT YET IMPLEMENTED: capturing the signer's IP address.
-- A plain Postgres trigger on auth.users has no access to the
-- original HTTP request. Doing this properly requires a Supabase
-- Auth Hook (or an Edge Function in front of signUp()) that reads
-- the request and writes it into raw_user_meta_data or profiles
-- directly. Flagging for a separate task if/when needed.
-- ------------------------------------------------------------
