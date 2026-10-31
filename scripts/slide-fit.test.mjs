// Pins js/slide-fit.js — the P365 slide-on-grip fitment rule Alex signed off
// 2026-10-29 (fitment-model/SHIP-PROMPT-fitment-for-claude-code.md in the
// shared notes folder). The signed-off matrix is 10 slide setups × 3 grip
// tiers = 30 cells, and every cell is a line in this file: the rule shipped
// table-first, so a change to the module that moves any cell fails here
// before it reaches a page. Every wrong cell renders perfectly in a browser —
// a tag is just a chip — which is why it is pinned.
//
// Run: node --test scripts/slide-fit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { SlideFit } = await (async () => {
  const src = await readFile(join(ROOT, 'js/slide-fit.js'), 'utf8');
  const g = {};
  new Function('window', src)(g);
  return g;
})();

// Slide setups, as the Armory hands them to the module: a slide (or a model's
// stock slide) is { fit_tier, comp_style }; a grip is { fit_tier }; an add-on
// comp is its compensator_specs row or null.
const slide = (fit_tier, comp_style) => ({ fit_tier, comp_style });
const grip = (fit_tier) => ({ fit_tier });
const COMP = {};                       // an add-on comp with no fit_result yet
const SHORT = grip('short'), XMACRO = grip('xmacro'), FUSE = grip('fuse');

// ── The signed-off matrix: 10 rows × { Short, XMacro, FUSE } ──────────────
// Each row: [name, slide, addOnComp, short cell, xmacro cell, fuse cell].
const MATRIX = [
  ['1. 3.1" slide, no comp',                 slide('short', 'none'),           null, 'flush',        'needs_comp',            'wont_fit'],
  ['2. 3.1" slide + add-on comp',            slide('short', 'none'),           COMP, 'comp_extends', 'comp_flush_or_partial', 'wont_fit'],
  ['3. XL slide, internally ported short barrel', slide('xmacro', 'short_barrel'), null, 'extended',  'flush',                 'wont_fit'],
  ['4. 3.7" slide, no comp',                 slide('xmacro', 'none'),          null, 'extended',     'flush',                 'needs_comp'],
  ['5. 3.7" slide + add-on comp',            slide('xmacro', 'none'),          COMP, 'comp_extends', 'comp_extends',          'comp_flush_or_partial'],
  ['6. 3.7" ported barrel comp',             slide('xmacro', 'ported_barrel'), null, 'extended',     'flush',                 'wont_fit'],
  ['7. FUSE slide, internally ported short barrel', slide('fuse', 'short_barrel'), null, 'extended', 'extended',              'flush'],
  ['8. 4.3" FUSE slide, no comp',            slide('fuse', 'none'),            null, 'extended',     'extended',              'flush'],
  ['9. 4.3" FUSE slide + add-on comp',       slide('fuse', 'none'),            COMP, 'comp_extends', 'comp_extends',          'comp_extends'],
  ['10. 4.3" ported barrel comp',            slide('fuse', 'ported_barrel'),   null, 'extended',     'extended',              'flush'],
];

test('the signed-off matrix: all 30 cells', () => {
  for (const [name, s, comp, shortCell, xmacroCell, fuseCell] of MATRIX) {
    assert.equal(SlideFit.tag(s, SHORT, comp).key, shortCell, `${name} × Short grip`);
    assert.equal(SlideFit.tag(s, XMACRO, comp).key, xmacroCell, `${name} × XMacro grip`);
    assert.equal(SlideFit.tag(s, FUSE, comp).key, fuseCell, `${name} × FUSE grip`);
  }
});

test('a comp with a fit_result names its verdict; without one it hedges', () => {
  const s = slide('short', 'none');                       // d = -1 against XMacro
  assert.equal(SlideFit.tag(s, XMACRO, { fit_result: 'flush' }).key, 'comp_flush');
  assert.equal(SlideFit.tag(s, XMACRO, { fit_result: 'partial' }).key, 'comp_partial');
  assert.equal(SlideFit.tag(s, XMACRO, { fit_result: 'extends' }).key, 'comp_extends');
  assert.equal(SlideFit.tag(s, XMACRO, { fit_result: null }).key, 'comp_flush_or_partial');
  // d >= 0 and d <= -2 ignore fit_result: the comp extends past, or nothing helps
  assert.equal(SlideFit.tag(s, SHORT, { fit_result: 'flush' }).key, 'comp_extends');
  assert.equal(SlideFit.tag(s, FUSE, { fit_result: 'flush' }).key, 'wont_fit');
});

test('either side unclassified is unconfirmed — null never guesses', () => {
  assert.equal(SlideFit.tag(slide(null, 'none'), XMACRO, null).key, 'unconfirmed');
  assert.equal(SlideFit.tag(slide('xmacro', 'none'), grip(null), null).key, 'unconfirmed');
  assert.equal(SlideFit.tag(null, XMACRO, null).key, 'unconfirmed');
  assert.equal(SlideFit.tag(slide('xmacro', 'none'), null, null).key, 'unconfirmed');
  assert.equal(SlideFit.tag(slide('nonsense', 'none'), XMACRO, null).key, 'unconfirmed');
  // a tier without a stated comp style can answer flush/extended/wont_fit —
  // those don't turn on the comp style — but never needs_comp vs wont_fit
  assert.equal(SlideFit.tag(slide('xmacro', null), XMACRO, null).key, 'flush');
  assert.equal(SlideFit.tag(slide('fuse', null), SHORT, null).key, 'extended');
  assert.equal(SlideFit.tag(slide('short', null), FUSE, null).key, 'wont_fit');
  assert.equal(SlideFit.tag(slide('short', null), XMACRO, null).key, 'unconfirmed');
});

