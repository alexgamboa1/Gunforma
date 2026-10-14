-- ============================================================
-- Gunforma-v2 — prevent_build_photo_path_tampering() blocked service_role
-- APPLIED 2026-09-26. See the record at the bottom of this file.
--
-- No rollback file: the "before" state is the bug below.
--
-- THE BUG
-- The guard refused any change to storage_path, thumb_path, build_id or
-- user_id unless the caller was an admin:
--
--     ... and not public.is_admin() then raise exception ...
--
-- public.is_admin() answers "is the CURRENT USER an admin", and it works out
-- who that is from auth.uid(). A service_role request has no end user, so
-- auth.uid() is NULL, so is_admin() is false. The guard therefore fired on
-- trusted server-side code — the one caller it was never meant to stop.
--
-- THE THING WORTH REMEMBERING
-- **service_role bypasses RLS. It does NOT bypass triggers.**
--
-- That asymmetry is the whole bug. Reaching for the service key is the
-- standard answer to "RLS is in my way", and it works, which is exactly what
-- makes this expensive: the policies step aside, the statement proceeds, and
-- then a BEFORE trigger — which nobody was thinking about, because the
-- mental model was "service_role can do anything" — raises. Every trigger on
-- the table still runs, with the same authority it always had, and any guard
-- inside it that identifies the caller through auth.uid() sees NULL and
-- concludes it is talking to an anonymous stranger.
--
-- WHAT IT COST
-- launch-invite's photo ownership transfer (supabase/functions/launch-invite,
-- step 5) runs as service role and updates build_photos.user_id. This guard
-- rejected it. The function treats that failure as partial success and
-- returns { success: true, warning: ... }, and scripts/launch-invites.js then
-- printed a green tick and "0 failed" — so a half-finished invite, which
-- cannot be retried because the function refuses any build that already has
-- a user_id, reported as a clean launch. The runner is fixed in the same
-- change as this file.
--
-- THE FIX
-- Read the caller's role from the request JWT instead of inferring it from
-- auth.uid(), and let service_role through. This is the pattern CLAUDE.md
-- already prescribes under "A SECURITY DEFINER function must identify the
-- caller from the request JWT" — the same claim, read the same way. The
-- difference here is what it is used FOR: not to stop a definer function
-- trusting its owner, but to recognise a caller who has no auth.uid() at all.
--
-- current_setting(..., true) returns NULL rather than raising when the
-- setting is absent, and the cast is wrapped anyway: a direct psql session
-- has no request.jwt.claims, and the guard must degrade to "not
-- service_role" there rather than erroring inside the trigger.
--
-- The admin path is untouched, and so is the protection this exists for: a
-- signed-in non-admin still cannot repoint a photo's storage_path, build_id
-- or user_id, on any row RLS lets them reach.
-- ============================================================

begin;

create or replace function public.prevent_build_photo_path_tampering()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  jwt_role text;
begin
  -- Absent or unparseable claims must mean "not service_role", never an
  -- error raised from inside a trigger.
  begin
    jwt_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  exception when others then
    jwt_role := '';
  end;

  if (new.storage_path is distinct from old.storage_path
      or new.thumb_path  is distinct from old.thumb_path
      or new.build_id    is distinct from old.build_id
      or new.user_id     is distinct from old.user_id)
     and jwt_role <> 'service_role'
     and not public.is_admin()
  then
    raise exception 'storage_path, thumb_path, build_id, and user_id cannot be changed after upload';
  end if;

  return new;
end;
$function$;

commit;

-- ============================================================
-- APPLIED 2026-09-26 to project lagjjcpclvzrjlrswojt.
--
-- Verified both directions by simulating callers inside transactions that
-- were rolled back, as CLAUDE.md requires for guards of this shape — they
-- read correctly either way, so reading them proves nothing:
--
--                                                    before        after
--   service_role transfers build_photos.user_id      BLOCKED       ALLOWED
--   non-admin changes user_id on a row RLS permits   BLOCKED       BLOCKED
--
-- The second row is the one that matters for the review: widening this guard
-- for service_role must not widen it for anyone else, and it does not. The
-- protection the trigger exists for is intact; only the caller who has no
-- auth.uid() to check is now recognised.
--
-- Note the function was already SECURITY DEFINER with search_path pinned to
-- 'public' before this change. Neither was touched.
-- ============================================================
