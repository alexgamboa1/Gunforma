-- ============================================================
-- Gunforma-v2 — every build part has its own id, and corrections use it
-- NOT YET APPLIED. Rollback: part_ids_rollback.sql
--
-- WHAT WAS WRONG
-- A reviewer's correction in builds.edit_history named its part by POSITION
-- (part_index) in parts_snapshot. Remove an earlier part and the list shifts
-- under it: the build page lays "name corrected to X" over a different part,
-- contest_build_part flags the wrong one, and relink_build_part checks the
-- wrong one for corrections. No error anywhere. The editor stopped that by
-- PINNING every part up to the last corrected one, which meant a build that
-- was corrected and then rejected for a wrong part could not have that part
-- removed by its owner — delete and re-post was the only way out.
--
-- THE FIX
-- Every element of parts_snapshot carries `partId`: 12 lowercase hex
-- characters, unique within its build, assigned once and never changed. A
-- correction carries `part_id` beside `part_index`, and readers match by
-- part_id when there is one — js/part-ids.js on the pages, and the two
-- functions below in the database. A removed part takes its corrections
-- with it; nothing shifts; nothing is pinned.
--
-- WHO ASSIGNS IDS
--   the builder pages  PartIds.ensure() before every save (js/part-ids.js)
--   this file          trg_assign_part_ids, for any writer that sends a part
--                      without one: the parked Armory, a script, SQL by
--                      hand, or a builder page opened before the deploy
--   this file, once    the backfill of the builds that exist today
-- Both re-link paths already keep the id: relink_build_part() and
-- create_product() merge into the existing part (`v_part || …`). Neither
-- needed to change for that; create_product() is not touched here.
--
-- WHY THE TRIGGER LOOKS AT OLD
-- A part that arrives without an id but is otherwise IDENTICAL to a part
-- already on the row keeps that part's id. Without that, a page that drops
-- the key (a tab opened before the deploy, say) would re-id every part on
-- save, and every correction would stop finding its part — hidden, not
-- misplaced, but gone from the page all the same. Identical means every
-- other key and value equal (jsonb equality, so key order does not matter),
-- and each old id can be claimed once.
--
-- AND THE FLAG, which never worked: the edit_history guard refused every
-- caller but an admin, including the visitor contest_build_part() acts for.
-- Fixed narrowly below (prevent_owner_edit_history_change).
--
-- ORDER. Unlike most migrations here this one is additive and can go either
-- side of the code: it adds a key to jsonb that every reader ignores, a
-- trigger that only ever adds that key, a nullable column, and two function
-- bodies with unchanged signatures and grants. Run it AFTER the merge anyway
-- (the house order), and the pages work in both states: before it, the
-- pages assign ids themselves and the two functions still match by index;
-- after it, everything matches by id.
--
-- TRIGGER ORDER on builds (BEFORE, by name): builds_updated_at,
-- trg_assign_part_ids, trg_prevent_build_consent_tampering,
-- trg_prevent_owner_edit_history_change, trg_restrict_build_status,
-- trg_restrict_owner_edits_on_approved, trg_stamp_build_review. Ids are
-- assigned BEFORE trg_restrict_owner_edits_on_approved compares NEW to OLD,
-- and it is UPDATE OF parts_snapshot only — an owner renaming a live build
-- never sends the column (gunforma-post-build.html's approvedLock path), so
-- it never fires there.
-- ============================================================

begin;

-- ── the rule, as a function: assign ids, keep every valid one ──────────────
create or replace function public.with_part_ids(p_new jsonb, p_old jsonb)
returns jsonb
language plpgsql
volatile
set search_path to ''
as $function$
declare
  v_out      jsonb  := '[]'::jsonb;
  v_reserved text[] := '{}';   -- valid ids NEW already carries (first use of each)
  v_used     text[] := '{}';   -- ids handed out so far, in this call
  v_el jsonb; v_old jsonb; v_id text; i int; j int;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'array' then
    return p_new;
  end if;

  -- First pass: the ids NEW already has. A part that brought its own id must
  -- keep it, so no other part may be given it in the second pass.
  for i in 0 .. jsonb_array_length(p_new) - 1 loop
    v_id := p_new -> i ->> 'partId';
    if jsonb_typeof(p_new -> i) = 'object' and v_id ~ '^[0-9a-f]{12}$' and not v_id = any (v_reserved) then
      v_reserved := v_reserved || v_id;
    end if;
  end loop;

  for i in 0 .. jsonb_array_length(p_new) - 1 loop
    v_el := p_new -> i;
    if jsonb_typeof(v_el) <> 'object' then
      v_out := v_out || jsonb_build_array(v_el);
      continue;
    end if;

    v_id := v_el ->> 'partId';
    -- Its own valid id, first time it is seen: kept.
    if v_id ~ '^[0-9a-f]{12}$' and not v_id = any (v_used) then
      v_used := v_used || v_id;
      v_out  := v_out || jsonb_build_array(v_el);
      continue;
    end if;

    -- No id (or an invalid or duplicate one). An identical part on OLD gives
    -- it that part's id, if nothing else here has it.
    v_id := null;
    if jsonb_typeof(p_old) = 'array' then
      for j in 0 .. jsonb_array_length(p_old) - 1 loop
        v_old := p_old -> j;
        if jsonb_typeof(v_old) = 'object'
           and (v_old ->> 'partId') ~ '^[0-9a-f]{12}$'
           and not (v_old ->> 'partId') = any (v_reserved)
           and not (v_old ->> 'partId') = any (v_used)
           and (v_old - 'partId') = (v_el - 'partId') then
          v_id := v_old ->> 'partId';
          exit;
        end if;
      end loop;
    end if;

    -- Otherwise a new one.
    while v_id is null or v_id = any (v_reserved) or v_id = any (v_used) loop
      v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    end loop;

    v_used := v_used || v_id;
    v_out  := v_out || jsonb_build_array(v_el || jsonb_build_object('partId', v_id));
  end loop;

  return v_out;
end;
$function$;

-- Called by the trigger as whoever is writing the row, so authenticated
-- needs it. It reads nothing and writes nothing; anon cannot write builds.
revoke execute on function public.with_part_ids(jsonb, jsonb) from public, anon;
grant  execute on function public.with_part_ids(jsonb, jsonb) to authenticated, service_role;

create or replace function public.assign_part_ids()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'UPDATE' and new.parts_snapshot is not distinct from old.parts_snapshot then
    return new;
  end if;
  new.parts_snapshot := public.with_part_ids(
    new.parts_snapshot,
    case when tg_op = 'UPDATE' then old.parts_snapshot end);
  return new;
end;
$function$;

revoke execute on function public.assign_part_ids() from public, anon, authenticated;

drop trigger if exists trg_assign_part_ids on public.builds;
create trigger trg_assign_part_ids
  before insert or update of parts_snapshot on public.builds
  for each row execute function public.assign_part_ids();

-- ── the builds that exist today ────────────────────────────────────────────
-- Five on 2026-10-08, all approved, none with a correction. This bumps their
-- updated_at (builds_updated_at), so an editor tab left open on one will be
-- told the build changed on its next save — which is true.
update public.builds
   set parts_snapshot = public.with_part_ids(parts_snapshot, null)
 where exists (select 1 from jsonb_array_elements(parts_snapshot) p
                where jsonb_typeof(p) = 'object'
                  and not coalesce(p ->> 'partId', '') ~ '^[0-9a-f]{12}$');

-- ── flags remember which part, not just where it was ───────────────────────
alter table public.build_part_flags add column if not exists part_id text;

-- ── the edit_history guard: let a flag through, and the service role ──────
-- Found by the dry run of this file (Claude Code, #152): the visitor's flag
-- has NEVER worked. contest_build_part() is SECURITY DEFINER, but this
-- trigger identifies the caller with is_admin() (auth.uid()), and the caller
-- is still the visitor — so its final UPDATE was refused with "Only admins
-- can modify edit_history", the page said "Something went wrong", and the
-- database holds zero contested entries and zero flag rows. Same shape as
-- CLAUDE.md's "service_role bypasses RLS. It does not bypass triggers", and
-- that half was logged too: the service role and a direct session were
-- refused here as well.
--
-- The rule now, for anyone who is not an admin or a trusted backend: the ONE
-- change allowed to edit_history is marking existing corrections
-- 'contested' on a build that is live and stays live — same entries, same
-- order, every key equal except `status`, which may only become
-- 'contested'. That is exactly what contest_build_part() writes, and all it
-- can write. Adding, removing, rewriting or un-contesting an entry is still
-- refused, as before. An owner can do the same thing by a direct UPDATE of
-- their own live build; that is the same act any signed-in visitor can do
-- through the function, so it opens nothing.
create or replace function public.prevent_owner_edit_history_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Admins log corrections; the service role and a direct session (the SQL
  -- editor, a migration) are trusted. See is_trusted_backend().
  if public.is_admin() or public.is_trusted_backend() then
    return new;
  end if;
  if new.edit_history is not distinct from old.edit_history then
    return new;
  end if;
  -- A flag: only statuses changed, only to 'contested', on a live build.
  if old.status = 'approved' and new.status = 'approved'
     and jsonb_typeof(old.edit_history) = 'array' and jsonb_typeof(new.edit_history) = 'array'
     and jsonb_array_length(old.edit_history) = jsonb_array_length(new.edit_history)
     and not exists (
       select 1
         from jsonb_array_elements(old.edit_history) with ordinality as o(oe, oi)
         join jsonb_array_elements(new.edit_history) with ordinality as n(ne, ni) on ni = oi
        where not (
          ne = oe
          or (jsonb_typeof(ne) = 'object' and jsonb_typeof(oe) = 'object'
              and (ne - 'status') = (oe - 'status')
              and ne ->> 'status' = 'contested')
        ))
  then
    return new;
  end if;
  raise exception 'Only admins can modify edit_history'
    using errcode = '42501';   -- insufficient_privilege
end;
$function$;

-- ── contest_build_part: the flagged correction is the PART's ───────────────
-- Same signature, so the page's call and the grants are unchanged. The page
-- still sends the position it rendered; the function reads the id of the
-- part at that position and finds the correction by it. An entry written
-- before ids (part_index only) is still found by position.
create or replace function public.contest_build_part(p_build_id uuid, p_part_index integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  target_idx int;
  uid uuid := auth.uid();
  v_pid text;
begin
  if uid is null then
    raise exception 'must be signed in to flag';
  end if;
  if p_part_index is null or p_part_index < 0 then
    raise exception 'contest_build_part: part index must be 0 or more';   -- jsonb -> -1 reads from the end
  end if;

  select b.parts_snapshot -> p_part_index ->> 'partId' into v_pid
    from public.builds b where b.id = p_build_id;

  insert into public.build_part_flags (build_id, part_index, part_id, user_id)
  values (p_build_id, p_part_index, v_pid, uid)
  on conflict (build_id, part_index, user_id) do nothing;

  select (ord - 1) into target_idx
  from public.builds b, jsonb_array_elements(b.edit_history) with ordinality as e(elem, ord)
  where b.id = p_build_id
    and b.status = 'approved'
    and case when (e.elem ->> 'part_id') ~ '^[0-9a-f]{12}$'
             then (e.elem ->> 'part_id') = v_pid
             else (e.elem ->> 'part_index') ~ '^[0-9]+$' and (e.elem ->> 'part_index')::int = p_part_index
        end
  order by ord desc
  limit 1;

  if target_idx is null then
    return;
  end if;

  update public.builds
  set edit_history = jsonb_set(edit_history, array[target_idx::text, 'status'], '"contested"'::jsonb)
  where id = p_build_id and status = 'approved';
end;
$function$;

-- ── relink_build_part: "has corrections" means THIS part's ─────────────────
-- The live body, unchanged except for the count of corrections (marked).
create or replace function public.relink_build_part(p_build_id uuid, p_part_index integer, p_product_id uuid, p_variant_id uuid, p_variant_specs text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_part jsonb; v_history jsonb; v_corrections int; v_entry jsonb;
  pr record; pv record;
begin
  if not (public.is_admin() or public.is_trusted_backend()) then
    raise exception 'relink_build_part: admin or service_role only' using errcode = '42501';
  end if;
  if p_build_id is null or p_part_index is null or p_product_id is null or p_variant_id is null then
    raise exception 'relink_build_part: build, part index, product and variant are all required';
  end if;
  if p_part_index < 0 then
    raise exception 'relink_build_part: part index must be 0 or more';   -- jsonb -> -1 would read from the end
  end if;

  select b.parts_snapshot -> p_part_index, coalesce(b.edit_history, '[]'::jsonb)
    into v_part, v_history
    from public.builds b where b.id = p_build_id for update;
  if not found then raise exception 'relink_build_part: no build %', p_build_id; end if;
  if v_part is null then raise exception 'relink_build_part: that build has no part at index %', p_part_index; end if;
  if (v_part->>'pending')::boolean is not true or v_part->>'refId' is not null then
    raise exception 'relink_build_part: part % ("%") on that build is not a pending custom part', p_part_index, v_part->>'name';
  end if;

  -- CHANGED (part_ids.sql): by the part's own id when the entry has one,
  -- else by position, as every entry used to be.
  select count(*) into v_corrections from jsonb_array_elements(v_history) e
   where case when (e->>'part_id') ~ '^[0-9a-f]{12}$'
              then (e->>'part_id') = (v_part->>'partId')
              else (e->>'part_index') ~ '^[0-9]+$' and (e->>'part_index')::int = p_part_index
         end;
  if v_corrections > 0 then
    raise exception 'relink_build_part: part % ("%") has % correction% in the review queue. The build page shows those over the part, so a linked part would read as the correction. Not linked.',
      p_part_index, v_part->>'name', v_corrections, case when v_corrections = 1 then '' else 's' end;
  end if;

  select p.id, p.name, p.category, m.name as brand into pr
    from public.products p join public.manufacturers m on m.id = p.brand_id
   where p.id = p_product_id;
  if not found then raise exception 'relink_build_part: no product %', p_product_id; end if;

  select v.id, v.product_id, v.retired_at, v.primary_image_url, v.color, v.variant_label, v.finish into pv
    from public.product_variants v where v.id = p_variant_id;
  if not found or pv.product_id is distinct from p_product_id then
    raise exception 'relink_build_part: that variant is not one of "%"''s variants', pr.name;
  end if;
  if pv.retired_at is not null then
    raise exception 'relink_build_part: that variant of "%" is retired. Pick a live one.', pr.name;
  end if;

  v_entry := v_part
    || jsonb_strip_nulls(jsonb_build_object('name', pr.name, 'brand', pr.brand, 'refId', pr.id,
         'imageUrl', pv.primary_image_url, 'variantId', pv.id, 'variantColor', pv.color,
         'variantLabel', pv.variant_label, 'variantFinish', pv.finish,
         'variantSpecs', nullif(btrim(coalesce(p_variant_specs, '')), '')))
    || jsonb_build_object('pending', false)
    -- Other Parts (stored as `misc`) is the catch-all: a linked part takes the
    -- product's own category and renders in its real section. Every other
    -- section keeps the category it was saved under.
    || case when v_part->>'category' = 'misc' then jsonb_build_object('category', pr.category::text) else '{}'::jsonb end;

  update public.builds b set parts_snapshot = jsonb_set(b.parts_snapshot, array[p_part_index::text], v_entry)
   where b.id = p_build_id;

  return jsonb_build_object('build_id', p_build_id, 'part_index', p_part_index, 'entry', v_entry);
end;
$function$;

commit;

-- ============================================================
-- AFTER APPLYING, expect:
--
--   select count(*) from builds, jsonb_array_elements(parts_snapshot) p
--    where not coalesce(p->>'partId','') ~ '^[0-9a-f]{12}$';          -- 0
--   select count(*) from (select b.id, p->>'partId' from builds b,
--     jsonb_array_elements(b.parts_snapshot) p group by 1, 2 having count(*) > 1) d;  -- 0
--   select tgname from pg_trigger where tgname = 'trg_assign_part_ids';   -- one row
-- ============================================================
