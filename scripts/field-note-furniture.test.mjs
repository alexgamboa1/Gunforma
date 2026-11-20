// field-note-furniture.test.mjs — the page furniture every field note gets
// with no per-article work: the table of contents, the byline row, the one
// @graph of structured data (Breadcrumb, ItemList per ranked group, Person),
// and the related-notes footer. field-note.mjs runs for real against a
// stubbed PostgREST, over BOTH declared articles: the renderer-check
// fixture (author, credential, ranked cards, a changelog, a related note)
// and the live grip-module guide (no author, six H2s, nine ranked cards),
// so the no-author byline and "a draft is never related" are pinned on a
// real page, not a toy.
//
// What it pins (and scripts/field-note-page-audit.mjs, which check-routes
// also runs on the wire, holds on every rendered page):
//   - every H2 id unique (and the renderer's own section ids reserved), the
//     optional {toc="Short label"} stripped from the heading and used as
//     the TOC label
//   - 3+ H2s → exactly one nav[aria-label="On this page"] listing every H2
//     in order, Latest updates / Related field notes last; < 3 → no TOC
//   - every TOC href page-absolute and resolving; the collapsed <details>
//     copy directly under the method line, identical links, no landmark
//   - the byline row in order: author · credential · Last reviewed; no
//     author → no name at all, never a placeholder
//   - the JSON-LD one @graph: Person with an author, Organization without;
//     Breadcrumb Home → Field Notes → title; one ItemList per ranked group
//     (rank 1 restarts a group), items = ::rank cards, urls = /parts/
//     pages; never Review or AggregateRating
//   - related notes: shared tags first, newest reviewed next, four at most,
//     never a draft, never the page itself; none → no section
//   - the IntersectionObserver script only on a page with a TOC
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditFieldNotePage } from './field-note-page-audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;

const md = await import(fn('_markdown.mjs'));
const meta = await import(fn('_field-notes-meta.mjs'));
const page = await import(fn('field-note.mjs'));
const handler = page.default;
const { FIELD_NOTES, fieldNotePath, relatedNotes } = meta;

const FIXTURE = 'renderer-check';
const LIVE = 'best-p365-xmacro-grip-modules';
assert.ok(FIELD_NOTES.find((a) => a.slug === FIXTURE && a.draft), 'the renderer-check draft fixture must stay');
assert.ok(FIELD_NOTES.find((a) => a.slug === LIVE && !a.draft), 'the live grip-module guide is the second page under test');
const PREVIEW = 'https://deploy-preview-999--velvety-stardust-4de48f.netlify.app';

// ── the Markdown half ────────────────────────────────────────────────────
test('H2 ids are unique, the renderer’s own ids are reserved, {toc} is a label', () => {
  const r = md.renderMarkdown([
    '## The fit', '## The fit', '## Latest updates', '## Related field notes',
    '## A very long heading about magazines {toc="Magazines"}', '## Empty label {toc=""}',
  ].join('\n\n'));
  const h2 = r.headings.filter((h) => h.level === 2);
  assert.deepEqual(h2.map((h) => h.id), ['the-fit', 'the-fit-2', 'latest-updates-2', 'related-field-notes-2', 'a-very-long-heading-about-magazines', 'empty-label']);
  assert.equal(h2[4].toc, 'Magazines');
  assert.equal(h2[4].text, 'A very long heading about magazines', 'the label is stripped from the heading');
  assert.ok(r.html.includes('<h2 id="a-very-long-heading-about-magazines">A very long heading about magazines</h2>'));
  assert.ok(!r.html.includes('{toc='), 'the attribute never reaches the page');
  assert.equal(h2[5].toc, null, 'an empty label falls back to the heading');
});

test('each block knows the H2 it sits under', () => {
  const r = md.renderMarkdown('::price a\n\n## Ranked\n\n::rank a best="B" rank=1\n~ x\n::\n\n## Second list\n\n::rank b best="B" rank=1\n~ y\n::');
  assert.deepEqual(r.blockSections, [null, 'Ranked', 'Second list']);
});

