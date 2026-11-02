// _guide-og — what a Gun Guide's share image draws, its hash, and its URL.
// ─────────────────────────────────────────────────────────────────────────
// guide-og.mjs renders the collage (claude/loadouts-spec.md §5) at
// /gg-og/<uuid>-<hash>.png; guide-share.mjs names that URL in the /gg/
// page's og:image. Both build the MODEL here — the exact data the image
// draws — and the hash is of the model, so:
//   - an edited guide (a part added, removed, re-ordered, a new option, a
//     renamed title) or a moved total gets a new URL, and a durably cached
//     image is correct for its URL by construction;
//   - the image function recomputes the hash from live data and 301s a
//     stale one to the current URL, so an old share link still lands on an
//     image;
//   - COLLAGE_VERSION is in the model, so a change to the DESIGN moves
//     every URL too. Bump it whenever guide-og.mjs draws differently.
//
// The model is pure data — no wasm, no fetch — so the page can afford to
// build it. Rendering lives in guide-og.mjs only.
//
// Which photo a part shows is partPicture() (_guide-data.mjs), the rule the
// page uses: the saved option's own photo, else its colour's swatch, never
// another option's photo. One difference, on purpose: a photo URL the
// guide's SNAPSHOT carried (a saved option no longer live) is not used —
// the image function fetches server-side, and that URL was written by
// whoever saved the guide. The part draws as its swatch instead.
import { createHash } from 'node:crypto';
import { guideParts, groupByProduct, partPicture } from './_guide-data.mjs';
import { priceTotal, priceTotalText } from './_build-cards.mjs';
import { swatchFor } from './_variant-swatch.mjs';
import { CATEGORY_META } from './_category-meta.mjs';
import { loadBuildCategories } from './_build-categories.mjs';

const SITE = 'https://gunforma.com';

// The image's real size. og:image:width / og:image:height are declared from
// these, and guide-og.mjs refuses to serve a render that decodes to
// anything else — a declared size the bytes do not have is the failure
// scripts/check-og-image.mjs exists for (CLAUDE.md, "SEO invariants").
// 1200x630 is the ~1.91:1 shape every scraper gives the large card.
export const GG_OG_W = 1200;
export const GG_OG_H = 630;
export const GG_OG_TYPE = 'image/png';

// og-default.png: the card when no collage can be named. The same size and
// type as the collage, so the declaration is true whichever one is served.
export const OG_DEFAULT_URL = SITE + '/og-default.png';
export const OG_DEFAULT_W = 1200;
export const OG_DEFAULT_H = 630;

// 2: the logo moved from a small bottom-right wordmark to a header band.
// 3: the band label and the model line up to 36px (15px at 500px wide).
// 4: a reader's build is labelled ARMORY BUILD, not COMMUNITY GUIDE.
export const COLLAGE_VERSION = 4;
// Up to six tiles. A guide of more than six parts shows five photos and a
// "+N" tile — the Gun Guides card's rule, one row more.
export const MAX_TILES = 6;

export const GG_OG_PREFIX = '/gg-og/';
const HASH_LEN = 10;
const OG_PATH_RE = /^\/gg-og\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-([0-9a-f]{10}))?\.png$/i;

export const guideTitle = (row) => ((row && row.title) || '').trim() || 'Untitled guide';
export const guideModel = (row) =>
  (row && row.guns && row.guns.name) || (row && row.platforms && row.platforms.name) || 'P365';

// swatchFor() answers CSS for a browser box; the image needs fills. The
// colours are read out of that CSS in order, so the colour rule stays in
// one place (_variant-swatch.mjs ↔ js/variant-swatch.js).
export function swatchSpec(color, brand) {
  const sw = swatchFor(color, brand);
  return { kind: sw.kind, colors: (sw.css.match(/#[0-9a-f]{3,8}\b/gi) || []).map((c) => c.toLowerCase()) };
}

const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null);

// The model: everything the image draws, nothing it does not.
export function collageModel({ kind, row, variants }, BuildCategories) {
  const parts = guideParts(row);
  const byProduct = groupByProduct(variants);
  const ordered = BuildCategories.orderParts(parts);
  const shown = parts.length > MAX_TILES ? MAX_TILES - 1 : parts.length;
  const tiles = ordered.slice(0, shown).map((p) => {
    const entry = p.refId ? byProduct.get(p.refId) : null;
    const pic = partPicture(p, entry);
    // Every tile carries its option's swatch, with the category and colour
    // it names: that is the picture when there is no photo, and what the
    // tile draws if the photo will not load. A bare colour square on a dark
    // card reads as an empty box; the words make it a part.
    const photo = pic.fromSnapshot ? null : httpsOnly(pic.photo);
    const cat = (entry && entry.product && entry.product.category) || p.category;
    return {
      photo,
      swatch: swatchSpec(pic.color, p.brand || ''),
      label: CATEGORY_META[cat] ? CATEGORY_META[cat][2] : 'Part',
      color: pic.color || null,
    };
  });
  return {
    v: COLLAGE_VERSION,
    kind: kind === 'curated' ? 'curated' : 'community',
    title: guideTitle(row),
    model: guideModel(row),
    count: parts.length,
    total: priceTotalText(priceTotal(parts, variants || [])),
    tiles,
    more: parts.length - shown,
  };
}

export function collageHash(model) {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex').slice(0, HASH_LEN);
}

export function ogImagePath(id, hash) {
  return GG_OG_PREFIX + String(id).toLowerCase() + (hash ? '-' + hash : '') + '.png';
}

// '/gg-og/<uuid>-<hash>.png' → { id, hash }; '/gg-og/<uuid>.png' →
// { id, hash: null } (answered with a 301 to the current hash); anything
// else → null.
export function parseOgPath(pathname) {
  const m = OG_PATH_RE.exec(pathname || '');
  return m ? { id: m[1].toLowerCase(), hash: m[2] ? m[2].toLowerCase() : null } : null;
}

// The og:image the /gg/ page declares: the collage's apex URL, or
// og-default.png when the model cannot be built (the taxonomy file missing
// from the bundle, a throw anywhere). The page cannot know whether a render
// that happens later will succeed, so the image URL itself falls back to
// og-default.png's bytes on a failed render (guide-og.mjs) — same size,
// same type, so this declaration holds either way.
export async function shareImageFor(found, variants, { loadCategories = loadBuildCategories } = {}) {
  const title = guideTitle(found && found.row);
  const count = guideParts(found && found.row).length;
  const alt = (found && found.kind === 'curated' ? 'Gun Guide: ' : 'Armory build: ') + title + ' — ' + count + (count === 1 ? ' part' : ' parts') + ' on the ' + guideModel(found && found.row);
  try {
    const BuildCategories = await loadCategories();
    if (!BuildCategories) throw new Error('js/build-categories.js is not in the bundle');
    const model = collageModel({ kind: found.kind, row: found.row, variants }, BuildCategories);
    return { url: SITE + ogImagePath(found.row.id, collageHash(model)), w: GG_OG_W, h: GG_OG_H,
             type: GG_OG_TYPE, alt, collage: true };
  } catch (e) {
    console.error('[guide-share] share image unavailable, using og-default.png', e);
    return { url: OG_DEFAULT_URL, w: OG_DEFAULT_W, h: OG_DEFAULT_H, type: 'image/png', alt, collage: false };
  }
}
