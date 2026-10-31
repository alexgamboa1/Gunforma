// build-og — server-renders /b/:id for crawlers: OG/Twitter meta, JSON-LD,
// and the build's actual BODY — h1, the builder's words, the parts list with
// /parts/ links, the photos.
// -----------------------------------------------------------------------------
// Crawlers (Facebook, X, Slack, iMessage, LinkedIn) do not run JavaScript, so
// a shared build link currently previews as a bare URL — no title, no image.
// That matters more than it sounds: sharing the build page IS the value for a
// builder, and we are about to invite ~20 of them.
//
// THE BODY IS INJECTED THE SAME WAY THE META IS: exact-string replaces of the
// page's placeholder elements ("—", "Loading…"). The page's own JS then
// hydrates over them with identical content. Every one of those literals is
// held to the page byte-for-byte by scripts/check-canonical-coupling.mjs —
// edit a placeholder in gunforma-build-detail.html and the matching literal
// here in the same commit, or the build refuses to ship. Every replacement is
// an arrow function on purpose: a plain string replacement interprets `$`
// sequences, and builders write things like "$250" in their descriptions.
//
// Before this, Google fetched a build and saw an H1 of "—", "Loading…", and a
// legal disclaimer shared by every build on the site — nothing to rank, and
// every build a thin duplicate of the next. See the PR that introduced it.
//
// Direct sibling of profile-og.mjs, deliberately: same shape, same failure
// modes, same conventions. This sits in front of /b/:id, confirms the build is
// visible, and returns the SAME gunforma-build-detail.html with meta injected
// into <head>. The page's own JS hydrates as normal — no redirect, no flash,
// so /b/:id is the real canonical URL.
//
// ONLY APPROVED BUILDS GET A PREVIEW. Two independent mechanisms, because this
// one leaks photos of private drafts if it is wrong:
//   1. RLS. The anon key can only see rows the "Public can view approved
//      builds" policy allows (status = 'approved'), and build_photos has the
//      matching "Public can view photos of approved builds". A draft or
//      pending build returns [] to this function, exactly as it does to the
//      browser. Verified against the live API before this was written.
//   2. An explicit status=eq.approved filter below. Redundant with RLS on
//      purpose — if a policy is ever loosened, the leak does not start here.
// An unapproved, unknown or deleted id gets a genuine 410, and a request
// with no id in it at all a 404 — never a soft one.
//
// Deliberately dependency-free — a plain fetch against PostgREST rather than
// @supabase/supabase-js, so there is no package.json, no install step, and
// nothing to bundle. The anon key is the same public key already shipped in
// js/supabase-client.js; this function holds no secrets.
//
// Routing lives in netlify.toml ([[redirects]] /b/* -> here with ?id=:splat).
// -----------------------------------------------------------------------------
import { readFile } from 'node:fs/promises';
import { buildUrl, buildIdFromPath } from './_build-url.mjs';
// The server's one category list — /parts/ URL segments and display names
// for the parts this function now server-renders into the page body. Import,
// never a local copy: scripts/check-categories.mjs fails any file carrying
// its own category map.
import { CATEGORY_META } from './_category-meta.mjs';
import { displayProductName } from './_display-name.mjs';
import { ANALYTICS_SNIPPET } from './_analytics.mjs';
import { CDN_CACHE_BUILD, CDN_CACHE_NO_STORE } from './_cache.mjs';
import { pgRows, unavailable } from './_pg.mjs';
// What the build is CALLED (its factory model, FCU, or the bare platform),
// the "More <model> builds" cards and their CSS — shared with the hubs,
// the homepage and the gallery so one build is named one way everywhere.
import { buildModel, modelBuildPhrase, fetchBuilds, fetchPriceTotals, priceTotalText, miniCardHtml, miniCardsCss, orderedPhotos } from './_build-cards.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';

const SITE       = 'https://gunforma.com';
const OG_DEFAULT = SITE + '/og-default.png';
const PHOTO_BASE = SB_URL + '/storage/v1/object/public/build-photos/';

// The card size every scraper except Twitter picks from the image's ACTUAL
// pixels: roughly 1.91:1 and at least 600px wide gets the full-width card,
// anything portrait or square gets a ~160px thumbnail with text beside it.
// twitter:card=summary_large_image is Twitter-only and does not help Facebook,
// iMessage, Slack or LinkedIn. Build photos come off phones and are mostly
// portrait, so every shared build was rendering as the thumbnail.
//
// One pair of constants because three things have to agree: the transform,
// og:image:width and og:image:height. A declared size that does not match the
// bytes is a worse lie than no declaration.
// 4:3, not 1.91:1. Compared at 630, 800, 900 and 1200 against a real
// portrait hero: 630 crops too hard, 900 keeps 56% of a 1201x1600 frame, and
// 1200 wide still clears every platform's threshold for the large card.
// iMessage and Slack honour the taller ratio; Twitter centre-crops back to
// 1.91:1, which is no worse than it was.
//
// Exported so scripts/check-og-image.mjs asserts THESE numbers rather than a
// hardcoded pair of its own — a check with its own copy of the expected size
// fails on correct output the day this changes, which is the failure mode
// that makes people delete checks.
export const OG_W = 1200;
export const OG_H = 900;

// og-default.png's real size. It is a designed 1200x630 graphic served
// unmodified, and the meta tags say so when it is the card — see buildImage.
export const OG_DEFAULT_W = 1200;
export const OG_DEFAULT_H = 630;

