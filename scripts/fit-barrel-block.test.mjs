// fit-barrel-block.test.mjs — the Field Notes `::fit barrel=` block.
//
// `::fit barrel=a[,b,…]` lists the slides v_barrel_slide_fit says those
// barrels fit (fit_status = 'fits'; slide approved, not discontinued), as a
// CLOSED <details> whose <summary> is the heading — "Slides this barrel
// fits (N)", or "Slides these barrels fit (N)" for a group — then the
// barrels named and linked, then the slides, linked, brand then name, no
// length column, and a dated footer. Zero rows is said in words. A group is
// only honest when every barrel fits the SAME slides: the build fails a
// group whose sets differ (against scripts/fixtures/barrel-slide-fit.json),
// and the renderer, re-checking live, refuses one in words.
// What it pins:
//   - the parser: barrel= single or comma list, with or without gun=;
//     optic=/magazine= still one slug with gun=
//   - the query: the fit view, fits only, the slide through the NAMED
//     slide_specs FK (PGRST201), discontinued slides filtered
//   - the HTML: details/summary closed, counts, singular/plural, barrel
//     links, slide links sorted, unapproved dropped, no length column, the
//     zero-row sentence, the footer, the live mismatch refusal
//   - the build guard: a mismatched group fails naming the barrels and the
//     differing slides; an unknown slug or a non-barrel fails; the article
//     as written passes
// Run with --refresh-fixture to re-read the fit fixture from production.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The OFFLINE half of the group rule: every barrel's fitting slides, read
// from v_barrel_slide_fit with the public key (fit_status = 'fits', the
// slide approved and not discontinued — the renderer's own filter).
// check-field-notes.mjs reads it to hold a ::fit barrel=a,b group to one
// set of slides. Refresh after a fit or catalog change:
//   node scripts/fit-barrel-block.test.mjs --refresh-fixture
// The renderer re-checks the same rule live on every request.
const FIT_FIXTURE = join(ROOT, 'scripts/fixtures/barrel-slide-fit.json');
if (process.argv.includes('--refresh-fixture')) {
  const client = await readFile(join(ROOT, 'js/supabase-client.js'), 'utf8');
  const url = client.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
  const key = client.match(/eyJ[A-Za-z0-9._-]+/)[0];
  const get = async (path) => {
    const res = await fetch(url + '/rest/v1/' + path, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    if (!res.ok) throw new Error('PostgREST ' + res.status + ' on ' + path);
    return res.json();
  };
  const barrels = await get('products?category=eq.barrel&is_discontinued=eq.false&select=slug&order=slug.asc&limit=1000');
  const sel = 'barrel:products!barrel_specs_product_id_fkey!inner(slug),' +
    'slide:products!slide_specs_product_id_fkey!inner(slug,is_approved,is_discontinued)';
  const rows = await get('v_barrel_slide_fit?fit_status=eq.fits&select=' + encodeURIComponent(sel) + '&limit=10000');
  const fits = Object.fromEntries(barrels.map((b) => [b.slug, []]));
  for (const r of rows) {
    if (!r.barrel || !r.slide || r.slide.is_approved !== true || r.slide.is_discontinued) continue;
    if (!fits[r.barrel.slug]) fits[r.barrel.slug] = [];
    if (!fits[r.barrel.slug].includes(r.slide.slug)) fits[r.barrel.slug].push(r.slide.slug);
  }
  for (const k of Object.keys(fits)) fits[k].sort();
  await writeFile(FIT_FIXTURE, JSON.stringify({ captured: new Date().toISOString().slice(0, 10),
    source: "v_barrel_slide_fit?fit_status=eq.fits, slide approved and not discontinued (public key)", fits }, null, 1) + '\n');
  console.log('fit fixture refreshed: ' + Object.keys(fits).length + ' barrels');
}
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;
const md = await import(fn('_markdown.mjs'));
const page = await import(fn('field-note.mjs'));
const handler = page.default;

const ARTICLE = 'best-p365-fuse-threaded-barrels';
const PREVIEW = 'https://deploy-preview-999--velvety-stardust-4de48f.netlify.app';

// ── the parser ───────────────────────────────────────────────────────────
test('::fit barrel= parses one slug or a comma list, with or without gun=', () => {
  assert.deepEqual(md.parseDirective('::fit barrel=b-1'), { kind: 'fit', part: 'barrel', slug: 'b-1', slugs: ['b-1'], gun: null });
  assert.deepEqual(md.parseDirective('::fit barrel=b-1,b-2,b-3 gun=p365-fuse'),
    { kind: 'fit', part: 'barrel', slug: 'b-1', slugs: ['b-1', 'b-2', 'b-3'], gun: 'p365-fuse' });
  assert.equal(md.parseDirective('::fit barrel=b-1,b-1'), null, 'no duplicate in a group');
  assert.equal(md.parseDirective('::fit barrel=b-1,'), null, 'no empty member');
  assert.equal(md.parseDirective('::fit barrel=b-1 optic=o-1 gun=p365'), null, 'one part per block');
  assert.equal(md.parseDirective('::fit barrel=Bad_Slug'), null);
  assert.equal(md.parseDirective('::fit b-1'), null, 'the bare slug form is not a directive');
  assert.equal(md.parseDirective('::fit optic=o-1'), null, 'optic still needs gun=');
  assert.equal(md.parseDirective('::fit optic=o-1,o-2 gun=p365'), null, 'only barrel= takes a list');
  assert.equal(md.parseDirective('::fit magazine=m-1'), null, 'magazine still needs gun=');
  assert.equal(md.parseDirective('::fit optic=o-1 gun=p365').part, 'optic');
});

test('the query: the fit view, fits only, slide through the named FK, discontinued filtered', () => {
  const p = decodeURIComponent(page.barrelFitQueryPath('B1'));
  assert.ok(p.startsWith('v_barrel_slide_fit?barrel_product_id=eq.B1&fit_status=eq.fits&'), p);
  assert.ok(p.includes('slide:products!slide_specs_product_id_fkey!inner('), 'the slide embed names its FK');
  assert.ok(!p.includes('barrel_length_in'), 'no length column, so no length read');
  assert.ok(p.endsWith('&slide.is_discontinued=is.false'));
});

// ── the handler over the article ─────────────────────────────────────────
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const barrel = (id, slug, name, brand) => ({
  id, slug, name, category: 'barrel', url: 'https://maker.example/' + slug, is_discontinued: false, restricted_states: null,
  material: '416R Stainless Steel', weight_oz: null,
  manufacturers: { name: brand, website_url: 'https://maker.example' },
  product_variants: [{ id: 'V' + id, msrp: 199.99, is_default: true, primary_image_url: null, color: 'Black', affiliate_links: [] }],
});
const slide = (slug, name, brand, extra = {}) => ({
  slide: { id: 'S-' + slug, slug, name, category: 'slide', is_approved: true, is_discontinued: false, manufacturers: { name: brand }, ...extra },
});
const ZETA = slide('zeta-slide', 'Zeta FUSE Slide', 'Norsso');
const ARCB = slide('arc-b-slide', 'Reactor B 365F', 'Arc Division');
const ARCA = slide('arc-a-slide', 'Reactor A 365F', 'Arc Division');
const HIDDEN = slide('hidden-slide', 'Hidden FUSE Slide', 'Aaa', { is_approved: false });

// The article's barrels, by id. Default stub: the threaded pair fits the
// same three slides (out of order, plus an unapproved one), the flush trio
// fits nothing, the Fdez ported pair fits ZETA, C Port fits ARCA, E Port
// fits nothing.
const SLUGS = {
  TPT: 'true-precision-p365-fuse-threaded', FWT: 'fdez-werx-p365-fuse-threaded-barrel',
  FWF: 'fdez-werx-p365-fuse-flush-barrel', TPN: 'true-precision-p365-fuse-non-threaded', NST: 'norsso-p365-fuse-standard',
  FWP: 'fdez-werx-p365-fuse-ported-barrel', FWC: 'fdez-werx-p365-fuse-chunk-port-barrel',
  NCP: 'norsso-n365-fuse-cport', NEP: 'norsso-n365-fuse-eport',
};
const PRODUCTS = Object.fromEntries(Object.entries(SLUGS).map(([id, s]) =>
  [s, barrel(id, s, id === 'TPT' ? 'True Precision P365 Fuse 4.3" Threaded Barrels' : 'Barrel ' + s, id === 'TPT' ? 'True Precision' : 'Maker')]));
const DEFAULT_FIT = {
  TPT: [ZETA, ARCB, ARCA, HIDDEN], FWT: [ARCA, ZETA, ARCB],
  FWF: [], TPN: [], NST: [],
  FWP: [ZETA], FWC: [ZETA], NCP: [ARCA], NEP: [],
};

async function render(fit = DEFAULT_FIT) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/products?slug=in.(')) {
      const want = u.match(/slug=in\.\(([^)]*)\)/)[1].split(',');
      return json(want.map((s) => PRODUCTS[s]).filter(Boolean));
    }
    const m = u.match(/v_barrel_slide_fit\?barrel_product_id=eq\.([A-Z]+)&fit_status=eq\.fits/);
    if (m) return json(fit[m[1]] || []);
    return json([]);
  };
  try {
    const res = await handler(new Request(PREVIEW + '/field-notes/' + ARTICLE));
    return { res, html: await res.text() };
  } finally { globalThis.fetch = real; }
}

