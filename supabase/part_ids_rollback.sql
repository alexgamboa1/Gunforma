-- ============================================================
-- Rollback for part_ids.sql.
--
-- Puts contest_build_part and relink_build_part back to matching a
-- correction by position, puts the edit_history guard back to admins only, and removes the trigger, its two functions and
-- build_part_flags.part_id.
--
-- It does NOT strip partId from parts_snapshot or part_id from
-- edit_history. Every reader ignores a key it does not know, and the ids
-- are the only record of which part a correction meant: removing them
-- loses that and gains nothing.
--
-- AFTER RUNNING THIS, a correction by id is matched by its part_index again
-- — the position the part had when the reviewer wrote it. Revert the page
-- change too (js/part-ids.js and the pages that load it), or the pages and
-- the database will disagree about which part a correction is on.
-- ============================================================

begin;

drop trigger if exists trg_assign_part_ids on public.builds;
drop function if exists public.assign_part_ids();
drop function if exists public.with_part_ids(jsonb, jsonb);

alter table public.build_part_flags drop column if exists part_id;

-- contest_build_part, as it was before part_ids.sql
create or replace function public.contest_build_part(p_build_id uuid, p_part_index integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;

-- relink_build_part, as it was before part_ids.sql (only the count differs)
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

  select count(*) into v_corrections from jsonb_array_elements(v_history) e
   where (e->>'part_index') ~ '^[0-9]+$' and (e->>'part_index')::int = p_part_index;
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

-- prevent_owner_edit_history_change, as it was before part_ids.sql: admins
-- only. This puts the visitor's flag back to never working.
create or replace function public.prevent_owner_edit_history_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Admins can freely modify edit_history — that's how corrections get logged.
  if public.is_admin() then
    return new;
  end if;
  -- Anyone else must leave edit_history unchanged. IS DISTINCT FROM is the
  -- null-safe comparison — [] vs [{...}] differs even if either side is null.
  if new.edit_history is distinct from old.edit_history then
    raise exception 'Only admins can modify edit_history'
      using errcode = '42501';   -- insufficient_privilege
  end if;
  return new;
end;
$function$;

commit;