// Netlify Image CDN. The source host is allowlisted in netlify.toml under
// [images] — scoped to the build-photos object path, not the whole Supabase
// host. Absolute apex URL, per the SEO invariants in CLAUDE.md: og:image is
// one of the places a non-apex URL would undo canonical-host.js.
//
// NOTE FOR PREVIEWS: this points at gunforma.com even when served from a
// deploy preview, which is correct — but it means the transform a preview
// emits is executed by PRODUCTION. To check a preview's own transform, swap
// the origin. scripts/check-og-image.mjs does exactly that.
// fm=jpg is load-bearing, not tidying. WITHOUT it the Image CDN content-
// negotiates on Accept and returns image/webp to anything that asks for it,
// image/jpeg to anything that doesn't — measured on production:
//
//   Accept: */*                                -> image/jpeg
//   Accept: image/avif,image/webp,image/*,*/*  -> image/webp
//
// which makes og:image:type unanswerable: whatever we declare is wrong for
// half the callers. Pinning the format makes the declaration a fact for
// every caller. Same rule as og:image:width/height — see the OG_W comment
// above. Do not drop fm=jpg without also dropping og:image:type.
function ogTransform(sourceUrl, fit = 'cover') {
  return SITE + '/.netlify/images?url=' + encodeURIComponent(sourceUrl) +
         '&w=' + OG_W + '&h=' + OG_H + '&fit=' + fit + '&fm=jpg';
}

// Builds are keyed by uuid. Anything that is not one 404s without a DB round
// trip, which is also what keeps path input out of the PostgREST query.
// buildIdFromPath in _build-url.mjs does the matching now — it takes the LAST
// 8-4-4-4-12 group, so /b/<uuid> and /b/<slug>-<uuid> both resolve and a slug
// full of hyphens (they all are) cannot be mistaken for the id.

const PAGE_CANDIDATES = [
  'gunforma-build-detail.html',
  './gunforma-build-detail.html',
  new URL('../../gunforma-build-detail.html', import.meta.url),
];

let cachedPage = null;
async function loadPage() {
  if (cachedPage) return cachedPage;
  for (const candidate of PAGE_CANDIDATES) {
    try {
      cachedPage = await readFile(candidate, 'utf8');
      return cachedPage;
    } catch { /* try next */ }
  }
  return null;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// One line, no markup, no newlines — a description is an attribute value.
function clamp(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  // A cut that lands after a name already ending in "…" must not print "……".
  return t.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/…$/, '') + '…';
}

// ── What a build is CALLED, to a search engine ─────────────────────────────
// Nobody searches a builder's caption ("My X Macro. Love this EDC."). They
// search the parts — so the title and description carry the build's most
// notable parts by name, drawn from parts_snapshot rather than typed by
// anyone. The caption still leads, because it is the h1 and the thing the
// builder shared.

// A part's display name: brand + name, except when the stored name already
// carries the brand ("True Precision" + "True Precision Axiom P365" is a
// live example — concatenating blindly ships the brand twice). The rule
// lives in _display-name.mjs, shared with the hubs, guides and Field Notes;
// a snapshot part carries the same {brand, name} pair a product row does.
const partDisplayName = displayProductName;

// Up to `max` parts worth naming in a title or description, most searched-for
// categories first. parts_snapshot carries two vocabularies (section keys
// like 'optics' and raw products.category values like 'optic' — see
// js/build-categories.js), so both spellings are listed. This is a priority
// ORDER over keys, not a key→label map — labels stay in _category-meta.mjs.
const HEADLINE_PRIORITY = [
  'optics', 'optic', 'slides', 'slide', 'barrels', 'barrel', 'compensator',
  'grips', 'frame', 'lights', 'light', 'triggers', 'trigger',
];
function headlineParts(build, max, maxLen = 38) {
  const parts = Array.isArray(build.parts_snapshot) ? build.parts_snapshot : [];
  const rank = (p) => {
    const i = HEADLINE_PRIORITY.indexOf(p && p.category);
    return i === -1 ? HEADLINE_PRIORITY.length : i;
  };
  return parts
    .map((p, i) => ({ p, i }))
    .filter((x) => partDisplayName(x.p))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)   // stable: snapshot order breaks ties
    .slice(0, max)
    .map((x) => clamp(partDisplayName(x.p), maxLen));
}

// "P365 XMacro build: Holosun 507K X2, Zaffiri Precision ZPS.3 Slide,
// Icarus Precision 311 — by Wraythe | Gunforma". The MODEL opens it and is
// never cut; the parts are added while they fit a budget, most searched-for
// category first, so a long name costs a third part rather than the model.
// The builder's caption is the H1, not the title: nobody searches a caption.
// "SIG P365" (the platform) opens it only when no model was recorded;
// "P365 FCU build" when the build started from a bare fire control unit.
const TITLE_PARTS_BUDGET = 72;
function titleParts(build) {
  const out = [];
  let used = 0;
  for (const p of headlineParts(build, 3)) {
    const cost = p.length + (out.length ? 2 : 0);
    if (out.length && used + cost > TITLE_PARTS_BUDGET) break;
    out.push(p);
    used += cost;
  }
  return out;
}

function buildTitle(build) {
  const model = buildModel(build);
  const by    = build.profiles && build.profiles.username;
  const parts = titleParts(build);
  return modelBuildPhrase(model) +
    (parts.length ? ': ' + parts.join(', ') : '') +
    (by ? ' — by ' + by : '') +
    ' | Gunforma';
}

// "a, b and c"
function list(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

// ── The answer block ──────────────────────────────────────────────────────
// Two sentences a crawler or a model can lift as the answer to "what is
// this build": who built it and for what, and what it runs. EVERY sentence
// is a template over stored fields, and a sentence whose field is empty is
// dropped — nothing is inferred, nothing is padded. The model name comes
// from gun_id / fcu_only / the platform (buildModel), never from the parts.
// The builder's own words are NOT quoted here: they print once, in full,
// in the description line right below (a quoted copy printed the same text
// twice on the preview, 2026-10-22).
function answerSentences(build) {
  const model = buildModel(build);
  const by    = build.profiles && build.profiles.username;
  const acts  = (Array.isArray(build.activities) ? build.activities : [])
    .filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim().toLowerCase());
  const parts = Array.isArray(build.parts_snapshot) ? build.parts_snapshot : [];
  const names = headlineParts(build, 3, 60);   // a sentence has room a title does not

  const out = [];
  out.push((by ? by + ' built this ' + model.name : 'This ' + model.name + ' was built') +
           (acts.length ? ' for ' + list(acts) : '') + '.');
  if (parts.length) {
    out.push('It runs ' + parts.length + ' part' + (parts.length !== 1 ? 's' : '') +
             (names.length ? ', including ' + list(names) : '') + '.');
  }
  return out;
}

