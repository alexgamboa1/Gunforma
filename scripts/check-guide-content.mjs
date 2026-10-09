// check-guide-content.mjs — build-time guard for the guide pages' two
// halves: the registry (_guide-meta.mjs) and the editorial content
// (_guide-content.mjs) must agree, and the content must obey the ground
// rules the pages were commissioned under.
//
// What it catches, all of which render perfectly in a browser:
//   - a registry page with no content block (guide-page.mjs would 404 a
//     URL the sitemap lists — a soft self-contradiction)
//   - a content block with no registry row (dead prose nothing serves)
//   - a dollar figure in prose. Prices render LIVE or not at all; a "$149"
//     typed into a takeaway is exactly the hardcoded price the brief bans,
//     and it stays wrong forever while looking authoritative.
//   - a hardcoded count in prose ("all 15 optics") — counts are computed
//     at request time so retiring a product cannot falsify a sentence.
//   - a malformed updated date, an overlong title, or a FAQ that is not a
//     question.
// No network: this is tree-dependent, not time-dependent.
import { GUN_META, GUIDE_FAMILIES, GUIDE_PAGES, GUN_HUBS } from '../netlify/functions/_guide-meta.mjs';
import { GUIDE_CONTENT } from '../netlify/functions/_guide-content.mjs';

let failures = 0;
const fail = (msg) => { console.error('FAIL  ' + msg); failures++; };
const pass = (msg) => console.log('ok    ' + msg);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// "$" followed by a digit — a typed price. "$" alone (prose about dollars)
// does not trip it.
const TYPED_PRICE = /\$\s*\d/;
// "all 15", "15 optics", "15 red dots" — a typed count of the live set.
const TYPED_COUNT = /\b(all|the)\s+\d+\s+(optics?|red dots?|lights?|slides?|products?)\b/i;

function checkProse(where, text) {
  if (TYPED_PRICE.test(text)) fail(where + ': typed dollar figure — prices render live, never in prose');
  if (TYPED_COUNT.test(text)) fail(where + ': typed product count — counts are computed at request time');
}

// Registry → content, one page at a time.
for (const p of GUIDE_PAGES) {
  const id = p.family + '/' + p.gun;
  if (!GUIDE_FAMILIES[p.family]) fail(id + ': family not in GUIDE_FAMILIES');
  if (!GUN_META[p.gun]) fail(id + ': gun slug not in GUN_META');
  if (!ISO_DATE.test(p.updated || '') || Number.isNaN(Date.parse(p.updated)))
    fail(id + ': updated is not a valid YYYY-MM-DD date: ' + p.updated);

  const c = GUIDE_CONTENT[p.family] && GUIDE_CONTENT[p.family][p.gun];
  if (!c) { fail(id + ': declared in registry but has no content block'); continue; }

  if (!c.title || c.title.length > 65)
    fail(id + ': title missing or over 65 chars (' + (c.title || '').length + ')');
  if (!c.metaDescription || c.metaDescription.length < 50)
    fail(id + ': metaDescription missing or under 50 chars');
  if (!c.introAfter) fail(id + ': introAfter missing');
  if (!Array.isArray(c.staticTakeaways) || !c.staticTakeaways.length)
    fail(id + ': staticTakeaways missing');
  if (!Array.isArray(c.faq) || c.faq.length < 4 || c.faq.length > 7)
    fail(id + ': FAQ must hold 4–7 entries, has ' + (c.faq || []).length);
  for (const f of c.faq || []) {
    if (!f.q || !f.q.trim().endsWith('?')) fail(id + ': FAQ entry is not a question: "' + (f.q || '') + '"');
    if (!f.a || f.a.length < 40) fail(id + ': FAQ answer too thin to stand alone: "' + (f.q || '') + '"');
  }
  if (!Array.isArray(c.picks) || !c.picks.length || c.picks.length > 3)
    fail(id + ': picks must hold 1–3 entries');
  for (const pick of c.picks || []) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pick.slug || '')) fail(id + ': pick has a bad slug: ' + pick.slug);
    if (!pick.why) fail(id + ': pick ' + pick.slug + ' has no why-line');
  }
  if (!c.author || !c.author.name) fail(id + ': author.name missing');

  // The prose sweep.
  checkProse(id + ' title', c.title || '');
  checkProse(id + ' metaDescription', c.metaDescription || '');
  checkProse(id + ' introAfter', c.introAfter || '');
  (c.staticTakeaways || []).forEach((t, i) => checkProse(id + ' takeaway[' + i + ']', t));
  (c.faq || []).forEach((f, i) => { checkProse(id + ' faq[' + i + '].q', f.q || ''); checkProse(id + ' faq[' + i + '].a', f.a || ''); });
  (c.picks || []).forEach((pk, i) => checkProse(id + ' pick[' + i + '].why', pk.why || ''));

  if (!failures) pass(id);
}

// Content → registry: prose nothing serves is a page someone THINKS is live.
for (const family of Object.keys(GUIDE_CONTENT)) {
  for (const gun of Object.keys(GUIDE_CONTENT[family])) {
    if (!GUIDE_PAGES.some((p) => p.family === family && p.gun === gun))
      fail(family + '/' + gun + ': content block exists but page is not in GUIDE_PAGES — dead prose, or a missing registry row');
  }
}

// ── gun hubs: the registry's other half ───────────────────────────────────
// A hub lists a model's facts and links to its fit pages, so the two sets
// must be the same guns. Either mismatch is silent and leaves a page
// stranded: a hub with no fit pages lists nothing to click, and a fit page
// with no hub stays orphaned on the up side — which is the exact defect this
// whole page type was added to fix.
const hubGuns  = new Set(GUN_HUBS.map((h) => h.gun));
const pageGuns = new Set(GUIDE_PAGES.map((p) => p.gun));
for (const g of hubGuns) {
  if (!pageGuns.has(g)) fail('hub ' + g + ': declared in GUN_HUBS but has no page in GUIDE_PAGES — the hub would list nothing');
  if (!GUN_META[g])     fail('hub ' + g + ': gun slug not in GUN_META');
}
for (const g of pageGuns) {
  if (!hubGuns.has(g)) fail('hub ' + g + ': has a fit page but no hub in GUN_HUBS — the fit page is orphaned on the up side');
}
for (const h of GUN_HUBS) {
  if (!ISO_DATE.test(h.updated || '') || Number.isNaN(Date.parse(h.updated)))
    fail('hub ' + h.gun + ': updated is not a valid YYYY-MM-DD date: ' + h.updated);
  if (!h.summary || h.summary.length < 40)
    fail('hub ' + h.gun + ': summary missing or too thin to be worth reading');
  checkProse('hub ' + h.gun + ' summary', h.summary || '');
}
const dupHubs = GUN_HUBS.map((h) => h.gun).filter((g, i, a) => a.indexOf(g) !== i);
if (dupHubs.length) fail('GUN_HUBS has duplicate entries: ' + dupHubs.join(', '));
if (!failures) pass(GUN_HUBS.length + ' gun hub(s) match the declared fit pages exactly');

if (failures) {
  console.error('\n' + failures + ' guide-content failure(s).');
  process.exit(1);
}
console.log('\nguide registry and content agree; prose carries no typed prices or counts.');
