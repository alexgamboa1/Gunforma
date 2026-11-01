// _guide-url — a Gun Guide's public URL on the server side, used by
// guide-share.mjs (the canonical it emits) and sitemap.mjs (the URL it
// submits). The same split, for the same reason, as _build-url.mjs ↔
// js/build-url.js: js/guide-url.js is the browser copy, loaded by the pages
// that link or copy a /gg/ URL (Gun Guides, the Armory), and
// scripts/guide-url.test.mjs runs both over the same inputs and fails if
// they differ by a character.
//
// /gg/<slug>-<uuid>: the slug comes from the guide's title and is
// decoration, the uuid at the END is what resolves — renaming a guide never
// breaks a link, two guides with one title never collide, and /gg/<uuid>
// with no slug works forever. One uuid space covers both tables: a
// published Gunforma guide (guides) and a community guide (gun_guides).
//
// The slug rule IS buildSlug(): one rule for every URL this site builds
// from a name. The test pins that too.
import { SITE, buildSlug } from './_build-url.mjs';

const TRAILING_UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export const GUN_GUIDE_PREFIX = '/gg/';

export function gunGuideSlug(title) {
  return buildSlug(title);
}

// /gg/<slug>-<uuid>, or /gg/<uuid> when the title slugs to nothing. '' with
// no id, so a caller cannot build a dead href out of undefined.
export function gunGuidePath(id, title) {
  if (!id) return '';
  const slug = gunGuideSlug(title);
  return GUN_GUIDE_PREFIX + (slug ? slug + '-' : '') + encodeURIComponent(id);
}

// The absolute form, for canonical, og:url and the sitemap. Apex always.
export function gunGuideUrl(id, title) {
  const path = gunGuidePath(id, title);
  return path ? SITE + path : '';
}

// The id back out of /gg/<uuid>, /gg/<slug>-<uuid> or a bare splat: the LAST
// 8-4-4-4-12 group, anchored at the end. Null when there is none, so the
// function 404s before it reads anything.
export function gunGuideIdFromPath(input) {
  if (!input) return null;
  const s = String(input).split('#')[0].split('?')[0];
  const m = s.match(TRAILING_UUID);
  return m ? m[1].toLowerCase() : null;
}
