// featured-field-notes.test.mjs — the product page's "Featured in Field
// Notes" section.
//
// A product page links the live articles that feature it — every slug in an
// article's ::picks, ::rank, ::compare, ::fit barrel= and ::build blocks —
// derived from the article files (_field-note-features.mjs), never a list.
// A dead or draft link renders perfectly, so this holds:
//
//   - which blocks count: those five, and not ::rank baseline=, ::fit
//     optic=/magazine=, ::price, ::colors or ::unlocks;
//   - the happy path: a featured product's page serves the section, linking
//     the article by its /field-notes/ path and title;
//   - a draft is never listed, a declared article whose file is missing is
//     skipped, and at most three are listed, newest reviewed first;
//   - none renders nothing — no heading over an empty list;
//   - on the REAL registry and files: every product any article names
//     (drafts included) maps only to live, declared articles whose file is
//     present — so no product page can link a draft or a missing note;
//   - the function bundles field-notes/*.md (netlify.toml).
//
// Run: node scripts/featured-field-notes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const F = await imp('netlify/functions/_field-note-features.mjs');
const META = await imp('netlify/functions/_field-notes-meta.mjs');
const handler = (await imp('netlify/functions/product-page.mjs')).default;

const note = (title, body) => '---\ntitle: ' + title + '\ndescription: d\n---\n\n' + body + '\n';

const EVERY_KIND = note('Every kind', [
  '::picks', 'pick-a | Label', 'pick-b | Label', '::',
  '::rank rank-a best="Label" rank=1 baseline=factory-part', '~ a change', '::',
  '::compare barrel cols=material slugs=cmp-a,cmp-b',
  '::fit barrel=fit-a,fit-b',
  '::build name="A build"', 'frame=build-a', 'slide=build-b', '::',
  // not counted:
  '::fit optic=optic-x gun=p365-xmacro',
  '::fit magazine=mag-x gun=p365-xmacro',
  '::price price-x',
  '::colors slugs=color-x baseline=color-base',
  '::unlocks frame=unlock-x',
].join('\n'));

test('which blocks count', () => {
  const got = [...F.featuredSlugs(EVERY_KIND)].sort();
  assert.deepEqual(got, ['build-a', 'build-b', 'cmp-a', 'cmp-b', 'fit-a', 'fit-b', 'pick-a', 'pick-b', 'rank-a']);
});

test('a draft is never listed, a missing file is skipped, three at most, newest reviewed first', async () => {
  const files = {
    old: note('Old', '::rank shared best="x" rank=1'),
    mid: note('Mid', '::rank shared best="x" rank=1'),
    new: note('New', '::compare barrel cols=material slugs=shared,other'),
    newest: note('Newest', '::fit barrel=shared'),
    drafty: note('Drafty', '::rank shared best="x" rank=1'),
    // gone: declared, no file
  };
  const notes = [
    { slug: 'old', published: '2026-01-01', updated: '2026-01-01' },
    { slug: 'mid', published: '2026-02-01' },
    { slug: 'new', published: '2026-01-15', updated: '2026-03-01' },
    { slug: 'newest', published: '2026-04-01', updated: '2026-04-01' },
    { slug: 'drafty', published: '2026-09-01', updated: '2026-09-01', draft: true },
    { slug: 'gone', published: '2026-08-01', updated: '2026-08-01' },
  ];
  const map = await F.buildFeatureMap({ notes, load: async (s) => files[s] ?? null });
  const shared = F.featuredNotesFrom(map, 'shared');
  assert.deepEqual(shared.map((n) => n.slug), ['newest', 'new', 'mid'], 'three, newest updated (else published) first; draft and missing file left out');
  assert.equal(shared[0].href, '/field-notes/newest');
  assert.equal(shared[0].title, 'Newest');
  assert.deepEqual(F.featuredNotesFrom(map, 'other').map((n) => n.slug), ['new']);
  assert.deepEqual(F.featuredNotesFrom(map, 'nobody'), []);
  // A part only a draft features has no entry at all.
  const draftOnly = await F.buildFeatureMap({
    notes: [{ slug: 'drafty', published: '2026-09-01', draft: true }],
    load: async () => note('Drafty', '::rank lonely best="x" rank=1'),
  });
  assert.deepEqual(F.featuredNotesFrom(draftOnly, 'lonely'), []);
});

