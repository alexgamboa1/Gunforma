// The catalog-match prompt: a typed part ("Holosun", "407k") is matched to
// the catalog part it most likely is, and offered — never applied.
//
// WHY THIS RUNS ON EVERY DEPLOY. The matcher fails in ways a browser cannot
// show you. A threshold nudged the wrong way and it either offers three
// triggers for "my trigger job" (noise beside the submit button, on every
// build) or stops offering "Holosun 407K X2" for "holosun 407k" (and the
// prompt quietly never appears again). Both render perfectly: an empty mount
// is what "no match" looks like. And the swap it drives rewrites the parts
// list in place, where one wrong index replaces a different part.
//
// The catalog below is REAL names from Gunforma-v2 (2026-10-07), bucketed by
// the real js/build-categories.js, because the matcher's judgement is about
// these names: brands repeated inside the name ("Holosun 407K X2") beside
// names without one ("TLR-7 Sub"), "P365" in a hundred of them, and a Wilson
// Combat part number that contains the word the builder typed for a Sig.
//
// Run: node --test scripts/part-match.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFile(join(ROOT, f), 'utf8');

// Loaded in page order (check-script-order.mjs enforces it in the HTML).
let mounts = {};
const win = {
  console: { warn() {} },
  document: {
    getElementById: (id) => mounts[id] || null,
    createElement: () => ({ setAttribute() {}, set textContent(_) {} }),
    head: { appendChild() {} },
  },
};
for (const f of ['js/category-map.js', 'js/build-categories.js', 'js/variant-label.js', 'js/variant-swatch.js']) {
  new Function('window', await read(f))(win);
}
new Function('window', 'document', 'setTimeout', await read('js/part-picker.js'))(win, win.document, () => {});
const PP = win.PartPicker;

