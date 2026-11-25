// field-notes-voice.test.mjs — every rule of the Field Notes voice lint
// (scripts/field-notes-voice.mjs, field-notes/VOICE.md) proven to fire, and
// proven NOT to fire where it must not, over synthetic notes. The live
// articles are linted by check-field-notes.mjs on every deploy; this file
// is what keeps a rule from quietly going dead (a regex typo makes a lint
// pass everything, and a lint that passes everything renders perfectly).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintVoice, lintSections, VOICE_RULES, FIELD_NOTE_TYPES } from './field-notes-voice.mjs';

const lint = (text, opts) => lintVoice(String(text).split('\n'), opts);
const fails = (text, opts) => lint(text, opts).filter((h) => h.level === 'fail');
const warns = (text, opts) => lint(text, opts).filter((h) => h.level === 'warn');

test('every FAIL phrase fails, in prose, at its line', () => {
  for (const rule of VOICE_RULES.fail) {
    for (const p of rule.phrases || []) {
      const hits = fails('Intro line.\n\nThe module is ' + p + ' here.');
      assert.equal(hits.length, 1, '"' + p + '" must fail exactly once');
      assert.equal(hits[0].line, 2, 'reported at its line');
      assert.equal(hits[0].group, rule.group);
      assert.ok(hits[0].why.length > 20, 'with a reason');
    }
  }
});

test('implied-testing patterns: any round count', () => {
  for (const s of ['after 500 rounds', 'after 1,000 rounds', 'after 2k rounds', '300 rounds through it', '1,500 rounds through the gun']) {
    assert.equal(fails('It ran ' + s + '.').length, 1, s);
  }
  assert.equal(fails('It holds 17 rounds in the magazine.').length, 0, 'a capacity is not a round count fired');
});

test('every WARN phrase warns and never fails', () => {
  for (const rule of VOICE_RULES.warn) {
    for (const p of rule.phrases) {
      const hits = lint('The grip is ' + p + ' overall.');
      assert.equal(hits.filter((h) => h.level === 'fail').length, 0, '"' + p + '" must not fail');
      assert.equal(hits.filter((h) => h.level === 'warn').length, 1, '"' + p + '" must warn once');
    }
  }
});

test('negative fit language warns; what fits does not', () => {
  const neg = (t) => warns(t).filter((h) => h.group === 'negative fit');
  assert.equal(neg('This barrel doesn\u2019t fit the FUSE Comp.').length, 1, 'curly apostrophe');
  assert.equal(neg("It won't fit an XL slide.").length, 1, 'straight apostrophe');
  assert.equal(neg('The two are not compatible.').length, 1);
  assert.equal(neg('A ported barrel will not work here.').length, 1);
  assert.equal(neg('A threaded barrel fits 7 of the 12 FUSE slides in the Gunforma catalog.').length, 0, 'a positive fit line');
  assert.equal(fails('It does not fit the FUSE Comp.').length, 0, 'a warning, never a failure');
});

test('whole words, case-insensitive, across line wrap spacing', () => {
  assert.equal(fails('FEELS like home').length, 1, 'case-insensitive');
  assert.equal(fails('a must   have module').length, 1, 'a phrase across extra spaces');
  assert.equal(warns('the smoothbore barrel').length, 0, '"smooth" inside a word is not "smooth"');
  assert.equal(warns('almost every module').length, 0, '"most" inside "almost" is not "most"');
  assert.equal(fails('the feelsgood brand').length, 0);
});

test('the scanned surfaces: headings, labels, ~/= lines, build names, faq answers', () => {
  assert.equal(fails('## Why it feels right').length, 1, 'a heading');
  assert.equal(fails('::picks\na-1 | The crisp one\n::').length, 1, 'a picks label');
  assert.equal(fails('::rank a-1 best="Snappy trigger" rank=1\n~ x\n::').length, 1, 'a rank best= label');
  assert.equal(fails('::rank a-1 best="B" rank=1\n~ Feels lighter in hand\n= We tested it\n::').length, 2, '~ and = lines');
  assert.equal(fails('::build name="Our favorite carry build"\nframe=f-1\n::').length, 1, 'a build name');
  assert.equal(fails('::faq\nQ: Is it crisp?\nA: It is crisp.\n::').length, 1, 'a faq ANSWER (the question is the reader’s words)');
  assert.equal(fails('| Part | Note |\n|---|---|\n| A | game changer |').length, 1, 'a table cell');
  assert.equal(fails('- a buttery list item').length, 1, 'a list item');
});

test('skipped: blockquotes (attributed), code, link URLs', () => {
  const q = '> It feels crisp and we tested it at the range. — [owner](/b/some-build-14ee1ae6-f134-48fc-99ad-ad434e63f8a2), from their posted build';
  assert.deepEqual(fails(q), [], 'an attributed owner quote is not linted for language');
  assert.equal(fails('```\nfeels crisp\n```').length, 0, 'a fenced block');
  assert.equal(fails('The `crisp` flag is a column.').length, 0, 'an inline code span');
  assert.equal(fails('See [the guide](/fit/best-overall-feels).').length, 0, 'a link URL');
  assert.equal(fails('See [the crisp guide](/x).').length, 1, 'but the link TEXT is prose');
});

