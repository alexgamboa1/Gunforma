-- Rollback for build_part_flags.sql
-- Restores contest_build_part to its pre-flags body and drops the table.
begin;

create or replace function public.contest_build_part(p_build_id uuid, p_part_index integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target_idx int;
begin
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

drop table if exists public.build_part_flags;

commit;