function answerBlock(build) {
  return answerSentences(build).join(' ');
}

// The meta description is the answer block's opening — the brief's rule —
// so what a results page shows is what the page says, not a second summary.
const META_DESCRIPTION_MAX = 150;
function buildDescription(build) {
  return clamp(answerBlock(build), META_DESCRIPTION_MAX);
}

// ── The kicker ────────────────────────────────────────────────────────────
// "P365 XMacro · 14 parts · $1,284 at today's prices · by Wraythe", under
// the H1. The total is priceTotal() in _build-cards.mjs — the ONE rule the
// homepage and gallery cards print too, so a build never shows two
// figures. priceTotalText() prints a "+" when the figure is a floor and
// null when nothing priced, in which case the segment is left out.

function kickerText(build, priced) {
  const model = buildModel(build);
  const by    = build.profiles && build.profiles.username;
  const parts = Array.isArray(build.parts_snapshot) ? build.parts_snapshot : [];
  const bits  = [model.name];
  if (parts.length) bits.push(parts.length + ' part' + (parts.length !== 1 ? 's' : ''));
  const totalText = priceTotalText(priced);
  if (totalText) bits.push(totalText + ' at today’s prices');
  if (by) bits.push('by ' + by);
  return bits.join(' · ');
}

// Hero photo, full size — a preview card wants the big image, not the thumb.
// Falls back to any photo, then to the site default, so a build with no photo
// still previews as something rather than nothing.
// The hero photo's own URL, or null when there isn't one.
//
// storage_path ONLY — thumb_path is deliberately not a fallback any more.
// Measured: storage_path images are up to 1600px on the long edge (1201x1600
// for the portrait hero used in testing), thumb_path images are capped at 480
// (360x480 for the same photo). Feeding a 480px thumb to w=1200 upscales it
// 3.3x, and a blurry card is worse than the thumbnail card this change
// exists to fix. og-default.png is 1200x630 and sharp, so falling through to
// it is strictly better than upscaling.
//
// Not a live branch either way: no build_photos row has a null storage_path,
// and processFile in js/photos.js uploads the display copy before it writes
// the row. This is about what happens if that ever stops being true.
function heroPhotoUrl(build) {
  const photos = Array.isArray(build.build_photos) ? build.build_photos : [];
  if (!photos.length) return null;
  const hero = photos.find((p) => p.is_hero) ||
               photos.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  return hero && hero.storage_path ? PHOTO_BASE + hero.storage_path : null;
}

// The card image AND its true dimensions, together, because they must not be
// able to disagree.
//
// og-default.png stays 1200x630 and stays untransformed. The alternatives
// were worse: regenerating it at 1200x900 means redrawing a designed graphic,
// and routing it through the transform would upscale a 1200-wide source and
// crop 270px off a composition with a logo in it. Leaving the asset alone
// only created a problem while the meta tags were hardcoded — so the tags
// follow the image instead. A declared size the bytes do not have is the one
// thing this whole change is trying not to ship.
// type travels WITH the image for the same reason w and h do: the two cards
// are different formats. The transform is pinned to JPEG (see ogTransform);
// og-default.png is a PNG and is served unmodified. A hardcoded 'image/jpeg'
// here would be correct for every build that has a photo and a lie for every
// build that does not — which is the harder case to notice, because it is the
// emptier one.
function buildImage(build) {
  const photo = heroPhotoUrl(build);
  return photo
    ? { url: ogTransform(photo), w: OG_W,         h: OG_H,         type: 'image/jpeg' }
    : { url: OG_DEFAULT,         w: OG_DEFAULT_W, h: OG_DEFAULT_H, type: 'image/png'  };
}

// ── Photo alts ────────────────────────────────────────────────────────────
// "Holosun 507K X2 on P365 XMacro with Zaffiri Precision ZPS.3 slide —
// photo 2 of 3": what is in the picture, from the parts and the model, then
// the angle. The optic leads because it is what a photo of a pistol shows
// first; the slide, else the grip module, is the second thing. No part in
// those categories: the model alone. Never empty — every image on the page
// gets one, the thumbnails included (they shipped alt="" until 2026-10-22).
// gunforma-build-detail.html's photoSubject() is the browser copy of the
// subject half; change the two together.
const ALT_OPTIC = ['optics', 'optic'];
const ALT_SLIDE = ['slides', 'slide'];
const ALT_GRIP  = ['grips', 'frame'];
function firstPartIn(build, keys) {
  const parts = Array.isArray(build.parts_snapshot) ? build.parts_snapshot : [];
  const p = parts.find((x) => x && keys.includes(x.category) && partDisplayName(x));
  return p ? clamp(partDisplayName(p), 48) : '';
}

// "… with Zaffiri ZPS.3 slide", unless the name already says what it is
// ("SIG SAUER 3.7\" Macro Slide" must not read "Macro Slide slide").
function withWord(name, word, re) {
  return re.test(name) ? name : name + ' ' + word;
}
function photoSubject(build) {
  const model = buildModel(build).name;
  const optic = firstPartIn(build, ALT_OPTIC);
  const slide = firstPartIn(build, ALT_SLIDE);
  const grip  = slide ? '' : firstPartIn(build, ALT_GRIP);
  return (optic ? optic + ' on ' : '') + model +
    (slide ? ' with ' + withWord(slide, 'slide', /\bslide\b/i)
     : grip ? ' with ' + withWord(grip, 'grip module', /\b(grip|frame|module)\b/i) : '');
}

function photoAltText(build, i, n) {
  return photoSubject(build) + (n > 1 ? ' — photo ' + (i + 1) + ' of ' + n : '');
}

