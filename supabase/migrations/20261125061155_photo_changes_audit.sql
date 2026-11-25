-- photo_changes: every change to a product photo is recorded, and every
-- change not made through Alex's own flow is flagged (2026-11-25).
--
-- The ruling (Alex, 2026-11-24): every product photo URL Alex entered is
-- correct by definition — he chose each one by looking at it. Where a photo
-- is hosted does not matter. The only problem is a photo changed by anything
-- other than Alex. Until now a change left no trace beyond
-- product_variants.updated_at, which every column bumps (the 2026-11-20
-- finish-families backfill moved 554 rows' updated_at without touching a
-- photo), and variant_images carries no timestamp at all.
--
-- WHAT IS RECORDED. One row per change, written by triggers that no caller
-- can skip:
--   product_variants.primary_image_url   insert with a photo, any change
--   variant_images.url                   insert, delete, change of url
--   variant_images.position              change of order
-- with the old and new value, when, and who: the request's JWT role and
-- user, the database session, and the edit reason if one was declared.
--
-- WHAT COUNTS AS ALEX'S FLOW (approved = true). Either:
--   1. an admin's own request — JWT role 'authenticated' and is_admin():
--      the admin add-part page (create_product / add_variants). Readers
--      cannot write these tables at all (no write policy), so an
--      authenticated write that lands here came through an admin-only
--      SECURITY DEFINER function;
--   2. a DECLARED edit — the transaction set the custom setting
--      gunforma.photo_edit to a reason:
--        set local gunforma.photo_edit = 'Alex: <why>';
--      That is how the add-part skill's corrections (Step 6), a restore
--      migration, or any hand-run SQL Alex asked for says what it is. The
--      reason is stored with the row.
-- Everything else — the service role (the price sync, any script with the
-- service key), and an undeclared direct SQL session (the MCP SQL tool, the
-- dashboard, a migration that does not declare itself) — is approved =
-- false, and scripts/check-photo-changes.mjs turns the twice-daily
-- check-routes.yml run red, listing the variants, until each row is
-- reviewed (reviewed_at set by hand, with a review_note).
--
-- PRIVATE. RLS on, no policies, every grant revoked from anon and
-- authenticated; the service role (the check) and direct sessions read it.
-- The trigger function is SECURITY DEFINER so a caller's lack of access to
-- the table can never make a photo write fail — and no caller can skip it.
--
-- CLOSED IN THE SAME CHANGE: create_variant(), the original variant RPC,
-- which the service role could call (its guard admits is_trusted_backend())
-- and which scripts/add-variants.mjs drove from a CSV with the service key.
-- create_product() and add_variants() replaced it and do not call it.
-- EXECUTE is revoked from every API role; the function stays, owner-only.
-- scripts/add-variants.mjs is deleted in the same PR.

create table public.photo_changes (
  id                bigint generated always as identity primary key,
  variant_id        uuid not null,
  variant_slug      text,
  product_slug      text,
  field             text not null check (field in ('primary_image_url', 'variant_images.url', 'variant_images.position')),
  image_id          uuid,
  old_value         text,
  new_value         text,
  changed_at        timestamptz not null default now(),
  changed_by_role   text not null,        -- the JWT role claim, or 'session'
  changed_by_user   uuid,                 -- the JWT sub, when there is one
  session_user_name text not null default session_user,
  edit_reason       text,                 -- gunforma.photo_edit, when declared
  approved          boolean not null,
  reviewed_at       timestamptz,
  review_note       text
);

comment on table public.photo_changes is
  'Every change to a product photo (primary_image_url, variant_images url/position). approved = an admin request or a declared gunforma.photo_edit; anything else is flagged by scripts/check-photo-changes.mjs until reviewed_at is set.';

create index photo_changes_unreviewed on public.photo_changes (changed_at) where not approved and reviewed_at is null;
create index photo_changes_variant on public.photo_changes (variant_id, changed_at);

alter table public.photo_changes enable row level security;
revoke all on public.photo_changes from anon, authenticated;

