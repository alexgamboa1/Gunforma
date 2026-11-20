// field-note-page-audit.mjs — the invariants of a rendered Field Notes page
// that only the served HTML can show, as one pure function. Imported by
// scripts/field-note-furniture.test.mjs (over pages rendered against a
// stubbed catalog, on every deploy) and by scripts/check-routes.mjs (over
// the pages a real deploy serves). Not a check itself — nothing here runs
// on import — so the registry audit in check-all.sh rightly ignores it.
//
// Every one of these renders perfectly in a browser when it is wrong:
//   - two elements with one id: a TOC link lands on the first, silently
//   - a TOC href whose fragment is not on the page, or that is a bare
//     "#id" (the chrome's <base href="/"/> sends it to the homepage)
//   - an H2 the table of contents does not list, or a list out of order
//   - a TOC on a page with fewer than 3 H2s, none on a page with 3+, or a
//     second "On this page" landmark
//   - more or fewer than one <h1>
//   - an ItemList whose items do not match the ::rank cards on the page,
//     or whose url is not a /parts/ page the cards themselves link
//   - a Review or AggregateRating anywhere in the structured data
//   - a "Related field notes" link to a draft or an undeclared slug
import { FIELD_NOTES, fieldNotePath } from '../netlify/functions/_field-notes-meta.mjs';

const SITE = 'https://gunforma.com';
const TOC_MIN_H2 = 3;

