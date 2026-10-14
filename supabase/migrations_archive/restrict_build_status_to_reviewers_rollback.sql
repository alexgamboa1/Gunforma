-- Rollback for restrict_build_status_to_reviewers.sql.
--
-- Running this reopens the hole that file closes: any signed-in user can
-- again set their own build to 'approved', or insert one already approved.
-- Only run it if the guard is refusing something it should not, and say
-- what in the commit — the fix is almost certainly to let that caller
-- through by name in the function, not to drop the guard.

begin;

drop trigger if exists trg_restrict_build_status on public.builds;
drop function if exists public.restrict_build_status_to_reviewers();

commit;