test('an add-on comp on a comp slide is ignored — the page never offers one', () => {
  // Neither comp style can take an add-on comp; if a stale pick is still in
  // state the verdict is the slide's own, not the comp branch's.
  assert.equal(SlideFit.tag(slide('xmacro', 'short_barrel'), XMACRO, COMP).key, 'flush');
  assert.equal(SlideFit.tag(slide('xmacro', 'ported_barrel'), FUSE, COMP).key, 'wont_fit');
});

test('labels, colours and selectability — the signed-off table, verbatim', () => {
  const T = SlideFit.TAGS;
  assert.deepEqual(
    Object.keys(T).sort(),
    ['comp_extends', 'comp_flush', 'comp_flush_or_partial', 'comp_partial',
     'flush', 'extended', 'needs_comp', 'unconfirmed', 'wont_fit'].sort());
  assert.deepEqual([T.flush.label, T.flush.color, T.flush.selectable], ['Flush', 'green', true]);
  assert.deepEqual([T.extended.label, T.extended.color, T.extended.selectable], ['Extended slide', 'neutral', true]);
  assert.deepEqual([T.comp_flush.label, T.comp_flush.color, T.comp_flush.selectable], ['Comp flush', 'green', true]);
  assert.deepEqual([T.comp_partial.label, T.comp_partial.color, T.comp_partial.selectable], ['Comp partially flush', 'neutral', true]);
  assert.deepEqual([T.comp_flush_or_partial.label, T.comp_flush_or_partial.color, T.comp_flush_or_partial.selectable],
    ['Comp flush / partially flush', 'neutral', true]);
  assert.deepEqual([T.comp_extends.label, T.comp_extends.color, T.comp_extends.selectable], ['Comp extends', 'neutral', true]);
  assert.deepEqual([T.needs_comp.label, T.needs_comp.color, T.needs_comp.selectable], ['Needs comp', 'amber', true]);
  assert.deepEqual([T.wont_fit.label, T.wont_fit.color, T.wont_fit.selectable], ['Won’t fit', 'red', false]);
  assert.deepEqual([T.unconfirmed.label, T.unconfirmed.color, T.unconfirmed.selectable], ['Fit not confirmed', 'muted', true]);
});

test('tier labels never show inches, and the index is short < xmacro < fuse', () => {
  assert.deepEqual(SlideFit.TIER_LABEL, { short: 'Short', xmacro: 'XMacro', fuse: 'FUSE' });
  assert.deepEqual(SlideFit.TIER_INDEX, { short: 0, xmacro: 1, fuse: 2 });
  for (const label of Object.values(SlideFit.TIER_LABEL)) assert.doesNotMatch(label, /["\d]/);
});

test('wont_fit carries its reason; the two shapes read differently', () => {
  // a slide two tiers short: nothing helps, comp included
  const twoShort = SlideFit.tag(slide('short', 'none'), FUSE, null);
  assert.equal(twoShort.reason, 'A Short slide can’t cover a FUSE grip, even with a comp.');
  // one tier short but the slide is a comp slide: the comp slot is taken
  const compSlide = SlideFit.tag(slide('xmacro', 'short_barrel'), FUSE, null);
  assert.equal(compSlide.reason,
    'This comp slide can’t take an add-on comp, so it can’t cover a FUSE grip.');
  // needs_comp says what finishes the build
  const needs = SlideFit.tag(slide('short', 'none'), XMACRO, null);
  assert.equal(needs.reason, 'Add a threaded barrel and comp to finish this build.');
  // …in the builders. A product page describes the part instead; the context
  // option changes that one sentence and nothing else about the verdict.
  const onPage = SlideFit.tag(slide('short', 'none'), XMACRO, null, { context: 'page' });
  assert.equal(onPage.reason, 'Needs a threaded barrel and add-on comp to cover the grip.');
  assert.deepEqual({ ...onPage, reason: '' }, { ...needs, reason: '' });
  assert.equal(SlideFit.tag(slide('short', 'none'), XMACRO, null, { context: 'nonsense' }).reason,
    needs.reason, 'an unknown context reads as the builder');
  assert.equal(SlideFit.tag(slide('short', 'none'), FUSE, null, { context: 'page' }).reason,
    twoShort.reason, 'only the needs_comp sentence has a page wording');
  // the selectable tags carry no reason — there is nothing to warn about
  assert.equal(SlideFit.tag(slide('short', 'none'), SHORT, null).reason, '');
});

test('sortRank orders the picker: Flush first, Won’t fit last', () => {
  const order = ['flush', 'comp_flush', 'extended', 'comp_flush_or_partial',
                 'comp_partial', 'comp_extends', 'needs_comp', 'unconfirmed', 'wont_fit'];
  const ranks = order.map((k) => SlideFit.sortRank(k));
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i] >= ranks[i - 1], `${order[i]} sorts at or after ${order[i - 1]}`);
  }
  assert.ok(SlideFit.sortRank('flush') < SlideFit.sortRank('comp_flush'), 'flush before comp flush');
  assert.ok(SlideFit.sortRank('comp_flush') < SlideFit.sortRank('extended'), 'comp flush before extended');
  assert.ok(SlideFit.sortRank('comp_extends') < SlideFit.sortRank('needs_comp'), 'comp extends before needs comp');
  assert.ok(SlideFit.sortRank('needs_comp') < SlideFit.sortRank('unconfirmed'), 'needs comp before unconfirmed');
  assert.ok(SlideFit.sortRank('unconfirmed') < SlideFit.sortRank('wont_fit'), 'wont_fit dead last');
});
