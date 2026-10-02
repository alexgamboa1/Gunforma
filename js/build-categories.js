// build-categories — the ONE source of truth for a build's parts taxonomy:
// which sections exist, what order they render in, which of the four group
// headings each one sits under, and what label a stored category value
// renders as.
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS. Three pages render the same taxonomy and used to
// carry their own copy of it:
//
//   gunforma-post-build.html    the builder's picker  (CATEGORIES)
//   gunforma-admin-post.html    the admin's picker    (CATEGORIES)
//   gunforma-build-detail.html  the published build   (CATEGORY_LABELS)
//
// The admin copy had already drifted: no Magazine Release, Magwells with its
// dbCategory hint dropped so six seeded products were unreachable, and a
// Sights section the public page does not have. Same shape as the photo
// uploader, the redact modal and the part picker before it — the page nobody
// is looking at keeps the old list, and nothing fails. So this is the fifth
// thing extracted rather than copied, and CLAUDE.md already named the
// CATEGORIES list as the next extraction.
//
// Loaded as a plain `<script src>` global by all three pages, like
// js/category-map.js and js/build-url.js — these pages have no module loader.
//
// EVERYTHING IS DERIVED FROM `CATEGORIES`. Labels, the db-category reverse
// map and the grouped render order are all computed below rather than
// hand-listed, so a new section declares its facts once. The only
// hand-written map is LEGACY_CATEGORY_LABELS, for keys that are no longer
// offered but still sit in old snapshots.
//
// GUARDED BY scripts/check-category-labels.mjs, which evaluates this file and
// asserts that every key it can emit resolves to a real label, that no label
// ever reaches a reader with an underscore in it, and that the groups cover
// every section exactly once and in the same order as CATEGORIES. A section
// in CATEGORIES with no group would render in no group heading and therefore
// nowhere at all on the builder pages — invisible, with the page looking
// perfectly normal.
// ─────────────────────────────────────────────────────────────────────────
(function (global) {

// The four stages a build is assembled in, in render order. The point of the
// headings is to make the parts step read as progress through the gun rather
// than a flat list of eighteen accordions, so each one carries a line saying
// what the stage is for. Not clickable — they are headings, not accordions.
const CATEGORY_GROUPS = [
  { key: 'core',     label: 'Core build',       blurb: 'The parts that define the gun.' },
  { key: 'controls', label: 'Controls',         blurb: 'The small parts you touch every time you run it.' },
  { key: 'magazine', label: 'Magazine',         blurb: 'Capacity, reloads and grip length.' },
  { key: 'carry',    label: 'Carry and finish', blurb: 'How you carry it and how it looks.' },
];

// Sections, in the order they render. `group` must be one of the keys above,
// and sections sharing a group must be CONTIGUOUS here and in group order —
// the check enforces both, which is what keeps this array's order identical
// to what the grouped builder pages and the ungrouped build page both show.
//
// `key` is what gets written into parts_snapshot. `dbCategory` lists the raw
// products.category values that belong to this section: it drives the catalog
// query's bucketing AND the reverse map that rescues a part saved under the
// DB vocabulary instead of the UI one.
//
// The five former "Other Parts / Components" members — basepad, slide_plate,
// slide_release, safety_selector, takedown_lever — are now sections of their
// own, keyed by the products.category value itself, so a saved part carries
// its real category with no translation in either direction. `other_parts` is
// gone as a section; a leftover in an old snapshot falls through to
// Miscellaneous on the builder and renders under its own legacy heading on a
// published build.
const CATEGORIES = [
  // ── Core build ──────────────────────────────────────────────────────────
  { key:'grips',    group:'core', label:'Grip Modules',           dbCategory:['frame'] },
  { key:'slides',   group:'core', label:'Slides',                 dbCategory:['slide'] },
  { key:'barrels',  group:'core', label:'Barrels & Compensators', dbCategory:['barrel','compensator'] },
  { key:'optics',   group:'core', label:'Optics',                 dbCategory:['optic'] },
  { key:'lights',   group:'core', label:'Weapon Lights',          dbCategory:['light'] },
  { key:'triggers', group:'core', label:'Triggers',               dbCategory:['trigger'] },

  // ── Controls ────────────────────────────────────────────────────────────
  { key:'mag_release',     group:'controls', label:'Magazine Release', dbCategory:['mag_release'] },
  { key:'slide_release',   group:'controls', label:'Slide Releases',   dbCategory:['slide_release'] },
  { key:'takedown_lever',  group:'controls', label:'Takedown Levers',  dbCategory:['takedown_lever'] },
  { key:'safety_selector', group:'controls', label:'Safety Selectors', dbCategory:['safety_selector'] },
  { key:'slide_plate',     group:'controls', label:'Slide Plates',     dbCategory:['slide_plate'] },

  // ── Magazine ────────────────────────────────────────────────────────────
  { key:'magwells', group:'magazine', label:'Magwells',  dbCategory:['magwell'] },
  { key:'mags',     group:'magazine', label:'Magazines', dbCategory:null },
  { key:'basepad',  group:'magazine', label:'Basepads',  dbCategory:['basepad'] },

  // ── Carry and finish ────────────────────────────────────────────────────
  { key:'holsters', group:'carry', label:'Holsters', dbCategory:null },
  // A finish is work done to the gun, not a product anyone can buy, so this
  // category replaces the generic Brand / Part name / link form with its own
  // fields and skips the review queue — there is no catalog listing to
  // promote it into. See customFormFieldsHtml() and addCustomPart() on the
  // two builder pages.
  { key:'paintjob', group:'carry', label:'Paint Job & Finish', dbCategory:null,
    custom:{
      toggle:'Add your paint job or finish',
      empty:'Finishes and custom work aren\'t catalog parts. Tell us who did the work, the color, and the stipple style — it gets credited on your build.',
      fields:[
        { id:'shop',    placeholder:'Custom work done by (shop name, or DIY)', required:true },
        { id:'color',   placeholder:'Color (e.g. Cerakote FDE, two-tone)' },
        { id:'stipple', placeholder:'Stippling style (e.g. laser, hand, none)' },
      ],
      note:'Goes straight onto your build. Shops that show up often get featured on Gunforma.',
      submit:'Add to build →',
      pending:false,
    } },
  { key:'knife', group:'carry', label:'Tactical Knife',  dbCategory:null },
  { key:'misc',  group:'carry', label:'Miscellaneous',   dbCategory:null },
];

// Keys that are no longer offered but still occur in stored snapshots. They
// must keep a real label: a published build renders whatever its snapshot
// says, and .part-type is `text-transform: uppercase`, so an unmapped key
// reaches a reader shouted — "OTHER_PARTS" reads like a leaked enum, not a
// heading. Two live builds shipped exactly that.
//
// `sights` only ever existed on the admin page, which had no DB backing for
// it and no stored build using it; the label stays anyway, because the cost
// of keeping it is one line and the cost of being wrong is a shouted key.
const LEGACY_CATEGORY_LABELS = {
  other_parts: 'Other Parts',
  sights:      'Sights',
};

// Bucket for anything we can't place on the BUILDER pages — a real, rendered
// section. Never drop a part: a visible part in the wrong section is fixable
// by the user, an invisible one looks like data loss. (A published build does
// not use this — it renders an unrecognised key under its own heading after
// the known sections, so nothing is relabelled after the fact.)
const FALLBACK_CATEGORY_KEY = 'misc';

// ── derived ───────────────────────────────────────────────────────────────

const UI_CATEGORY_KEYS = new Set(CATEGORIES.map(function (c) { return c.key; }));

// Raw products.category -> section key. A part added from the Armory is
// stored under the DB enum ('optic') rather than the UI key ('optics'), and
// barrel/compensator both belong to one section, so without this a part
// matches no section: counted in the summary, invisible in the list.
const DB_CATEGORY_TO_KEY = CATEGORIES.reduce(function (map, cat) {
  (cat.dbCategory || []).forEach(function (db) { map[db] = cat.key; });
  return map;
}, {});

// Every value that can appear in parts_snapshot -> its heading. Both
// vocabularies resolve to the SAME label, which is what stops one build
// opening two sections with the same heading.
const CATEGORY_LABELS = (function () {
  const labels = {};
  CATEGORIES.forEach(function (cat) {
    labels[cat.key] = cat.label;
    (cat.dbCategory || []).forEach(function (db) { labels[db] = cat.label; });
  });
  Object.keys(LEGACY_CATEGORY_LABELS).forEach(function (k) {
    labels[k] = LEGACY_CATEGORY_LABELS[k];
  });
  return labels;
})();

// Sections collected under their group, in group order. Derived rather than
// hand-listed so the builder pages and CATEGORIES cannot disagree about what
// is in a group or what comes first.
const GROUPED_CATEGORIES = CATEGORY_GROUPS.map(function (group) {
  return {
    group: group,
    categories: CATEGORIES.filter(function (c) { return c.group === group.key; }),
  };
});

// ── api ───────────────────────────────────────────────────────────────────

// An unmapped key must never reach the page verbatim. Prettifying the
// fallback — underscores to spaces, title case — is what stops the NEXT key
// added to CATEGORIES from shipping as "SOME_NEW_THING" before anyone has
// mapped it. Same fallback gunforma-parts-catalog.html and
// gunforma-armory.html already use.
function categoryLabel(key) {
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  const pretty = String(key == null ? '' : key)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  return pretty || 'Miscellaneous';
}

// A stored category value -> the section it renders in, or null when nothing
// recognises it. Callers choose their own fallback: the builder pages send a
// null to FALLBACK_CATEGORY_KEY so the part stays reachable, the published
// build keeps the raw key as its own trailing section so nothing is silently
// relabelled.
function sectionKeyFor(raw) {
  const value = (raw == null ? '' : String(raw)).trim();
  if (!value) return null;
  if (UI_CATEGORY_KEYS.has(value)) return value;        // already a section key
  return DB_CATEGORY_TO_KEY[value] || null;
}

function categoryByKey(key) {
  return CATEGORIES.find(function (c) { return c.key === key; }) || null;
}

global.BuildCategories = {
  CATEGORIES: CATEGORIES,
  CATEGORY_GROUPS: CATEGORY_GROUPS,
  GROUPED_CATEGORIES: GROUPED_CATEGORIES,
  CATEGORY_LABELS: CATEGORY_LABELS,
  LEGACY_CATEGORY_LABELS: LEGACY_CATEGORY_LABELS,
  DB_CATEGORY_TO_KEY: DB_CATEGORY_TO_KEY,
  FALLBACK_CATEGORY_KEY: FALLBACK_CATEGORY_KEY,
  categoryLabel: categoryLabel,
  sectionKeyFor: sectionKeyFor,
  categoryByKey: categoryByKey,
};

})(window);
