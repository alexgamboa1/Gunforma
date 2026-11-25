// check-barrel-fit-fixture.mjs — scripts/fixtures/barrel-slide-fit.json
// still says what production says.
// ─────────────────────────────────────────────────────────────────────────
// check-field-notes.mjs holds every ::fit barrel=a,b group to the fixture,
// offline, because the build cannot read the database. The fixture is
// refreshed by hand. A barrel or slide added (or approved, discontinued,
// locked) without a refresh leaves the build grading the article against
// stale data, and nothing says so: the article still renders, and the
// renderer re-checks the rule live on every request. This compares the file
// with the live rows, through the same reader the refresh uses
// (barrel-fit-fixture.mjs), and fails naming every barrel that moved.
//
// CREDENTIALS. It reads with the public anon key, but only when the
// environment supplies one — SUPABASE_URL and SUPABASE_ANON_KEY — and
// otherwise WARNS AND PASSES. That is deliberate: the build cannot see the
// database (CLAUDE.md, NOT_BUILD_CHECKS), so a data change in production
// must not fail an unrelated deploy. Where it runs, as of 2026-11-24:
//
//   Netlify build (check-all.sh)  neither variable is set → warns, passes
//   check-routes.yml (twice a day, and on demand)  both set → compares, and
//                                 the job goes red when the fixture is stale
//   a laptop                      set them to compare; unset, it warns
//
// A failed read with credentials present fails (a 5xx is not a pass).
//
// Run: SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/check-barrel-fit-fixture.mjs
import { readFile } from 'node:fs/promises';
import { readLiveFits, diffFits, FIT_FIXTURE, REFRESH_COMMAND } from './barrel-fit-fixture.mjs';

export const STALE_MESSAGE = 'Barrel fit fixture is out of date. Run ' + REFRESH_COMMAND + '.';

export async function checkFixture({ env = process.env, fetchImpl = fetch, fixturePath = FIT_FIXTURE } = {}) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { status: 'skipped', lines: ['WARNING: barrel fit fixture NOT compared with the live database — SUPABASE_URL / SUPABASE_ANON_KEY are not set here. check-routes.yml compares it twice a day.'] };
  }
  const stored = JSON.parse(await readFile(fixturePath, 'utf8')).fits || {};
  let live;
  try {
    live = await readLiveFits({ url, key, fetchImpl });
  } catch (e) {
    return { status: 'error', lines: ['could not read v_barrel_slide_fit: ' + (e && e.message)] };
  }
  const diff = diffFits(stored, live);
  if (!diff.length) return { status: 'fresh', lines: ['barrel fit fixture matches production (' + Object.keys(live).length + ' barrels)'] };
  return { status: 'stale', lines: [STALE_MESSAGE, ...diff.map((d) => '  ' + d)] };
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const r = await checkFixture();
  for (const l of r.lines) (r.status === 'fresh' || r.status === 'skipped' ? console.log : console.error)(l);
  process.exit(r.status === 'fresh' || r.status === 'skipped' ? 0 : 1);
}
