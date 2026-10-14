-- create_variant_backend_callable.sql
-- Applied 2026-10-02 as migrations 004 + 004b. Recorded here because
-- supabase/*.sql is this repo's record of what the database actually is.
--
-- WHY. create_variant() shipped in 003 and nothing ever called it. The guard
-- was is_admin(), which reads auth.uid(); auth.uid() is NULL for the
-- service_role key and for a direct psql session, so the function was
-- unreachable from any script. Every real load therefore went around it, via
-- the variant_insert_import staging table plus hand-written INSERTs -- which
-- is the exact "adding a colour variant is complicated" problem 003 existed
-- to solve. Widening the guard is what makes the validating path usable.
--
-- THE current_user TRAP. create_variant is SECURITY DEFINER, so current_user
-- inside it is the OWNER (postgres), not the caller. A guard written as
-- `current_user in ('service_role', ...)` is therefore true for every caller,
-- anon included, and silently removes itself. session_user is not rewritten
-- by SECURITY DEFINER, and request.jwt.claims is request-scoped; both are
-- safe. Never use current_user in a guard inside a SECURITY DEFINER function.

create or replace function public.is_trusted_backend()
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    -- A PostgREST request. Decide ONLY on the role claim, so anon and
    -- authenticated can never reach the superuser branch below. PostgREST
    -- always sets request.jwt.claims, even for anon, which is what makes
    -- that branch structurally unreachable from HTTP rather than merely
    -- unreachable given today's role wiring.
    when nullif(current_setting('request.jwt.claims', true), '') is not null
      then (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
    -- No request context: a direct database session (psql, the SQL editor,
    -- the MCP connection), superuser-ish by definition.
    else session_user in ('postgres', 'supabase_admin')
  end;
$$;

comment on function public.is_trusted_backend is
  'True for the service_role key, or a direct superuser database session. A PostgREST request is judged solely by its JWT role claim, so anon/authenticated can never reach the superuser branch. Never use current_user here: SECURITY DEFINER rewrites it to the owner.';

revoke all on function public.is_trusted_backend() from public, anon;
grant execute on function public.is_trusted_backend() to authenticated, service_role;

-- The only change to create_variant itself is this guard; the body is
-- otherwise exactly what 003 left in place:
--
--   -  if not public.is_admin() then
--   -    raise exception 'create_variant: admin only' using errcode = '42501';
--   +  if not (public.is_admin() or public.is_trusted_backend()) then
--   +    raise exception 'create_variant: admin or service_role only' using errcode = '42501';
--
-- Verified in a rolled-back transaction: anon refused, authenticated
-- refused, service_role succeeds and writes the variant + image rows with
-- the slug, label and one-default-per-product rules intact, and an unknown
-- colour is still rejected.

-- ---------------------------------------------------------------------------
-- STILL TO DO BY HAND (DROPs are not run through the MCP connection: it holds
-- them awaiting a confirmation that never arrives, then times out at 180s).
-- Run in the Supabase dashboard SQL editor once you are happy:
--
--   drop table if exists public.variant_insert_import;
--   drop table if exists public.variant_image_import;
--
-- Both were empty (0 rows) as of 2026-10-02 and nothing references them.
-- They are the staging detour that scripts/add-variants.mjs replaces.
--
-- public._archive_products_specs (81 rows) is the migration 001 safety net.
-- Leave it until you are certain nothing needs the retired products.specs
-- jsonb back.
-- ---------------------------------------------------------------------------