// Describes the IMAGE, not the page — so it says what the card is showing
// rather than repeating the title a scraper already has.
function buildImageAlt(build) {
  const name = (build.name || '').trim() || 'Untitled build';
  return heroPhotoUrl(build)
    ? photoSubject(build) + ' — ' + name
    : name + ', a ' + buildModel(build).name + ' on Gunforma';
}

// ── Linked products ────────────────────────────────────────────────────────
// parts_snapshot stores refId (the product uuid) but not the slug, and a
// /parts/ link needs the slug. One lookup for the whole build; a failure is
// non-fatal — the parts render unlinked, exactly as a pending part does.
const UUID_ONLY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchLinkedProducts(build) {
  const ids = [...new Set(
    (Array.isArray(build.parts_snapshot) ? build.parts_snapshot : [])
      // The regex is what keeps snapshot content out of the query: refId is
      // written by our own pages, but it is still a jsonb field an API caller
      // could have shaped, so only clean uuids reach the URL.
      .map((p) => p && p.refId)
      .filter((id) => typeof id === 'string' && UUID_ONLY_RE.test(id)),
  )];
  if (!ids.length) return {};
  try {
    const rows = await pgRows('products?id=in.(' + ids.join(',') + ')&select=id,slug,category,is_discontinued');
    const map = {};
    for (const r of rows) if (r && r.id) map[r.id] = r;
    return map;
  } catch (err) {
    console.error('[build-og] linked-product lookup failed', err);
    return {};
  }
}

// /parts/<segment>/<slug>, or null when the catalog cannot address it — same
// null-not-dead-href contract as js/category-map.js's productPath().
function linkedProductPath(prod) {
  if (!prod || !prod.slug) return null;
  const meta = CATEGORY_META[prod.category];
  return meta ? '/parts/' + meta[0] + '/' + encodeURIComponent(prod.slug) : null;
}

// ── JSON-LD ────────────────────────────────────────────────────────────────
// An Article (the build post: headline, author, dates, image) plus an
// ItemList of its parts, each linked to its /parts/ page when the catalog
// can address it. product-page.mjs owns the Product/Offer markup; repeating
// offers here would be a second copy of price data to keep honest.
function buildJsonLd(build, productsById) {
  const name     = (build.name || '').trim() || 'Untitled build';
  const username = build.profiles && build.profiles.username;
  const image    = buildImage(build);
  const url      = buildUrl(build.id, build.name);
  const parts    = Array.isArray(build.parts_snapshot) ? build.parts_snapshot : [];
  const model    = buildModel(build);

  // Every photo, the card image first: the transformed hero a scraper
  // wants, then each original in gallery order.
  const images = [image.url].concat(orderedPhotos(build).map((p) => PHOTO_BASE + p.storage_path));

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: clamp(name, 110),
    description: buildDescription(build),
    image: images,
    url,
    mainEntityOfPage: url,
    ...(username
      ? { author: { '@type': 'Person', name: username, url: SITE + '/u/' + encodeURIComponent(username) } }
      : { author: { '@type': 'Organization', name: 'Gunforma', url: SITE } }),
    ...(build.created_at ? { datePublished: build.created_at } : {}),
    ...((build.updated_at || build.created_at)
      ? { dateModified: build.updated_at || build.created_at } : {}),
    publisher: { '@type': 'Organization', name: 'Gunforma', url: SITE },
  };

  const items = parts
    .filter((p) => partDisplayName(p))
    .map((p, i) => {
      const path = linkedProductPath(p.refId ? productsById[p.refId] : null);
      return {
        '@type': 'ListItem',
        position: i + 1,
        name: clamp(partDisplayName(p) + (p.variantLabel ? ' (' + p.variantLabel + ')' : ''), 110),
        ...(path ? { url: SITE + path } : {}),
      };
    });

  // Gunforma / Builds / <model hub, when the model has one> / this build —
  // the same trail the page's breadcrumb prints.
  const crumbs = [
    { '@type': 'ListItem', position: 1, name: 'Gunforma', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name: 'Builds', item: SITE + '/gunforma-builds.html' },
  ];
  if (model.hub) crumbs.push({ '@type': 'ListItem', position: 3, name: model.hubName, item: SITE + model.hub });
  crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: clamp(name, 110), item: url });
  const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs };

  if (!items.length) return [article, breadcrumb];
  return [article, breadcrumb, {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: clamp(name, 90) + ' — parts list',
    numberOfItems: items.length,
    itemListElement: items,
  }];
}

function metaBlock(build, productsById) {
  const title = buildTitle(build);
  const desc  = buildDescription(build);
  const image = buildImage(build);
  // The shared builder, not a local string. The page re-emits this exact
  // URL from js/build-url.js once its data loads; if the two ever disagree
  // the build declares two canonicals in one page load. See _build-url.mjs.
  const url   = buildUrl(build.id, build.name);
  return [
    // The page is served at /b/<id> but every script src and nav href in it is
    // root-relative-less ("js/nav.js", "gunforma-builds.html"), which would
    // resolve against /b/ and 404. One base tag fixes all of them, and it
    // lands before any relative URL in the document. Origin-relative, not
    // absolute, so deploy previews and netlify dev resolve to themselves.
    '<base href="/"/>',
    '<title>' + esc(title) + '</title>',
    '<meta name="description" content="' + esc(desc) + '"/>',
    '<meta property="og:type" content="article"/>',
    '<meta property="og:site_name" content="Gunforma"/>',
    '<meta property="og:title" content="' + esc(title) + '"/>',
    '<meta property="og:description" content="' + esc(desc) + '"/>',
    '<meta property="og:image" content="' + esc(image.url) + '"/>',
    // Declared so a scraper can lay the card out before it has fetched the
    // image, and so the ones that trust the declaration over a fetch get the
    // large card rather than guessing from a portrait source.
    '<meta property="og:image:width" content="' + image.w + '"/>',
    '<meta property="og:image:height" content="' + image.h + '"/>',
    '<meta property="og:image:type" content="' + esc(image.type) + '"/>',
    '<meta property="og:image:alt" content="' + esc(buildImageAlt(build)) + '"/>',
    '<meta property="og:url" content="' + esc(url) + '"/>',
    '<meta name="twitter:card" content="summary_large_image"/>',
    '<meta name="twitter:title" content="' + esc(title) + '"/>',
    '<meta name="twitter:description" content="' + esc(desc) + '"/>',
    // image.url, not image. buildImage() returns {url,w,h,type}; this line
    // stringified the whole object and shipped content="[object Object]" on
    // every /b/ page — invisible in a browser, invisible to og:-only checks,
    // and a broken card on any scraper that prefers the Twitter tags. It was
    // a string here until og:image:width/height needed the dimensions.
    // scripts/check-og-image.mjs now asserts this tag resolves and 200s.
    '<meta name="twitter:image" content="' + esc(image.url) + '"/>',
    '<link rel="canonical" href="' + esc(url) + '"/>',
    // <, same as product-page.mjs and guide-page.mjs: user text inside
    // a <script> block must not be able to close it.
    '<script type="application/ld+json">' +
      JSON.stringify(buildJsonLd(build, productsById || {})).replace(/</g, '\\u003c') +
    '</script>',
    // The "More <model> builds" cards are server-only (the page's JS never
    // draws them), so their CSS rides with the server render too.
    '<style>.more-builds h2 { font-size: 15px; font-weight: 700; margin: 36px 0 4px; }' + miniCardsCss() + '</style>',
  ].join('\n');
}

