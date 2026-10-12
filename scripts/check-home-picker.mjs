// check-home-picker — the homepage's "What fits your P365?" picker is a copy
// of GUN_HUBS, and this holds the copy to the registry.
// ─────────────────────────────────────────────────────────────────────────
// index.html ships as a file, so its picker is a typed list of <a href>
// links — the only form a crawler or a no-JS visitor can see. /p365/ renders
// its cards from GUN_HUBS in netlify/functions/_guide-meta.mjs (names from
// GUN_META), and the registry is the one source of which models have a live
// hub. There is no second source: `guns` has no hub flag and no order
// column. So the homepage copy is allowed to exist only because this check
// refuses the deploy when it drifts:
//
//   - the SAME hubs: a hub declared in GUN_HUBS with no button here fails;
//     a button here for a gun with no hub (a dead button) fails
//   - the SAME order: GUN_HUBS order is the display order, most-owned first
//   - the SAME names: GUN_META[gun], byte for byte
//   - the index link LAST: "Not sure which model?" → HUB_INDEX_PATH
//   - NO typed counts in the picker's copy: "9 models" is stale the day the
//     tenth hub ships, and the registry cannot fix a number in prose
//
// A failure renders perfectly in a browser — a stale list, a wrong order, a
// dead button — which is the entry criterion for scripts/check-all.sh.
// No network: tree-dependent, not time-dependent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUN_HUBS, GUN_META, hubPath, HUB_INDEX_PATH } from '../netlify/functions/_guide-meta.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failures = 0;
const fail = (msg) => { console.error('FAIL  ' + msg); failures++; };
const pass = (msg) => console.log('ok    ' + msg);

// The whole section, heading to closing grid, so the prose check sees the
// heading and the subline and not just the buttons.
const section = html.match(/<div class="section fit-section">([\s\S]*?)<div class="model-grid" id="model-picker">([\s\S]*?)<\/div>/);
if (!section) {
  fail('index.html: no <div class="section fit-section"> … <div class="model-grid" id="model-picker"> block');
} else {
  const [, head, grid] = section;

  const links = [...grid.matchAll(/<a class="model-btn( more)?" href="([^"]*)">([^<]*)<\/a>/g)]
    .map((m) => ({ more: Boolean(m[1]), href: m[2], label: m[3] }));
  const stray = grid.replace(/<a class="model-btn( more)?" href="[^"]*">[^<]*<\/a>/g, '').replace(/\s+/g, '');
  if (stray) fail('picker grid holds something other than model buttons: ' + stray.slice(0, 80));

  const expected = GUN_HUBS.map((h) => ({ more: false, href: hubPath(h.gun), label: GUN_META[h.gun] || h.gun }));
  expected.push({ more: true, href: HUB_INDEX_PATH, label: 'Not sure which model? →' });

  const want = expected.map((e) => `${e.more ? '[more] ' : ''}${e.href} → ${e.label}`);
  const have = links.map((e) => `${e.more ? '[more] ' : ''}${e.href} → ${e.label}`);
  for (let i = 0; i < Math.max(want.length, have.length); i++) {
    if (want[i] !== have[i]) fail(`picker button ${i + 1}: expected "${want[i] ?? '(nothing)'}", found "${have[i] ?? '(nothing)'}"`);
  }
  if (!failures) pass(`${GUN_HUBS.length} model button(s) match GUN_HUBS in order, names from GUN_META, index link last`);

  const prose = (head + grid).replace(/<[^>]+>/g, ' ');
  const counted = prose.match(/\b\d[\d,]*\s*\+?\s*(models?|parts?|guns?|pistols?|optics?|red dots?|builds?|brands?)\b/i);
  if (counted) fail('picker copy carries a typed count: "' + counted[0] + '"');
  else pass('picker copy carries no typed count');

  if (!/<h2 class="section-title">What fits your P365\?<\/h2>/.test(head)) fail('picker heading is not an <h2> reading "What fits your P365?"');
  else pass('picker heading present');
}

if (failures) {
  console.error('\n' + failures + ' homepage-picker failure(s). The picker in index.html must mirror GUN_HUBS in netlify/functions/_guide-meta.mjs.');
  process.exit(1);
}
console.log('\nhomepage picker mirrors the gun-hub registry.');