test('the real registry: every listed article is live, declared, and has its file', async () => {
  const map = await F.buildFeatureMap();
  const declared = new Map(META.FIELD_NOTES.map((a) => [a.slug, a]));
  let pairs = 0;
  // Every product ANY article names, drafts included — a draft-only part
  // must map to nothing.
  const named = new Set();
  for (const a of META.FIELD_NOTES) {
    const src = await F.loadNoteSource(a.slug);
    assert.ok(src != null, 'declared article ' + a.slug + ' has a file');
    for (const s of F.featuredSlugs(src)) named.add(s);
  }
  for (const p of named) {
    for (const n of F.featuredNotesFrom(map, p)) {
      const a = declared.get(n.slug);
      assert.ok(a, p + ' links undeclared note ' + n.slug);
      assert.ok(!a.draft, p + ' links DRAFT note ' + n.slug);
      assert.equal(n.href, META.fieldNotePath(n.slug));
      assert.ok(n.title, n.slug + ' has a title');
      pairs++;
    }
  }
  assert.ok(pairs > 0, 'at least one product is featured by a live article');
});

// ── the served page ──────────────────────────────────────────────────────
function product(slug) {
  return {
    id: '00000000-0000-4000-8000-0000000000aa', slug, name: 'Test Barrel',
    category: 'barrel', description: 'A test part.', best_for: [],
    material: null, material_family: null, weight_oz: null,
    installation_difficulty: null, fitment_confidence: 'verified',
    build_warning: null, fitment_notes: null, lowest_price: null,
    url: 'https://maker.example/part', is_discontinued: false,
    manufacturers: { name: 'Acme', slug: 'acme', website_url: 'https://maker.example' },
    product_variants: [{
      id: 'v1', sku: 'S', upc: null, msrp: 99, is_default: true, primary_image_url: null,
      color: 'Black', finish: null, optic_cut: null, bundle: null, clamp_style: null,
      manual_safety_variant: null, reticle: null, reticle_color: null, variant_label: null,
      variant_images: [], affiliate_links: [],
    }],
  };
}

async function render(slug) {
  const realFetch = globalThis.fetch;
  const realErr = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/products?slug=eq.')) return json([product(slug)]);
    if (u.includes('/product_platforms?')) return json([{ platforms: { slug: 'p365' } }]);
    if (u.includes('/products?id=eq.')) return json([{ restricted_states: null }]);
    return json([]);
  };
  try {
    const res = await handler(new Request('https://gunforma.com/parts/barrels/' + slug));
    assert.equal(res.status, 200);
    return { html: await res.text(), state: res.headers.get('x-field-notes') };
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
}

test('a featured product\'s page serves the section and links the article', async () => {
  const live = META.liveFieldNotes().map((a) => a.slug);
  const map = await F.buildFeatureMap();
  const [slug, notes] = [...map.entries()].find(([, v]) => v.length) || [];
  assert.ok(slug, 'some product is featured');
  const { html, state } = await render(slug);
  assert.equal(state, 'listed:' + notes.length);
  assert.match(html, /<div class="section-title">Featured in Field Notes<\/div>/);
  for (const n of notes) {
    assert.ok(live.includes(n.slug));
    assert.ok(html.includes('href="/field-notes/' + n.slug + '"'), 'links /field-notes/' + n.slug);
  }
  const links = [...html.matchAll(/href="\/field-notes\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  for (const l of links) assert.ok(live.includes(l), 'the page links only live notes, not ' + l);
});

test('none renders nothing', async () => {
  const { html, state } = await render('no-article-features-this-part');
  assert.equal(state, 'listed:0');
  assert.ok(!html.includes('Featured in Field Notes'), 'no heading over nothing');
  assert.ok(!/href="\/field-notes\//.test(html));
});

test('product-page bundles the article files', async () => {
  const toml = await readFile(join(ROOT, 'netlify.toml'), 'utf8');
  const block = (toml.match(/\[functions\."product-page"\][\s\S]*?(?=\n\[|\n#|$)/) || [''])[0];
  assert.match(block, /"field-notes\/\*\.md"/, 'included_files carries field-notes/*.md');
});