// ── The server-rendered body ───────────────────────────────────────────────
// Each placeholder the page ships ("—", "Loading…", the empty containers) is
// replaced with the build's real content; the page's own renderBuild() then
// writes the same content over it once its data loads. Replacements are
// arrow functions (see the file header), and every literal below must occur
// in gunforma-build-detail.html exactly once — check-canonical-coupling.mjs
// fails the deploy otherwise, which is what lets this file and that page be
// edited apart without one silently breaking the other.
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function serverPartsHtml(build, productsById) {
  const parts = Array.isArray(build.parts_snapshot) ? build.parts_snapshot : [];
  if (!parts.length) {
    return '<div id="parts-container"><div class="no-parts-note">No parts listed for this build yet.</div></div>';
  }
  // A flat list under one heading, not the client's grouped sections — the
  // section taxonomy lives in js/build-categories.js, and a server copy of
  // it is exactly the drift check-categories.mjs exists to refuse. For a
  // crawler, the names and the links are the content; the client's grouped
  // render replaces this the moment its data loads.
  const cards = parts.map((p) => {
    if (!p) return '';
    const prod = p.refId ? productsById[p.refId] : null;
    const path = linkedProductPath(prod);
    const meta = prod && CATEGORY_META[prod.category];
    const nameTxt = (p.name ? String(p.name) : '').replace(/\s+/g, ' ').trim() || 'Unnamed part';
    const brandTxt = (p.brand ? String(p.brand) : '').replace(/\s+/g, ' ').trim() || 'Unknown brand';
    const variantTxt = p.variantLabel ? String(p.variantLabel) : (p.variant ? String(p.variant) : '');
    return '<div class="part-card"><div class="part-card-top"><div class="part-body">' +
      (meta ? '<div class="part-type">' + esc(meta[2]) + '</div>' : '') +
      '<div class="part-brand">' + esc(brandTxt) + '</div>' +
      '<div class="part-model">' +
        (path
          ? '<a class="part-model-link" href="' + esc(path) + '">' + esc(nameTxt) + '</a>'
          : esc(nameTxt)) +
        (variantTxt ? ' — ' + esc(variantTxt) : '') +
      '</div>' +
      // A discontinued part stays on the build, marked — the same tag the
      // page's own render draws (gunforma-build-detail.html, renderPartCard).
      (prod && prod.is_discontinued === true ? '<div class="part-tags"><span class="part-tag part-tag-disc">Discontinued</span></div>' : '') +
      // The builder's own words about this part. For a crawler this is the
      // one text on the page no other site has.
      (p.details ? '<div class="part-details"><span class="part-details-label">Builder\'s notes</span>' + esc(String(p.details)) + '</div>' : '') +
    '</div></div></div>';
  }).join('');
  return '<div id="parts-container">' +
    '<div class="section-divider"><h2>Parts on this build</h2>' +
      '<span class="section-count">' + parts.length + ' part' + (parts.length !== 1 ? 's' : '') + '</span></div>' +
    '<div class="parts-list">' + cards + '</div></div>';
}

