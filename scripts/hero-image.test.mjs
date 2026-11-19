// hero-image.test.mjs — the product page's hero photo follows the DEFAULT
// variant.
//
// The heroImage block in product-page.mjs used to take the first variant
// with any image, in whatever order PostgREST returned the variants — so a
// product whose default variant was not first served another colour's photo
// as its hero, og:image, twitter:image and JSON-LD image, while the parts
// catalog card (default-first) showed the right one. The Wilson Combat
// WCP365 XL served the Green variant over its Black default. The page
// renders perfectly either way, so the handler is run for real against a
// stubbed fetch and the served image is held to the default variant:
//
//   1. the default variant's primary_image_url
//   2. the default variant's first variant_images row by position
//   3. any variant's primary_image_url
//   4. any variant's first variant_images row by position
//   5. null — the colour-swatch placeholder, og-default.png on the card
//
// Hero <img>, og:image, twitter:image and the Product JSON-LD image must all
// be the one value. Run: node scripts/hero-image.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(pathToFileURL(join(ROOT, 'netlify/functions/product-page.mjs')).href);
const handler = mod.default;

const GREEN = 'https://maker.example/photos/green-main.jpg';
const BLACK = 'https://maker.example/photos/black-main.webp';
const BLACK_GALLERY_1 = 'https://maker.example/photos/black-angle-1.jpg';
const BLACK_GALLERY_2 = 'https://maker.example/photos/black-angle-2.jpg';

function variant(over) {
  return {
    id: 'v-' + over.slug, sku: over.slug.toUpperCase(), upc: null, msrp: 99.99,
    is_default: false, primary_image_url: null, color: 'Green', finish: null,
    optic_cut: null, bundle: null, clamp_style: null, manual_safety_variant: null,
    reticle: null, reticle_color: null, variant_label: null,
    variant_images: [], affiliate_links: [],
    ...over,
  };
}

function product(variants) {
  return {
    id: '00000000-0000-4000-8000-000000000001', slug: 'test-frame', name: 'Test Frame',
    category: 'frame', description: 'A test part.', best_for: [],
    material: null, material_family: null, weight_oz: null,
    installation_difficulty: null, fitment_confidence: 'verified',
    build_warning: null, fitment_notes: null, lowest_price: null,
    url: 'https://maker.example/part', is_discontinued: false,
    manufacturers: { name: 'Acme', slug: 'acme', website_url: 'https://maker.example' },
    product_variants: variants,
  };
}

// Run the handler over a stubbed fetch (the fits-on.test.mjs shape).
async function render(variants) {
  const realFetch = globalThis.fetch;
  const realErr = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('/products?slug=eq.')) return json([product(variants)]);
    if (u.includes('/frame_specs?') && u.includes('select=fit_tier')) return json([]);
    if (u.includes('/product_platforms?')) return json([{ platforms: { slug: 'p365' } }]);
    if (u.includes('/products?id=eq.')) return json([{ restricted_states: null }]);
    return json([]);
  };
  try {
    const res = await handler(new Request('https://gunforma.com/parts/frames/test-frame'));
    assert.equal(res.status, 200);
    return await res.text();
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
  }
}

function served(html) {
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html);
  const tw = /<meta name="twitter:image" content="([^"]+)"/.exec(html);
  const hero = /<img class="hero-img" src="([^"]+)"/.exec(html);
  const products = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]))
    .flatMap((d) => (Array.isArray(d) ? d : [d]))
    .filter((d) => d['@type'] === 'Product');
  assert.equal(products.length, 1, 'one Product JSON-LD node');
  return {
    og: og && og[1], twitter: tw && tw[1], hero: hero && hero[1],
    jsonLd: products[0].image || null,
    swatch: html.includes('hero-placeholder'),
  };
}

test('the default variant\'s photo wins even when the default is not first', async () => {
  // Green first in the array (the Wilson shape) — the old code served it.
  const html = await render([
    variant({ slug: 'green', primary_image_url: GREEN }),
    variant({ slug: 'black', is_default: true, color: 'Black', primary_image_url: BLACK }),
  ]);
  const s = served(html);
  assert.equal(s.hero, BLACK, 'hero <img> is the default variant\'s photo');
  assert.equal(s.og, BLACK, 'og:image is the default variant\'s photo');
  assert.equal(s.twitter, BLACK, 'twitter:image is the default variant\'s photo');
  assert.equal(s.jsonLd, BLACK, 'JSON-LD image is the default variant\'s photo');
});

test('a default with no primary photo uses its own gallery, position first', async () => {
  const html = await render([
    variant({ slug: 'green', primary_image_url: GREEN }),
    variant({ slug: 'black', is_default: true, color: 'Black', variant_images: [
      // Out of order on purpose: position decides, not array order.
      { url: BLACK_GALLERY_2, position: 2, alt_text: null },
      { url: BLACK_GALLERY_1, position: 1, alt_text: null },
    ] }),
  ]);
  const s = served(html);
  assert.equal(s.og, BLACK_GALLERY_1, 'the default\'s position-1 gallery image beats another variant\'s primary photo');
  assert.equal(s.hero, BLACK_GALLERY_1);
});

test('a default with no image at all falls back to another variant\'s photo', async () => {
  const html = await render([
    variant({ slug: 'black', is_default: true, color: 'Black' }),
    variant({ slug: 'green', primary_image_url: GREEN }),
  ]);
  const s = served(html);
  assert.equal(s.og, GREEN, 'fallback: any variant\'s photo rather than no image');
  assert.equal(s.hero, GREEN);
  assert.equal(s.jsonLd, GREEN);
});

test('no variant has an image: the swatch placeholder renders and the card falls back', async () => {
  const html = await render([
    variant({ slug: 'black', is_default: true, color: 'Black' }),
    variant({ slug: 'green' }),
  ]);
  const s = served(html);
  assert.equal(s.hero, null, 'no hero <img>');
  assert.ok(s.swatch, 'the colour-swatch placeholder renders instead');
  assert.equal(s.og, 'https://gunforma.com/og-default.png', 'og:image falls back to og-default.png');
  assert.equal(s.twitter, 'https://gunforma.com/og-default.png');
  assert.equal(s.jsonLd, null, 'JSON-LD carries no image rather than a wrong one');
});
