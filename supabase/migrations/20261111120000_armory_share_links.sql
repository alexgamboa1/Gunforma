-- Armory builds shared without an account: /l/<share_id> (PR 3 of the
-- 2026-11-10/11 Armory design).
--
-- One home for every saved Armory build stays gun_guides — My builds, the
-- profile tab and the share pages keep working — extended, not replaced:
--
--   * user_id becomes NULLABLE: an anonymous list has no account. Its
--     owner is whoever holds the edit token (stored HASHED; the plain
--     token is returned once, by create_armory_build, and lives in that
--     browser's localStorage).
--   * share_id: the short random slug /l/ serves. Every row gets one
--     (default + backfill), so old links can 301 onto new ones.
--   * based_on_id: "Based on …" credit when a viewer edits a copy of
--     someone else's list.
--   * Anonymous writes go ONLY through the three SECURITY DEFINER RPCs —
--     anon keeps no direct insert/update on the table. Signed-in direct
--     writes keep working exactly as today.
--
-- House rules: RLS + explicit revoke; no inline table reads in policies;
-- callers identified from the request JWT, never current_user; pinned
-- search_path on every SECURITY DEFINER function.
--
-- OWNERSHIP IS LOAD-BEARING: `supabase db push` runs as cli_login_postgres
-- (rolbypassrls = false, not the tables' owner), so a SECURITY DEFINER
-- function it creates would hit gun_guides' RLS as a role no policy names
-- and every anonymous save would be refused — correct-looking SQL, broken
-- at runtime. Each function below is therefore handed to postgres
-- (bypassrls), which cli_login_postgres may do as a member of postgres.

-- ── columns ────────────────────────────────────────────────────────────────
alter table public.gun_guides alter column user_id drop not null;
-- The old default (auth.uid()) stays correct for signed-in inserts and is
-- null for the RPCs' anonymous rows.

-- 8 lowercase base-36 characters ≈ 2.8e12 slugs: collisions are lottery
-- odds, and the unique constraint turns the lottery into one failed save.
create or replace function public.armory_share_id()
returns text
language sql
volatile
set search_path = public
as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789',
                           1 + floor(random() * 36)::int, 1), '')
  from generate_series(1, 8);
$$;
alter function public.armory_share_id() owner to postgres;

alter table public.gun_guides add column if not exists share_id text unique default public.armory_share_id();
update public.gun_guides set share_id = public.armory_share_id() where share_id is null;
alter table public.gun_guides alter column share_id set not null;

alter table public.gun_guides add column if not exists edit_token_hash text;
alter table public.gun_guides add column if not exists based_on_id uuid references public.gun_guides (id) on delete set null;

-- An anonymous row must carry a token hash, or nobody could ever edit it;
-- a signed-in row may carry one (it was claimed) or not (saved signed in).
alter table public.gun_guides drop constraint if exists gun_guides_anon_has_token;
alter table public.gun_guides add constraint gun_guides_anon_has_token
  check (user_id is not null or edit_token_hash is not null);

-- ── policies ───────────────────────────────────────────────────────────────
-- The takedown half logged as missing on 2026-10-27: admins may flip
-- is_removed (and fix a title) on any row. is_admin() is the usual
-- SECURITY DEFINER reader — never an inline profiles read (CLAUDE.md).
drop policy if exists gun_guides_admin_update on public.gun_guides;
create policy gun_guides_admin_update on public.gun_guides
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists gun_guides_admin_delete on public.gun_guides;
create policy gun_guides_admin_delete on public.gun_guides
  for delete to authenticated
  using (public.is_admin());

-- The public read already hides taken-down rows (gun_guides_public_read,
-- 20261027120000): is_removed only, which now also covers anonymous rows.

-- ── abuse protection for anonymous saves ──────────────────────────────────
-- A per-visitor rate limit, enforced INSIDE create_armory_build — Turnstile
-- guards Supabase Auth's endpoints, but an RPC has no captcha verify hook,
-- and nothing client-side is protection at all. Bookkeeping, not tracking:
-- the key is sha256(ip + day) — never the raw address — and rows older
-- than seven days are swept on every write. definer-only: no grants, no
-- policies, nothing reads it but the limiter.
create table if not exists public.armory_save_limits (
  ip_hash text not null,
  day     date not null default current_date,
  saves   integer not null default 0,
  primary key (ip_hash, day)
);
alter table public.armory_save_limits enable row level security;
revoke all on public.armory_save_limits from anon, authenticated;