// [products.category, brand, name]
const REAL = [
  ['optic', 'Holosun', 'Holosun 407C X3'], ['optic', 'Holosun', 'Holosun 407COMP'], ['optic', 'Holosun', 'Holosun 407K X2'],
  ['optic', 'Holosun', 'Holosun 507 PROMAX'], ['optic', 'Holosun', 'Holosun 507C X2'], ['optic', 'Holosun', 'Holosun 507C X3'],
  ['optic', 'Holosun', 'Holosun 507COMP'], ['optic', 'Holosun', 'Holosun 507K X2'], ['optic', 'Holosun', 'Holosun 508T X2'],
  ['optic', 'Holosun', 'Holosun EPS'], ['optic', 'Holosun', 'Holosun EPS Carry'], ['optic', 'Holosun', 'Holosun EPS CORE'],
  ['optic', 'Holosun', 'Holosun SCS Carry GR'], ['optic', 'Aimpoint', 'Aimpoint ACRO P-2'], ['optic', 'EOTech', 'EOTech EFLX'],
  ['optic', 'Leupold', 'Leupold DeltaPoint Pro'], ['optic', 'Olight', 'Osight 3 MOA'], ['optic', 'Olight', 'Osight SE'],
  ['optic', 'Olight', 'Osight X'], ['optic', 'Sig Sauer', 'Sig Sauer Romeo-X Pro'], ['optic', 'Sig Sauer', 'Sig Sauer Romeo-X Enclosed Compact'],
  ['optic', 'Sig Sauer', 'Sig Sauer Romeo X-Compact'], ['optic', 'Sig Sauer', 'Sig Sauer Romeo2'], ['optic', 'Sig Sauer', 'Sig Sauer Romeo1Pro'],
  ['optic', 'Vortex', 'Vortex Defender CCW'], ['optic', 'Vortex', 'Vortex Defender ST'], ['optic', 'Vortex', 'Vortex Venom Enclosed'],
  ['light', 'Streamlight', 'TLR-1 HL'], ['light', 'Streamlight', 'TLR-1 HL-X'], ['light', 'Streamlight', 'TLR-7 HL-X'],
  ['light', 'Streamlight', 'TLR-7 HL-X Sub USB'], ['light', 'Streamlight', 'TLR-7 Sub'], ['light', 'Streamlight', 'TLR-7 X'],
  ['light', 'Streamlight', 'TLR-7 X Sub USB'], ['light', 'SureFire', 'X300U-A'], ['light', 'SureFire', 'XC3 Sub'],
  ['light', 'Olight', 'Baldr Mini'], ['light', 'Olight', 'PL-Mini 2 Valkyrie'], ['light', 'Holosun', 'P.ID'], ['light', 'Holosun', 'P.ID Plus'],
  ['light', 'Sig Sauer', 'FOXTROT2R'],
  ['frame', 'Sig Sauer', 'Sig Sauer P365 OEM'], ['frame', 'Sig Sauer', 'Sig Sauer P365 XL OEM'], ['frame', 'Sig Sauer', 'Sig Sauer P365 X-Macro OEM'],
  ['frame', 'Wilson Combat', 'Wilson Combat WCP365 Grip Module'], ['frame', 'Wilson Combat', 'Wilson Combat WCP365 XL Grip Module'],
  ['frame', 'Wilson Combat', 'Wilson Combat WCP365 XMacro Grip Module'], ['frame', 'Grayguns', 'Grayguns P365XL Laser-Sculpted Grip Module'],
  ['frame', 'Icarus Precision', 'Icarus Precision AXG Series AXG MACRO (A.C.E.)'], ['frame', 'Icarus Precision', 'Icarus Precision MACRO Series X MACRO (A.C.E.)'],
  ['frame', 'Icarus Precision', 'Icarus Precision EVO Series X EVO'], ['frame', 'Mischief Machine', 'Mischief Machine Alpha Gen 3 XMacro'],
  ['frame', 'Shalotek', 'Shalotek FLEX XR-17 Grip Module'], ['frame', 'Tyrant CNC', 'Tyrant CNC P365 XMacro'],
  ['frame', 'Strike Industries', 'Strike Industries SIG P365/365XL Enhanced Grip Module'],
  ['trigger', 'Armory Craft', 'Adjustable Skeleton Flat Trigger'], ['trigger', 'MCARBO', 'MCARBO Short Stroke Flat Trigger'],
  ['trigger', 'Ramm Tactical', 'Ramm Tactical Leverage P365'], ['trigger', 'Sig Sauer', 'Sig Sauer Curved P365'],
  ['trigger', 'Sig Sauer', 'Sig Sauer Flat OEM P365'], ['trigger', 'True Precision', 'True Precision Flat P365'],
  ['trigger', 'Tyrant CNC', 'Tyrant CNC P365 Intellifire Trigger'],
  ['compensator', 'Radian Weapons', 'Radian Ramjet + Afterburner Compensator P365'], ['compensator', 'Radian Weapons', 'Radian Ramjet + Afterburner Compensator P365XL'],
  ['compensator', 'Parker Mountain Machine', 'PMM P365 Compensator'], ['compensator', 'Parker Mountain Machine', 'PMM P365XL Compensator'],
  ['compensator', 'Herrington Arms', 'Herrington Arms HC365 Compensator P365'], ['compensator', 'Faxon Firearms', 'Faxon Exos P365 Compensator'],
  ['compensator', 'True Precision', 'True Precision True-Lock Compensator P365'],
  ['barrel', 'True Precision', 'True Precision P365XL 3.7" Threaded Barrels'], ['barrel', 'True Precision', 'True Precision P365XL 3.7" Non-Threaded Barrels'],
  ['barrel', 'Zaffiri Precision', 'Zaffiri Precision P365XL Flush & Crown Barrel'], ['barrel', 'Norsso', 'Norsso N365XL 3.7" C Port Barrel'],
  ['basepad', 'Springer Precision', '+3 Magazine Extension for Sig Sauer X Macro 17rd Mags'], ['basepad', 'Tyrant CNC', 'Tyrant CNC P365 XMacro +3 Magazine Extension'],
  ['basepad', 'Radian Weapons', 'Radian TRU-17 Magazine Base Pad (2-Pack)'], ['basepad', 'Hogue', 'Hogue OverMolded Rubber Grip Extension Base Pad (10-Round) for P365'],
  ['magwell', 'Tyrant CNC', 'Tyrant CNC Sig Sauer P365 XMacro Magwell'], ['magwell', 'Herrington Arms', 'Herrington Arms HA Magwell for P365 X Macro'],
  ['slide', 'True Precision', 'True Precision Axiom P365XL'], ['slide', 'Norsso', 'Norsso P365XL Reptile EDC'],
  ['other', 'Tactical Development', 'Pro Ledge for TLR7 SUB-1913'], ['other', 'Tactical Development', 'Pro Ledge TAR for Sig P365 xMacro'],
  ['recoil_spring', 'DMP Springs', 'DMP Soft RSA'],
];