test('the TOC: 3+ H2s, in order, renderer sections last; fewer → none', () => {
  const hs = (n) => Array.from({ length: n }, (_, i) => ({ level: 2, id: 'h' + i, text: 'H ' + i, toc: null }));
  assert.equal(page.TOC_MIN_H2, 3);
  assert.deepEqual(page.tocEntries(hs(2), { hasChangelog: true, hasRelated: true }), [], 'two H2s: no table of contents, even with the renderer sections');
  const e = page.tocEntries([...hs(3), { level: 3, id: 'sub', text: 'Sub' }], { hasChangelog: true, hasRelated: true });
  assert.deepEqual(e.map((x) => x.id), ['h0', 'h1', 'h2', 'latest-updates', 'related-field-notes'], 'no H3s; Latest updates then Related close the list');
  assert.deepEqual(page.tocEntries(hs(3), { hasChangelog: false, hasRelated: false }).map((x) => x.id), ['h0', 'h1', 'h2']);
  const label = page.tocEntries([{ level: 2, id: 'a', text: 'Long [link](/x) and `code`', toc: null }, ...hs(2)], {})[0].labelHtml;
  assert.equal(label, 'Long link and code', 'a label is plain text — no <a> nested in the TOC link');
});

test('ranked groups: rank 1 restarts a group, items in rank order, named by their H2', () => {
  const P = (slug) => ({ slug, displayName: slug.toUpperCase(), href: '/parts/frames/' + slug });
  const products = new Map(['a', 'b', 'c', 'd', 'e'].map((s) => [s, P(s)]));
  const blocks = [
    { kind: 'rank', slug: 'a', rank: 1 }, { kind: 'rank', slug: 'e', rank: 3 }, { kind: 'rank', slug: 'b', rank: 2 },   // one group, out of order
    { kind: 'price', slugs: ['x'] },
    { kind: 'rank', slug: 'c', rank: 1 }, { kind: 'rank', slug: 'd', rank: 2 }, { kind: 'rank', slug: 'missing', rank: 3 },
  ];
  const g = page.rankGroups(blocks, ['Top', 'Top', 'Top', 'Top', 'Budget', 'Budget', 'Budget'], products);
  assert.equal(g.length, 2, 'the second rank=1 opens a second group');
  assert.equal(g[0].section, 'Top');
  assert.deepEqual(g[0].items.map((i) => i.rank + i.o.slug), ['1a', '2b', '3e'], 'rank order, not document order');
  assert.equal(g[1].section, 'Budget');
  assert.deepEqual(g[1].items.map((i) => i.o.slug), ['c', 'd'], 'a card whose product did not resolve has no /parts/ page to list');
  assert.equal(g[1].cards, 3);
});

test('related notes: shared tags first, newest next, four at most, never a draft or itself', () => {
  const notes = [
    { slug: 'me', published: '2026-01-01', tags: ['grips', 'xmacro', 'mags'] },
    { slug: 'one-tag-new', published: '2026-05-01', updated: '2026-09-01', tags: ['grips'] },
    { slug: 'two-tags-old', published: '2026-02-01', tags: ['grips', 'xmacro'] },
    { slug: 'three-tags-draft', published: '2026-10-01', draft: true, tags: ['grips', 'xmacro', 'mags'] },
    { slug: 'one-tag-old', published: '2026-03-01', tags: ['mags'] },
    { slug: 'one-tag-mid', published: '2026-04-01', tags: ['xmacro'] },
    { slug: 'unrelated', published: '2026-11-01', tags: ['optics'] },
    { slug: 'untagged', published: '2026-11-01' },
  ];
  assert.deepEqual(relatedNotes('me', notes).map((a) => a.slug), ['two-tags-old', 'one-tag-new', 'one-tag-mid', 'one-tag-old']);
  assert.equal(relatedNotes('me', notes, 2).length, 2);
  assert.ok(!relatedNotes('me', notes, 10).some((a) => a.draft), 'never a draft');
  assert.deepEqual(relatedNotes('untagged', notes), [], 'an untagged note has no related notes — never "everything"');
  assert.deepEqual(relatedNotes('nope', notes), []);
});

