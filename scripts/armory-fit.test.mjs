// js/armory-fit.js — the Armory's fit verdicts, pinned.
//
// WHY: every one of these fails silently in a browser. A wrong verdict is a
// perfectly normal-looking tag — a ported slide quietly reading "Fits" over
// a stock barrel it will never take, a magazine judged by the FUSE's
// housing_class ('xmacro' since the fitment migration) instead of the
// maker's own 'fuse' rows, an optic given a green tag on a cut the data
// does not back. The ship checklist's fit cases live here so a change to
// the module is held to them on every deploy.
//
// Run: node --test scripts/armory-fit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/slide-fit.js', 'js/armory-fit.js']) {
  vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const AF = ctx.ArmoryFit;

// The guns rows as PostgREST returns them (numerics are strings).
const XMACRO = { slug: 'p365-xmacro', name: 'P365 XMacro', housing_class: 'xmacro', barrel_length_in: '3.7',
  slide_length_in: '3.7', integrated_comp: false, grip_fit_tier: 'xmacro', slide_fit_tier: 'xmacro', slide_comp_style: 'none' };
const FUSE = { slug: 'p365-fuse', name: 'P365 FUSE', housing_class: 'xmacro', barrel_length_in: '4.3',
  slide_length_in: '4.3', integrated_comp: false, grip_fit_tier: 'xmacro', slide_fit_tier: 'fuse', slide_comp_style: 'none' };
const XMACRO_COMP = { slug: 'p365-xmacro-comp', name: 'P365 XMacro Comp', housing_class: 'xmacro', barrel_length_in: '3.1',
  slide_length_in: '3.7', integrated_comp: true, grip_fit_tier: 'xmacro', slide_fit_tier: 'xmacro', slide_comp_style: 'short_barrel' };

const base = (over) => Object.assign({
  tierMode: true, gun: XMACRO, fcu: false,
  slide: AF.stockSlideRef(XMACRO), grip: null,
  gripHC: null, stockGripProduct: null, barrel: null, comp: null, optics: null,
}, over);
const withHC = (c) => { c.gripHC = AF.gripHousingClass(c); return c; };

// A picked slide: Norsso-style ported "C" slide, 3.7", internally ported.
const NORSSO_C = AF.slideRef({ id: 'slide-c', brand: 'Norsso' },
  { barrel_length_in: '3.7', slide_length_in: '3.7', internally_ported: true, integrated_comp: false, threaded_barrel_ok: false, port_style: 'c-port' },
  { fit_tier: 'xmacro', comp_style: 'ported_barrel' });
const PLAIN_37 = AF.slideRef({ id: 'slide-p', brand: 'True Precision' },
  { barrel_length_in: '3.7', slide_length_in: '3.7', internally_ported: false, integrated_comp: false, threaded_barrel_ok: true },
  { fit_tier: 'xmacro', comp_style: 'none' });

test('stock barrel: a ported slide is a Must fix; a wrong length names both numbers; a plain match fits', () => {
  const ported = AF.stockBarrelVerdict(base({ slide: NORSSO_C }));
  assert.equal(ported.key, 'wont_fit');
  assert.match(ported.reason, /ported slide needs its maker’s matched barrel/);

  const wrongLen = AF.stockBarrelVerdict(base({ gun: FUSE, slide: PLAIN_37 }));
  assert.equal(wrongLen.key, 'wont_fit');
  assert.match(wrongLen.reason, /4\.3", and this slide takes 3\.7"/);

  assert.equal(AF.stockBarrelVerdict(base({ slide: PLAIN_37 })).key, 'flush');
  assert.equal(AF.stockBarrelVerdict(base()).label, 'Factory', 'no picked slide: the factory pair');
  // A factory comp model's own barrel is factory too, never a warning.
  assert.equal(AF.stockBarrelVerdict(base({ gun: XMACRO_COMP, slide: AF.stockSlideRef(XMACRO_COMP) })).label, 'Factory');
});

