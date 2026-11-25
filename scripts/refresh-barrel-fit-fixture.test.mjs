// refresh-barrel-fit-fixture.test.mjs — the scheduled auto-refresh of the
// barrel fit fixture.
//
// .github/workflows/refresh-barrel-fit-fixture.yml runs
// scripts/refresh-barrel-fit-fixture.mjs after each scheduled "Check routes"
// and keeps ONE pull request open with the rewritten fixture. A workflow is
// only exercised on GitHub, twice a day, so what can be held offline is
// held here:
//
//   - the PR body lists every changed barrel once, sorted, with each line of
//     what changed;
//   - the live read and the diff over a stubbed PostgREST: a slide gained,
//     a slide lost, a barrel added, a barrel gone — and an unapproved or
//     discontinued slide never counted;
//   - the workflow's contract: titled "Refresh barrel fit fixture", ONE
//     branch (the script's PR_BRANCH), the existing PR updated rather than a
//     second opened, closed when main catches up, checks out main, commits
//     only the fixture, never merges, never pushes main, runs only after a
//     SCHEDULED Check routes (or by hand).
//
// Run: node scripts/refresh-barrel-fit-fixture.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = await import(pathToFileURL(join(ROOT, 'scripts/refresh-barrel-fit-fixture.mjs')).href);
const FIX = await import(pathToFileURL(join(ROOT, 'scripts/barrel-fit-fixture.mjs')).href);
const WF = await readFile(join(ROOT, '.github/workflows/refresh-barrel-fit-fixture.yml'), 'utf8');

// A stubbed PostgREST for readLiveFits().
function stub({ barrels, rows }) {
  return async (url) => {
    const u = decodeURIComponent(String(url));
    const body = u.includes('/rest/v1/products?') ? barrels.map((slug) => ({ slug }))
      : u.includes('/rest/v1/v_barrel_slide_fit?') ? rows
      : null;
    return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
  };
}
const fit = (b, s, extra = {}) => ({ barrel: { slug: b }, slide: { slug: s, is_approved: true, is_discontinued: false, ...extra } });

test('the live read and the diff', async () => {
  const live = await FIX.readLiveFits({
    url: 'https://x.supabase.co', key: 'k',
    fetchImpl: stub({
      barrels: ['b-one', 'b-two', 'b-new'],
      rows: [
        fit('b-one', 's-a'), fit('b-one', 's-new'),
        fit('b-two', 's-hidden', { is_approved: false }),
        fit('b-two', 's-gone', { is_discontinued: true }),
      ],
    }),
  });
  assert.deepEqual(live, { 'b-one': ['s-a', 's-new'], 'b-two': [], 'b-new': [] });
  const stored = { 'b-one': ['s-a'], 'b-two': ['s-b'], 'b-old': ['s-a'] };
  assert.deepEqual(FIX.diffFits(stored, live), [
    'b-new: live barrel missing from the fixture',
    'b-old: in the fixture, not a live barrel',
    'b-one: now also fits s-new',
    'b-two: no longer fits s-b',
  ]);
  assert.deepEqual(FIX.diffFits(live, live), [], 'same fits, no diff');
  assert.deepEqual(FIX.diffFits({ b: ['y', 'x'] }, { b: ['x', 'y'] }), [], 'order is not a change');
});

test('a failed read throws, never returns an empty map', async () => {
  const fail = async () => new Response('nope', { status: 503 });
  await assert.rejects(FIX.readLiveFits({ url: 'https://x', key: 'k', fetchImpl: fail }), /PostgREST 503/);
  const proxy = async () => new Response('{"ok":true}', { status: 200 });
  await assert.rejects(FIX.readLiveFits({ url: 'https://x', key: 'k', fetchImpl: proxy }), /non-array/);
});

test('the PR body lists every changed barrel once', () => {
  const diff = [
    'b-two: no longer fits s-b',
    'b-one: now also fits s-new',
    'b-one: no longer fits s-old',
    'b-new: live barrel missing from the fixture',
  ];
  const body = R.prBody(diff, { captured: '2026-11-25', runUrl: 'https://github.com/o/r/actions/runs/1' });
  assert.deepEqual(R.changedBarrels(diff), ['b-new', 'b-one', 'b-two']);
  assert.match(body, /\*\*Changed barrels \(3\):\*\*/);
  const listed = [...body.matchAll(/^- `([a-z0-9-]+)`$/gm)].map((m) => m[1]);
  assert.deepEqual(listed, ['b-new', 'b-one', 'b-two'], 'each changed barrel once, sorted');
  for (const d of diff) assert.ok(body.includes('- ' + d.replace(/^([^:]+):/, '`$1`:')), 'lists: ' + d);
  assert.match(body, /captured 2026-11-25/);
  assert.match(body, /actions\/runs\/1/);
  assert.ok(body.includes(R.PR_BRANCH));
});

test('the workflow keeps to one PR and never merges', () => {
  assert.equal(R.PR_TITLE, 'Refresh barrel fit fixture');
  assert.match(WF, /^name: Refresh barrel fit fixture$/m);
  assert.match(WF, new RegExp('BRANCH: ' + R.PR_BRANCH.replace(/\//g, '\\/') + '\\n'), 'one branch, the script\'s');
  assert.match(WF, new RegExp('TITLE: ' + R.PR_TITLE + '\\n'));
  // triggers
  assert.match(WF, /workflow_run:\s*\n\s*workflows: \["Check routes"\]\s*\n\s*types: \[completed\]/);
  assert.match(WF, /github\.event\.workflow_run\.event == 'schedule'/, 'only after a SCHEDULED check');
  assert.match(WF, /concurrency:\s*\n\s*group: refresh-barrel-fit-fixture/, 'runs never overlap');
  // one PR: look first, edit if open, create only if not
  assert.match(WF, /gh pr list [^\n]*--head "\$BRANCH" --state open/);
  assert.match(WF, /if \[ -n "\$n" \]; then\s*\n\s*gh pr edit "\$n"/);
  assert.match(WF, /elif ! gh pr create [^\n]*--base main --head "\$BRANCH"/);
  assert.equal((WF.match(/gh pr create/g) || []).length, 1);
  assert.match(WF, /stale == 'false' && steps\.pr\.outputs\.number != ''/, 'closes a PR main no longer needs');
  // never merges, never main
  assert.doesNotMatch(WF, /gh pr merge|--auto|git merge/);
  assert.doesNotMatch(WF, /push[^\n]*\bmain\b/);
  assert.match(WF, /git push --force origin "HEAD:refs\/heads\/\$BRANCH"/);
  assert.match(WF, /actions\/checkout@v7\s*\n\s*with:\s*\n\s*ref: main/);
  // only the fixture
  assert.match(WF, /\[ "\$changed" != "scripts\/fixtures\/barrel-slide-fit\.json" \]/);
  assert.match(WF, /git add scripts\/fixtures\/barrel-slide-fit\.json\n/);
  assert.doesNotMatch(WF, /git add (-A|\.|--all)/);
  // the reads use the public key, the same one the site ships
  assert.match(WF, /run: node scripts\/refresh-barrel-fit-fixture\.mjs/);
});

test('the workflow carries the site\'s public key, nothing else', async () => {
  const client = await readFile(join(ROOT, 'js/supabase-client.js'), 'utf8');
  const key = client.match(/eyJ[A-Za-z0-9._-]+/)[0];
  assert.ok(WF.includes('SUPABASE_ANON_KEY: ' + key), 'the anon key from js/supabase-client.js');
  assert.doesNotMatch(WF, /service_role|SERVICE_ROLE/);
});