const boxes = (html) => [...html.matchAll(/<details class="fn-block fn-fit fn-fit-barrel" data-fit-slides="(\d+)">([\s\S]*?)<\/details>/g)]
  .map((m) => ({ n: Number(m[1]), body: m[2] }));

test('four groups and two singles render as closed <details> boxes, summary first', async () => {
  const { res, html } = await render();
  assert.equal(res.status, 200);
  const b = boxes(html);
  assert.equal(b.length, 5, 'threaded pair, flush trio, Fdez ported pair, C Port, E Port');
  for (const x of b) {
    assert.ok(x.body.startsWith('<summary class="fn-fit-q">'), 'the summary is the first child, so the box works with JS off');
    assert.ok(!/<details[^>]*\sopen/.test(html.slice(html.indexOf('<details class="fn-block fn-fit'), html.indexOf('</details>', html.indexOf('<details class="fn-block fn-fit')))), 'closed by default');
    assert.ok(!x.body.includes('<table') && !/Barrel length/i.test(x.body), 'no length column');
    assert.match(x.body, /<div class="disclosure">Fit from the Gunforma catalog on [A-Z][a-z]{2} \d{1,2}, \d{4}\.<\/div>$/);
  }
  assert.ok(!/<details class="fn-block fn-fit fn-fit-barrel"[^>]*\sopen/.test(html), 'no fit box is served open');
});

