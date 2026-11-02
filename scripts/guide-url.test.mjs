// Runs js/guide-url.js and netlify/functions/_guide-url.mjs over the same
// inputs and fails if they disagree on ANY of them — the same pair, for the
// same reason, as scripts/build-url.test.mjs: the server copy emits a /gg/
// page's canonical and the sitemap's URL, the browser copy builds the card
// links and the URL a Share button copies. One character apart, and a
// shared link names a different URL from the one the page declares.
//
// Also pinned: the slug rule IS buildSlug(), so a guide and a build titled
// alike slug alike — one rule for every URL this site builds from a name.
//
// Run: node --test scripts/guide-url.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const browser = await (async () => {
  const src = await readFile(join(ROOT, 'js/guide-url.js'), 'utf8');
  const g = {};
  new Function('window', src)(g);
  return g;
})();
const server = await import(pathToFileURL(join(ROOT, 'netlify/functions/_guide-url.mjs')).href);
const { buildSlug } = await import(pathToFileURL(join(ROOT, 'netlify/functions/_build-url.mjs')).href);

const ID  = 'd1ccac3a-3f29-4e5c-a14e-667386e46315';
const ID2 = '11111111-2222-4333-8444-555555555555';

const TITLES = [
  'Sig P365 Concealed Carry', 'sig p365 concealed carry', 'Sig P365 Range / Competition',
  'My "Duty" Guide #2', '   leading and trailing   ', '!!!', '---', '', null, undefined, '  ',
  'Ünïcode Gúide', 'emoji 🔫 guide', 'A'.repeat(200),
  'trailing hyphen after cut ------------------------------------------------ x',
  ID, 'd1ccac3a', '2026', 'Guide   with    runs',
];
const PATHS = [
  '/gg/' + ID, '/gg/sig-p365-concealed-carry-' + ID, '/gg/' + ID + '/',
  '/gg/a-b-' + ID + '#x', '/gg/a-b-' + ID + '?s=1', '/gg/' + ID.toUpperCase(),
  'sig-p365-concealed-carry-' + ID, ID, '/gg/' + ID2 + '-' + ID,
  '/gg/not-a-guide', '/gg/', '', null,
];

test('the two copies agree on slug, path and url', () => {
  for (const t of TITLES) {
    assert.equal(browser.gunGuideSlug(t), server.gunGuideSlug(t), 'slug differs for ' + JSON.stringify(t));
    for (const id of [ID, ID2, '', null]) {
      assert.equal(browser.gunGuidePath(id, t), server.gunGuidePath(id, t), 'path differs for ' + JSON.stringify([id, t]));
      assert.equal(browser.gunGuideUrl(id, t), server.gunGuideUrl(id, t), 'url differs for ' + JSON.stringify([id, t]));
    }
  }
});

test('the two copies agree on the id out of a path', () => {
  for (const p of PATHS) {
    assert.equal(browser.gunGuideIdFromPath(p), server.gunGuideIdFromPath(p), 'id differs for ' + JSON.stringify(p));
  }
});

test('the slug rule is buildSlug — one rule for every URL built from a name', () => {
  for (const t of TITLES) assert.equal(server.gunGuideSlug(t), buildSlug(t), JSON.stringify(t));
});

test('shape: /gg/<slug>-<uuid>, apex, and /gg/<uuid> for a title that slugs to nothing', () => {
  assert.equal(server.gunGuidePath(ID, 'Sig P365 Concealed Carry'), '/gg/sig-p365-concealed-carry-' + ID);
  assert.equal(server.gunGuideUrl(ID, 'Sig P365 Concealed Carry'), 'https://gunforma.com/gg/sig-p365-concealed-carry-' + ID);
  assert.equal(server.gunGuidePath(ID, '!!!'), '/gg/' + ID);
  assert.equal(server.gunGuidePath('', 'x'), '');
});

test('the uuid is what resolves — renamed, slug-less, uppercase, or titled like a uuid', () => {
  for (const t of TITLES) assert.equal(server.gunGuideIdFromPath(server.gunGuidePath(ID, t)), ID, JSON.stringify(t));
  assert.equal(server.gunGuideIdFromPath('/gg/' + ID.toUpperCase()), ID, 'normalised to lowercase');
  assert.equal(server.gunGuideIdFromPath(server.gunGuidePath(ID, ID2)), ID, 'the LAST uuid wins');
  for (const p of ['/gg/not-a-guide', '/gg/', '', null, '/gg/d1ccac3a']) {
    assert.equal(server.gunGuideIdFromPath(p), null, JSON.stringify(p));
  }
});
