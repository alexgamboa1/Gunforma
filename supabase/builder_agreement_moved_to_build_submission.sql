-- ============================================================
-- Gunforma-v2 — Builder Agreement consent moved from signup to
-- build submission, to match the updated gunforma-post-build-v6.html
-- (checkbox + consentRecord tied to an actual build/photo, not a
-- hypothetical signup-time checkbox).
--
-- Both migrations below have already been applied to project
-- lagjjcpclvzrjlrswojt. Saved here for reference/audit trail.
-- ============================================================

-- ------------------------------------------------------------
-- Migration: move_builder_agreement_consent_to_build_submission
-- ------------------------------------------------------------

-- PROFILES: rename to match the naming used in the new frontend
-- comment, and simplify handle_new_user() since signup no longer
-- sends builder agreement metadata at all (it naturally lands on
-- the column defaults: accepted=false, version/accepted_at=null).
alter table public.profiles
  rename column builder_agreement_signed_at to builder_agreement_accepted_at;

alter table public.profiles
  add constraint builder_agreement_version_not_blank
  check (builder_agreement_version is null or length(builder_agreement_version) > 0);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, marketing_consent)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false)
  );
  return new;
end;
$$;

-- PROFILES GUARD: builder_agreement_* fields can now ONLY be set by
-- the trusted cascade trigger below (via a transaction-local flag
-- the client can never set through PostgREST), or by an admin
-- correcting a record. A direct client update — even a
-- well-intentioned false->true — is rejected, so acceptance is
-- always tied to a real build submission, never a bare profile edit.
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
      or new.builder_agreement_accepted_at is distinct from old.builder_agreement_accepted_at)
     and not public.is_admin()
     and coalesce(current_setting('app.bypass_consent_guard', true), 'false') <> 'true'
  then
    raise exception 'Builder agreement fields can only be set via a build submission';
  end if;

  return new;
end;
$$;

-- BUILDS: per-submission consent record, matching the consentRecord
-- object gunforma-post-build-v6.html builds today
-- (contentLicenseConfirmed, legalConfirmed, confirmedAt).
alter table public.builds
  add column content_license_confirmed boolean not null default false,
  add column legal_confirmed boolean not null default false,
  add column confirmed_at timestamptz,
  add column builder_agreement_version text;

alter table public.builds
  add constraint builds_consent_required_unless_draft
  check (status = 'draft' or (content_license_confirmed and legal_confirmed));

alter table public.builds
  add constraint builds_builder_agreement_version_not_blank
  check (builder_agreement_version is null or length(builder_agreement_version) > 0);

-- Stamp confirmed_at with the server's own clock — never trust the
-- client's `confirmedAt` value (the frontend TODO explicitly calls
-- this out).
create or replace function public.stamp_build_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.content_license_confirmed or new.legal_confirmed then
    new.confirmed_at := now();
  else
    new.confirmed_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_stamp_build_consent
before insert on public.builds
for each row execute function public.stamp_build_consent();

-- Once a build's consent record is written at insert, it's evidence
-- of what the builder confirmed at that moment — block edits to it
-- afterward (own-build edit flow otherwise allows changing any
-- column while status is draft/pending).
create or replace function public.prevent_build_consent_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.content_license_confirmed is distinct from old.content_license_confirmed
      or new.legal_confirmed is distinct from old.legal_confirmed
      or new.confirmed_at is distinct from old.confirmed_at
      or new.builder_agreement_version is distinct from old.builder_agreement_version)
     and not public.is_admin()
  then
    raise exception 'Consent fields cannot be edited after submission';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_build_consent_tampering
before update on public.builds
for each row execute function public.prevent_build_consent_tampering();

-- The actual cascade: a build whose content_license_confirmed is true
-- is, per the frontend's own logic, the builder's Builder Agreement
-- acceptance IF they haven't already accepted it. This only ever
-- flips profiles.builder_agreement_accepted false -> true, once — if
-- it's already true, this update matches zero rows and does nothing
-- (exactly the "don't re-stamp the profile" requirement).
create or replace function public.cascade_builder_agreement_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.content_license_confirmed then
    perform set_config('app.bypass_consent_guard', 'true', true);
    update public.profiles
    set builder_agreement_accepted = true,
        builder_agreement_version = new.builder_agreement_version,
        builder_agreement_accepted_at = new.confirmed_at
    where id = new.user_id
      and builder_agreement_accepted = false;
    perform set_config('app.bypass_consent_guard', 'false', true);
  end if;
  return new;
end;
$$;

create trigger trg_cascade_builder_agreement
after insert on public.builds
for each row execute function public.cascade_builder_agreement_to_profile();

-- ------------------------------------------------------------
-- Migration: lock_down_new_build_consent_trigger_grants
-- Why: same reason as the earlier lockdown migration — Supabase
-- grants EXECUTE on new public-schema functions to anon/authenticated
-- by default. These are trigger-only and should never be callable
-- directly via /rest/v1/rpc/....
-- ------------------------------------------------------------
revoke execute on function public.stamp_build_consent() from public, anon, authenticated;
revoke execute on function public.prevent_build_consent_tampering() from public, anon, authenticated;
revoke execute on function public.cascade_builder_agreement_to_profile() from public, anon, authenticated;
