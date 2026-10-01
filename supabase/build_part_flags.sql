-- ============================================================
-- Gunforma — accountability for build-part "contest" flags
-- Run in the Supabase SQL editor for project lagjjcpclvzrjlrswojt.
-- Rollback: supabase/build_part_flags_rollback.sql
--
-- WHY: contest_build_part let any signed-in user flip a part to 'contested'
-- with no record of WHO, no limit, and no dedupe — one account could flag
-- every part on every build in a loop and the admin queue could not tell one
-- person flagging forty things from forty people agreeing about one. This adds
-- a flags table (who + when, one row per user per part) and routes the RPC
-- through it. The RPC signature is unchanged, so no page or function changes.
-- ============================================================

begin;

-- 1. who flagged what — one row per (build, part, user) ------------------
create table public.build_part_flags (
  id          bigint generated always as identity primary key,
  build_id    uuid    not null references public.builds(id)   on delete cascade,
  part_index  integer not null,
  user_id     uuid    not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (build_id, part_index, user_id)   -- a person's second flag is a no-op
);

alter table public.build_part_flags enable row level security;

-- A signed-in user may record their OWN flag. No select policy, on purpose:
-- clients never read this table (the admin queue reads builds.edit_history);
-- admin and service_role read it by bypassing RLS. Deny-all reads is intended
-- and will not trip the rls_enabled_no_policy advisor because an insert policy
-- exists.
create policy build_part_flags_insert_own on public.build_part_flags
  for insert to authenticated
  with check (user_id = auth.uid());

-- 2. route the existing RPC through it -----------------------------------
-- Records the flag first (deduped, with the actor), THEN performs the exact
-- edit_history flip it did before. CREATE OR REPLACE keeps the function's
-- existing EXECUTE grant to authenticated.
create or replace function public.contest_build_part(p_build_id uuid, p_part_index integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target_idx int;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'must be signed in to flag';
  end if;

  insert into public.build_part_flags (build_id, part_index, user_id)
  values (p_build_id, p_part_index, uid)
  on conflict (build_id, part_index, user_id) do nothing;

  select (ord - 1) into target_idx
  from public.builds b, jsonb_array_elements(b.edit_history) with ordinality as e(elem, ord)
  where b.id = p_build_id
    and b.status = 'approved'
    and (e.elem ->> 'part_index')::int = p_part_index
  order by ord desc
  limit 1;

  if target_idx is null then
    return;
  end if;

  update public.builds
  set edit_history = jsonb_set(edit_history, array[target_idx::text, 'status'], '"contested"'::jsonb)
  where id = p_build_id and status = 'approved';
end;
$$;

commit;

-- Later, when you want it: "N distinct users flagged this part" is
--   select build_id, part_index, count(*) from public.build_part_flags
--   group by build_id, part_index order by count(*) desc;
-- and a threshold (require 2+ before showing 'contested') becomes a one-line
-- change in the function.
