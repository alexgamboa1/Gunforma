-- ============================================================
-- Gunforma-v2 — a build records WHICH pistol it is, not just the platform
-- NOT YET APPLIED. Rollback: builds_gun_id_rollback.sql
--
-- WHAT WAS MISSING
-- A build names its platform ("SIG P365") and nothing narrower. Which P365 —
-- the XL, the XMacro Comp, the FUSE — was something a builder could only say
-- by typing the factory slide in as a part. So they did, along with the
-- factory slide catch, takedown lever and trigger: four rows with no buy
-- link, on every build posted by someone thorough. And nothing that reads a
-- build could tell a 3.1" gun from a 4.3" one, which is the fact the fit of
-- every barrel and compensator turns on.
--
-- public.guns already holds the answer — one row per factory model, with its
-- slide length, barrel length, grip-module class and whether the comp is
-- built in. The parts catalog has filtered on it since the sub-model picker.
-- This gives a build a pointer into that table.
--
-- WHAT THIS ADDS
--   builds.gun_id            nullable uuid. NULL with fcu_only false means
--                            "not asked" (every build before this) or "not
--                            listed" (the builder's answer). Those two are
--                            not told apart; nothing needs them to be.
--   builds.fcu_only          boolean, default false. TRUE = the build
--                            started from a bare fire control unit: the
--                            serialised internals and nothing else, so there
--                            is no factory slide, barrel or grip module to
--                            assume. It is its own column and not a row in
--                            guns, because guns is "factory models" to every
--                            other reader — the catalog's model picker, the
--                            optic-cut table, platform_skus, the gun hubs —
--                            and a model with no slide length, no barrel and
--                            no grip class would have to be special-cased in
--                            each of them.
--   builds_fcu_xor_gun       a build is a factory model OR an FCU build,
--                            never both: fcu_only and a gun_id together are
--                            refused.
--   builds_gun_fkey          (gun_id, platform_id) -> guns (id, platform_id).
--                            COMPOSITE on purpose: a simple FK on gun_id
--                            would let a P320 model sit on a P365 build, and
--                            every reader would then have two answers to
--                            "which pistol". With this the pair cannot
--                            disagree. MATCH SIMPLE, so a NULL gun_id is not
--                            checked at all.
--   guns_id_platform_key     the unique key that FK needs to point at.
--   builds_gun_id_idx        partial, for "builds of this model".
--   column grants            INSERT and UPDATE on gun_id and fcu_only for
--                            authenticated. builds has COLUMN-level write
--                            grants, so a new column is not writable until it
--                            is named here — without this the form's save
--                            fails with "permission denied for table builds".
--   the live-build lock      restrict_owner_edits_on_approved_build() gains
--                            gun_id and fcu_only. Which gun it is, is "the
--                            gun itself" in the sense that function's message
--                            means, and a build's fit claims hang off it.
--
-- ON DELETE SET NULL (gun_id) — the column list matters. Without it a
-- composite FK's SET NULL nulls BOTH columns, and builds.platform_id is NOT
-- NULL, so deleting a guns row would fail on every build that used it
-- instead of quietly detaching them. (Postgres 15+; this project is 17.)
--
-- WHO MUST KEEP THE PAIR TOGETHER
-- Any writer that changes builds.platform_id on a row with a gun_id must
-- clear or replace gun_id in the same statement, or the FK refuses it. The
-- only such writer is the editor (gunforma-post-build.html), whose "Change
-- pistol" clears the model before anything is saved. The parked Armory and
-- relink_build_part() never touch platform_id.
--
-- ORDER. Additive, and the pages are written to work in both states, so this
-- follows the house order: MERGE AND DEPLOY THE CODE FIRST, then run this.
--   before it  js/gun-model.js probes for builds.gun_id and builds.fcu_only
--              in one request, finds nothing, and the two builder pages
--              behave exactly as they did: no model question, neither column
--              in any payload. The review queue's side read fails and is
--              swallowed.
--   after it   the question appears on the next page load and saves.
-- PostgREST picks the column and the new relationship up from the schema
-- reload Supabase issues on DDL. If the question does not appear within a
-- minute of running this, reload the schema cache by hand:
--   notify pgrst, 'reload schema';
--
-- DRY RUN, 2026-10-10. Everything between begin and commit below was run
-- against the live project inside a transaction that ended in a raised
-- exception, so nothing was kept — checked afterwards: neither column, no
-- new constraint, function body unchanged. Inside it:
--   the 7 existing builds                      all fcu_only false, gun_id null
--   a model of the build's own platform        accepted
--   a model of another platform                refused, foreign_key_violation
--   fcu_only true WITH a model                 refused, check_violation
--   fcu_only true, no model                    accepted
--   write grants, authenticated                INSERT, UPDATE on both columns
--   write grants, anon                         none on either
--   the lock function names both columns       true
--   foreign keys builds -> guns                1 (so `guns(...)` embeds are unambiguous)
-- NOT exercised: ON DELETE SET NULL (gun_id). In an earlier run of the same
-- file, deleting the guns row was refused first by platform_skus_gun_id_fkey,
-- which is unrelated to this file and means a guns row in use elsewhere
-- cannot be deleted at all today.
-- NOT exercised either: anything through PostgREST. A transaction cannot
-- show that the schema cache reloads or that the embed resolves; the pages
-- find that out on their first load after this runs.
--
-- NOT IN THIS FILE: setting gun_id on the builds that exist today. That is a
-- per-build judgement (which P365 is "All Black P365 1911 Build"?), so it is
-- done by hand after this, one UPDATE per build, by someone who has looked.
-- ============================================================