test('a group: plural heading, every barrel named and linked, the shared slides sorted brand then name', async () => {
  const { html } = await render();
  const tp = boxes(html)[0];
  assert.equal(tp.n, 3);
  assert.ok(tp.body.includes('<summary class="fn-fit-q">Slides these barrels fit (3)</summary>'));
  assert.ok(tp.body.includes('<a href="/parts/barrels/true-precision-p365-fuse-threaded">True Precision P365 Fuse 4.3&quot; Threaded Barrels</a>'));
  assert.ok(tp.body.includes('<a href="/parts/barrels/fdez-werx-p365-fuse-threaded-barrel">'));
  const links = [...tp.body.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a><\/li>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [
    ['/parts/slides/arc-a-slide', 'Arc Division Reactor A 365F'],
    ['/parts/slides/arc-b-slide', 'Arc Division Reactor B 365F'],
    ['/parts/slides/zeta-slide', 'Norsso Zeta FUSE Slide'],
  ], 'brand then name; the unapproved slide is not listed');
  assert.ok(!tp.body.includes('hidden-slide'));
});

test('the single-barrel form still works: singular heading, its own slides', async () => {
  const { html } = await render();
  const cp = boxes(html).find((x) => x.body.includes('/parts/barrels/norsso-n365-fuse-cport'));
  assert.equal(cp.n, 1);
  assert.ok(cp.body.includes('<summary class="fn-fit-q">Slides this barrel fits (1)</summary>'));
  assert.ok(cp.body.includes('<li><a href="/parts/slides/arc-a-slide">Arc Division Reactor A 365F</a></li>'));
});