// The shape loadCatalog() builds: { <section key>: [{ id, brand, name, ... }] }.
let n = 0;
const CATALOG = {};
for (const [category, brand, name] of REAL) {
  const key = win.BuildCategories.sectionKeyFor(category);
  assert.ok(key, 'fixture category has a build section: ' + category);
  (CATALOG[key] ||= []).push({ id: 'id-' + (++n), brand, name, desc: '', price: 0, image: null, variants: [], variantId: null });
}
const idOf = (name) => Object.values(CATALOG).flat().find((i) => i.name === name).id;
const names = (list) => list.map((m) => m.item.name);
const match = (brand, name, opts) => PP.matchIn(CATALOG, brand, name, opts);

test('the part that was meant comes first, and its brand-mates do not trail behind it', () => {
  const m = match('Holosun', '407k');
  assert.deepEqual(names(m), ['Holosun 407K X2']);
  assert.equal(m[0].strong, true);
});

test('sharing the brand and one word is not being in the same league', () => {
  // "507K X2", "507C X2" and "508T X2" all have the brand and "X2". None of
  // them is a 407K, and listing them under it would read as "one of these?".
  assert.deepEqual(names(match('Holosun', '407k x2')), ['Holosun 407K X2']);
});

test('an ambiguous model number offers the candidates, capped at three', () => {
  const m = match('holosun', '507');
  assert.equal(m.length, 3);
  for (const x of names(m)) assert.match(x, /^Holosun 507/);
});

test('a missing hyphen or space does not matter', () => {
  assert.equal(names(match('Streamlight', 'TLR7 sub'))[0], 'TLR-7 Sub');
  assert.equal(names(match('', 'tlr 7 sub'))[0], 'TLR-7 Sub');
  assert.equal(names(match('streamlight', 'TLR-7 SUB'))[0], 'TLR-7 Sub');
});

test('the closer name wins when several contain everything typed', () => {
  // "TLR-7 HL-X Sub USB" and "TLR-7 X Sub USB" contain it all too.
  const m = match('Streamlight', 'tlr-7 sub');
  assert.equal(names(m)[0], 'TLR-7 Sub');
});

test('a typed brand outranks shared words: Sig is not Wilson Combat', () => {
  const m = match('Sig', 'P365 XL grip module');
  assert.equal(m[0].item.brand, 'Sig Sauer', 'got ' + names(m).join(' | '));
  assert.equal(m[0].item.name, 'Sig Sauer P365 XL OEM');
});

test('and the same words with the other brand find the other part', () => {
  assert.equal(names(match('Wilson Combat', 'grip module xl'))[0], 'Wilson Combat WCP365 XL Grip Module');
});

test('a brand known only by the abbreviation in the name still counts', () => {
  const m = match('PMM', 'comp');
  assert.ok(m.length >= 1);
  for (const x of names(m)) assert.match(x, /^PMM /);
});

test('one common word is not a match', () => {
  assert.deepEqual(match('Custom', 'my trigger job'), []);
  assert.deepEqual(match("Bob's Garage", 'stipple work'), []);
  assert.deepEqual(match('', 'grip'), []);
});

test('a brand alone is not a part', () => {
  assert.deepEqual(match('Holosun', ''), []);
  assert.deepEqual(match('Sig Sauer', '   '), []);
});

test('but a brand plus that word is', () => {
  assert.deepEqual(names(match('Tyrant', 'trigger')), ['Tyrant CNC P365 Intellifire Trigger']);
});

test('colour and dot size are not part of the name', () => {
  const m = match('Holosun', 'EPS Carry green 2 MOA');
  assert.equal(names(m)[0], 'Holosun EPS Carry');
  assert.equal(m[0].strong, true);
  assert.equal(match('Streamlight', 'TLR-7 Sub FDE')[0].strong, true);
});

