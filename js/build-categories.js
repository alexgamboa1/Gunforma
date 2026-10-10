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
// NAMES COME FROM js/category-map.js, WHICH MUST LOAD FIRST. A section that
// holds exactly one products.category takes that category's plural name
// ("Grip Modules", "Basepads"), so the builder, the catalog and add-a-part
// cannot name the same thing differently. Only sections that are not one
// category name themselves: "Barrels & Compensators" (two), and the five
// with no catalog backing (Magazines, Holsters, Paint Job & Finish, Tactical
// Knife). scripts/check-script-order.mjs fails a page that loads this file
// without category-map.js before it.
//
// EVERYTHING IS DERIVED FROM `CATEGORIES`. Labels, the db-category reverse
// map and the grouped render order are all computed below rather than
// hand-listed, so a new section declares its facts once. The only
// hand-written map is LEGACY_SECTION_ALIASES, for keys that are no longer
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

// the one display name of a products.category value, from js/category-map.js
function name(db) {
  if (typeof global.categoryPlural !== 'function') {
    throw new Error('js/build-categories.js needs js/category-map.js loaded before it');
  }
  return global.categoryPlural(db);
}

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
// gone as a section; a leftover in an old snapshot folds into Other Parts
// (LEGACY_SECTION_ALIASES below).
//
// New sections (recoil_spring, sight) are keyed by the products.category value
// itself, as the five controls are, so a saved part carries its real category.
// `stockDefault: true` marks a section where the factory part is the usual
// answer and is worth nothing listed: the trigger, slide catch, takedown
// lever and safety on most builds are the ones the gun shipped with. On the
// two builder pages js/gun-model.js prints "Still the factory part? Leave
// this empty." under such a section while it has nothing in it, so an empty
// section reads as an answer rather than a gap — builders had been typing
// "OEM Slide Catch" in by hand to fill it. It changes nothing about what a
// section accepts: an aftermarket trigger, or Sig's own flat trigger bought
// as an upgrade, is added exactly as before. The Slides section has a note
// of its own that names the model's stock slide; see sectionNoteHtml().
const CATEGORIES = [
  // ── Core build ──────────────────────────────────────────────────────────
  { key:'grips',         group:'core', label:name('frame'),             dbCategory:['frame'] },
  { key:'slides',        group:'core', label:name('slide'),             dbCategory:['slide'] },
  { key:'barrels',       group:'core', label:'Barrels & Compensators',  dbCategory:['barrel','compensator'] },
  { key:'recoil_spring', group:'core', label:name('recoil_spring'),     dbCategory:['recoil_spring'] },
  { key:'optics',        group:'core', label:name('optic'),             dbCategory:['optic'] },
  { key:'sight',         group:'core', label:name('sight'),             dbCategory:['sight'] },
  { key:'lights',        group:'core', label:name('light'),             dbCategory:['light'] },
  { key:'triggers',      group:'core', label:name('trigger'),           dbCategory:['trigger'], stockDefault:true },

  // ── Controls ────────────────────────────────────────────────────────────
  { key:'mag_release',     group:'controls', label:name('mag_release'),     dbCategory:['mag_release'] },
  { key:'slide_release',   group:'controls', label:name('slide_release'),   dbCategory:['slide_release'],   stockDefault:true },
  { key:'takedown_lever',  group:'controls', label:name('takedown_lever'),  dbCategory:['takedown_lever'],  stockDefault:true },
  { key:'safety_selector', group:'controls', label:name('safety_selector'), dbCategory:['safety_selector'], stockDefault:true },
  { key:'slide_plate',     group:'controls', label:name('slide_plate'),     dbCategory:['slide_plate'] },

  // ── Magazine ────────────────────────────────────────────────────────────
  { key:'magwells', group:'magazine', label:name('magwell'), dbCategory:['magwell'] },
  { key:'mags',     group:'magazine', label:'Magazines',     dbCategory:null },
  { key:'basepad',  group:'magazine', label:name('basepad'), dbCategory:['basepad'] },

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
  // Other Parts. Its key stays `misc`, the key every part typed here has
  // always been saved under, so those snapshots still render. It is backed by
  // the `other` catalog category and keeps the typed-in form for parts we do
  // not carry. `anyCategory`: it is the catch-all, so the review queue's link
  // picker and add-a-part offer EVERY category for a pending part from here,
  // and linking one rewrites its category to the product's own
  // (create_product() and relink_build_part(), supabase/add_categories.sql).
  { key:'misc',  group:'carry', label:name('other'), dbCategory:['other'], anyCategory:true },
];

// Keys that are no longer offered but may occur in stored snapshots, and the
// section each now renders in. A published build renders whatever its
// snapshot says, and .part-type is `text-transform: uppercase`, so an
// unmapped key reaches a reader shouted ("OTHER_PARTS"). Two live builds
// shipped exactly that; none carries either key today (2026-10-05).
//
// They fold INTO their section rather than rendering under a heading of their
// own, because the names are now the same: `other_parts` would otherwise open
// a second "Other Parts" heading beside misc's. `other_parts` is a retired
// SECTION key; `other` is a products.category value. Neither is ever used as
// the other, and check-category-labels.mjs asserts it.
const LEGACY_SECTION_ALIASES = {
  other_parts: 'misc',    // the pre-#114 "Other Parts / Components" section
  sights:      'sight',   // only ever existed on the admin page
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
  Object.keys(LEGACY_SECTION_ALIASES).forEach(function (k) {
    labels[k] = labels[LEGACY_SECTION_ALIASES[k]];
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
  return pretty || name('other');
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
  if (LEGACY_SECTION_ALIASES[value]) return LEGACY_SECTION_ALIASES[value];
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
  LEGACY_SECTION_ALIASES: LEGACY_SECTION_ALIASES,
  DB_CATEGORY_TO_KEY: DB_CATEGORY_TO_KEY,
  FALLBACK_CATEGORY_KEY: FALLBACK_CATEGORY_KEY,
  categoryLabel: categoryLabel,
  sectionKeyFor: sectionKeyFor,
  categoryByKey: categoryByKey,
};

})(window);
