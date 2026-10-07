// Runs js/maker-link.js and netlify/functions/_maker-link.mjs over the same
// inputs and fails if they disagree on ANY of them — then pins both to the
// documented rules, so a drive-by edit to either copy fails the deploy rather
// than labelling the same button differently on the catalog and the part
// page.
//
// Same shape as build-url.test.mjs, for the same reason: a browser copy and
// a server copy with no module boundary between the pages and the function.
//
// Run: node --test scripts/maker-link.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const browser = await (async () => {
  const src = await readFile(join(ROOT, 'js/maker-link.js'), 'utf8');
  const g = {};
  new Function('window', src)(g);
  return g;
})();
const server = await import(join(ROOT, 'netlify/functions/_maker-link.mjs'));

// [url, makerName, makerWebsite] — every shape the live data has, plus the
// ones it does not have yet.
const CASES = [
  // Maker's own site, with and without www on either side.
  ['https://norsso.com/p365-slide', 'Norsso', 'https://norsso.com'],
  ['https://www.icarusprecision.com/evo-series-grip-modules', 'Icarus Precision', 'https://icarusprecision.com'],
  ['https://armorycraft.com/x', 'Armory Craft', 'https://www.armorycraft.com'],
  // A subdomain of the maker's site is still the maker's store.
  ['https://shop.springerprecision.com/carry-basepad/', 'Springer Precision', 'https://springerprecision.com'],
  // The maker has no website saved: the host is all we can claim.
  ['https://ecmprecision.com/r11-p365-macro-grip-module/', 'ECM Precision', null],
  ['https://shop.springerprecision.com/carry-basepad/', 'Springer Precision', null],
  // Third-party shops carrying a maker's part.
  ['https://illumn.com/olight-pl-pro-valkyrie.html', 'Olight', 'https://www.olightstore.com'],
  ['https://www.sigsauer.com/p365-grip-module-grayguns.html', 'Grayguns', 'https://grayguns.com'],
  ['https://thetriggerguyusa.com/product/ramm-leverage/', 'Ramm Tactical', null],
  // Near-misses that must NOT match: a different TLD, a hyphen, a host that
  // merely contains the site name.
  ['https://aimpoint.us/acro-p-2/', 'Aimpoint', 'https://aimpoint.com'],
  ['https://true-precision.com/axiom/', 'True Precision', 'https://www.trueprecision.com'],
  ['https://notnorsso.com/x', 'Norsso', 'https://norsso.com'],
  ['https://norsso.com.evil.example/x', 'Norsso', 'https://norsso.com'],
  // Case and port.
  ['HTTPS://WWW.NORSSO.COM/P365', 'Norsso', 'https://norsso.com'],
  ['https://norsso.com:8443/x', 'Norsso', 'https://norsso.com'],
  // Website saved but no maker name: nothing to say "from", so the host.
  ['https://norsso.com/x', '', 'https://norsso.com'],
  ['https://norsso.com/x', null, 'https://norsso.com'],
  // Not a link: empty, null, non-http, garbage.
  ['', 'Norsso', 'https://norsso.com'],
  [null, 'Norsso', 'https://norsso.com'],
  [undefined, 'Norsso', null],
  ['javascript:alert(1)', 'Norsso', 'https://norsso.com'],
  ['ftp://norsso.com/x', 'Norsso', 'https://norsso.com'],
  ['mailto:sales@norsso.com', 'Norsso', 'https://norsso.com'],
  ['not a url', 'Norsso', 'https://norsso.com'],
  ['//norsso.com/x', 'Norsso', 'https://norsso.com'],
  // A broken website_url must not break the label.
  ['https://norsso.com/x', 'Norsso', 'norsso.com'],
  ['https://norsso.com/x', 'Norsso', ''],
];