test('a model the catalog does not have is offered while typing, never claimed in the prompt', () => {
  // The Romeo Zero is not in the catalog. The Romeo-X is the nearest thing,
  // and a builder typing it may want to see that — but it is not their optic.
  const m = match('Sig', 'Romeo Zero');
  assert.ok(m.length >= 1);
  for (const x of m) {
    assert.match(x.item.name, /Romeo/);
    assert.equal(x.strong, false, x.item.name + ' must not be a strong match for "Romeo Zero"');
  }
  // Same for a half-described part: plenty of candidates, no claim.
  for (const x of match('Sig', 'P365 XL grip module')) assert.equal(x.strong, false);
  for (const x of match('Sig Sauer', 'P365')) assert.equal(x.strong, false);
});

test('a brand we do not carry is not evidence against a match', () => {
  // The builder got the maker wrong; the model is still unmistakable.
  assert.equal(names(match('Holo Sun Optics', 'EPS Carry'))[0], 'Holosun EPS Carry');
});

test('parts already on the build are never offered again', () => {
  const m = match('Holosun', '407k', { exclude: { [idOf('Holosun 407K X2')]: true } });
  assert.ok(!names(m).includes('Holosun 407K X2'));
});

test('never throws on what people actually type', () => {
  for (const [b, nm] of [['', ''], [null, undefined], ['!!!', '???'], ['a', 'b'], ['   ', '\n'], ['x'.repeat(500), '9'.repeat(500)]]) {
    assert.deepEqual(match(b, nm), []);
  }
  assert.deepEqual(PP.matchIn(null, 'Holosun', '407k'), []);
  assert.deepEqual(PP.matchIn({}, 'Holosun', '407k'), []);
});

// ── the two places it is drawn, and the swap ───────────────────────────────
// Driven through init() with the same accessors the pages pass.
let state, added;
function mount(parts, extra) {
  state = { parts, openPicker: null, customOpen: null };
  added = [];
  mounts = {};
  win.addCatalogPart = (k, id) => {
    const item = CATALOG[k].find((i) => i.id === id);
    state.parts.push({ uid: 'new' + state.parts.length, refId: item.id, category: k, brand: item.brand, name: item.name, pending: false });
    added.push(id);
    PP.closePickerAfterAdd(k);
  };
  win.removePart = () => {};
  win.pickVariant = () => {};
  win.cancelVariantPick = () => {};
  PP.init(Object.assign({ catalog: () => CATALOG, state: () => state, render: () => {}, onChange: () => {} }, extra || {}));
}
const typed = (uid, category, brand, name, over) => Object.assign({ uid, refId: null, category, brand, name, pending: true }, over || {});

test('the prompt lists typed parts that look like catalog parts, and only those', () => {
  mount([
    typed('p1', 'optics', 'Holosun', '407k'),
    typed('p2', 'triggers', 'Custom', 'my trigger job'),                 // no match: left alone
    typed('p3', 'mags', 'Sig Sauer', '17rd X Macro magazine'),           // typed-only section
    typed('p4', 'paintjob', 'Shop', 'FDE', { pending: false, finish: { shop: 'Shop', color: 'FDE', stipple: '' } }),
    { uid: 'p5', refId: idOf('TLR-7 Sub'), category: 'lights', brand: 'Streamlight', name: 'TLR-7 Sub', pending: false },
  ]);
  const found = PP.unlinkedMatches();
  assert.deepEqual(found.map((f) => f.part.uid), ['p1']);
  assert.equal(found[0].matches[0].item.name, 'Holosun 407K X2');
  const html = PP.unlinkedNudgeHtml(found);
  assert.match(html, /1 typed part looks like a catalog part/);
  assert.match(html, /PartPicker\.useMatch\('optics','id-\d+','p1'\)/);
});

test('"Use this" replaces the typed part IN PLACE, and nothing else moves', () => {
  mount([
    typed('p1', 'triggers', 'Tyrant', 'trigger'),
    typed('p2', 'optics', 'Holosun', '407k'),
    typed('p3', 'grips', 'Someone', 'Custom grip'),
  ]);
  PP.useMatch('optics', idOf('Holosun 407K X2'), 'p2');
  assert.deepEqual(state.parts.map((p) => p.name), ['trigger', 'Holosun 407K X2', 'Custom grip']);
  assert.equal(state.parts[1].pending, false);
  assert.equal(state.parts[1].refId, idOf('Holosun 407K X2'));
});