// ── the handler over both declared articles ─────────────────────────────
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
const realError = console.error;
test.beforeEach(() => { console.error = () => {}; });
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

// A catalog in which every slug a page names resolves (so the ItemList can
// be held to the ::rank cards one for one) and every other read is empty —
// the furniture does not depend on what the blocks say.
const CATEGORY = { 'holosun-507k-x2': 'optic', 'holosun-507c-x2': 'optic', 'sig-sauer-p365-17rd-mag': 'magazine', 'killer-innovations-velo-v1-p365-xl': 'slide', 'holosun-507-promax': 'optic', 'streamlight-tlr-7-hl-x-sub-usb': 'light' };
const inList = (path, key) => { const m = path.match(new RegExp(key + '=in\\.\\(([^)]*)\\)')); return m ? m[1].split(',') : []; };
function catalog(n, path) {
  if (path.startsWith('products?slug=in.')) {
    return json(inList(path, 'slug').map((slug) => ({
      id: 'id-' + slug, slug, name: slug.replace(/-/g, ' '), category: CATEGORY[slug] || 'frame', url: null, is_discontinued: false, restricted_states: null,
      manufacturers: { name: 'Maker', website_url: null },
      product_variants: [{ id: 'v-' + slug, msrp: null, is_default: true, primary_image_url: null, color: 'Black', affiliate_links: [] }],
    })));
  }
  return json([]);
}
function stubFetch(impl) {
  globalThis.fetch = async (url, init) => impl(0, decodeURIComponent(String(url).replace(/^.*\/rest\/v1\//, '')), init);
}
const run = async (slug) => {
  const res = await handler(new Request(PREVIEW + fieldNotePath(slug)));
  return { status: res.status, headers: res.headers, html: await res.text() };
};
const graphOf = (h) => JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1].replaceAll('\\u003c', '<'))['@graph'];

for (const slug of [FIXTURE, LIVE]) {
  test(`${slug}: the page audit holds — ids, TOC, h1, ItemList, related`, async () => {
    stubFetch(catalog);
    const r = await run(slug);
    assert.equal(r.status, 200);
    assert.deepEqual(auditFieldNotePage(r.html, slug), [], 'every page invariant holds');
  });
}

test('the fixture: TOC entries, rail + collapsed copy, script, related note, headers', async () => {
  stubFetch(catalog);
  const { html: h, headers } = await run(FIXTURE);
  const h2 = [...h.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(h2.length, 5);
  // 5 H2s + Latest updates + Related field notes
  assert.equal(headers.get('x-field-note-toc'), '7');
  assert.equal((h.match(/aria-label="On this page"/g) || []).length, 1, 'one landmark');
  assert.ok(h.includes('<div class="fn-toc-head">On this page</div>'));
  assert.ok(h.includes('<summary>Jump to section</summary>'));
  assert.ok(h.includes('href="/field-notes/renderer-check#the-v2-blocks-unlocks-colours-an-example-build">The v2 blocks</a>'), 'the fixture’s {toc} short label is the TOC entry');
  assert.ok(h.includes('<h2 id="the-v2-blocks-unlocks-colours-an-example-build">The v2 blocks: unlocks, colours, an example build</h2>'), 'the heading keeps its full text and id');
  assert.ok(h.includes('href="/field-notes/renderer-check#latest-updates">Latest updates</a>'));
  assert.ok(h.includes('href="/field-notes/renderer-check#related-field-notes">Related field notes</a>'));
  assert.ok(!/href="#/.test(h.slice(h.indexOf('aria-label="On this page"'), h.indexOf('</details>'))), 'no bare fragment href');
  // the collapsed copy sits directly under the method line, above the disclosure
  const method = h.indexOf('<p class="fn-method">'), mob = h.indexOf('<details class="fn-toc-mobile">'), disc = h.indexOf('<p class="fn-affiliate-note">');
  assert.ok(method < mob && mob < disc, 'method line, then the collapsed TOC, then the disclosure');
  assert.ok(h.slice(h.indexOf('</p>', method) + 4).startsWith('<details class="fn-toc-mobile">'), 'directly under the method line');
  // the two-column layout hooks and the script
  assert.ok(h.includes('<body class="fn-toc-on">') && h.includes('class="page article fn-has-toc"'));
  assert.equal((h.match(/new IntersectionObserver/g) || []).length, 1, 'the observer script once');
  assert.ok(h.includes('aria-current'), 'the script sets aria-current');
  assert.ok(h.includes('scroll-margin-top: 72px'), 'headings clear the sticky nav');
  assert.ok(h.includes('@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }'), 'smooth scrolling only without reduced motion');
  // related: the live guide shares grip-modules + p365-xmacro with the fixture
  assert.equal(headers.get('x-field-note-related'), '1');
  const rel = h.slice(h.indexOf('id="related-field-notes"'));
  assert.ok(rel.includes('<a href="/field-notes/best-p365-xmacro-grip-modules">Best P365 XMacro Grip Modules (2026): Every Option, Fit-Checked</a>'), 'title from the related note’s own front matter');
  assert.ok(rel.includes('class="fn-related-desc">Every aftermarket XMacro-size grip module'), 'and its description');
  assert.ok(h.indexOf('id="latest-updates"') < h.indexOf('id="related-field-notes"'), 'after Latest updates');
});

test('the fixture: byline order, Person, Breadcrumb, one ItemList for the three cards', async () => {
  stubFetch(catalog);
  const { html: h, headers } = await run(FIXTURE);
  const byline = h.match(/<div class="byline">(.*?)<\/div>/)[1];
  assert.equal(byline, 'By <strong>Gunforma</strong> &middot; <span class="byline-cred">Renderer fixture — not reviewed prose</span> &middot; Last reviewed November 2026',
    'author · credential · Last reviewed — one date (Alex, 2026-11-20)');
  assert.ok(!h.includes('<div class="author">'), 'no author box repeating the byline at the bottom');
  assert.equal(graphOf(h).find((n) => n['@type'] === 'Article').datePublished, '2026-10-20', 'the published date stays in the JSON-LD');
  assert.ok(h.includes('<meta property="article:published_time" content="2026-10-20"/>'), 'and in the article meta');
  // one Related section: the tag-matched note, then the Keep going line
  assert.equal((h.match(/class="section-title">Related/g) || []).length, 1, 'never two Related headings');
  const rel = h.slice(h.indexOf('id="related-field-notes"'), h.indexOf('</div></div>', h.indexOf('id="related-field-notes"')));
  assert.ok(rel.indexOf('class="fn-related-list"') < rel.indexOf('class="fn-keep-going"'), 'notes first, then Keep going under them');
  assert.ok(rel.includes('<span class="fn-keep-going-label">Keep going:</span> <a href="/p365/">What fits your P365 &rarr;</a> <a href="/gunforma-armory.html">Build yours in the Armory &rarr;</a> <a href="/gunforma-builds.html">Real builds &rarr;</a> <a href="/field-notes.html">All Field Notes &rarr;</a>'),
    'the fixture is linked from no hub, so its model hub is the /p365/ index');
  assert.ok(h.indexOf('<h1>') < h.indexOf('<div class="byline">') && h.indexOf('<div class="byline">') < h.indexOf('<p class="fn-method">'));
  const g = graphOf(h);
  const art = g.find((n) => n['@type'] === 'Article');
  assert.deepEqual(art.author, { '@type': 'Person', name: 'Gunforma', description: 'Renderer fixture — not reviewed prose' });
  assert.deepEqual(g.find((n) => n['@type'] === 'BreadcrumbList').itemListElement.map((i) => i.name),
    ['Home', 'Field Notes', 'Does the Holosun 507K X2 fit a P365 XL? A renderer check, not an article']);
  const lists = g.filter((n) => n['@type'] === 'ItemList');
  assert.equal(lists.length, 1);
  assert.equal(lists[0].name, 'The guide blocks', 'named by the H2 the cards sit under');
  assert.deepEqual(lists[0].itemListElement.map((i) => [i.position, i.url]), [
    [1, 'https://gunforma.com/parts/optics/holosun-507k-x2'],
    [2, 'https://gunforma.com/parts/optics/holosun-507c-x2'],
    [3, 'https://gunforma.com/parts/magazines/sig-sauer-p365-17rd-mag'],
  ]);
  assert.equal(headers.get('x-field-note-itemlists'), '1:3');
  assert.ok(!JSON.stringify(g).includes('Review') && !JSON.stringify(g).includes('AggregateRating'));
});

test('the live guide: no author → no name, Organization; a draft is never related', async () => {
  stubFetch(catalog);
  const { html: h, headers } = await run(LIVE);
  const byline = h.match(/<div class="byline">(.*?)<\/div>/)[1];
  assert.equal(byline, 'Last reviewed October 2026', 'no placeholder name, no credential, one date');
  assert.ok(!h.includes('class="author"'), 'and no author box');
  // no related notes → no Related heading, but the Keep going line stays,
  // leading with the note's own model hub (the XMacro hub links into it)
  assert.equal((h.match(/class="section-title">Related/g) || []).length, 0);
  assert.ok(h.includes('<div class="fn-related-notes"><div class="fn-keep-going"><span class="fn-keep-going-label">Keep going:</span> <a href="/p365/p365-xmacro">Everything for the Sig Sauer P365 XMacro &rarr;</a>'),
    'the model hub is the first live hub that links into this note');
  assert.ok(h.includes('<a href="/gunforma-builds.html">Real builds &rarr;</a> <a href="/field-notes.html">All Field Notes &rarr;</a></div>'),
    'All Field Notes closes the Keep going line (Alex, 2026-11-20) — the index is what links every note');
  assert.ok(!h.includes('Parts by category'), '"Parts by category" stays out');
  assert.deepEqual(graphOf(h).find((n) => n['@type'] === 'Article').author, { '@type': 'Organization', name: 'Gunforma' });
  // the only note it shares tags with is the renderer-check DRAFT
  assert.equal(headers.get('x-field-note-related'), '0');
  assert.ok(!h.includes('id="related-field-notes"'), 'no related section at all');
  assert.ok(!h.includes('href="/field-notes/renderer-check"'), 'the draft is never linked');
  assert.equal(headers.get('x-field-note-toc'), '8', 'seven H2s plus Latest updates');
  assert.equal(headers.get('x-field-note-itemlists'), '1:9', 'nine ranked cards, one list');
});

test('a page under the TOC threshold renders no rail, no collapsed copy, no script', () => {
  // Asserted through the audit: a page with two H2s and a TOC is a failure,
  // and the same page with none passes.
  const base = (toc) => '<h1>T</h1><div class="byline">Last reviewed May 2026</div><h2 id="a">A</h2><h2 id="b">B</h2>' + toc +
    '<div class="fn-keep-going"><a href="/field-notes.html">All Field Notes &rarr;</a></div>' +
    '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article"},{"@type":"BreadcrumbList","itemListElement":[{"name":"Home"},{"name":"Field Notes"},{"name":"T"}]}]}</script>';
  assert.deepEqual(auditFieldNotePage(base(''), 'x'), []);
  assert.ok(auditFieldNotePage(base('<nav aria-label="On this page"></nav>'), 'x').some((p) => p.includes('fewer than 3')));
});