-- Who is writing, decided once. Never raises: a malformed or absent claims
-- setting reads as "no request", the way is_trusted_backend() reads it.
create or replace function public.photo_change_caller(
  out caller_role text, out caller_user uuid, out reason text, out ok boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    claims := null;
  end;
  caller_role := coalesce(nullif(claims ->> 'role', ''), 'session');
  begin
    caller_user := nullif(claims ->> 'sub', '')::uuid;
  exception when others then
    caller_user := null;
  end;
  reason := nullif(btrim(coalesce(current_setting('gunforma.photo_edit', true), '')), '');
  ok := reason is not null
     or (caller_role = 'authenticated' and coalesce(public.is_admin(), false));
end;
$$;

revoke all on function public.photo_change_caller() from public, anon, authenticated;

create or replace function public.log_photo_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_variant uuid;
  v_vslug text;
  v_pslug text;
  rows_to_log jsonb := '[]'::jsonb;
  r jsonb;
begin
  if tg_table_name = 'product_variants' then
    if tg_op = 'INSERT' and new.primary_image_url is not null then
      rows_to_log := jsonb_build_array(jsonb_build_object(
        'f', 'primary_image_url', 'o', null, 'n', new.primary_image_url));
    elsif tg_op = 'UPDATE' and new.primary_image_url is distinct from old.primary_image_url then
      rows_to_log := jsonb_build_array(jsonb_build_object(
        'f', 'primary_image_url', 'o', old.primary_image_url, 'n', new.primary_image_url));
    end if;
    v_variant := new.id;
  else  -- variant_images
    if tg_op = 'INSERT' then
      rows_to_log := jsonb_build_array(jsonb_build_object(
        'f', 'variant_images.url', 'o', null, 'n', new.url, 'i', new.id));
      v_variant := new.variant_id;
    elsif tg_op = 'DELETE' then
      rows_to_log := jsonb_build_array(jsonb_build_object(
        'f', 'variant_images.url', 'o', old.url, 'n', null, 'i', old.id));
      v_variant := old.variant_id;
    else
      if new.url is distinct from old.url then
        rows_to_log := rows_to_log || jsonb_build_object(
          'f', 'variant_images.url', 'o', old.url, 'n', new.url, 'i', new.id);
      end if;
      if new.position is distinct from old.position then
        rows_to_log := rows_to_log || jsonb_build_object(
          'f', 'variant_images.position', 'o', old.position::text, 'n', new.position::text, 'i', new.id);
      end if;
      v_variant := new.variant_id;
    end if;
  end if;

  if jsonb_array_length(rows_to_log) = 0 then
    return null;
  end if;

  select * into c from public.photo_change_caller();
  select v.slug, p.slug into v_vslug, v_pslug
    from public.product_variants v left join public.products p on p.id = v.product_id
   where v.id = v_variant;

  for r in select * from jsonb_array_elements(rows_to_log) loop
    insert into public.photo_changes
      (variant_id, variant_slug, product_slug, field, image_id, old_value, new_value,
       changed_by_role, changed_by_user, edit_reason, approved)
    values
      (v_variant, v_vslug, v_pslug, r ->> 'f', nullif(r ->> 'i', '')::uuid, r ->> 'o', r ->> 'n',
       c.caller_role, c.caller_user, c.reason, c.ok);
  end loop;
  return null;
end;
$$;

revoke all on function public.log_photo_change() from public, anon, authenticated;

-- AFTER triggers: they record what actually landed, after every BEFORE
-- trigger and constraint has had its say; a refused write records nothing
-- (the log row rolls back with it).
create trigger trg_log_photo_change
  after insert or update of primary_image_url on public.product_variants
  for each row execute function public.log_photo_change();

create trigger trg_log_photo_change
  after insert or update or delete on public.variant_images
  for each row execute function public.log_photo_change();

-- The legacy variant RPC: owner-only from here on.
revoke execute on function public.create_variant(
  text, text, text, text, text, numeric, text, text, text, text, numeric,
  boolean, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;
