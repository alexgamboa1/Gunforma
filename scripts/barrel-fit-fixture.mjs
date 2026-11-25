// barrel-fit-fixture — ONE reader of the fitting slides per barrel, the
// offline half of the ::fit barrel= group rule.
// ─────────────────────────────────────────────────────────────────────────
// scripts/fixtures/barrel-slide-fit.json is what check-field-notes.mjs holds
// a ::fit barrel=a,b group to (one set of slides across the group), because
// the build cannot read the database. Two things read the live rows:
//
//   - fit-barrel-block.test.mjs --refresh-fixture, which REWRITES the file;
//   - check-barrel-fit-fixture.mjs, which COMPARES the file with the live
//     rows and fails when they differ.
//
// Both go through readLiveFits() below, so "what the fixture should hold"
// is defined once: every live (not discontinued) barrel, each with the
// slugs of the slides v_barrel_slide_fit says fit (fit_status = 'fits'),
// the slide approved and not discontinued — the renderer's own filter —
// sorted. A barrel with no fitting slide is present with an empty list.
//
// Not a check (no check- prefix, no .test suffix): check-all's audit
// ignores it, and it runs nothing on import.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIT_FIXTURE = join(ROOT, 'scripts/fixtures/barrel-slide-fit.json');
export const FIXTURE_SOURCE = 'v_barrel_slide_fit?fit_status=eq.fits, slide approved and not discontinued (public key)';
export const REFRESH_COMMAND = 'node scripts/fit-barrel-block.test.mjs --refresh-fixture';

export async function readLiveFits({ url, key, fetchImpl = fetch }) {
  const get = async (path) => {
    const res = await fetchImpl(url.replace(/\/+$/, '') + '/rest/v1/' + path, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('PostgREST ' + res.status + ' on ' + path.split('?')[0]);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error('PostgREST answered a non-array on ' + path.split('?')[0]);
    return body;
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
  return fits;
}

// What differs between two { barrel: [slides] } maps, in words — empty when
// they hold the same barrels with the same slides (order ignored).
export function diffFits(stored, live) {
  const out = [];
  const keys = [...new Set([...Object.keys(stored), ...Object.keys(live)])].sort();
  for (const b of keys) {
    if (!(b in live)) { out.push(b + ': in the fixture, not a live barrel'); continue; }
    if (!(b in stored)) { out.push(b + ': live barrel missing from the fixture'); continue; }
    const s = new Set(stored[b]), l = new Set(live[b]);
    const gained = [...l].filter((x) => !s.has(x)).sort();
    const lost = [...s].filter((x) => !l.has(x)).sort();
    if (gained.length) out.push(b + ': now also fits ' + gained.join(', '));
    if (lost.length) out.push(b + ': no longer fits ' + lost.join(', '));
  }
  return out;
}

// The fixture file's exact text for a set of fits — written by the hand
// refresh and by the scheduled auto-refresh, so the two produce the same
// bytes.
export function fixtureText(fits, captured = new Date().toISOString().slice(0, 10)) {
  return JSON.stringify({ captured, source: FIXTURE_SOURCE, fits }, null, 1) + '\n';
}