test('zero fitting rows is said in words, singular and plural', async () => {
  const { html } = await render();
  const b = boxes(html);
  const ep = b.find((x) => x.body.includes('/parts/barrels/norsso-n365-fuse-eport'));
  assert.ok(ep.body.includes('Slides this barrel fits (0)'));
  assert.ok(ep.body.includes('No slide in the Gunforma catalog is on record as fitting this barrel.'));
  const flush = b.find((x) => x.body.includes('/parts/barrels/fdez-werx-p365-fuse-flush-barrel'));
  assert.ok(flush.body.includes('Slides these barrels fit (0)'));
  assert.ok(flush.body.includes('No slide in the Gunforma catalog is on record as fitting these barrels.'));
});

test('live: a group whose sets have diverged is refused in words, never merged', async () => {
  const { html, res } = await render({ ...DEFAULT_FIT, FWT: [ARCA, ZETA] });
  assert.equal(res.status, 200);
  assert.equal(boxes(html).length, 4, 'the threaded pair is no longer a box');
  const m = html.match(/<div class="fn-block fn-fit fn-fit-barrel fn-fit-mismatch">([\s\S]*?)<\/div><\/div>/);
  assert.ok(m, 'the refusal renders');
  assert.ok(m[1].includes('These barrels no longer fit the same slides'));
  assert.ok(m[1].includes('Arc Division Reactor B 365F fits True Precision P365 Fuse 4.3&quot; Threaded Barrels only'), 'names the slide and the barrel that fits it');
  assert.ok(!m[1].includes('<li>'), 'no slide list under a refusal');
});

// ── the build guard ──────────────────────────────────────────────────────
async function guardWith(edit) {
  const dir = await mkdtemp(join(tmpdir(), 'fit-barrel-'));
  try {
    for (const p of ['scripts', 'netlify/functions', 'field-notes', 'field-notes.html', 'js'])
      await cp(join(ROOT, p), join(dir, p), { recursive: true });
    const file = join(dir, 'field-notes', ARTICLE + '.md');
    await writeFile(file, edit(await readFile(file, 'utf8')));
    return spawnSync(process.execPath, [join(dir, 'scripts/check-field-notes.mjs')], { encoding: 'utf8' });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('the fit fixture carries the article\'s barrels, with the sets the groups rely on', async () => {
  const f = JSON.parse(await readFile(FIT_FIXTURE, 'utf8')).fits;
  const same = (a, b) => JSON.stringify(f[a]) === JSON.stringify(f[b]);
  assert.ok(same(SLUGS.TPT, SLUGS.FWT));
  assert.ok(same(SLUGS.FWF, SLUGS.TPN) && same(SLUGS.TPN, SLUGS.NST));
  assert.ok(same(SLUGS.FWP, SLUGS.FWC));
  assert.ok(!same(SLUGS.NCP, SLUGS.NEP), 'C Port and E Port fit different slides, which is why they are two boxes');
});

test('the guard passes the article as it is', async () => {
  const r = await guardWith((s) => s);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the guard fails a group whose barrels fit different slides, naming them', async () => {
  const r = await guardWith((s) => s.replace('::fit barrel=norsso-n365-fuse-cport\n', '::fit barrel=norsso-n365-fuse-cport,norsso-n365-fuse-eport\n'));
  assert.notEqual(r.status, 0);
  const out = r.stdout + r.stderr;
  assert.match(out, /::fit barrel=norsso-n365-fuse-cport,norsso-n365-fuse-eport groups barrels that do not fit the same slides/);
  assert.match(out, /norsso-[a-z0-9-]+ fits norsso-n365-fuse-cport only/);
  assert.match(out, /norsso-[a-z0-9-]+ fits norsso-n365-fuse-eport only/);
});

test('the guard fails a ::fit barrel= slug that is not in the catalog', async () => {
  const r = await guardWith((s) => s.replace('::fit barrel=norsso-n365-fuse-eport', '::fit barrel=no-such-barrel-anywhere'));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /::fit barrel= names a slug not in the live catalog \(fixture\): no-such-barrel-anywhere/);
});

test('the guard fails a ::fit barrel= slug that is not a barrel', async () => {
  const r = await guardWith((s) => s.replace('::fit barrel=norsso-n365-fuse-eport', '::fit barrel=mcarbo-comp-p365'));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /::fit barrel= names mcarbo-comp-p365, which is a compensator, not a barrel/);
});
