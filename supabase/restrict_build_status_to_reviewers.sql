-- ============================================================
-- Gunforma-v2 — only a reviewer can approve or reject a build
-- NOT YET APPLIED. Rollback: restrict_build_status_to_reviewers_rollback.sql
--
-- WHAT WAS OPEN
-- Any signed-in user could publish their own build without review.
-- Measured 2026-10-06, as an ordinary user (role 'user') through the same
-- path the browser uses, inside a rolled-back transaction:
--
--   update builds set status = 'approved' where id = <my pending build>
--     -> 1 row. status = approved, reviewed_by = MYSELF.
--   insert into builds (..., status) values (..., 'approved')
--     -> OK. Born live, never in the queue.
--
-- The review queue was a convention of the page, not a rule of the database.
-- gunforma-post-build.html only ever sends 'draft' or 'pending', so nothing
-- on the site did this — but the anon key is public and the browser console
-- is one keystroke away, and "the page doesn't do that" is the assumption
-- CLAUDE.md's first paragraph on security tells you not to make.
--
-- WHY NOTHING STOPPED IT
--   - "Owners can edit their own builds" and "Users can create their own
--     builds" both check auth.uid() = user_id and nothing else. Correct for
--     what they are: RLS says WHICH ROWS, it cannot say which values of
--     which column.
--   - authenticated holds INSERT and UPDATE on builds.status, and has to:
--     draft -> pending is how a build is submitted.
--   - restrict_owner_edits_on_approved_build only fires its checks when
--     OLD.status = 'approved'. It stops an owner changing a live build. It
--     says nothing about how a build becomes live.
--   - stamp_build_review() then recorded the owner as their own reviewer.
--
-- THE RULE
-- A caller who is not an admin and not a trusted backend may:
--   INSERT a build as 'draft' or 'pending'
--   UPDATE a build's status only TO 'draft' or 'pending'
-- and so may never write 'approved' or 'rejected'. An UPDATE that leaves
-- the status alone is not this function's business — an owner editing a
-- rejected build's description before resubmitting passes untouched.
--
-- WHO IS TRUSTED, AND HOW IT IS DECIDED
--   is_admin()            profiles.role = 'admin' for auth.uid(). The review
--                         queue (approve / reject / undo) and
--                         gunforma-admin-post.html (inserts 'approved').
--   is_trusted_backend()  a request whose JWT role is service_role
--                         (launch-invite, scripts), or a session with no
--                         request context at all (the SQL editor, a
--                         migration). It reads the claim through
--                         nullif(..., ''), so it does not have the defect
--                         logged against restrict_owner_edits_on_approved_
--                         build, which tests `claims is null` and so treats
--                         a pooled connection's '' as an API caller.
-- Neither is current_user, which inside a SECURITY DEFINER function is the
-- function's owner (CLAUDE.md, "A SECURITY DEFINER function must identify
-- the caller from the request JWT").
--
-- IT DOES NOT OVERLAP THE EXISTING GUARD
-- An owner moving a LIVE build back to pending passes this function
-- ('pending' is a status an owner may write) and is refused by
-- trg_restrict_owner_edits_on_approved, as before. BEFORE triggers fire in
-- name order and this one sorts first (trg_restrict_b… < trg_restrict_o…);
-- neither modifies NEW, so the order does not change the outcome.
--
-- NOT COVERED, ON PURPOSE
-- reviewed_by, reviewed_at and rejection_reason on a build that is not yet
-- live: an owner can still write them directly. They decide nothing — a
-- build is public because status = 'approved' and for no other reason —
-- and stamp_build_review() rewrites them in a BEFORE trigger of its own, so
-- guarding them here means reasoning about trigger order for no gain in
-- what a visitor can see. Logged, not built.
--
-- Same for rejected -> draft -> pending through the API: both steps are
-- statuses an owner may write, and stamp_build_review() only logs a resubmit
-- and clears the review columns on rejected -> pending directly, so that
-- route skips the resubmit entry and leaves the old rejection_reason on the
-- row. The page never offers it (a rejected build has no Save as draft).
-- It changes what the history says, not what is public.
-- ============================================================

begin;

create or replace function public.restrict_build_status_to_reviewers()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.is_trusted_backend() or public.is_admin() then
    return new;
  end if;

  -- IS DISTINCT FROM, not NOT IN: status is NOT NULL today, but `x not in
  -- (...)` is NULL for a NULL x and an IF treats NULL as false, which would
  -- make a guard that passes exactly the value nobody thought about.
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' and new.status is distinct from 'pending' then
      raise exception 'A new build starts as a draft or goes into review. Only a reviewer can approve or reject it.'
        using errcode = '42501';   -- insufficient_privilege -> HTTP 403
    end if;
  elsif new.status is distinct from old.status
        and new.status is distinct from 'draft'
        and new.status is distinct from 'pending' then
    raise exception 'Only a reviewer can approve or reject a build.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- A trigger function is never called directly, and firing a trigger does
-- not check EXECUTE on it. Same ACL as the other build guards
-- (postgres, service_role).
revoke execute on function public.restrict_build_status_to_reviewers() from public, anon, authenticated;

drop trigger if exists trg_restrict_build_status on public.builds;
create trigger trg_restrict_build_status
  before insert or update on public.builds
  for each row execute function public.restrict_build_status_to_reviewers();

commit;

-- ============================================================
-- PROVED BEFORE WRITING THIS FILE, 2026-10-06, against project
-- lagjjcpclvzrjlrswojt: the function and trigger above created inside one
-- DO block, every caller simulated with `set local role` plus a real `sub`
-- in request.jwt.claims, then RAISE to roll the whole thing back. Read back
-- afterwards: 4 builds, no function, no trigger — nothing was left behind.
--
--   direct session    insert 'approved'                        OK
--   owner             insert 'approved'                        REFUSED 42501
--   owner             insert 'rejected'                        REFUSED
--   owner             insert 'pending'                         OK
--   owner             insert 'draft'                           OK
--   owner             pending -> approved                      REFUSED 42501
--   owner             pending -> rejected                      REFUSED
--   owner             edits name + parts of a build in review  1 row
--   owner             pending -> draft -> pending              OK
--   admin             approve, undo, reject                    OK
--   admin             insert 'approved', user_id null          OK
--   admin             edits parts of a LIVE unowned build,
--                     no status sent                           1 row, still approved
--   owner             rejected -> approved                     REFUSED
--   owner             rejected -> pending (resubmit)           1 row, resubmit logged
--   service_role      pending -> approved                      1 row
--   owner             renames own live build                   1 row
--   owner             live -> pending                          REFUSED (existing guard)
--
-- Rows 8 and 12 are the two saves gunforma-post-build.html's edit mode
-- gained in the same PR — an owner editing a build in review, and an admin
-- editing a build nobody owns. Neither needs this file: both passed before
-- it and pass after it. This file closes a hole; it does not open a door.
--
-- ORDER. Unlike most migrations here, this one does not have to wait for
-- the code. No page, function or script writes 'approved' or 'rejected' as
-- anyone but an admin or the service role (swept: gunforma-*.html, js/,
-- netlify/, scripts/, supabase/functions/), so there is no deployed code
-- for it to break and it can be applied before or after the merge.
--
-- AFTER APPLYING, expect:
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.builds'::regclass and tgname = 'trg_restrict_build_status';
--                                                                 -- one row
--
-- and, signed in as a non-admin in the browser console on the live site:
--
--   await sb.from('builds').update({ status: 'approved' }).eq('id', '<your own pending build>')
--                                   -- error.code '42501', "Only a reviewer can…"
-- ============================================================
