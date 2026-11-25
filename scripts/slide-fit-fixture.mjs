// slide-fit-fixture — ONE reader of the grip classes each slide fits, the
// offline half of the ::fit slide= against=frame group rule.
// ─────────────────────────────────────────────────────────────────────────
// scripts/fixtures/slide-frame-fit.json is what check-field-notes.mjs holds
// a ::fit slide=a,b against=frame group to (one grip-class fit set across
// the group), because the build cannot read the database. Two things read
// the live rows, both through readLiveSlideFrameFits():
//
//   - fit-slide-block.test.mjs --refresh-fixture, which REWRITES the file;
//   - check-slide-fit-fixture.mjs, which COMPARES the file with the live
//     rows and fails when they differ (check-routes.yml, with the key).
//
// Per live (not discontinued) slide: { <housing_class>: <view verdict> }
// over v_slide_frame_fit rows with fits = true whose grip is approved and
// not discontinued — the renderer's own filter. The against=barrel half
// reads scripts/fixtures/barrel-slide-fit.json inverted (barrelsBySlide),
// so one fixture, not two, says which barrel fits which slide.
//
// Not a check (no check- prefix, no .test suffix): it runs nothing on import.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SLIDE_FIT_FIXTURE = join(ROOT, 'scripts/fixtures/slide-frame-fit.json');
export const SLIDE_FIXTURE_SOURCE = 'v_slide_frame_fit?fits=is.true, grip approved and not discontinued (public key)';
export const SLIDE_REFRESH_COMMAND = 'node scripts/fit-slide-block.test.mjs --refresh-fixture';

export async function readLiveSlideFrameFits({ url, key, fetchImpl = fetch }) {
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
  const slides = await get('products?category=eq.slide&is_discontinued=eq.false&select=slug&order=slug.asc&limit=1000');
  const sel = 'housing_class,verdict,slide:products!slide_specs_product_id_fkey!inner(slug),' +
    'frame:products!frame_specs_product_id_fkey!inner(is_approved,is_discontinued)';
  // PostgREST caps a response at 1000 rows and this view holds more, so
  // page through it in a fixed order — a single read silently returned the
  // first 1000 and half the slides came back with no grip class at all.
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await get('v_slide_frame_fit?fits=is.true&select=' + encodeURIComponent(sel) +
      '&order=slide_product_id.asc,frame_product_id.asc&limit=1000&offset=' + offset);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const fits = Object.fromEntries(slides.map((s) => [s.slug, {}]));
  for (const r of rows) {
    if (!r.slide || !r.frame || r.frame.is_approved !== true || r.frame.is_discontinued || !r.housing_class) continue;
    if (!fits[r.slide.slug]) continue;   // a discontinued slide
    fits[r.slide.slug][r.housing_class] = r.verdict || '';
  }
  for (const k of Object.keys(fits)) fits[k] = Object.fromEntries(Object.entries(fits[k]).sort(([a], [b]) => (a < b ? -1 : 1)));
  return fits;
}

// What differs between two { slide: {class: verdict} } maps, in words.
export function diffSlideFits(stored, live) {
  const out = [];
  for (const s of [...new Set([...Object.keys(stored), ...Object.keys(live)])].sort()) {
    if (!(s in live)) { out.push(s + ': in the fixture, not a live slide'); continue; }
    if (!(s in stored)) { out.push(s + ': live slide missing from the fixture'); continue; }
    for (const c of [...new Set([...Object.keys(stored[s]), ...Object.keys(live[s])])].sort()) {
      if (stored[s][c] !== live[s][c]) out.push(s + ' on ' + c + ': fixture says ' + JSON.stringify(stored[s][c] ?? null) + ', live says ' + JSON.stringify(live[s][c] ?? null));
    }
  }
  return out;
}

export function slideFixtureText(fits, captured = new Date().toISOString().slice(0, 10)) {
  return JSON.stringify({ captured, source: SLIDE_FIXTURE_SOURCE, fits }, null, 1) + '\n';
}

// The barrel fixture turned around: { slide slug: [barrel slugs] }.
export function barrelsBySlide(barrelFits) {
  const out = {};
  for (const [barrel, slides] of Object.entries(barrelFits || {})) for (const s of slides) (out[s] = out[s] || []).push(barrel);
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}