test('a blockquote must carry its build attribution', () => {
  const bare = fails('> I love this grip.');
  assert.equal(bare.length, 1);
  assert.equal(bare[0].group, 'unattributed quote');
  assert.deepEqual(fails('> I love this grip.\n— [owner](/b/x-1-14ee1ae6-f134-48fc-99ad-ad434e63f8a2), from their build'), [], 'attribution on the next line');
  assert.deepEqual(fails('> I love this grip.\n\n— [owner](https://gunforma.com/b/x-14ee1ae6-f134-48fc-99ad-ad434e63f8a2)'), [], 'after one blank line, apex link');
  assert.equal(fails('> I love this grip. — [owner](/u/someone)').length, 1, 'a profile link is not the build');
  assert.equal(fails('> I love this grip. — [owner](/gunforma-builds.html)').length, 1, 'the gallery is not the build');
});

test('Pros / Cons headings fail at any level', () => {
  for (const h of ['## Pros', '### Cons', '#### Pros and cons', '## Pros & Cons', '## Cons:']) assert.equal(fails(h).length, 1, h);
  assert.equal(fails('## Prosthetic grips').length, 0);
});

test('a "Best" label fails once, as the label rule', () => {
  for (const label of ['Best', 'best', 'Best overall', 'Best overall for carry']) {
    const p = fails('::picks\na-1 | ' + label + '\n::');
    assert.equal(p.length, 1, 'picks "' + label + '"');
    assert.equal(p[0].group, 'verdict label');
    const r = fails('::rank a-1 best="' + label + '" rank=1\n::');
    assert.equal(r.length, 1, 'rank "' + label + '"');
  }
  assert.equal(fails('::picks\na-1 | Best enclosed budget\n::').length, 0, '"Best <something else>" is not the label rule');
});

test('a ::rank card whose paragraph never names its product warns', () => {
  const nameCheck = (slug, para) => para.includes('Tyrant CNC');
  const named = '::rank tyrant best="Polymer" rank=1\n~ x\n::\n\nThe Tyrant CNC module is 2.1 oz.';
  const unnamed = '::rank tyrant best="Polymer" rank=1\n~ x\n::\n\nIt is 2.1 oz.';
  assert.equal(warns(named, { nameCheck }).length, 0);
  const w = warns(unnamed, { nameCheck });
  assert.equal(w.length, 1);
  assert.equal(w[0].group, 'unnamed product');
  assert.equal(w[0].line, 4, 'at the paragraph');
});

test('required sections per type: warnings only, the right ones', () => {
  const faq = (n) => ({ kind: 'faq', qas: Array.from({ length: n }, (_, i) => ({ q: 'Q' + i, a: 'A' })) });
  const h2 = (...t) => t.map((text) => ({ level: 2, text }));
  assert.deepEqual(FIELD_NOTE_TYPES, ['fit', 'trap', 'comparison', 'roundup', 'explainer', 'builds', 'new-part']);
  // every type
  assert.deepEqual(lintSections({ type: 'new-part', title: 'Tyrant CNC XMacro module', blocks: [faq(6)], headings: [] }), []);
  assert.ok(lintSections({ type: 'new-part', title: 'Which grip fits?', blocks: [faq(6)], headings: [] }).some((m) => /question word/.test(m)));
  assert.ok(lintSections({ type: 'new-part', title: 'T', blocks: [faq(3)], headings: [] }).some((m) => /5–8/.test(m)));
  assert.ok(lintSections({ type: 'new-part', title: 'T', blocks: [], headings: [] }).some((m) => /exactly one ::faq/.test(m)));
  // roundup
  const roundup = lintSections({ type: 'roundup', title: 'T', blocks: [faq(5), { kind: 'picks' }, { kind: 'rank' }], headings: h2('Ranked') });
  for (const want of ['::compare', '3 ::rank', '::unlocks', '::build', ' vs ']) assert.ok(roundup.some((m) => m.includes(want)), 'roundup needs ' + want);
  assert.deepEqual(lintSections({ type: 'roundup', title: 'T', headings: h2('A vs B'),
    blocks: [faq(5), { kind: 'picks' }, { kind: 'compare' }, { kind: 'rank' }, { kind: 'rank' }, { kind: 'rank' }, { kind: 'unlocks' }, { kind: 'build' }] }), []);
  // comparison, fit, trap, explainer, builds
  assert.ok(lintSections({ type: 'comparison', title: 'A and B', blocks: [faq(5)], headings: [] }).some((m) => / vs /.test(m)));
  assert.deepEqual(lintSections({ type: 'fit', title: 'T', blocks: [faq(5), { kind: 'fit' }], headings: h2('Does the 507K fit the XL?', 'How fit was checked') }), []);
  assert.ok(lintSections({ type: 'fit', title: 'T', blocks: [faq(5)], headings: h2('Fit') }).length === 3);
  assert.deepEqual(lintSections({ type: 'trap', title: 'T', blocks: [faq(5), { kind: 'build' }], headings: h2('What you need') }), []);
  assert.deepEqual(lintSections({ type: 'explainer', title: 'T', blocks: [faq(5)], headings: h2('What is an optic cut', 'Next') }), []);
  assert.ok(lintSections({ type: 'explainer', title: 'T', blocks: [faq(5)], headings: h2('Next', 'What is it') }).length === 1, 'the FIRST H2');
  assert.deepEqual(lintSections({ type: 'builds', title: 'T', blocks: [faq(5)], headings: h2('From the builders') }), []);
});
