-- ============================================================
-- Gunforma-v2 — platforms.is_live
-- APPLIED 2026-09-25. See the record at the bottom of this file.
--
-- No rollback file: `alter table ... drop column is_live` is the whole of it,
-- and the column carries no data worth archiving.
--
-- WHY
-- A platform is only worth offering in the builder once there is something to
-- build with. SIG P320 has 0 parts and 0 builds, so it reads as a dead end to
-- anyone who picks it. is_live is the switch that keeps it out of the public
-- picker without deleting the row — the platform, its slug and any future
-- parts keep their identity, same idea as retired_at on affiliate_links.
--
-- Default true so every existing platform stays exactly as it is, and so a
-- newly inserted platform is live unless someone says otherwise.
--
-- ORDER MATTERS — and it was met. This had to run BEFORE the code that
-- filters on it. gunforma-post-build.html selects platforms with
-- .eq('is_live', true); had that shipped first, PostgREST would have
-- rejected the whole query with 42703 (undefined column) and the platform
-- picker would render empty — no platforms, no way to start a build. Same
-- failure shape as the is_primary drop: a reader naming a column the
-- database does not have takes the entire query down, not just the filter.
-- gunforma-admin-post.html does NOT filter, so admins keep seeing every
-- platform either way.
-- ============================================================

begin;

alter table public.platforms
  add column is_live boolean not null default true;

comment on column public.platforms.is_live is
  'False hides the platform from the public builder picker (gunforma-post-build.html). The admin poster ignores this flag on purpose. Not a delete — the row and its slug stay.';

-- 0 parts and 0 builds as of 2026-09-25.
update public.platforms
   set is_live = false
 where name = 'SIG P320';

commit;

-- ============================================================
-- APPLIED 2026-09-25 to project lagjjcpclvzrjlrswojt.
-- Verified live after the change: platforms.is_live exists, and SIG P320 is
-- the one row set false.
--
-- Note for anyone reading the history: an earlier revision of this file
-- carried a NOT YET APPLIED status, recorded on 2026-09-25 from a read-only
-- check that found no is_live column. It was added later the same day, from
-- another session. Both statements were true when written; this one
-- supersedes.
-- ============================================================
