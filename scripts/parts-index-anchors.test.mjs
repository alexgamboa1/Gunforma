// parts-index-anchors.test.mjs — /parts's category jump links stay on /parts.
//
// parts-index.mjs serves /parts with <base href="/"/> in its head (the nav's
// relative links depend on it). Its jump nav used href="#<segment>", which
// that base resolves to "/#<segment>" — the homepage — so every category
// link on /parts went home (2026-11-22). The links now name the page,
// "/parts#<segment>".
//
// No network: globalThis.fetch is stubbed with a small catalog (one product
// in two categories, plus a discontinued part so the collapsed list renders)
// and the real handler is run. Asserts: <base href> still set; no href on
// the page starts with "#"; every jump link targets an id on the page; and
// the Discontinued list has no bare-fragment link of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { auditFragments } from './fragment-audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const handler = (await import(pathToFileURL(join(ROOT, 'netlify/functions/parts-index.mjs')).href)).default;

const ROWS = [
  { id: 'a1', slug: 'test-barrel', name: 'Test Barrel', category: 'barrel', is_discontinued: false, manufacturers: { name: 'Acme' } },
  { id: 'a2', slug: 'test-slide',  name: 'Test Slide',  category: 'slide',  is_discontinued: false, manufacturers: { name: 'Acme' } },
  { id: 'a3', slug: 'old-optic',   name: 'Old Optic',   category: 'optic',  is_discontinued: true,  manufacturers: { name: 'Acme' } },
];

test('/parts jump links resolve to sections on /parts, not the homepage', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(ROWS), { status: 200, headers: { 'content-type': 'application/json' } });
  let html;
  try {
    const res = await handler(new Request('https://gunforma.com/parts'));
    assert.equal(res.status, 200);
    html = await res.text();
  } finally {
    globalThis.fetch = realFetch;
  }

  const a = auditFragments(html, '/parts');
  assert.ok(a.hasBase, '<base href> is still set (the nav depends on it) — if it was removed on purpose, revisit this test');
  assert.deepEqual(a.bare, [], 'no href may start with "#" under <base href="/"/> — it resolves to the homepage');

  const jump = [...html.matchAll(/class="jump-link" href="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual([...jump].sort(), ['/parts#barrels', '/parts#slides'],
    'jump links are "/parts#<segment>": ' + jump.join(', '));
  assert.ok(jump.every((h) => h.startsWith('/parts#')), 'every jump link names /parts');
  assert.deepEqual(a.missing, [], 'every /parts#<id> link has an element with that id');

  const disc = html.slice(html.indexOf('id="discontinued"'));
  assert.ok(html.includes('id="discontinued"'), 'the Discontinued list renders for the fixture');
  assert.ok(!/href="#/.test(disc.slice(0, disc.indexOf('</details>'))), 'the Discontinued list has no bare-fragment link');
});
