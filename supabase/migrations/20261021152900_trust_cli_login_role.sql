-- is_trusted_backend(): admit the Supabase CLI's login role.
--
-- `supabase db push` (CLI 2.115+) prints "Initialising login role..." and
-- runs each migration as session_user `cli_login_postgres` — a login role
-- the CLI creates, a member of `postgres`, neither superuser nor BYPASSRLS.
-- The direct-session branch below tested session_user against `postgres`
-- and `supabase_admin` only, so every guard that admits "a direct session"
-- (prevent_owner_edit_history_change, restrict_owner_edits_on_approved_build,
-- restrict_build_status_to_reviewers, notify_build_changes) refused the CLI:
-- on 2026-10-21 the push of 20261021152936 stopped at the first write to
-- builds.edit_history with `42501 Only admins can modify edit_history`, and
-- rolled back whole. The MCP dry run had passed, because that connection is
-- session_user `postgres`.
--
-- This file changes ONE thing: 'cli_login_postgres' joins the session_user
-- list. The claims branch, the comments and everything else are the live
-- definition byte for byte (pg_get_functiondef, 2026-10-21). It is numbered
-- before 20261021152936 on purpose so that `db push` applies it first.
--
-- What it does not widen: a PostgREST request still decides on its role
-- claim alone (anon and authenticated stay untrusted; service_role stays
-- trusted), and a direct session as any other role stays untrusted. The
-- PR's rolled-back run shows those three; session_user cannot be set with
-- SET ROLE, so the CLI role itself is proven by the real push.

CREATE OR REPLACE FUNCTION public.is_trusted_backend()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    -- A PostgREST request. Decide only on the role claim.
    when nullif(current_setting('request.jwt.claims', true), '') is not null
      then (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
    -- No request context: a direct database session (psql, the SQL editor,
    -- the MCP connection), which is superuser-ish by definition.
    -- session_user, NOT current_user: SECURITY DEFINER rewrites current_user
    -- to the function owner and would make this true for every caller.
    -- cli_login_postgres is the role `supabase db push` connects as (CLI
    -- 2.115+); without it every migration that writes builds is refused.
    else session_user in ('postgres', 'supabase_admin', 'cli_login_postgres')
  end;
$function$