test('both copies produce identical makerLink output for every case', () => {
  for (const [url, name, site] of CASES) {
    const b = browser.makerLink(url, name, site);
    const s = server.makerLink(url, name, site);
    assert.deepEqual(b, s, `makerLink(${JSON.stringify([url, name, site])})\n  browser: ${JSON.stringify(b)}\n  server:  ${JSON.stringify(s)}`);
  }
});

test('both copies produce identical disclosure text for every combination', () => {
  for (const p of [false, true]) {
    for (const m of [false, true]) {
      assert.equal(browser.buyDisclosure(p, m), server.buyDisclosure(p, m), `buyDisclosure(${p}, ${m})`);
    }
  }
  assert.equal(browser.MAKER_REL, server.MAKER_REL);
});

// ── the doctrine, pinned on the server copy (parity above covers the other) ──

test('the maker\'s own site, with or without www and on a subdomain, reads "Buy from <maker>"', () => {
  assert.equal(server.makerLink('https://norsso.com/x', 'Norsso', 'https://norsso.com').label, 'Buy from Norsso');
  assert.equal(server.makerLink('https://www.icarusprecision.com/x', 'Icarus Precision', 'https://icarusprecision.com').label, 'Buy from Icarus Precision');
  assert.equal(server.makerLink('https://armorycraft.com/x', 'Armory Craft', 'https://www.armorycraft.com').label, 'Buy from Armory Craft');
  assert.equal(server.makerLink('https://shop.springerprecision.com/x', 'Springer Precision', 'https://springerprecision.com').label, 'Buy from Springer Precision');
});

test('any other host, including when no website is saved, reads "Buy at <host>" without www', () => {
  assert.equal(server.makerLink('https://ecmprecision.com/x', 'ECM Precision', null).label, 'Buy at ecmprecision.com');
  assert.equal(server.makerLink('https://illumn.com/x', 'Olight', 'https://www.olightstore.com').label, 'Buy at illumn.com');
  assert.equal(server.makerLink('https://www.sigsauer.com/x', 'Grayguns', 'https://grayguns.com').label, 'Buy at sigsauer.com');
  assert.equal(server.makerLink('https://thetriggerguyusa.com/x', 'Ramm Tactical', null).label, 'Buy at thetriggerguyusa.com');
});

test('a host that merely resembles the maker\'s site is not the maker\'s site', () => {
  assert.equal(server.makerLink('https://notnorsso.com/x', 'Norsso', 'https://norsso.com').ownStore, false);
  assert.equal(server.makerLink('https://norsso.com.evil.example/x', 'Norsso', 'https://norsso.com').ownStore, false);
  assert.equal(server.makerLink('https://aimpoint.us/x', 'Aimpoint', 'https://aimpoint.com').ownStore, false);
});

test('only http(s) becomes a link', () => {
  for (const bad of ['', null, undefined, 'javascript:alert(1)', 'ftp://x.com/', 'mailto:a@b.c', 'not a url', '//norsso.com/x']) {
    assert.equal(server.makerLink(bad, 'Norsso', 'https://norsso.com'), null, JSON.stringify(bad));
    assert.equal(server.isHttpUrl(bad), false, JSON.stringify(bad));
  }
  assert.equal(server.isHttpUrl('http://norsso.com/x'), true);
});

test('the disclosure follows the three-way table, and is absent with no links', () => {
  assert.equal(server.buyDisclosure(true, false), 'Gunforma may earn a commission on purchases made through these links.');
  assert.equal(server.buyDisclosure(false, true), "These links go straight to the seller's own store. Gunforma earns nothing on them.");
  assert.equal(server.buyDisclosure(true, true), "Gunforma may earn a commission on retailer links. Links to a maker's own store earn us nothing.");
  assert.equal(server.buyDisclosure(false, false), null);
});

test('a maker link is never marked sponsored', () => {
  assert.equal(server.MAKER_REL, 'noopener nofollow');
  assert.doesNotMatch(server.MAKER_REL, /sponsored/);
});