test('barrel ↔ slide: matched ported barrel fits, the maker’s lock binds, threads are honoured', () => {
  const ctx37 = base({ slide: NORSSO_C });
  const matched = AF.barrelVerdict({ spec: { barrel_length_in: '3.7', barrel_type: 'ported', port_style: 'c-port' },
    locks: [{ slide: 'slide-c' }] }, ctx37);
  assert.equal(matched.key, 'flush');
  assert.equal(matched.label, 'Matched barrel');

  const strange = AF.barrelVerdict({ spec: { barrel_length_in: '3.7', barrel_type: 'standard' }, locks: null }, ctx37);
  assert.equal(strange.key, 'wont_fit', 'a plain barrel never goes in a ported slide');

  const wrongLen = AF.barrelVerdict({ spec: { barrel_length_in: '3.1', barrel_type: 'standard' }, locks: null }, base({ slide: PLAIN_37 }));
  assert.equal(wrongLen.key, 'wont_fit');
  assert.match(wrongLen.reason, /takes a 3\.7" barrel/);

  const portedInPlain = AF.barrelVerdict({ spec: { barrel_length_in: '3.7', barrel_type: 'ported' }, locks: [{ slide: 'slide-c' }] },
    base({ slide: PLAIN_37 }));
  assert.equal(portedInPlain.key, 'wont_fit', 'a ported barrel wants its matching ported slide');

  const noThreads = AF.slideRef({ id: 's2', brand: 'X' }, { barrel_length_in: '3.7', threaded_barrel_ok: false }, { fit_tier: 'xmacro', comp_style: 'none' });
  assert.equal(AF.barrelVerdict({ spec: { barrel_length_in: '3.7', barrel_type: 'threaded' }, locks: null }, base({ slide: noThreads })).key, 'wont_fit');

  const factoryComp = AF.barrelVerdict({ spec: { barrel_length_in: '3.1', barrel_type: 'standard' }, locks: null },
    base({ gun: XMACRO_COMP, slide: AF.stockSlideRef(XMACRO_COMP) }));
  assert.equal(factoryComp.key, 'unconfirmed', 'factory comp slide + aftermarket barrel is never a guess');

  const kit = AF.slideRef({ id: 'kit', brand: 'Arc Division' }, { barrel_length_in: '3.7' }, { fit_tier: 'xmacro', comp_style: 'chunk-port', includes_barrel: true });
  assert.equal(AF.barrelVerdict({ spec: { barrel_length_in: '3.7', barrel_type: 'standard' }, locks: null }, base({ slide: kit })).key, 'na',
    'a slide kit brings its own barrel');
});

test('compensator: built-in comps refuse, threads must match, kits must match the slide length', () => {
  const onComp = AF.compVerdict({ spec: { requires_threaded_barrel: true, thread_pitch: '1/2x28' } },
    base({ gun: XMACRO_COMP, slide: AF.stockSlideRef(XMACRO_COMP) }));
  assert.equal(onComp.key, 'wont_fit');
  assert.match(onComp.reason, /has a comp built in/);

  const noBarrel = AF.compVerdict({ spec: { requires_threaded_barrel: true, thread_pitch: '1/2x28' } }, base({ slide: PLAIN_37 }));
  assert.equal(noBarrel.key, 'needs_comp');

  const pitch = AF.compVerdict({ spec: { requires_threaded_barrel: true, thread_pitch: 'INTRA-LOK' } },
    base({ slide: PLAIN_37, barrel: { spec: { barrel_type: 'threaded', thread_pitch: '1/2x28' } } }));
  assert.equal(pitch.key, 'wont_fit');
  assert.match(pitch.reason, /1\/2x28.*INTRA-LOK/);

  const plainBarrel = AF.compVerdict({ spec: { requires_threaded_barrel: true } },
    base({ slide: PLAIN_37, barrel: { spec: { barrel_type: 'standard' } } }));
  assert.equal(plainBarrel.key, 'wont_fit');

  assert.equal(AF.compVerdict({ spec: { comes_with_barrel: true, barrel_length_in: '3.1' } }, base({ slide: PLAIN_37 })).key, 'wont_fit',
    'a 3.1" kit comp on a 3.7" slide');
  assert.equal(AF.compVerdict({ spec: { comes_with_barrel: true, barrel_length_in: '3.7' } }, base({ slide: PLAIN_37 })).key, 'flush');
});

test('magazines: the FUSE asks the maker’s fuse rows; aftermarket grips are unconfirmed; silence is unconfirmed', () => {
  const rows = {
    xmacro: { fit: 'flush', note: 'Factory magazine for the XMACRO' },
    fuse: { fit: 'flush', note: 'Factory flush magazine for the FUSE' },
    p365: { fit: 'with_included_baseplate', note: 'Swap to the included floor plate' },
  };
  const onXmacro = AF.magazineVerdict(rows, withHC(base()));
  assert.equal(onXmacro.key, 'flush');
  assert.match(onXmacro.reason, /XMACRO/);

  const onFuse = AF.magazineVerdict(rows, withHC(base({ gun: FUSE, slide: AF.stockSlideRef(FUSE) })));
  assert.match(onFuse.reason, /FUSE/, 'the FUSE uses the fuse rows, never its xmacro housing_class');

  const p365gun = { slug: 'p365', name: 'P365', housing_class: 'p365', grip_fit_tier: 'short' };
  const baseplate = AF.magazineVerdict(rows, withHC(base({ gun: p365gun })));
  assert.equal(baseplate.key, 'extended');
  assert.equal(baseplate.label, 'Fits with included baseplate');

  const aftermarket = AF.magazineVerdict(rows, withHC(base({
    grip: { product: { id: 'g1', brand: 'Icarus Precision' }, spec: { housing_class: 'xmacro' }, fitRow: { fit_tier: 'xmacro' } } })));
  assert.equal(aftermarket.key, 'unconfirmed');
  assert.match(aftermarket.reason, /check with the grip maker/i);

  const sigGrip = AF.magazineVerdict(rows, withHC(base({
    grip: { product: { id: 'g2', brand: 'Sig Sauer' }, spec: { housing_class: 'p365' }, fitRow: { fit_tier: 'short' } } })));
  assert.equal(sigGrip.label, 'Fits with included baseplate', 'a picked SIG OEM grip uses its own class');

  assert.equal(AF.magazineVerdict({}, withHC(base())).key, 'unconfirmed', 'no row: never a guess');
  assert.equal(AF.magazineVerdict(rows, withHC(base({ gun: null, fcu: true, slide: null }))).reason, 'Pick a grip to check.');
  const notComp = AF.magazineVerdict({ xmacro: { fit: 'not_compatible', note: 'SIG lists it as not compatible' } }, withHC(base()));
  assert.equal(notComp.key, 'wont_fit');
});

test('magwells: judged against the stock grip’s OEM product; no rule rows is unconfirmed', () => {
  const stockGrip = { id: 'oem-xmacro', brand: 'Sig Sauer', stock: true };
  const fits = [{ frame: 'oem-xmacro', note: 'Designed for OEM SIG P365 XMacro grip module.' }];
  const hit = AF.magwellVerdict(fits, base({ stockGripProduct: stockGrip }));
  assert.equal(hit.key, 'flush');
  assert.match(hit.reason, /XMacro/);

  const miss = AF.magwellVerdict([{ frame: 'r11-fuse' }], base({ stockGripProduct: stockGrip }));
  assert.equal(miss.key, 'wont_fit');
  assert.match(miss.reason, /your stock grip/);

  assert.equal(AF.magwellVerdict(null, base({ stockGripProduct: stockGrip })).key, 'unconfirmed', 'no rows: the maker doesn’t say');
  assert.equal(AF.magwellVerdict(fits, base({ stockGripProduct: null })).reason, 'We don’t have magwell data for this grip yet.',
    'a model whose stock grip has no catalog product (AXG) is unconfirmed');
  assert.equal(AF.magwellVerdict(fits, base({ gun: null, fcu: true, slide: null })).reason, 'Pick a grip to check.');

  const picked = AF.magwellVerdict(fits, base({ grip: { product: { id: 'oem-xmacro', brand: 'Sig Sauer' }, spec: {}, fitRow: {} } }));
  assert.equal(picked.key, 'flush', 'a picked grip outranks the stock one');
});

test('recoil springs: length must equal the slide’s; comp slides are unconfirmed', () => {
  assert.equal(AF.springVerdict({ slide_length_in: '3.7' }, base({ slide: PLAIN_37 })).key, 'flush');
  const wrong = AF.springVerdict({ slide_length_in: '3.1' }, base({ slide: PLAIN_37 }));
  assert.equal(wrong.key, 'wont_fit');
  assert.match(wrong.reason, /3\.1" slides, and your slide is 3\.7"/);
  assert.equal(AF.springVerdict({ slide_length_in: '3.7' }, base({ gun: XMACRO_COMP, slide: AF.stockSlideRef(XMACRO_COMP) })).key, 'unconfirmed');
  assert.equal(AF.springVerdict({ slide_length_in: null }, base({ slide: PLAIN_37 })).key, 'unconfirmed');
  assert.equal(AF.springVerdict({ slide_length_in: '4.3' }, base({ gun: FUSE, slide: AF.stockSlideRef(FUSE) })).key, 'flush',
    'the stock slide’s own length');
});

test('optics: the stock slide’s default cut decides; an alternate SKU’s cut says so; aftermarket slides get no tag', () => {
  const CUTS = [
    { optic_cut: 'rmsc', applies_to: 'default', confidence: 'verified' },
    { optic_cut: 'sig-loc-compact', applies_to: 'sku-sl-rxsl', confidence: 'verified' },
  ];
  const optics = {
    cutFootprints: { rmsc: { 'fp-rmsc': 'direct', 'fp-k': 'via-plate' }, 'sig-loc-compact': { 'fp-sigloc': 'direct' } },
    footprintName: (id) => ({ 'fp-rmsc': 'Shield RMSc', 'fp-dpp': 'Leupold DeltaPoint Pro', 'fp-sigloc': 'SIG-LOC Compact' })[id] || null,
  };
  const stock = base({ slide: AF.stockSlideRef(XMACRO, CUTS), optics });

  assert.equal(AF.opticVerdict({ footprintId: 'fp-rmsc' }, stock).key, 'flush');
  assert.equal(AF.opticVerdict({ footprintId: 'fp-k' }, stock).label, 'Fits with adapter plate');
  const sku = AF.opticVerdict({ footprintId: 'fp-sigloc' }, stock);
  assert.equal(sku.key, 'unconfirmed');
  assert.match(sku.reason, /sku-sl-rxsl/, 'the SKU split is named, not guessed over');
  const no = AF.opticVerdict({ footprintId: 'fp-dpp' }, stock);
  assert.equal(no.key, 'wont_fit');
  assert.match(no.reason, /rmsc cut doesn’t take the Leupold DeltaPoint Pro footprint/);
  assert.equal(AF.opticVerdict({ footprintId: null }, stock).key, 'unconfirmed');

  assert.equal(AF.opticVerdict({ footprintId: 'fp-rmsc' }, base({ slide: PLAIN_37, optics })).key, 'na',
    'an aftermarket slide has no cut in the data: no tag, never a guess');
  assert.equal(AF.opticVerdict({ footprintId: 'fp-rmsc' }, base({ slide: null, optics })).key, 'na');
});

test('slide ↔ grip goes through SlideFit: a FUSE-length grip on an XMacro stock slide needs a comp', () => {
  const fuseGrip = AF.gripVerdict({ fit_tier: 'fuse' }, base());
  assert.equal(fuseGrip.key, 'needs_comp', 'the signed-off tier rule, not a second copy');
  assert.equal(AF.gripVerdict({ fit_tier: 'xmacro' }, base()).key, 'flush');
  assert.equal(AF.gripVerdict({ fit_tier: null }, base()).key, 'unconfirmed');
  assert.equal(AF.gripVerdict({ fit_tier: 'fuse' }, base({ tierMode: false })).key, 'na', 'P320 and pre-migration: no tags');

  const slide31 = AF.slideRef({ id: 's31', brand: 'X' }, { barrel_length_in: '3.1' }, { fit_tier: 'short', comp_style: 'none' });
  const onFuseGrip = AF.slideVerdict(slide31, base({ grip: { product: { id: 'g' }, spec: {}, fitRow: { fit_tier: 'fuse' } } }));
  assert.equal(onFuseGrip.key, 'wont_fit', 'two tiers short, even with a comp');
});

test('the picked barrel binds the slide list, and a picked comp binds the barrel list', () => {
  const withBarrel = base({ barrel: { spec: { barrel_length_in: '3.1', barrel_type: 'standard' }, locks: null } });
  const s = AF.slideVerdict(PLAIN_37, withBarrel);
  assert.equal(s.key, 'wont_fit');
  assert.match(s.reason, /3\.1", and this slide takes 3\.7"/);

  const locked = base({ barrel: { spec: { barrel_length_in: '3.7', barrel_type: 'ported' }, locks: [{ slide: 'slide-c' }] } });
  assert.equal(AF.slideVerdict(PLAIN_37, locked).key, 'wont_fit', 'a locked barrel refuses an unnamed slide');
  assert.equal(AF.slideVerdict(NORSSO_C, locked).key, 'flush', 'and fits its named one');

  const withComp = base({ slide: PLAIN_37, comp: { spec: { requires_threaded_barrel: true, thread_pitch: '1/2x28' }, fitRow: null } });
  const plain = AF.barrelVerdict({ spec: { barrel_length_in: '3.7', barrel_type: 'standard' }, locks: null }, withComp);
  assert.equal(plain.key, 'wont_fit', 'a picked comp refuses an unthreaded barrel');
  const wrongPitch = AF.barrelVerdict({ spec: { barrel_length_in: '3.7', barrel_type: 'threaded', thread_pitch: 'INTRA-LOK' }, locks: null }, withComp);
  assert.equal(wrongPitch.key, 'wont_fit');
  const right = AF.barrelVerdict({ spec: { barrel_length_in: '3.7', barrel_type: 'threaded', thread_pitch: '1/2x28' }, locks: null }, withComp);
  assert.equal(right.key, 'flush');
});
