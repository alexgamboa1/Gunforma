-- Rollback for notifications.sql. Drops the inbox and its triggers; the
-- source tables (build_comments, build_fires) are untouched.
begin;
drop trigger if exists trg_notify_on_like    on public.build_fires;
drop trigger if exists trg_notify_on_comment on public.build_comments;
drop trigger if exists trg_notifications_guard_update on public.notifications;
drop function if exists public.notify_on_like();
drop function if exists public.notify_on_comment();
drop function if exists public.notifications_guard_update();
drop table if exists public.notifications;
commit;