function injectBody(page, build, productsById, { priced, more } = {}) {
  const name       = (build.name || '').trim() || 'Untitled build';
  const platform   = (build.platforms && build.platforms.name) || '';
  const model      = buildModel(build);
  const username   = build.profiles && build.profiles.username;
  const activities = Array.isArray(build.activities) ? build.activities.filter(Boolean) : [];
  const parts      = Array.isArray(build.parts_snapshot) ? build.parts_snapshot : [];
  const photos     = Array.isArray(build.build_photos) ? build.build_photos : [];
  const hero       = photos.find((p) => p.is_hero) ||
                     photos.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];

  let html = page;

  // Builds / <model> / <this build>. The model is the factory model the
  // build was recorded as, linked to its hub when the registry declares
  // one; an FCU build says so; a build with neither says its platform.
  // The page's own renderBuild() leaves a server-rendered crumb alone (it
  // has no registry to decide which models have a hub).
  html = html.replace('<span id="breadcrumb-platform">—</span>',
    () => '<span id="breadcrumb-platform">' +
      (model.hub ? '<a href="' + esc(model.hub) + '">' + esc(model.hubName) + '</a>' : esc(model.name)) +
    '</span>');
  html = html.replace('<span id="breadcrumb-name">—</span>',
    () => '<span id="breadcrumb-name">' + esc(name) + '</span>');
  html = html.replace('<div class="build-eyebrow" id="build-eyebrow">—</div>',
    () => '<div class="build-eyebrow" id="build-eyebrow">' + esc(activities.join(' · ') || model.name) + '</div>');
  html = html.replace('<h1 class="build-title" id="build-title">—</h1>',
    () => '<h1 class="build-title" id="build-title">' + esc(name) + '</h1>');

  const posted = fmtDate(build.created_at);
  if (username || posted) {
    html = html.replace('<div class="build-author-row" id="build-author-row">—</div>',
      () => '<div class="build-author-row" id="build-author-row">' +
        (username ? 'Built by <strong>' + esc(username) + '</strong>' : '') +
        (username && posted ? ' · ' : '') + (posted ? 'Posted ' + esc(posted) : '') +
      '</div>');
  }

  // The kicker and the answer block, under the author line. Both are
  // generated from stored fields only (see kickerText / answerSentences);
  // the page's JS fills them itself only when they arrive empty.
  html = html.replace('<div class="build-kicker" id="build-kicker"></div>',
    () => '<div class="build-kicker" id="build-kicker">' + esc(kickerText(build, priced)) + '</div>');
  html = html.replace('<p class="build-answer" id="build-answer"></p>',
    () => '<p class="build-answer" id="build-answer">' + esc(answerBlock(build)) + '</p>');

  const desc = (build.description ? String(build.description) : '').trim();
  if (desc) {
    html = html.replace('<div class="build-desc" id="build-desc" style="display:none;"></div>',
      () => '<div class="build-desc" id="build-desc">' + esc(desc) + '</div>');
  }

  // The chip says the same name the crumb and the kicker say — one gun,
  // one name, everywhere on the page. It said the platform ("SIG P365")
  // under a crumb that said "P365 XMacro Comp" until 2026-10-22.
  html = html.replace('<div class="build-tags" id="build-tags"></div>',
    () => '<div class="build-tags" id="build-tags">' +
      '<span class="build-tag blue">' + esc(model.name) + '</span>' +
      activities.map((a) => '<span class="build-tag">' + esc(a) + '</span>').join('') +
    '</div>');

  html = html.replace('<div class="build-total-num" id="build-tier-label">—</div>',
    () => '<div class="build-total-num" id="build-tier-label">' +
      (build.tier === 'full' ? 'Full build' : 'Minimum build') + '</div>');
  html = html.replace('<div class="build-total-sub" id="build-parts-sub">—</div>',
    () => '<div class="build-total-sub" id="build-parts-sub">' +
      (parts.length ? parts.length + ' part' + (parts.length !== 1 ? 's' : '') + ' listed' : 'No parts listed yet') +
    '</div>');

  const ordered = orderedPhotos(build);
  if (hero && hero.storage_path) {
    html = html.replace('<div class="build-hero" id="build-hero"><span>Loading…</span></div>',
      () => '<div class="build-hero" id="build-hero">' +
        '<img src="' + esc(PHOTO_BASE + hero.storage_path) + '" alt="' + esc(photoAltText(build, 0, ordered.length)) + '" /></div>');
  }

  if (ordered.length > 1) {
    // Same markup renderBuild() writes — hero first, then the rest by
    // position — so hydration changes nothing visually. The buttons do
    // nothing until bindGallery() runs, which is the pre-hydration behaviour
    // the page already had. The thumbnail's alt is the button's accessible
    // name (no aria-label beside it, or a reader hears the photo twice).
    const thumbs = ordered.map((p, i) =>
      '<button type="button" class="gallery-thumb" data-i="' + i + '"' +
        (i === 0 ? ' aria-current="true"' : '') + '>' +
        '<img src="' + esc(PHOTO_BASE + (p.thumb_path || p.storage_path)) + '" alt="' + esc(photoAltText(build, i, ordered.length)) + '" />' +
      '</button>').join('');
    html = html.replace('<div class="build-gallery" id="build-gallery" style="display:none;"></div>',
      () => '<div class="build-gallery" id="build-gallery" style="display:flex;">' + thumbs + '</div>');
  }

  html = html.replace('<div id="parts-container"></div>',
    () => serverPartsHtml(build, productsById));

  // "More P365 XMacro builds" — other approved builds recorded as the same
  // model (or, for an FCU build, other FCU builds), up to six, newest
  // first. Browse links, not fitment: gun_id is provenance (CLAUDE.md).
  // Server-only; the page's JS never touches #more-builds.
  if (Array.isArray(more) && more.length) {
    html = html.replace('<div id="more-builds"></div>',
      () => '<div id="more-builds" class="more-builds">' +
        '<h2>More ' + esc(model.kind === 'fcu' ? 'P365 FCU' : model.name) + ' builds</h2>' +
        '<div class="bcard-grid">' + more.map(miniCardHtml).join('') + '</div>' +
      '</div>');
  }

  return html;
}

// 404 when the request carries nothing that could be a build (no uuid in
// the path or query); 410 when it names a uuid that resolves to no
// approved build. Search Console reported deleted builds' URLs as plain
// 404s (2026-10-12), which Google keeps re-crawling for a while; 410 says
// "gone, drop it" and it drops faster. The function cannot tell a deleted
// build from one still pending review (anon key, status=eq.approved), so
// a pending build's share URL also answers 410 until it is approved — the
// same moment it stopped answering 404 before, and the 60s cache below is
// what lets it flip. Google never holds a pending URL: it is in no sitemap
// and on no public page.
function notFound(status = 404) {
  return new Response(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
    '<title>Build not found — Gunforma</title>' +
    '<meta name="robots" content="noindex"/>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#0e0f11;color:#e8e6e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}' +
    'a{color:#4a9edd;text-decoration:none}.s{font-size:13px;color:#888780;margin:10px 0 22px}</style>' +
    '</head><body><div><div style="font-size:20px;font-weight:700">Build not found</div>' +
    '<div class="s">This build does not exist, or it has not been published yet.</div>' +
    '<a href="' + SITE + '/gunforma-builds.html">Browse builds &rarr;</a>' +
    '<span class="s" style="margin:0 10px">&middot;</span>' +
    '<a href="' + SITE + '/gunforma-post-build.html">Post your build &rarr;</a></div>' + ANALYTICS_SNIPPET + '</body></html>',
    {
      status,
      headers: {
        'Content-Type':  'text/html; charset=utf-8',
        // Short — a build approved a minute from now shouldn't stay 404. This
        // is the common case here, not an edge one: every build starts
        // pending and becomes shareable the moment it is approved.
        'Cache-Control': 'public, max-age=60',
        // And never at the CDN: a 404 or 410 stored durably would keep
        // answering gone for an hour after the approval (_cache.mjs).
        'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE,
      },
    },
  );
}

