-- Gunforma guides: drafts and published (Alex, 2026-11-01).
--
-- BEFORE. An admin's Edit on a Gunforma guide opened the live row in the
-- Armory and Save wrote straight back to it — every change was public the
-- moment it was saved. And the Armory restored its last identity on any
-- visit, so "Build yours in the Armory" landed an admin in edit mode on the
-- last guide they had opened, one click from rewriting it.
--
-- AFTER. A published guide is never edited in place. Edit opens a DRAFT:
-- a separate, unpublished guides row whose draft_of names the live guide.
-- Publishing it copies its contents onto the live row (same id) and deletes
-- the draft. This file adds only the link; the rule is the page's, and the
-- page also filters every update to a Gunforma guide on
-- is_published = false, so a live row cannot be written by an edit.
--
--   * guides.draft_of — the live guide this draft will replace, or NULL
--     for a guide that is its own (a new guide's draft, or any published
--     guide). ON DELETE SET NULL: deleting the live guide leaves the draft
--     as a draft of nothing, never deletes work.
--   * guides_draft_unpublished — a row naming draft_of is unpublished.
--     A published row with draft_of set would be a second live copy.
--   * guides_draft_not_self — a guide is not a draft of itself.
--   * guides_one_draft_per_guide — one draft per live guide, so Edit
--     always reopens the same draft instead of starting a second.
--
-- No grants or policies change: guides' admin policies
-- (20261030200231_guides_admin_writes.sql) already cover reading, writing
-- and deleting drafts, and anon's SELECT sees published rows only, which
-- never carry draft_of.
--
-- House order: the pages that read draft_of (gunforma-armory.html,
-- gunforma-gun-guides.html) merge and deploy BEFORE this is applied. Until
-- then both probe for the column and keep a draft's link to its live guide
-- in the editing browser only.
--
-- Rollback: supabase/guide_drafts_rollback.sql.

alter table public.guides
  add column draft_of uuid references public.guides (id) on delete set null;

alter table public.guides
  add constraint guides_draft_unpublished check (draft_of is null or is_published = false);

alter table public.guides
  add constraint guides_draft_not_self check (draft_of is null or draft_of <> id);

create unique index guides_one_draft_per_guide on public.guides (draft_of)
  where draft_of is not null;

comment on column public.guides.draft_of is
  'The published guide this unpublished draft replaces when it is published; NULL for a guide that is its own.';