begin;

alter table public.guns
  add constraint guns_id_platform_key unique (id, platform_id);

alter table public.builds
  add column gun_id uuid,
  add column fcu_only boolean not null default false;

alter table public.builds
  add constraint builds_fcu_xor_gun check (not (fcu_only and gun_id is not null));

alter table public.builds
  add constraint builds_gun_fkey
  foreign key (gun_id, platform_id)
  references public.guns (id, platform_id)
  on delete set null (gun_id);

create index builds_gun_id_idx on public.builds (gun_id) where gun_id is not null;

grant insert (gun_id, fcu_only), update (gun_id, fcu_only) on public.builds to authenticated;

comment on column public.builds.gun_id is
  'Which factory model this build is (guns.id). NULL = not asked, not listed, or an FCU build (see fcu_only). Must belong to platform_id — builds_gun_fkey is composite.';
comment on column public.builds.fcu_only is
  'TRUE = built from a bare fire control unit: no factory slide, barrel or grip module to assume. Never true together with a gun_id (builds_fcu_xor_gun).';

-- The deployed body, read back with pg_get_functiondef on 2026-10-10, plus
-- two lines: gun_id and fcu_only. Nothing else is changed.
create or replace function public.restrict_owner_edits_on_approved_build()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare claims text; jwt_role text;
begin
  claims := current_setting('request.jwt.claims', true);
  -- NULL on a direct SQL connection, which already requires credentials
  -- nobody but the owner holds. This guard is for API callers.
  if claims is null then return new; end if;
  begin jwt_role := coalesce(claims::jsonb ->> 'role',''); exception when others then jwt_role := ''; end;

  if old.status = 'approved' and jwt_role <> 'service_role' and not public.is_admin() then
    if new.platform_id is distinct from old.platform_id
       or new.gun_id is distinct from old.gun_id
       or new.fcu_only is distinct from old.fcu_only
       or new.parts_snapshot is distinct from old.parts_snapshot
       or new.status is distinct from old.status
       or new.tier is distinct from old.tier
       or new.user_id is distinct from old.user_id
       or new.legal_confirmed is distinct from old.legal_confirmed
       or new.content_license_confirmed is distinct from old.content_license_confirmed
       or new.builder_agreement_version is distinct from old.builder_agreement_version
       or new.confirmed_at is distinct from old.confirmed_at
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.rejection_reason is distinct from old.rejection_reason
       or new.created_at is distinct from old.created_at
    then
      raise exception 'On a live build you can change the name, description and activity. To change the gun itself, delete this build and post the new one.';
    end if;
  end if;
  return new;
end; $function$;

commit;

-- ============================================================
-- AFTER RUNNING IT, CHECK — do not take "Success" as the record:
--
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='builds'
--      and column_name in ('gun_id','fcu_only') order by 1;
--   -- fcu_only, gun_id
--
--   select column_name, string_agg(privilege_type, ',' order by privilege_type)
--     from information_schema.column_privileges
--    where table_schema='public' and table_name='builds'
--      and column_name in ('gun_id','fcu_only') and grantee='authenticated'
--      and privilege_type in ('INSERT','UPDATE')
--    group by 1 order by 1;
--   -- fcu_only INSERT,UPDATE / gun_id INSERT,UPDATE
--   -- (anon must have neither INSERT nor UPDATE on either)
--
--   select d like '%new.gun_id is distinct from old.gun_id%'
--      and d like '%new.fcu_only is distinct from old.fcu_only%'
--     from (select pg_get_functiondef('public.restrict_owner_edits_on_approved_build()'::regprocedure) d) x;
--   -- t
--
-- Then record it here the way part_ids.sql does: the date, the migration
-- name and version from supabase_migrations.schema_migrations, and what the
-- three checks returned.
-- ============================================================
