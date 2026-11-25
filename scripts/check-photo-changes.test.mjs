// check-photo-changes.test.mjs — the scheduled photo-change alarm.
//
// scripts/check-photo-changes.mjs reads public.photo_changes with the service
// key and fails while any change NOT made through Alex's flow is unreviewed.
// It only runs on GitHub (check-routes.yml), so what it decides is held here
// over a stubbed PostgREST:
//
//   - flagged rows fail, listing every variant and each change (old → new,
//     who), and ask only for unapproved, unreviewed rows;
//   - no rows pass; no credentials warn and pass; the table not existing yet
//     (PGRST205, before the migration) passes with a notice;
//   - any other failed read FAILS — a 401, a 5xx, a network error, a body
//     that is not an array — never reads as clean;
//   - check-routes.yml runs it with the service-role secret, and check-all.sh
//     lists it under NOT_BUILD_CHECKS (a data event must not fail a deploy).
//
// The triggers that FILL the table are tested against a real database by
// supabase/tests/photo-changes.sql (check-migrations.yml).
//
// Run: node scripts/check-photo-changes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { checkPhotoChanges } = await import(pathToFileURL(join(ROOT, 'scripts/check-photo-changes.mjs')).href);
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };

const answer = (status, body) => {
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push({ url: decodeURIComponent(String(url)), init });
    if (body instanceof Error) throw body;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fetchImpl, asked };
};

const ROW = (over) => ({
  id: 1, product_slug: 'true-precision-p365-fuse-threaded', variant_slug: 'tp-fuse-black',
  field: 'primary_image_url', old_value: 'https://maker.example/a.jpg', new_value: 'https://op1.0ps.us/b.jpg',
  changed_at: '2026-11-19T07:40:12Z', changed_by_role: 'session', session_user_name: 'postgres', ...over,
});

test('unapproved, unreviewed rows fail and are listed', async () => {
  const { fetchImpl, asked } = answer(200, [
    ROW({}),
    ROW({ id: 2, variant_slug: 'tp-fuse-gold', field: 'variant_images.url', old_value: null, new_value: 'https://x/c.jpg', changed_by_role: 'service_role' }),
    ROW({ id: 3, field: 'variant_images.position', old_value: '1', new_value: '2' }),
  ]);
  const r = await checkPhotoChanges({ env: ENV, fetchImpl });
  assert.equal(r.status, 'flagged');
  assert.match(r.lines[0], /^3 product photo change\(s\) not made through Alex's flow, on 2 variant\(s\)/);
  const body = r.lines.join('\n');
  assert.match(body, /#1 2026-11-19 07:40 true-precision-p365-fuse-threaded \/ tp-fuse-black — primary_image_url: https:\/\/maker\.example\/a\.jpg → https:\/\/op1\.0ps\.us\/b\.jpg \[by session postgres\]/);
  assert.match(body, /#2 .*tp-fuse-gold — variant_images\.url: \(none\) → https:\/\/x\/c\.jpg \[by service_role\]/);
  assert.match(body, /#3 .*variant_images\.position: 1 → 2/);
  // It asks for the right rows, with the service key.
  assert.equal(asked.length, 1);
  assert.match(asked[0].url, /\/rest\/v1\/photo_changes\?approved=is\.false&reviewed_at=is\.null&/);
  assert.equal(asked[0].init.headers.apikey, 'svc');
});

test('no flagged rows pass', async () => {
  const r = await checkPhotoChanges({ env: ENV, fetchImpl: answer(200, []).fetchImpl });
  assert.equal(r.status, 'clean');
});

test('no credentials warn and pass without a request', async () => {
  const a = answer(200, [ROW({})]);
  for (const env of [{}, { SUPABASE_URL: 'https://x' }, { SUPABASE_SERVICE_ROLE_KEY: 'k' }]) {
    const r = await checkPhotoChanges({ env, fetchImpl: a.fetchImpl });
    assert.equal(r.status, 'skipped');
    assert.match(r.lines[0], /^WARNING/);
  }
  assert.equal(a.asked.length, 0);
});

test('the table not existing yet passes with a notice; nothing else does', async () => {
  const pending = await checkPhotoChanges({ env: ENV, fetchImpl: answer(404, { code: 'PGRST205' }).fetchImpl });
  assert.equal(pending.status, 'pending');
  for (const [status, body] of [[401, { code: 'PGRST301' }], [404, { code: 'PGRST999' }], [503, 'upstream'], [200, { rows: [] }]]) {
    const r = await checkPhotoChanges({ env: ENV, fetchImpl: answer(status, body).fetchImpl });
    assert.equal(r.status, 'error', status + ' ' + JSON.stringify(body) + ' read as ' + r.status);
  }
  const net = await checkPhotoChanges({ env: ENV, fetchImpl: answer(0, new TypeError('fetch failed')).fetchImpl });
  assert.equal(net.status, 'error');
});

test('it runs twice a day with the service key, and never in the build', async () => {
  const wf = await readFile(join(ROOT, '.github/workflows/check-routes.yml'), 'utf8');
  assert.match(wf, /run: node scripts\/check-photo-changes\.mjs/);
  assert.match(wf, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
  const all = await readFile(join(ROOT, 'scripts/check-all.sh'), 'utf8');
  const notBuild = (all.match(/NOT_BUILD_CHECKS=\(([\s\S]*?)\n\)/) || [, ''])[1];
  assert.match(notBuild, /scripts\/check-photo-changes\.mjs/);
  assert.doesNotMatch(all, /^check .*check-photo-changes\.mjs/m);
});
