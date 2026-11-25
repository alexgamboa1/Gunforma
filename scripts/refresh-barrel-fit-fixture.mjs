// refresh-barrel-fit-fixture.mjs — the scheduled half of the barrel fit
// fixture: when production no longer matches
// scripts/fixtures/barrel-slide-fit.json, rewrite it and describe the change
// for a pull request.
// ─────────────────────────────────────────────────────────────────────────
// Run by .github/workflows/refresh-barrel-fit-fixture.yml after every
// scheduled "Check routes" run. Neither add-part path (the gunforma-add-part
// skill, the admin add-part page) can run a script or commit, so a barrel or
// slide saved through either used to leave the fixture stale until someone
// refreshed it by hand. This closes that: the workflow commits what this
// script writes to ONE branch and keeps ONE pull request open for it; Alex
// merges.
//
// Reads with SUPABASE_URL / SUPABASE_ANON_KEY (the public key — the workflow
// sets them) through barrel-fit-fixture.mjs, the reader the check and the
// hand refresh use, and writes the file with fixtureText(), the hand
// refresh's own format. It refuses to run without them: unlike the check,
// there is no "warn and pass" — a refresh that did not read anything has
// nothing to say.
//
// Outputs (to $GITHUB_OUTPUT when set): stale=true|false, changed=<n>.
// With stale=true it has rewritten the fixture and written the PR body to
// $BODY_FILE (default: refresh-barrel-fit-fixture-body.md).
//
// Not a check (no check- prefix, no .test suffix); its pure half, prBody(),
// is pinned by scripts/refresh-barrel-fit-fixture.test.mjs.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { readLiveFits, diffFits, fixtureText, FIT_FIXTURE, REFRESH_COMMAND } from './barrel-fit-fixture.mjs';

export const PR_TITLE = 'Refresh barrel fit fixture';
export const PR_BRANCH = 'auto/refresh-barrel-fit-fixture';

// The changed barrels, one line each, grouped by barrel — diffFits()'s lines
// already lead with the barrel slug.
export function changedBarrels(diff) {
  return [...new Set(diff.map((d) => d.split(':')[0]))].sort();
}

export function prBody(diff, { captured, runUrl } = {}) {
  const barrels = changedBarrels(diff);
  return [
    '`scripts/fixtures/barrel-slide-fit.json` no longer matched production, so the scheduled refresh rewrote it' +
      (captured ? ' (captured ' + captured + ')' : '') + '. This is the file the build holds every `::fit barrel=` group to.',
    '',
    '**Changed barrels (' + barrels.length + '):**',
    '',
    ...barrels.map((b) => '- `' + b + '`'),
    '',
    '**What changed:**',
    '',
    ...diff.map((d) => '- ' + d.replace(/^([^:]+):/, '`$1`:')),
    '',
    'Nothing else is in this PR. A Netlify deploy runs `check-all.sh` over it, and `check-field-notes.mjs` then holds each `::fit barrel=` group to the new fixture — if an article\'s group no longer shares one set of slides, that build fails, and the article needs editing before this merges.',
    '',
    'This PR is opened and kept current by `.github/workflows/refresh-barrel-fit-fixture.yml`: one PR at a time on `' + PR_BRANCH + '`, force-pushed on each run, closed by the workflow if `main` catches up on its own. Do not commit to its branch. The hand equivalent is `' + REFRESH_COMMAND + '`.',
    ...(runUrl ? ['', 'Run: ' + runUrl] : []),
  ].join('\n') + '\n';
}

async function output(k, v) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, k + '=' + v + '\n');
  console.log(k + '=' + v);
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_ANON_KEY must be set'); process.exit(1); }
  const stored = JSON.parse(await readFile(FIT_FIXTURE, 'utf8')).fits || {};
  const live = await readLiveFits({ url, key });
  const diff = diffFits(stored, live);
  await output('stale', diff.length ? 'true' : 'false');
  await output('changed', String(changedBarrels(diff).length));
  if (diff.length) {
    const captured = new Date().toISOString().slice(0, 10);
    await writeFile(FIT_FIXTURE, fixtureText(live, captured));
    const runUrl = process.env.GITHUB_RUN_ID
      ? (process.env.GITHUB_SERVER_URL || 'https://github.com') + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID
      : null;
    await writeFile(process.env.BODY_FILE || 'refresh-barrel-fit-fixture-body.md', prBody(diff, { captured, runUrl }));
    for (const d of diff) console.log('  ' + d);
  }
}
