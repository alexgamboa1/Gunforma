// fit-barrel-block.test.mjs — the Field Notes `::fit barrel=<slug>` block.
//
// The block lists the slides v_barrel_slide_fit says a barrel fits
// (fit_status = 'fits' only), each linked to its /parts/ page with the
// barrel length the slide takes, sorted brand then name, under "Slides
// this barrel fits (N)" and a dated footer. Zero rows is an answer, said in
// words. What it pins:
//   - the parser: barrel= with or without gun=, never two parts at once,
//     optic= and magazine= still needing gun=
//   - the query: v_barrel_slide_fit, fit_status=eq.fits, the slide through
//     the NAMED slide_specs FK (PGRST201), discontinued slides filtered
//   - the HTML: heading count, links, lengths, brand-then-name order, an
//     unapproved slide dropped, the zero-row sentence, the footer
//   - the build guard: a ::fit barrel= slug that is not in the catalog, or
//     is not a barrel, fails check-field-notes.mjs
// It runs field-note.mjs over the real draft article
// (best-p365-fuse-threaded-barrels) against a stubbed PostgREST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = (f) => pathToFileURL(join(ROOT, 'netlify/functions', f)).href;
const md = await import(fn('_markdown.mjs'));
const page = await import(fn('field-note.mjs'));
const handler = page.default;

const ARTICLE = 'best-p365-fuse-threaded-barrels';
const PREVIEW = 'https://deploy-preview-999--velvety-stardust-4de48f.netlify.app';

// ── the parser ───────────────────────────────────────────────────────────
test('::fit barrel= parses with or without gun=; the other parts still need gun=', () => {
  assert.deepEqual(md.parseDirective('::fit barrel=b-1'), { kind: 'fit', part: 'barrel', slug: 'b-1', gun: null });
  assert.deepEqual(md.parseDirective('::fit barrel=b-1 gun=p365-fuse'), { kind: 'fit', part: 'barrel', slug: 'b-1', gun: 'p365-fuse' });
  assert.equal(md.parseDirective('::fit barrel=b-1 optic=o-1 gun=p365'), null, 'one part per block');
  assert.equal(md.parseDirective('::fit barrel=Bad_Slug'), null);
  assert.equal(md.parseDirective('::fit b-1'), null, 'the bare slug form is not a directive');
  assert.equal(md.parseDirective('::fit optic=o-1'), null, 'optic still needs gun=');
  assert.equal(md.parseDirective('::fit magazine=m-1'), null, 'magazine still needs gun=');
  assert.equal(md.parseDirective('::fit optic=o-1 gun=p365').part, 'optic');
});

