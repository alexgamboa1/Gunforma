-- Rollback for supabase/migrations/20261101120000_guide_drafts.sql.
-- Drafts stay as unpublished guides; only their link to the live guide goes.
begin;
drop index if exists public.guides_one_draft_per_guide;
alter table public.guides drop constraint if exists guides_draft_not_self;
alter table public.guides drop constraint if exists guides_draft_unpublished;
alter table public.guides drop column if exists draft_of;
commit;