-- 20 anonymous saves per connection per day, and 500 across everyone — a
-- person spec'ing builds never sees either; a script does. A request whose
-- address Kong didn't forward lands in one shared 'unknown' bucket, so a
-- platform header change degrades to throttling, never to an open door.
create or replace function public.armory_anon_save_allowed()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text;
  v_hash text;
  v_count integer;
  v_total integer;
begin
  begin
    v_ip := coalesce(
      current_setting('request.headers', true)::jsonb ->> 'cf-connecting-ip',
      current_setting('request.headers', true)::jsonb ->> 'x-real-ip',
      split_part(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ',', 1));
  exception when others then
    v_ip := null;
  end;
  v_hash := encode(sha256((coalesce(nullif(trim(v_ip), ''), 'unknown') || ':' || current_date::text)::bytea), 'hex');
  delete from armory_save_limits where day < current_date - 7;
  insert into armory_save_limits (ip_hash, day, saves)
  values (v_hash, current_date, 1)
  on conflict (ip_hash, day) do update set saves = armory_save_limits.saves + 1
  returning saves into v_count;
  if v_count > 20 then
    raise exception 'too many builds saved from this connection today — sign in to keep saving';
  end if;
  select coalesce(sum(saves), 0) into v_total from armory_save_limits where day = current_date;
  if v_total > 500 then
    raise exception 'anonymous saving is briefly paused — sign in to save your build';
  end if;
end;
$$;
alter function public.armory_anon_save_allowed() owner to postgres;
revoke execute on function public.armory_anon_save_allowed() from public, anon, authenticated;

-- ── the RPCs ───────────────────────────────────────────────────────────────
-- What a payload may say, checked once for the three writers: at most 18
-- parts (one per catalog category), each naming a known category and a
-- live product (and, when it names an option, one of THAT product's), the
-- title at most 80 characters. The parts_snapshot stored is rebuilt from
-- the checked fields — never the caller's object verbatim.
create or replace function public.armory_build_checked(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_title text;
  v_platform uuid;
  v_gun uuid;
  v_parts jsonb;
  v_out jsonb := '[]'::jsonb;
  v_part jsonb;
  v_product record;
  v_variant uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be an object';
  end if;
  v_title := left(coalesce(nullif(trim(p_payload->>'title'), ''), 'Armory build'), 80);
  v_platform := (p_payload->>'platform_id')::uuid;
  if v_platform is null or not exists (select 1 from platforms where id = v_platform) then
    raise exception 'unknown platform';
  end if;
  v_gun := nullif(p_payload->>'gun_id', '')::uuid;
  if v_gun is not null and not exists (select 1 from guns where id = v_gun and platform_id = v_platform) then
    raise exception 'unknown gun for this platform';
  end if;
  v_parts := coalesce(p_payload->'parts_snapshot', '[]'::jsonb);
  if jsonb_typeof(v_parts) <> 'array' or jsonb_array_length(v_parts) > 18 then
    raise exception 'parts_snapshot must be an array of at most 18 parts';
  end if;
  for v_part in select * from jsonb_array_elements(v_parts) loop
    select p.id, p.slug, p.name, p.category::text as category, m.name as brand
      into v_product
      from products p left join manufacturers m on m.id = p.brand_id
     where p.id = (v_part->>'refId')::uuid;
    if not found then
      raise exception 'unknown product in parts_snapshot';
    end if;
    if (v_part->>'category') is not null and (v_part->>'category') <> v_product.category then
      raise exception 'part category does not match the product';
    end if;
    v_variant := nullif(v_part->>'variantId', '')::uuid;
    if v_variant is not null and not exists (
      select 1 from product_variants v where v.id = v_variant and v.product_id = v_product.id
    ) then
      raise exception 'variant does not belong to the product';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'category', v_product.category,
      'refId', v_product.id,
      'slug', v_product.slug,
      'brand', v_product.brand,
      'name', v_product.name,
      'pending', false,
      'variantId', v_variant,
      'variantLabel', nullif(v_part->>'variantLabel', ''),
      'variantColor', nullif(v_part->>'variantColor', ''),
      'variantFinish', nullif(v_part->>'variantFinish', ''),
      'imageUrl', nullif(v_part->>'imageUrl', ''),
      'msrp', case when jsonb_typeof(v_part->'msrp') = 'number' then v_part->'msrp' else 'null'::jsonb end
    ));
  end loop;
  return jsonb_build_object('title', v_title, 'platform_id', v_platform,
    'gun_id', v_gun, 'parts_snapshot', v_out,
    'based_on_id', nullif(p_payload->>'based_on_id', '')::uuid);