// Netlify's production edge does not substitute named params into a rewrite
// target's query string the way `netlify dev` does — the function gets an
// empty param and every build 404s. Rather than depend on one mechanism, read
// whichever source actually carries it.
//
// MEASURED on a deploy preview, which is the only place this can be known —
// it was guessed wrong twice from a laptop first:
//
//   /b/<slug>-<uuid>                     source=path    x-nf-original-path absent
//   gunforma-build-detail.html?id=<uuid> source=query   x-nf-original-path absent
//
// Both readings say the same thing: a Netlify function receives the ORIGINAL
// request URL in req.url, not the rewrite target. The pre-rewrite path is
// therefore already here, and a rewrite target does not need to carry the id
// for this function to find it. See CLAUDE.md, "Netlify redirects".
//
// Returns { id, source }, echoed on every response as x-build-og-id-source,
// so this stays a measurement rather than reverting to a belief.
function extractId(req) {
  const url = new URL(req.url);

  // req.url is the ORIGINAL request URL, not the rewrite target — measured,
  // see the table above. So this is the reader's own query string:
  // gunforma-build-detail.html?id=<uuid> lands here. /b/… has no query at
  // all and falls through to the pathname below.
  //
  // `splat` is read too, on the same never-observed-insurance footing as the
  // header branch at the bottom.
  const fromQuery = url.searchParams.get('id') || url.searchParams.get('splat');
  if (fromQuery) {
    const id = buildIdFromPath(decodeURIComponent(fromQuery));
    if (id) return { id, source: 'query' };
  }

  // The original pathname. /b/<slug>-<uuid> resolves here.
  const fromPath = buildIdFromPath(decodeURIComponent(url.pathname));
  if (fromPath) return { id: fromPath, source: 'path' };

  // NEVER-OBSERVED INSURANCE. x-nf-original-path was measured absent on BOTH
  // routes, so this branch has not fired once. It stays because two
  // observations is thin evidence for a runtime behaviour someone else owns,
  // and because it costs a header read — not because anything relies on it.
  // If it ever does fire, x-build-og-id-source will say `header-path` or
  // `header-query` and that is the signal to revisit this comment.
  const original = req.headers.get('x-nf-original-path') || '';
  if (original) {
    const decoded = decodeURIComponent(original);
    const inPath = buildIdFromPath(decoded);
    if (inPath) return { id: inPath, source: 'header-path' };
    // buildIdFromPath strips ?… before matching, so the query needs its own
    // look.
    const q = decoded.indexOf('?');
    if (q !== -1) {
      const idParam = new URLSearchParams(decoded.slice(q + 1)).get('id');
      const inQuery = buildIdFromPath(idParam);
      if (inQuery) return { id: inQuery, source: 'header-query' };
    }
  }

  return { id: null, source: 'none' };
}

// Both routes refuse an id that cannot be resolved: 410 for a uuid that is
// not an approved build, 404 when there is no uuid to look up.
//
// There used to be a split here: /b/… hard-404, and the legacy
// gunforma-build-detail.html?id=… soft-serving the page so the client could
// render its own "Build not found", on the reasoning that an old link should
// not start refusing. Two things killed it.
//
// It never ran. isShareRoute() read x-nf-original-path to tell the routes
// apart, and that header is absent on the legacy rule in production — so the
// function always took the share branch and the soft path was unreachable
// from the moment it shipped. A synthetic Request supplies whatever header
// the test author writes, so both the local suite and the reviewer's saw the
// 200 that production never produced.
//
// And it was wrong anyway. A 200 carrying "Build not found" is a soft 404,
// which Google penalises. Nothing links to the legacy shape any more, so
// there is no old link to protect that is worth a soft 404 to protect it.
//
// The dead branch is gone rather than fixed. See CLAUDE.md, "Netlify
// redirects".

// Copies a response, adding the diagnostics that make the routing observable
// from outside. Cheap, non-secret, and the only way this file's assumptions
// about Netlify can be checked against Netlify.
function withDiag(res, source, req) {
  const headers = new Headers(res.headers);
  headers.set('x-build-og-id-source', source);
  headers.set('x-build-og-orig', req.headers.get('x-nf-original-path') ? 'set' : 'absent');
  return new Response(res.body, { status: res.status, headers });
}

