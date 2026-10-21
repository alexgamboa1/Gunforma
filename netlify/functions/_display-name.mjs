// _display-name.mjs — what a product is CALLED on a page.
// ─────────────────────────────────────────────────────────────────────────
// products.name is the MODEL alone, never the brand: "507K X2", not
// "Holosun 507K X2". The brand is manufacturers.name, and every page prints
// the two together through this module — displayProductName() for a name
// that stands alone ("Holosun 507K X2"), displayProductParts() for a card
// that prints the brand on one line and the model under it. The convention
// is the migration 20261021160000_product_naming_convention.sql: it renamed
// the 236 live products whose stored name carried the brand (or something a
// spec column already holds), and it refuses to leave any live name opening
// with its brand. scripts/display-name.test.mjs holds the fixture of the
// catalog to the same rule, and scripts/check-routes.mjs holds production.
//
// Before that migration the helper had to GUESS from the name's own words
// whether the brand was already there — full name, first word, initials, a
// listed alias — and the guess could not fix a name that doubled its own
// brand ("Herrington Arms HA Magwell …"). For a catalog row the guess is
// gone: brand + ' ' + name, and nothing else.
//
// One place still holds the old shape, and it is why the brand forms below
// survive: builds.parts_snapshot froze each part's name and brand at the
// time of the build. On 2026-10-21, 47 of the 86 parts in approved builds
// opened with their brand ("Sig Sauer Romeo-X Enclosed Compact", "Radian
// Ramjet …" for Radian Weapons), and a builder typing a part by hand may
// write the brand in both fields. So displayProductParts() strips ONE
// leading form of the brand — the full name, the first word of a multi-word
// brand, its initials, or a listed alias (BRAND_ALIASES) — when the name
// opens with it and a space (or nothing) follows. A hyphen does not count:
// True Precision's "True-Lock Compensator" keeps its "True-". A brand that
// appears only mid-name is left alone, and a name that IS the brand keeps
// it rather than render an empty line.
//
// Dependency-free and server-side only; js/display-name.js is the same
// rule as a plain <script> global, held identical by the test.

// Aliases the generic forms cannot derive — keyed by the brand in lower
// case, values in lower case. Add a line here AND in js/display-name.js.
export const BRAND_ALIASES = {
  'maskas precision': ['mpi'],
};

const squash = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The forms a frozen name may open with, lower case, longest first. Empty
// for an empty brand.
export function brandForms(brand) {
  const b = squash(brand).toLowerCase();
  if (!b) return [];
  const forms = new Set([b]);
  const words = b.split(' ').filter(Boolean);
  if (words.length >= 2) {
    if (words[0].length >= 2) forms.add(words[0]);
    const initials = words.map((w) => w[0]).join('');
    if (/^[a-z0-9]{2,}$/.test(initials)) forms.add(initials);
  }
  for (const a of BRAND_ALIASES[b] || []) forms.add(a);
  return [...forms].sort((x, y) => y.length - x.length);
}

// `text` opens with `form` as a whole word: a space or the end follows it.
const opensWith = (text, form) => new RegExp('^' + escapeRe(form) + '(?=\\s|$)', 'i').test(text);

// { name, brand } → { brand, model }: the two lines a card prints. For a
// catalog row `model` IS the stored name; for a frozen snapshot name it is
// the name with one leading brand form removed.
export function displayProductParts(p) {
  const name  = squash(p && p.name);
  const brand = squash(p && p.brand);
  if (!name || !brand) return { brand, model: name };
  const form = brandForms(brand).find((f) => opensWith(name, f));
  if (!form) return { brand, model: name };
  const model = name.slice(form.length).replace(/^[\s\-–—:·|,]+/, '').trim();
  return { brand, model: model || name };
}

// { name, brand } → the name a reader sees: brand + ' ' + model. A name
// that is nothing but its brand ("Olight" / "Olight") is printed once.
// Nothing else is collapsed: a frozen name that opened with TWO forms of
// its brand (the old "Herrington Arms HA Magwell …") loses one and is
// printed as the maker wrote it — the helper never introduces a double,
// and it does not edit what it was given.
export function displayProductName(p) {
  const { brand, model } = displayProductParts(p);
  if (!brand || !model) return brand || model;
  return model.toLowerCase() === brand.toLowerCase() ? brand : brand + ' ' + model;
}

// True when `text` opens with two forms of the same brand ("Magpul Magpul
// AMAG", "Sig Sauer SIG P365") — the thing a stored name must never do
// again, checked by the test over the fixture and by check-routes.mjs over
// production and served HTML.
export function hasDoubledBrand(text, brand) {
  const t = squash(text);
  const forms = brandForms(brand);
  for (const first of forms) {
    if (!opensWith(t, first)) continue;
    const rest = t.slice(first.length).trim();
    if (forms.some((second) => opensWith(rest, second))) return true;
  }
  return false;
}
