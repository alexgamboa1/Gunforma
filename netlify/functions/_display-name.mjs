// _display-name.mjs — what a product is CALLED on a page.
// ─────────────────────────────────────────────────────────────────────────
// products.name is the maker's own model name and carries the brand only
// when the maker writes it that way: "Holosun 507K X2" does, "AMAG 15 SG9
// P365 9mm 15rd Magazine" (Magpul) and "Osight SE" (Olight) do not. Measured
// 2026-10-20 over the 277 live products: 204 names start with their brand,
// 73 do not, and every one of the 73 has a brand on its manufacturers row.
// A hub row that read "AMAG 15 SG9 15rd" told a visitor nothing, so every
// page that prints a product name prints displayProductName() instead:
// "{brand} {name}", unless the name already carries the brand.
//
// "Already carries the brand" is decided from the name's own words, never
// by editing the stored name:
//   - it starts with the full brand ("Sig Sauer Romeo-X Pro", "SIG SAUER
//     P365 17rd" — case does not matter);
//   - it starts with the first word of a multi-word brand ("Faxon Exos" for
//     Faxon Firearms, "Radian Ramjet" for Radian Weapons, "SIG P365" for
//     Sig Sauer, "Timber Creek …" for Timber Creek Outdoors);
//   - it starts with the brand's initials ("TTI SIG X-MACRO …" for Taran
//     Tactical Innovations, "PMM P365 Compensator" for Parker Mountain
//     Machine);
//   - it starts with a listed alias the rules cannot derive (BRAND_ALIASES:
//     "MPI" for MASKAS Precision);
//   - or the full brand appears anywhere in it as whole words.
// Every match is on whole words, so "Signature Grip" is not a Sig prefix,
// and another maker's name inside the product name is not this product's
// brand: Springer Precision's "Carry Basepad for Sig Sauer - P365 X-Macro"
// still gets its Springer Precision prefix.
//
// The first-word rule is the one with a cost worth knowing: a future Night
// Fision part named "Night Sights …" would be judged branded and ship
// without its prefix — a missing brand, never a doubled one, and the
// catalog has no such name today. scripts/display-name.test.mjs pins every
// shape above against the live names; scripts/check-routes.mjs asserts on
// the wire that every hub magazine row starts with a known brand and
// doubles none.
//
// Dependency-free and server-side only. build-og.mjs used to hold its own
// shorter copy (full-prefix only) for the build page's title; it imports
// this one now, so the rule exists once.

// Aliases the generic rules cannot derive — keyed by the brand in lower
// case, values in lower case. Add a line here when a maker's short form is
// neither its first word nor its initials.
export const BRAND_ALIASES = {
  'maskas precision': ['mpi'],
};

const squash = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The forms a name may START with to count as already branded, lower case,
// longest first. Empty for an empty brand.
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

// A whole-word match: nothing alphanumeric may follow the form, and when
// anchored mid-string nothing alphanumeric may precede it.
const startsWithWord = (text, form) => new RegExp('^' + escapeRe(form) + '(?![a-z0-9])', 'i').test(text);
const containsWord   = (text, form) => new RegExp('(^|[^a-z0-9])' + escapeRe(form) + '(?![a-z0-9])', 'i').test(text);

export function nameCarriesBrand(name, brand) {
  const n = squash(name);
  const b = squash(brand).toLowerCase();
  if (!n || !b) return false;
  if (brandForms(b).some((f) => startsWithWord(n, f))) return true;
  return containsWord(n, b);
}

// { name, brand } → the name a reader sees. Never returns the brand twice.
export function displayProductName(p) {
  const name  = squash(p && p.name);
  const brand = squash(p && p.brand);
  if (!name) return brand;
  if (!brand || nameCarriesBrand(name, brand)) return name;
  return brand + ' ' + name;
}

// True when `text` opens with two forms of the same brand ("Magpul Magpul
// AMAG", "Sig Sauer SIG P365", "Radian Weapons Radian Ramjet") — the thing
// the rule above exists to prevent, checked from the outside by the test
// and by check-routes.mjs over served HTML.
export function hasDoubledBrand(text, brand) {
  const t = squash(text);
  for (const first of brandForms(brand)) {
    if (!startsWithWord(t, first)) continue;
    const rest = t.slice(first.length).trim();
    if (brandForms(brand).some((second) => startsWithWord(rest, second))) return true;
  }
  return false;
}
