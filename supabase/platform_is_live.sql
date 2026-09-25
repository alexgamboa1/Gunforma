-- ============================================================
-- Gunforma-v2 — platforms.is_live
-- NOT YET APPLIED. See the status note at the bottom of this header.
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
-- ORDER MATTERS. Run this BEFORE deploying the code that filters on it.
-- gunforma-post-build.html selects platforms with .eq('is_live', true); if
-- that ships first, PostgREST rejects the whole query with 42703 (undefined
-- column) and the platform picker renders empty — no platforms, no way to
-- start a build. Same failure shape as the is_primary drop: a reader naming a
-- column the database does not have takes the entire query down, not just the
-- filter. gunforma-admin-post.html does NOT filter, so admins keep seeing
-- every platform either way.
--
-- STATUS
-- This file was written as a record of a change reported as already applied.
-- It is NOT applied. Verified read-only against project lagjjcpclvzrjlrswojt
-- on 2026-09-25: platforms has no is_live column. Run this file before the
-- accompanying code change is deployed.
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