test('a match added from the typing list is an ordinary add: nothing is replaced', () => {
  mount([typed('p1', 'optics', 'Holosun', '407k')]);
  PP.useMatch('optics', idOf('Holosun 407K X2'));
  assert.deepEqual(state.parts.map((p) => p.uid), ['p1', 'new1']);
});

test('backing out and adding something else does not swap', () => {
  mount([typed('p1', 'optics', 'Holosun', '407k'), typed('p2', 'grips', 'Someone', 'Custom grip')]);
  // "Use this" opens the colour step and the builder cancels: no add happens.
  const real = win.addCatalogPart;
  win.addCatalogPart = () => {};
  PP.useMatch('optics', idOf('Holosun 407K X2'), 'p1');
  win.addCatalogPart = real;
  // They then add a different part the normal way.
  win.addCatalogPart('lights', idOf('TLR-7 Sub'));
  assert.deepEqual(state.parts.map((p) => p.name), ['407k', 'Custom grip', 'TLR-7 Sub']);
  // And a later, unrelated add of the offered product is not a swap either:
  // the intent was consumed by the add in between.
  win.addCatalogPart('optics', idOf('Holosun 407K X2'));
  assert.equal(state.parts.length, 4);
  assert.equal(state.parts[0].name, '407k');
});

test('a part the page says cannot be swapped is neither offered nor swapped', () => {
  mount([typed('p1', 'optics', 'Holosun', '407k')], { canSwap: (uid) => uid !== 'p1' });
  assert.deepEqual(PP.unlinkedMatches(), []);
  PP.useMatch('optics', idOf('Holosun 407K X2'), 'p1');
  assert.deepEqual(state.parts.map((p) => p.uid), ['p1', 'new1']);   // added, not replaced
});

test('"Keep what I typed" removes it from the prompt', () => {
  mount([typed('keep1', 'optics', 'Holosun', '407k')]);
  assert.equal(PP.unlinkedMatches().length, 1);
  PP.dismissMatch('keep1');
  assert.equal(PP.unlinkedMatches().length, 0);
});

test('what the builder typed is escaped where it is shown back to them', () => {
  mount([typed('p9', 'optics', 'Holosun', '407K <i>X2</i>')]);
  const html = PP.unlinkedNudgeHtml(PP.unlinkedMatches());
  assert.ok(html.length > 0, 'still matched');
  assert.ok(!html.includes('<i>X2'), 'typed markup must not reach the page');
  assert.match(html, /&lt;i&gt;X2/);
});

test('typing in a section with no catalog parts offers nothing', () => {
  mount([]);
  mounts['cs-mags'] = { innerHTML: 'stale' };
  mounts['cb-mags'] = { value: 'Sig Sauer' };
  mounts['cn-mags'] = { value: '17rd X Macro magazine' };
  PP.suggestWhileTyping('mags');
  assert.equal(mounts['cs-mags'].innerHTML, '');
});

test('typing in a catalog section draws the offers into its own mount', () => {
  mount([]);
  mounts['cs-optics'] = { innerHTML: '' };
  mounts['cb-optics'] = { value: 'Holosun' };
  mounts['cn-optics'] = { value: '407k' };
  PP.suggestWhileTyping('optics');
  assert.match(mounts['cs-optics'].innerHTML, /Already in the catalog\?/);
  assert.match(mounts['cs-optics'].innerHTML, /407K X2/);
  // and clears itself when the match goes away
  mounts['cn-optics'].value = 'zzzz';
  mounts['cb-optics'].value = 'Nobody';
  PP.suggestWhileTyping('optics');
  assert.equal(mounts['cs-optics'].innerHTML, '');
});

test('a failure inside the prompt never reaches the page', () => {
  mount([typed('p1', 'optics', 'Holosun', '407k')], { catalog: () => { throw new Error('boom'); } });
  mounts['unlinked-nudge'] = { innerHTML: 'stale' };
  assert.doesNotThrow(() => PP.renderUnlinkedNudge());
  assert.equal(mounts['unlinked-nudge'].innerHTML, '');
});
