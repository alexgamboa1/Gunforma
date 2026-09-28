// Runs js/build-url.js and netlify/functions/_build-url.mjs over the same
// inputs and fails if they disagree on ANY of them.
//
// This pair is not like the category map, where drift ships a 404 someone
// notices. These two produce the canonical tag — the server copy emits it,
// the browser copy re-emits it once the build data loads. A one-character
// disagreement means the page declares two different canonical URLs for the
// same build during one page load, renders perfectly, and re-creates the
// duplicate-URL problem the /b/ work exists to fix.
//
// Run: node --test scripts/build-url.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load the browser copy the way a page does: as a script against a global.
const browser = await (async () => {
  const src = await readFile(join(ROOT, 'js/build-url.js'), 'utf8');
  const g = {};
  new Function('window', src)(g);
  return g;
})();
const server = await import(join(ROOT, 'netlify/functions/_build-url.mjs'));

const ID  = '9b68ab79-aa94-4446-8a25-8b3356b799fb';
const ID2 = '11111111-2222-4333-8444-555555555555';

const NAMES = [
  'P365 All Day',
  'p365 all day',
  'Sig P320 — "Carry" Build #2',
  '   leading and trailing   ',
  '!!!',
  '---',
  '',
  null,
  undefined,
  '  ',
  'Glock 19 / Gen 5 (RMR cut)',
  'Ünïcode Büild',
  'emoji 🔫 build',
  'A'.repeat(200),
  'a-very-long-name-that-will-definitely-be-cut-off-somewhere-around-sixty-characters-in',
  'trailing hyphen after cut ------------------------------------------------ x',
  ID,                       // a name that IS a uuid
  '9b68ab79',               // a name that looks like the head of one
  '2026',
  'Build   with    runs',
];

const PATHS = [
  '/b/' + ID,
  '/b/p365-all-day-' + ID,
  '/b/' + ID + '/',
  '/b/a-b-c-' + ID + '#c-12',
  '/b/a-b-c-' + ID + '?x=1',
  '/b/' + ID.toUpperCase(),
  'p365-all-day-' + ID,                 // bare splat
  ID,                                   // bare uuid splat
  '/b/' + ID2 + '-' + ID,               // slug that is itself a uuid
  '/b/not-a-build',
  '/b/',
  '',
  null,
];

test('buildSlug agrees across the two copies', () => {
  for (const n of NAMES) {
    assert.equal(browser.buildSlug(n), server.buildSlug(n), 'slug differs for ' + JSON.stringify(n));
  }
});

test('buildPath and buildUrl agree across the two copies', () => {
  for (const n of NAMES) {
    for (const id of [ID, ID2, '', null]) {
      assert.equal(browser.buildPath(id, n), server.buildPath(id, n),
        'path differs for ' + JSON.stringify([id, n]));
      assert.equal(browser.buildUrl(id, n), server.buildUrl(id, n),
        'url differs for ' + JSON.stringify([id, n]));
    }
  }
});

test('buildIdFromPath agrees across the two copies', () => {
  for (const p of PATHS) {
    assert.equal(browser.buildIdFromPath(p), server.buildIdFromPath(p),
      'id differs for ' + JSON.stringify(p));
  }
});

test('slug rules', () => {
  const s = server.buildSlug;
  assert.equal(s('P365 All Day'), 'p365-all-day');
  assert.equal(s('Sig P320 — "Carry" Build #2'), 'sig-p320-carry-build-2');
  assert.equal(s('   leading and trailing   '), 'leading-and-trailing');
  assert.equal(s('!!!'), '', 'symbols-only slugs to nothing');
  assert.equal(s(''), '');
  assert.equal(s(null), '');
  assert.equal(s('Ünïcode Büild'), 'unicode-build', 'diacritics fold, not hyphenate');
  assert.equal(s('Build   with    runs'), 'build-with-runs', 'runs collapse');
  assert.ok(s('A'.repeat(200)).length <= 60, 'capped');
  assert.ok(!s('x '.repeat(80)).endsWith('-'), 'a cut never leaves a trailing hyphen');
  assert.equal(s('P365 All Day'), s('P365 All Day'), 'deterministic');
});

test('an empty or symbols-only name still yields a working URL', () => {
  assert.equal(server.buildPath(ID, ''),    '/b/' + ID);
  assert.equal(server.buildPath(ID, '!!!'), '/b/' + ID);
  assert.equal(server.buildIdFromPath(server.buildPath(ID, '!!!')), ID);
});

test('the uuid is what resolves, whatever the slug is', () => {
  for (const n of NAMES) {
    const path = server.buildPath(ID, n);
    assert.equal(server.buildIdFromPath(path), ID, 'round trip failed for ' + JSON.stringify(n));
  }
  // Renaming changes the URL but never the id, and the old URL still resolves.
  const before = server.buildPath(ID, 'Old Name');
  const after  = server.buildPath(ID, 'Totally Different Name');
  assert.notEqual(before, after, 'a rename changes the URL');
  assert.equal(server.buildIdFromPath(before), ID, 'the OLD url still resolves');
  assert.equal(server.buildIdFromPath(after),  ID);
});

test('two builds with the same name get different URLs', () => {
  assert.notEqual(server.buildPath(ID, 'Same Name'), server.buildPath(ID2, 'Same Name'));
  assert.equal(server.buildIdFromPath(server.buildPath(ID,  'Same Name')), ID);
  assert.equal(server.buildIdFromPath(server.buildPath(ID2, 'Same Name')), ID2);
});

test('a slug that is itself a uuid does not shadow the id', () => {
  const path = server.buildPath(ID, ID2);     // name IS a uuid
  assert.equal(server.buildIdFromPath(path), ID, 'the LAST uuid wins');
});

test('non-build paths yield null rather than a bogus id', () => {
  for (const p of ['/b/not-a-build', '/b/', '', null, '/b/9b68ab79']) {
    assert.equal(server.buildIdFromPath(p), null, JSON.stringify(p));
  }
});

test("shareUrl's guard still matches a slug URL", () => {
  // The literal regex from gunforma-build-detail.html's shareUrl().
  const GUARD = /\/b\/[^/]+$/;
  assert.ok(GUARD.test(server.buildUrl(ID, 'P365 All Day')), 'slug form');
  assert.ok(GUARD.test(server.buildUrl(ID, '')), 'bare uuid form');
  assert.ok(!GUARD.test('https://gunforma.com/gunforma-build-detail.html'), 'id-less page still refused');
});