export default async (req) => {
  const { id: requested, source } = extractId(req);
  const diag = (res) => withDiag(res, source, req);

  // No uuid anywhere in the request — 404 without a DB round trip, which is
  // also what keeps path input out of the PostgREST query below. Not 410:
  // nothing was ever here, so there is nothing to have gone.
  if (!requested) return diag(notFound(404));

  // platforms and profiles each have exactly one FK to builds, so those bare
  // embeds are correct. profiles is named anyway because builds has two FKs
  // to it (user_id and reviewed_by) and a bare embed would be PGRST201.
  const select = [
    // tier, activities and the two dates feed the server-rendered body and
    // the JSON-LD; build_photos carries id for the gallery's deterministic
    // tiebreak, same as the page's own query. gun_id / fcu_only and the
    // guns embed (the composite FK builds_gun_fkey) are what the build is
    // CALLED — applied 2026-10, so this select may name them.
    'id', 'name', 'description', 'parts_snapshot',
    'tier', 'activities', 'created_at', 'updated_at',
    'gun_id', 'fcu_only',
    'platforms(name)',
    'guns!builds_gun_fkey(slug,name)',
    'profiles!builds_user_id_fkey(username)',
    'build_photos(id,storage_path,thumb_path,is_hero,position)',
  ].join(',');

  let build = null;
  try {
    // pgRows: one retry, a per-attempt timeout, and a body guaranteed to be
    // PostgREST's array — so `rows.length === 0` below is PostgREST saying
    // "no such approved build", never a proxy page or a dropped connection
    // being mistaken for one. See _pg.mjs.
    const rows = await pgRows('builds?select=' + encodeURIComponent(select) +
      '&limit=1&status=eq.approved&id=eq.' + encodeURIComponent(requested));
    build = rows.length ? rows[0] : null;
  } catch (err) {
    console.error('[build-og] build lookup failed', err);
    // An upstream failure is not proof the build is absent, and since this
    // function answers 410 for an absent build the stakes are a live share
    // URL being dropped from the index. 503 + Retry-After: the crawler keeps
    // what it has and comes back. This used to hand back the static page at
    // 200 for the client to hydrate — kinder to a reader mid-blip, but to a
    // crawler a 200 full of "Loading…" placeholders is a thin page, and the
    // client's own query was failing against the same PostgREST anyway.
    return diag(unavailable());
  }

  // PostgREST answered, with zero rows: unknown, unapproved, or deleted —
  // 410 Gone, see notFound().
  if (!build) return diag(notFound(410));

  // Slugs for the /parts/ links in the body and the JSON-LD, the kicker's
  // price total, and the "More <model> builds" cards. Each is internally
  // non-fatal: a failure renders the parts unlinked, the kicker without a
  // figure, the page without the cards — and says so in the x-build-og-*
  // headers below. Only a build recorded as a model, or as FCU, has
  // siblings to look for.
  const model = buildModel(build);
  const [productsById, priced, more] = await Promise.all([
    fetchLinkedProducts(build),
    fetchPriceTotals([build]).then((m) => m[build.id])
      .catch((err) => { console.error('[build-og] price lookup failed', err); return { total: null, count: 0, of: (build.parts_snapshot || []).length }; }),
    (model.kind === 'gun' || model.kind === 'fcu')
      ? fetchBuilds({ gunId: model.kind === 'gun' ? build.gun_id : null, fcuOnly: model.kind === 'fcu',
                      excludeId: build.id, limit: 6 })
          .catch((err) => { console.error('[build-og] sibling builds lookup failed', err); return []; })
      : Promise.resolve([]),
  ]);

  const page = await loadPage();
  if (!page) {
    console.error('[build-og] gunforma-build-detail.html not bundled — check included_files');
    // NO auto-refresh here. It used to bounce to
    // /gunforma-build-detail.html?id=…, which was fine while that URL served
    // the file directly. That URL is now rewritten to THIS function, so the
    // refresh would land back here, fail to load the page again, and emit the
    // same refresh — an infinite loop in the reader's browser, on a path that
    // only opens when the deploy is misconfigured.
    //
    // The meta block is what this branch is actually for: a crawler still
    // gets the full preview. A person gets a link they can see, and the error
    // above gets logged, which is the right way for a misconfiguration to
    // behave — visible, not spinning.
    return diag(new Response(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' + metaBlock(build, productsById) +
      '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'background:#0e0f11;color:#e8e6e1;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}' +
      'a{color:#4a9edd;text-decoration:none}.s{font-size:13px;color:#888780;margin:10px 0 22px}</style>' +
      '</head><body><div><div style="font-size:20px;font-weight:700">' + esc(buildTitle(build)) + '</div>' +
      '<div class="s">This build could not be rendered just now.</div>' +
      '<a href="' + SITE + '/gunforma-builds.html">Browse builds &rarr;</a></div>' + ANALYTICS_SNIPPET + '</body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    ));
  }

  // Swap the static <title> for the generated title + meta. Single anchored
  // replace so a future edit that drops the title fails loudly in testing
  // rather than silently shipping pages with no OG tags.
  //
  // The page also ships a static <link rel="canonical"> for its direct URL
  // (/gunforma-build-detail.html). At /b/:id the injected canonical must win,
  // so strip the static one before appending the meta block.
  //
  // This is an exact-string replace, so a whitespace change to that line in
  // gunforma-build-detail.html makes it a silent no-op and the page ships
  // two canonicals. The page carries a comment saying the same thing on its
  // side; change the two together.
  //
  // That page also sets its canonical from the id at runtime, for the
  // query-string URL. At /b/:id that script finds THIS canonical and writes
  // the same URL over it, so the two must agree byte for byte — metaBlock()
  // builds SITE + '/b/' + encodeURIComponent(id), and so does the page.
  //
  // The static meta description is stripped for the same reason as the
  // static canonical: metaBlock() injects a per-build one, and a page with
  // two description tags leaves a crawler to pick — it picks the generic one
  // often enough that every build reads identically in the results page.
  //
  // Replacement callbacks, not replacement strings: a description containing
  // "$&" or "$'" (builders type prices) would otherwise be interpolated by
  // String.replace's substitution rules.
  const html = injectBody(
    page
      .replace('<link rel="canonical" href="https://gunforma.com/gunforma-build-detail.html" />\n', '')
      .replace('<meta name="description" content="View a complete pistol build — every part, every photo, total cost, and affiliate links to buy." />\n', '')
      .replace('<title>Gunforma build</title>', () => metaBlock(build, productsById)),
    build, productsById, { priced, more });

  return diag(new Response(html, {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
      // Durable for an hour, NO stale-while-revalidate: a reviewer's
      // correction to a live build must reach every reader within the
      // hour, including the first one after it (_cache.mjs explains).
      'Netlify-CDN-Cache-Control': CDN_CACHE_BUILD,
      // Observable from outside (check-routes.mjs reads these): what the
      // build was called, how many parts priced into the kicker, and how
      // many sibling builds were served.
      'x-build-og-model': model.kind === 'gun' ? (model.slug || 'gun') : model.kind,
      'x-build-og-priced': priced.count + '/' + priced.of,
      'x-build-og-more': String(more.length),
    },
  }));
};
