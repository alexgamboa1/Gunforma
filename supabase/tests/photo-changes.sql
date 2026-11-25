-- photo_changes: every product-photo change is recorded, and only Alex's
-- flow is approved (2026-11-25, *_photo_changes_audit.sql). Driven over a
-- fixture made through the real create_product(); everything rolls back.
--
--   undeclared direct session (MCP / dashboard)   recorded, approved = false
--   declared: set local gunforma.photo_edit       recorded, approved, reason kept
--   service_role request (the sync, a script)      recorded, approved = false
--   an admin's request (add-part page)             recorded, approved
--   a signed-in non-admin's request                recorded, approved = false
--   variant_images insert / url / position / delete, each its own row
--   a write that changes no photo                  nothing recorded
--   anon / authenticated                           cannot read the table
--   create_variant()                               no API role may execute it
--
-- Cases that rely on the direct session's NULL request.jwt.claims run FIRST:
-- once a connection has set the claims, a reset value reads '' (CLAUDE.md).

begin;

create temp table t_ids (k text primary key, id uuid);

do $$
begin
  perform public.create_product(
    '{"brand":"Photocheck","name":"PC Barrel","category":"barrel","platforms":["p365"],"url":"https://example.com/pc-barrel","slug":"pc-barrel"}'::jsonb,
    '[{"color":"Black","msrp":100,"image_url":"https://example.com/pc-1.jpg","is_default":true}]'::jsonb,
    '{"barrel_length_in":3.1,"barrel_type":"standard","caliber":"9mm","is_lci":false}'::jsonb);
  insert into t_ids
    select 'variant', v.id from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'pc-barrel';
end $$;

-- An admin and a plain user, for the request cases below (set up while the
-- session has no claims, so the profiles guards see a direct session).
do $$
declare a uuid := gen_random_uuid(); u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (a, 'pc-admin@example.com'), (u, 'pc-user@example.com');
  insert into public.profiles (id, username, role) values (a, 'pc_admin', 'admin')
    on conflict (id) do update set role = 'admin', username = excluded.username;
  insert into public.profiles (id, username, role) values (u, 'pc_user', 'user')
    on conflict (id) do update set role = 'user', username = excluded.username;
  insert into t_ids values ('admin', a), ('user', u);
end $$;

do $$
declare
  v uuid := (select id from t_ids where k = 'variant');
  img uuid;
  n int;
  rec record;
