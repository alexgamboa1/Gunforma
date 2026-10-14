-- Rollback for build_comments.sql. Drops everything it created, comments and
-- votes included — there is no soft path back; run this only to un-ship the
-- feature entirely.
begin;
drop view if exists public.build_comments_public;
drop trigger if exists trg_build_comment_votes_guard    on public.build_comment_votes;
drop trigger if exists trg_build_comments_guard_update  on public.build_comments;
drop trigger if exists trg_build_comments_guard_insert  on public.build_comments;
drop function if exists public.build_comment_votes_guard();
drop function if exists public.build_comments_guard_update();
drop function if exists public.build_comments_guard_insert();
drop table if exists public.build_comment_votes;
drop table if exists public.build_comments;
commit;