export function auditFieldNotePage(html, slug) {
  const problems = [];
  const bad = (msg) => problems.push(msg);

  // ids, once each
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const idSet = new Set(ids);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) bad('duplicate ids on the page: ' + dupes.join(', '));

  // one h1
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) bad('expected exactly one <h1>, found ' + h1s);

  // Alex's rulings on #276 (2026-11-20): the byline shows ONE date, there is
  // ONE Related heading, and no author box repeats the byline at the bottom.
  const byline = (html.match(/<div class="byline">(.*?)<\/div>/) || [])[1];
  if (byline == null) bad('no byline row');
  else {
    if (!/Last reviewed [A-Z][a-z]+ \d{4}/.test(byline)) bad('the byline has no "Last reviewed <Month YYYY>"');
    if (/Published|\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b/.test(byline)) bad('the byline shows a second date — "Last reviewed" is its one date');
  }
  const relatedHeads = (html.match(/class="section-title">Related/g) || []).length;
  if (relatedHeads > 1) bad(relatedHeads + ' Related headings — the page has one Related section');
  const keepGoing = html.match(/<div class="fn-keep-going">(.*?)<\/div>/g) || [];
  if (keepGoing.length !== 1) bad('expected exactly one "Keep going" line');
  // All Field Notes closes it (Alex, 2026-11-20): an article's one path to
  // the index besides the breadcrumb, and the index links every note.
  else if (!/<a href="\/field-notes\.html">All Field Notes &rarr;<\/a><\/div>$/.test(keepGoing[0])) bad('the Keep going line does not end with "All Field Notes"');
  if (/<div class="author">/.test(html)) bad('the bottom author box is back — the byline carries the name and credential');

  // the table of contents against the H2s
  const h2ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
  const navs = (html.match(/<nav[^>]*aria-label="On this page"/g) || []).length;
  if (h2ids.length >= TOC_MIN_H2 && navs !== 1) bad(h2ids.length + ' H2s need exactly one nav[aria-label="On this page"], found ' + navs);
  if (h2ids.length < TOC_MIN_H2 && navs !== 0) bad('fewer than ' + TOC_MIN_H2 + ' H2s, but a table of contents rendered');

  const railStart = html.indexOf('aria-label="On this page"');
  if (railStart !== -1) {
    const rail = html.slice(railStart, html.indexOf('</nav>', railStart));
    const hrefs = [...rail.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    const frags = [];
    for (const href of hrefs) {
      const [path, frag] = href.split('#');
      if (path !== fieldNotePath(slug)) bad('TOC href is not page-absolute to this page: ' + href);
      if (!frag || !idSet.has(decodeURIComponent(frag))) bad('TOC href does not resolve on the page: ' + href);
      frags.push(decodeURIComponent(frag || ''));
    }
    const listedH2 = frags.filter((f) => h2ids.includes(f));
    if (listedH2.join(',') !== h2ids.join(',')) bad('TOC does not list every H2 in document order: [' + listedH2.join(', ') + '] vs [' + h2ids.join(', ') + ']');
    const extras = frags.filter((f) => !h2ids.includes(f));
    for (const f of extras) if (!['latest-updates', 'related-field-notes'].includes(f)) bad('TOC lists something that is not an H2 or a renderer section: #' + f);
    if (extras.length && frags.slice(-extras.length).join(',') !== extras.join(',')) bad('Latest updates / Related field notes must close the TOC');
    // the collapsed copy must carry the same links, and no second landmark
    const mob = html.indexOf('<details class="fn-toc-mobile">');
    if (mob === -1) bad('the <1024px table of contents (details.fn-toc-mobile) is missing');
    else {
      const mobile = html.slice(mob, html.indexOf('</details>', mob));
      const mHrefs = [...mobile.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      if (mHrefs.join('|') !== hrefs.join('|')) bad('the collapsed table of contents does not match the rail');
    }
  }

  // structured data: one script, one @graph
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  if (scripts.length !== 1) bad('expected one JSON-LD script, found ' + scripts.length);
  let graph = [];
  try {
    const ld = JSON.parse(scripts[0][1].replaceAll('\\u003c', '<'));
    graph = Array.isArray(ld['@graph']) ? ld['@graph'] : [];
    if (!graph.length) bad('the JSON-LD is not an @graph');
  } catch (e) { bad('the JSON-LD does not parse: ' + (e && e.message)); }
  const types = graph.map((n) => n['@type']);
  for (const t of ['Review', 'AggregateRating']) if (JSON.stringify(graph).includes('"' + t + '"')) bad('structured data carries a ' + t + ' — Gunforma does not review or rate parts');
  for (const t of ['Article', 'BreadcrumbList']) if (!types.includes(t)) bad('structured data has no ' + t);

  const crumb = graph.find((n) => n['@type'] === 'BreadcrumbList');
  if (crumb) {
    const names = (crumb.itemListElement || []).map((i) => i.name);
    if (names.length !== 3 || names[0] !== 'Home' || names[1] !== 'Field Notes') bad('breadcrumb must be Home → Field Notes → title, is ' + names.join(' → '));
  }

  // ItemList ↔ the ::rank cards
  const cards = (html.match(/class="fn-block fn-rank"/g) || []).length;
  const lists = graph.filter((n) => n['@type'] === 'ItemList');
  const items = lists.flatMap((l) => l.itemListElement || []);
  if (items.length !== cards) bad('ItemList items (' + items.length + ') do not match the ::rank cards on the page (' + cards + ')');
  for (const l of lists) if (l.numberOfItems !== (l.itemListElement || []).length) bad('ItemList "' + l.name + '" numberOfItems disagrees with its items');
  for (const it of items) {
    const path = String(it.url || '').replace(SITE, '');
    if (!String(it.url || '').startsWith(SITE + '/parts/') || !/^\/parts\/[a-z0-9-]+\/[a-z0-9-]+$/.test(path)) bad('ItemList url is not a /parts/ product page: ' + it.url);
    else if (!html.includes('class="rank-name" href="' + path + '"')) bad('ItemList url is not the page its rank card links: ' + it.url);
  }

  // related notes: declared, live
  const relStart = html.indexOf('id="related-field-notes"');
  if (relStart !== -1) {
    const rel = html.slice(relStart, html.indexOf('</ul>', relStart));
    for (const m of rel.matchAll(/<a href="\/field-notes\/([^"#]+)"/g)) {
      const a = FIELD_NOTES.find((x) => x.slug === m[1]);
      if (!a) bad('Related field notes links an undeclared slug: ' + m[1]);
      else if (a.draft) bad('Related field notes links a DRAFT: ' + m[1]);
      if (m[1] === slug) bad('Related field notes links the page itself');
    }
  }

  return problems;
}
