-- relink_build_part.sql
-- NOT YET APPLIED. Dry-run 2026-10-04 against Gunforma-v2 inside one
-- rolled-back transaction; results in the PR. Apply AFTER the queue page
-- that calls it is merged and live: the page reports a missing function
-- cleanly, so it ships first.
--
-- Swaps a build's pending custom part for a product that is ALREADY in the
-- catalog — the "Link to existing part" action on gunforma-admin-queue.html.
--
-- WHY. create_product() can re-link a pending part, but only while creating
-- the product. The first real part (Springer Precision's +3 X-Macro base
-- plate) was saved from the add-a-part page without the build parameters, so
-- "P365 Complete Build" still shows it as pending and create_product() would
-- now refuse it as a duplicate. The same happens whenever a builder types a
-- part that already exists under another name.
--
-- WHAT IT WRITES: exactly what create_product()'s re-link step writes — name
-- and brand from the product; imageUrl, variantId, variantColor, variantLabel
-- and variantFinish from the chosen variant; pending false; every other key
-- of the entry (its category above all) left as it was — PLUS variantSpecs,
-- the spec line, when the caller sends a non-empty one. The queue page
-- computes it with js/variant-label.js, so the formula stays in one place
-- and a linked part reads the same as one picked in the builder.
--
-- REFUSES, each with a sentence an admin can act on:
--   * a caller who is not an admin (or the service role)       42501
--   * no such build, or no part at that index
--   * a part that is not a pending custom part — the same refusal as
--     create_product()'s re-link
--   * a part with corrections in builds.edit_history: the build page lays
--     those over the entry, so a linked part would read as the correction,
--     not the catalog part. It says how many there are.
--   * a product that does not exist; a variant that is not that product's,
--     or is retired
-- It does NOT check that the product's category suits the part's section:
-- the queue page offers only products in that section, and the taxonomy
-- lives in js/build-categories.js. A copy here would be a third one.
--
-- p_part_index is the part's ORIGINAL index in parts_snapshot (CLAUDE.md,
-- "renderPartCard takes a part's ORIGINAL index").
--
-- The guard is is_admin() or is_trusted_backend(), never current_user:
-- SECURITY DEFINER rewrites current_user to the owner. The update passes
-- restrict_owner_edits_on_approved_build because the caller is an admin.

create or replace function public.relink_build_part(
  p_build_id uuid, p_part_index integer, p_product_id uuid, p_variant_id uuid,
  p_variant_specs text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $rl$
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

  select p.id, p.name, m.name as brand into pr
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
    || jsonb_build_object('pending', false);

  update public.builds b set parts_snapshot = jsonb_set(b.parts_snapshot, array[p_part_index::text], v_entry)
   where b.id = p_build_id;

  return jsonb_build_object('build_id', p_build_id, 'part_index', p_part_index, 'entry', v_entry);
end;
$rl$;

comment on function public.relink_build_part(uuid, integer, uuid, uuid, text) is
  'Admin / service_role only. Swaps a build''s pending custom part (by its original index) for an existing catalog product and variant, as create_product()''s re-link does, plus variantSpecs when given. Refuses a part that is not pending or carries corrections.';

revoke all on function public.relink_build_part(uuid, integer, uuid, uuid, text) from public, anon;
grant execute on function public.relink_build_part(uuid, integer, uuid, uuid, text) to authenticated, service_role;