test('the query: the fit view, fits only, slide through the named FK, discontinued filtered', () => {
  const p = decodeURIComponent(page.barrelFitQueryPath('B1'));
  assert.ok(p.startsWith('v_barrel_slide_fit?barrel_product_id=eq.B1&fit_status=eq.fits&'), p);
  assert.ok(p.includes('slide:products!slide_specs_product_id_fkey!inner('), 'the slide embed names its FK');
  assert.ok(p.includes('slide_specs!slide_specs_product_id_fkey!inner(barrel_length_in)'));
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
const slide = (id, slug, name, brand, len, extra = {}) => ({
  slide: { id, slug, name, category: 'slide', is_approved: true, is_discontinued: false,
    manufacturers: { name: brand }, slide_specs: { barrel_length_in: len }, ...extra },
});

// The threaded barrel fits three slides, out of order, plus one the
// catalog has not approved; the flush barrel fits nothing.
const FIT = {
  TP: [
    slide('S3', 'zeta-slide', 'Zeta FUSE Slide', 'Norsso', 4.3),
    slide('S1', 'arc-b-slide', 'Reactor B 365F', 'Arc Division', 4.3),
    slide('S2', 'arc-a-slide', 'Reactor A 365F', 'Arc Division', 4.3),
    slide('S9', 'hidden-slide', 'Hidden FUSE Slide', 'Aaa', 4.3, { is_approved: false }),
  ],
  FW: [],
};
const PRODUCTS = {
  'true-precision-p365-fuse-threaded': barrel('TP', 'true-precision-p365-fuse-threaded', 'True Precision P365 Fuse 4.3" Threaded Barrels', 'True Precision'),
  'fdez-werx-p365-fuse-flush-barrel': barrel('FW', 'fdez-werx-p365-fuse-flush-barrel', 'P365 FUSE Non-LCI Flush & Crown 4.3" Barrel', 'Fdez Werx'),
};
// The article's other seven barrels resolve too, with no fit rows.
['fdez-werx-p365-fuse-threaded-barrel', 'true-precision-p365-fuse-non-threaded', 'norsso-p365-fuse-standard',
 'fdez-werx-p365-fuse-ported-barrel', 'fdez-werx-p365-fuse-chunk-port-barrel', 'norsso-n365-fuse-cport', 'norsso-n365-fuse-eport']
  .forEach((s, k) => { PRODUCTS[s] = barrel('X' + String.fromCharCode(65 + k), s, 'Barrel ' + s, 'Maker'); });

async function render() {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    asked.push(u);
    if (u.includes('/products?slug=in.(')) {
      const want = u.match(/slug=in\.\(([^)]*)\)/)[1].split(',');
      return json(want.map((s) => PRODUCTS[s]).filter(Boolean));
    }
    const m = u.match(/v_barrel_slide_fit\?barrel_product_id=eq\.([A-Z]+)&fit_status=eq\.fits/);
    if (m) return json(FIT[m[1]] || []);
    return json([]);
  };
  try {
    const res = await handler(new Request(PREVIEW + '/field-notes/' + ARTICLE));
    return { res, html: await res.text(), asked };
  } finally { globalThis.fetch = real; }
}

const blocksOf = (html) => [...html.matchAll(/<div class="fn-block fn-fit fn-fit-barrel" data-fit-slides="(\d+)">([\s\S]*?)<div class="disclosure">([^<]*)<\/div><\/div>/g)]
  .map((m) => ({ n: Number(m[1]), body: m[2], footer: m[3] }));

test('happy path: the fitting slides, linked, with lengths, brand then name, unapproved dropped', async () => {
  const { res, html, asked } = await render();
  assert.equal(res.status, 200);
  assert.ok(asked.some((u) => u.includes('v_barrel_slide_fit?barrel_product_id=eq.TP&fit_status=eq.fits')));
  const blocks = blocksOf(html);
  assert.equal(blocks.length, 9, 'the article carries nine ::fit barrel= blocks');
  const tp = blocks[0];
  assert.equal(tp.n, 3);
  assert.ok(tp.body.includes('Slides this barrel fits (3)'));
  const links = [...tp.body.matchAll(/<td><a href="([^"]+)">([^<]+)<\/a><\/td><td>([^<]+)<\/td>/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(links, [
    ['/parts/slides/arc-a-slide', 'Arc Division Reactor A 365F', '4.3"'],
    ['/parts/slides/arc-b-slide', 'Arc Division Reactor B 365F', '4.3"'],
    ['/parts/slides/zeta-slide', 'Norsso Zeta FUSE Slide', '4.3"'],
  ], 'brand then name; the unapproved slide is not listed');
  assert.ok(!tp.body.includes('hidden-slide'));
  assert.match(tp.footer, /^Fit from the gunforma catalog on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
});

test('zero fitting rows is said in words, never omitted', async () => {
  const { html } = await render();
  const fw = blocksOf(html).find((b) => b.body.includes('/parts/barrels/fdez-werx-p365-fuse-flush-barrel'));
  assert.ok(fw, 'the flush barrel block renders');
  assert.equal(fw.n, 0);
  assert.ok(fw.body.includes('Slides this barrel fits (0)'));
  assert.ok(fw.body.includes('No slide in the gunforma catalog is on record as fitting this barrel.'));
  assert.ok(!fw.body.includes('<table'));
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

test('the guard passes the article as it is', async () => {
  const r = await guardWith((s) => s);
  assert.equal(r.status, 0, r.stdout + r.stderr);
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
