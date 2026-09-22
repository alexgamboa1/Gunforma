-- ============================================================
-- Gunforma-v2 — ROLLBACK for fix_prevent_role_self_escalation.sql
--
-- ⚠️ THIS RESTORES A KNOWN-VULNERABLE FUNCTION.
-- The definition below is the exact text captured from pg_get_functiondef()
-- before the fix. It is a no-op: `current_user` inside a SECURITY DEFINER
-- function is the owner (postgres), so the first test always passes and
-- neither check runs. Restoring it re-opens privilege escalation — any
-- signed-in user can set their own role to 'admin'.
--
-- Only use this if the fix breaks something worse, and treat it as temporary.
-- The trigger (trg_prevent_role_self_escalation) is not touched by either
-- file, so no trigger needs recreating.
-- ============================================================

create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

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
$function$;
