// check-slide-fit-fixture.mjs — scripts/fixtures/slide-frame-fit.json still
// says what production says. The twin of check-barrel-fit-fixture.mjs, for
// the ::fit slide= against=frame group rule: same credentials rule (with
// SUPABASE_URL / SUPABASE_ANON_KEY it compares, without them it WARNS AND
// PASSES, because the build cannot see the database), same reader as the
// refresh (slide-fit-fixture.mjs). check-routes.yml runs it with the key.
//
// Run: SUPABASE_URL=… SUPABASE_ANON_KEY=… node scripts/check-slide-fit-fixture.mjs
import { readFile } from 'node:fs/promises';
import { readLiveSlideFrameFits, diffSlideFits, SLIDE_FIT_FIXTURE, SLIDE_REFRESH_COMMAND } from './slide-fit-fixture.mjs';

export const STALE_MESSAGE = 'Slide fit fixture is out of date. Run ' + SLIDE_REFRESH_COMMAND + '.';

export async function checkSlideFixture({ env = process.env, fetchImpl = fetch, fixturePath = SLIDE_FIT_FIXTURE } = {}) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_ANON_KEY;
  if (!url || !key) return { status: 'skipped', lines: ['WARNING: slide fit fixture NOT compared with the live database — SUPABASE_URL / SUPABASE_ANON_KEY are not set here. check-routes.yml compares it twice a day.'] };
  const stored = JSON.parse(await readFile(fixturePath, 'utf8')).fits || {};
  let live;
  try { live = await readLiveSlideFrameFits({ url, key, fetchImpl }); }
  catch (e) { return { status: 'error', lines: ['could not read v_slide_frame_fit: ' + (e && e.message)] }; }
  const diff = diffSlideFits(stored, live);
  if (!diff.length) return { status: 'fresh', lines: ['slide fit fixture matches production (' + Object.keys(live).length + ' slides)'] };
  return { status: 'stale', lines: [STALE_MESSAGE, ...diff.map((d) => '  ' + d)] };
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const r = await checkSlideFixture();
  for (const l of r.lines) (r.status === 'fresh' || r.status === 'skipped' ? console.log : console.error)(l);
  process.exit(r.status === 'fresh' || r.status === 'skipped' ? 0 : 1);
}
