// Pins every verdict js/frame-fit.js gives the catalog — the grip filter and
// the "does this fit MY gun" badge — for the three guns the 2026-10-21 audit
// turned on (P365 FUSE, FUSE Comp, XMacro) against the FUSE's own factory
// module, a maker-stated aftermarket one, a fuse-class one, and a maker that
// is silent. Every cell renders perfectly whichever way it falls, which is
// why it is pinned here.
//
// Run: node --test scripts/frame-fit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { FrameFit } = await (async () => {
  const src = await readFile(join(ROOT, 'js/frame-fit.js'), 'utf8');
  const g = {};
  new Function('window', src)(g);
  return g;
})();

// guns, as the catalog's GUNS rows carry them (slug, name, housing_class)
const FUSE      = { slug: 'p365-fuse',      name: 'P365 FUSE',      housing_class: 'fuse' };
const FUSE_COMP = { slug: 'p365-fuse-comp', name: 'P365 FUSE Comp', housing_class: 'fuse' };
const XMACRO    = { slug: 'p365-xmacro',    name: 'P365 XMacro',    housing_class: 'xmacro' };
const XL        = { slug: 'p365-xl',        name: 'P365 XL',        housing_class: 'p365xl' };
const P365      = { slug: 'p365',           name: 'P365',           housing_class: 'p365' };
// every P365 housing class a gun carries in production (read 2026-10-22);
// fuse-xl and xmacro-sub are frame classes no gun carries
const GUNS = [FUSE, FUSE_COMP, XMACRO, XL, P365];

// frames, as the catalog's product rows carry them
const frame = (slug, housing_class) => ({ slug, category: 'frame', frame_specs: housing_class ? { housing_class } : null });
const OEM      = frame('sig-sauer-p365-fuse-xmacro-gm-oem', 'xmacro');   // Sig: "Factory grip module of the P365-FUSE"
const ARMORY   = frame('armory-craft-grip-module-p365xmacro', 'xmacro'); // Armory Craft: "comes stock on ... P365 FUSE models"
const ECM_FUSE = frame('ecm-precision-r11-fuse', 'fuse');                // a fuse-class module
const GRAYGUNS = frame('grayguns-p365-xmacro-gm', 'xmacro');             // silent on the FUSE
const NOSPEC   = frame('some-frame-without-a-spec', null);
const FUSE_XL  = frame('icarus-precision-ace-fuse-evo', 'fuse-xl');      // a class no gun carries

test('the nine cells: FUSE, FUSE Comp and XMacro against the OEM module, Armory Craft and ECM R11 Fuse', () => {
  const v = (f, g) => FrameFit.verdict(f, g, GUNS);
  // the FUSE's own factory grip, and a maker-stated aftermarket one: fits the FUSE now
  assert.equal(v(OEM, FUSE), 'fits');
  assert.equal(v(OEM, FUSE_COMP), 'fits');
  assert.equal(v(OEM, XMACRO), 'fits');
  assert.equal(v(ARMORY, FUSE), 'fits');
  assert.equal(v(ARMORY, FUSE_COMP), 'fits');
  assert.equal(v(ARMORY, XMACRO), 'fits');
  // a fuse-class module: fits the FUSE guns, and the other direction stays ✗
  assert.equal(v(ECM_FUSE, FUSE), 'fits');
  assert.equal(v(ECM_FUSE, FUSE_COMP), 'fits');
  assert.equal(v(ECM_FUSE, XMACRO), 'no');
});

test('a maker silent on the FUSE is unjudged, in words — never ✗, never ✓', () => {
  assert.equal(FrameFit.verdict(GRAYGUNS, FUSE, GUNS), 'unjudged');
  assert.equal(FrameFit.verdict(GRAYGUNS, FUSE_COMP, GUNS), 'unjudged');
  assert.equal(FrameFit.unjudgedText(GRAYGUNS, FUSE), 'FUSE fit not stated by the maker');
  assert.equal(FrameFit.unjudgedText(GRAYGUNS, FUSE_COMP), 'FUSE fit not stated by the maker');
  // the same module on its own class is simply a fit, with nothing to say
  assert.equal(FrameFit.verdict(GRAYGUNS, XMACRO, GUNS), 'fits');
  assert.equal(FrameFit.unjudgedText(GRAYGUNS, XMACRO), '');
  // and a maker-stated module has nothing to say either
  assert.equal(FrameFit.unjudgedText(OEM, FUSE), '');
});

test('the exception is only FUSE ← xmacro: every other mismatch stays ✗', () => {
  assert.equal(FrameFit.verdict(OEM, XL, GUNS), 'no', 'an xmacro module on an XL gun');
  assert.equal(FrameFit.verdict(ECM_FUSE, XL, GUNS), 'no', 'a fuse module on an XL gun');
  assert.equal(FrameFit.verdict(frame('any', 'p365xl'), FUSE, GUNS), 'no', 'an XL module on the FUSE');
  assert.equal(FrameFit.verdict(frame('any', 'p365'), FUSE, GUNS), 'no', 'a standard module on the FUSE');
});

test('the cases the old badge already left blank keep their shape', () => {
  assert.equal(FrameFit.verdict(NOSPEC, FUSE, GUNS), 'no', 'no spec fails closed');
  assert.equal(FrameFit.unjudgedText(NOSPEC, FUSE), '');
  assert.equal(FrameFit.verdict(FUSE_XL, FUSE, GUNS), 'unjudged', 'a class no gun carries is unjudged');
  assert.equal(FrameFit.unjudgedText(FUSE_XL, FUSE), '', 'and says nothing, as before');
  assert.equal(FrameFit.verdict(OEM, null, GUNS), 'unjudged', 'no gun chosen');
  assert.equal(FrameFit.verdict(OEM, {}, GUNS), 'unjudged', 'a gun with no class');
});

test('the maker-stated list carries a source for every slug, and only the four read on 2026-10-22', () => {
  const list = FrameFit.MAKER_STATES_FUSE_FIT;
  assert.deepEqual(Object.keys(list).sort(), [
    'armory-craft-grip-module-p365xmacro',
    'mischief-machine-com-g2-xmacro',
    'sig-sauer-p365-fuse-xmacro-gm-oem',
    'sig-sauer-p365-xmacro-gm-oem',
  ]);
  for (const [slug, url] of Object.entries(list)) assert.match(url, /^https:\/\//, slug + ' names its source');
});