begin
  -- 0. create_product(), undeclared direct session: the new variant's photo
  --    is recorded (insert), unapproved, role 'session'.
  select count(*) into n from public.photo_changes
   where variant_id = v and field = 'primary_image_url' and old_value is null
     and new_value = 'https://example.com/pc-1.jpg' and changed_by_role = 'session' and not approved
     and product_slug = 'pc-barrel';
  if n <> 1 then raise exception 'case 0: the new variant''s photo was not recorded as an unapproved session write (%)', n; end if;

  -- 1. An undeclared direct UPDATE — the 2026-11-19 shape.
  update public.product_variants set primary_image_url = 'https://example.com/pc-2.jpg' where id = v;
  select * into rec from public.photo_changes where variant_id = v order by id desc limit 1;
  if rec.old_value is distinct from 'https://example.com/pc-1.jpg' or rec.new_value is distinct from 'https://example.com/pc-2.jpg'
     or rec.approved or rec.changed_by_role <> 'session' or rec.edit_reason is not null then
    raise exception 'case 1: undeclared update recorded wrong: %', row_to_json(rec);
  end if;

  -- 2. Declared: the reason is kept and the row is approved.
  perform set_config('gunforma.photo_edit', 'Alex: restore the maker photo', true);
  update public.product_variants set primary_image_url = 'https://example.com/pc-3.jpg' where id = v;
  select * into rec from public.photo_changes where variant_id = v order by id desc limit 1;
  if not rec.approved or rec.edit_reason is distinct from 'Alex: restore the maker photo' then
    raise exception 'case 2: declared edit not approved with its reason: %', row_to_json(rec);
  end if;
  perform set_config('gunforma.photo_edit', '', true);   -- a blank reason is no reason

  -- 3. A write that changes no photo records nothing.
  select count(*) into n from public.photo_changes where variant_id = v;
  update public.product_variants set primary_image_url = 'https://example.com/pc-3.jpg', msrp = 101 where id = v;
  update public.product_variants set msrp = 102 where id = v;
  if (select count(*) from public.photo_changes where variant_id = v) <> n then
    raise exception 'case 3: a write that changed no photo was recorded';
  end if;

  -- 4. variant_images: insert, url change, position change, delete.
  insert into public.variant_images (variant_id, url, position) values (v, 'https://example.com/g-1.jpg', 9) returning id into img;
  update public.variant_images set url = 'https://example.com/g-2.jpg' where id = img;
  update public.variant_images set position = 8 where id = img;
  update public.variant_images set url = 'https://example.com/g-3.jpg', position = 7 where id = img;
  delete from public.variant_images where id = img;
  select count(*) into n from public.photo_changes where image_id = img;
  if n <> 6 then raise exception 'case 4: expected 6 gallery rows (insert, url, position, url+position, delete), got %', n; end if;
  if not exists (select 1 from public.photo_changes where image_id = img and field = 'variant_images.position' and old_value = '9' and new_value = '8')
     or not exists (select 1 from public.photo_changes where image_id = img and field = 'variant_images.url' and old_value = 'https://example.com/g-3.jpg' and new_value is null)
     or exists (select 1 from public.photo_changes where image_id = img and approved) then
    raise exception 'case 4: gallery rows wrong';
  end if;

  -- 5. A service_role request: recorded, NOT approved.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.product_variants set primary_image_url = 'https://example.com/pc-4.jpg' where id = v;
  select * into rec from public.photo_changes where variant_id = v order by id desc limit 1;
  if rec.approved or rec.changed_by_role <> 'service_role' then
    raise exception 'case 5: service_role write recorded wrong: %', row_to_json(rec);
  end if;

  -- 6. An admin's request: approved, with the admin's id.
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', (select id from t_ids where k = 'admin'))::text, true);
  update public.product_variants set primary_image_url = 'https://example.com/pc-5.jpg' where id = v;
  select * into rec from public.photo_changes where variant_id = v order by id desc limit 1;
  if not rec.approved or rec.changed_by_user is distinct from (select id from t_ids where k = 'admin') then
    raise exception 'case 6: admin request not approved: %', row_to_json(rec);
  end if;

  -- 7. A signed-in non-admin (only reachable if a write path ever opened):
  --    recorded, NOT approved.
  perform set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', (select id from t_ids where k = 'user'))::text, true);
  update public.product_variants set primary_image_url = 'https://example.com/pc-6.jpg' where id = v;
  select * into rec from public.photo_changes where variant_id = v order by id desc limit 1;
  if rec.approved then raise exception 'case 7: a non-admin request was approved'; end if;

  perform set_config('request.jwt.claims', '', true);
end $$;

-- 8. Private: no API role can read it, and create_variant() is closed.
do $$
begin
  if has_table_privilege('anon', 'public.photo_changes', 'select')
     or has_table_privilege('authenticated', 'public.photo_changes', 'select')
     or has_table_privilege('authenticated', 'public.photo_changes', 'insert') then
    raise exception 'case 8: photo_changes is readable or writable by an API role';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.photo_changes'::regclass) then
    raise exception 'case 8: RLS is off on photo_changes';
  end if;
  if has_function_privilege('service_role', 'public.create_variant(text,text,text,text,text,numeric,text,text,text,text,numeric,boolean,text,text,text,text,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.create_variant(text,text,text,text,text,numeric,text,text,text,text,numeric,boolean,text,text,text,text,boolean)', 'execute') then
    raise exception 'case 8: create_variant() is still executable by an API role';
  end if;
  raise notice 'photo_changes: all assertions passed';
end $$;

rollback;