end;
$$;
alter function public.armory_build_checked(jsonb) owner to postgres;
revoke execute on function public.armory_build_checked(jsonb) from public, anon, authenticated;

-- Save, with or without an account. Signed in: the row is theirs, no
-- token. Signed out: user_id null, a fresh token returned ONCE and stored
-- only as its hash. The caller is read from the request JWT (auth.uid()),
-- never current_user — the definer context does not disturb it.
create or replace function public.create_armory_build(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_uid uuid := auth.uid();
  v_token text := null;
  v_row gun_guides;
begin
  v := armory_build_checked(p_payload);
  if v_uid is null then
    perform armory_anon_save_allowed();   -- the per-visitor rate limit
    -- pgcrypto lives in the extensions schema, outside the pinned path.
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
  end if;
  insert into gun_guides (user_id, title, platform_id, gun_id, parts_snapshot, based_on_id, edit_token_hash)
  values (v_uid, v->>'title', (v->>'platform_id')::uuid, nullif(v->>'gun_id', '')::uuid,
          v->'parts_snapshot', nullif(v->>'based_on_id', '')::uuid,
          case when v_token is null then null else encode(sha256(v_token::bytea), 'hex') end)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'share_id', v_row.share_id, 'edit_token', v_token);
end;
$$;
alter function public.create_armory_build(jsonb) owner to postgres;
revoke execute on function public.create_armory_build(jsonb) from public;
grant execute on function public.create_armory_build(jsonb) to anon, authenticated;

-- Update: the signed-in owner, or whoever holds the token of an anonymous
-- row. The two proofs are exact: a token never updates a claimed row (its
-- owner signed in; the token's job is done), and an owner needs no token.
-- The identity columns never move here: user_id, share_id, based_on_id and
-- the token hash stay what they were.
create or replace function public.update_armory_build(p_id uuid, p_edit_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_uid uuid := auth.uid();
  v_row gun_guides;
begin
  select * into v_row from gun_guides where id = p_id;
  if not found or v_row.is_removed then
    raise exception 'no such build';
  end if;
  if v_row.user_id is not null then
    if v_uid is null or v_uid <> v_row.user_id then
      raise exception 'only this build''s owner can edit it';
    end if;
  else
    if p_edit_token is null or v_row.edit_token_hash is null
       or encode(sha256(p_edit_token::bytea), 'hex') <> v_row.edit_token_hash then
      raise exception 'this build''s edit link is required';
    end if;
  end if;
  v := armory_build_checked(p_payload);
  update gun_guides
     set title = v->>'title',
         platform_id = (v->>'platform_id')::uuid,
         gun_id = nullif(v->>'gun_id', '')::uuid,
         parts_snapshot = v->'parts_snapshot'
   where id = p_id
   returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'share_id', v_row.share_id);
end;
$$;
alter function public.update_armory_build(uuid, text, jsonb) owner to postgres;
revoke execute on function public.update_armory_build(uuid, text, jsonb) from public;
grant execute on function public.update_armory_build(uuid, text, jsonb) to anon, authenticated;

-- Claim: signing in after saving moves the list into the account. Token
-- proves the claim; the link (share_id) never changes. Claiming an already
-- claimed row is refused, so a leaked token cannot steal a saved list.
create or replace function public.claim_armory_build(p_id uuid, p_edit_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row gun_guides;
begin
  if v_uid is null then
    raise exception 'sign in to claim a build';
  end if;
  select * into v_row from gun_guides where id = p_id;
  if not found then
    raise exception 'no such build';
  end if;
  if v_row.user_id is not null then
    if v_row.user_id = v_uid then
      return jsonb_build_object('id', v_row.id, 'share_id', v_row.share_id, 'already', true);
    end if;
    raise exception 'this build already belongs to an account';
  end if;
  if p_edit_token is null or v_row.edit_token_hash is null
     or encode(sha256(p_edit_token::bytea), 'hex') <> v_row.edit_token_hash then
    raise exception 'this build''s edit link is required';
  end if;
  update gun_guides set user_id = v_uid, edit_token_hash = null where id = p_id
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'share_id', v_row.share_id);
end;
$$;
alter function public.claim_armory_build(uuid, text) owner to postgres;
revoke execute on function public.claim_armory_build(uuid, text) from public;
grant execute on function public.claim_armory_build(uuid, text) to anon, authenticated;
