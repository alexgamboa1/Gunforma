// _build-cards — approved builds as server-rendered cards, for every page
// that lists builds in served HTML: the homepage (home-page.mjs), the
// gallery (builds-page.mjs), a gun hub's "Owner builds" section
// (gun-hub.mjs) and a build page's "More <model> builds" (build-og.mjs).
// ─────────────────────────────────────────────────────────────────────────
// Why this exists (2026-10-22): the homepage and the gallery rendered their
// build cards in the browser, so their served HTML carried ZERO /b/ links.
// Every build page was reachable by a crawler through the sitemap and
// through nothing else — the same orphan shape the /fit/ cluster had before
// the hubs. The cards here are the inbound links.
//
// One module, four surfaces, because the card HTML must match what each
// page's own JS writes over it (the homepage and gallery hydrate on load and
// must not visibly change), while the QUERY — approved only, hero first,
// MSRP totals from live default variants — is one fact. The query is
// deliberately the same shape the pages' browser code sends: RLS already
// hides unapproved builds from the anon key; status=eq.approved is repeated
// here for the reason build-og.mjs and sitemap.mjs repeat it.
//
// What a build is CALLED — its model — lives here too (buildModel), because
// four renderers print it and gun_id is provenance, never fitment
// (CLAUDE.md): the model is a label and a link to the hub, nothing more.
import { pgRows } from './_pg.mjs';
import { buildPath } from './_build-url.mjs';
import { GUN_META, hubPath, isLiveGunHub } from './_guide-meta.mjs';

export const PHOTO_BASE = 'https://lagjjcpclvzrjlrswojt.supabase.co/storage/v1/object/public/build-photos/';

// The newest builds a crawler is shown on the homepage and the gallery.
// Twenty-four is the brief's number; past it the page says "See all".
export const CARD_LIMIT = 24;

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every column a card needs, and the gun model. profiles is NAMED: builds
// has two FKs to profiles (user_id, reviewed_by). guns is named too — the
// FK is the composite builds_gun_fkey (gun_id, platform_id) — and bare
// platforms/build_photos/build_fires each have exactly one.
export const BUILD_CARD_SELECT = [
  'id', 'name', 'tier', 'activities', 'description', 'created_at', 'updated_at',
  'parts_snapshot', 'gun_id', 'fcu_only',
  'platforms(id,name,slug)',
  'guns!builds_gun_fkey(slug,name)',
  'profiles!builds_user_id_fkey(id,username)',
  'build_photos(id,storage_path,thumb_path,is_hero,position)',
  'build_fires(count)',
].join(',');

// Approved builds, newest first. `gunId` narrows to one factory model (a
// hub's owner builds), `fcuOnly` to FCU builds, `excludeId` drops the page's
// own build. Resolves to an array; throws UpstreamError like pgRows does,
// so a caller decides whether the list is fatal (it never is — a page is
// the page without its cards).
export async function fetchBuilds({ gunId = null, fcuOnly = false, excludeId = null, limit = CARD_LIMIT } = {}) {
  let path = 'builds?select=' + encodeURIComponent(BUILD_CARD_SELECT) +
    '&status=eq.approved&order=created_at.desc&limit=' + Math.max(1, Math.min(100, limit));
  if (gunId && UUID_RE.test(gunId)) path += '&gun_id=eq.' + gunId;
  else if (fcuOnly) path += '&fcu_only=is.true';
  if (excludeId && UUID_RE.test(excludeId)) path += '&id=neq.' + excludeId;
  const rows = await pgRows(path);
  // The id filter is also applied here: the query already excludes it, but
  // a stubbed read (the build guards run these handlers against a fetch
  // that answers every query with the same rows) must not hand a build its
  // own card.
  return rows.filter((b) => b && typeof b.id === 'string' && UUID_RE.test(b.id) && b.id !== excludeId);
}

// Sum of default-variant MSRPs for every catalog part in each build — the
// gallery's and homepage's own rule (loadTotals / loadFeatured), copied so
// the server card and the hydrated card show one number. Live variants
// only; is_default is preferred in code rather than filtered server-side,
// because a product whose default variant is retired would otherwise drop
// out of the total silently. Returns { [buildId]: total }, with 0 for a
// build whose parts price to nothing.
export async function fetchMsrpTotals(builds) {
  const refIds = new Set();
  for (const b of builds) {
    for (const p of (Array.isArray(b.parts_snapshot) ? b.parts_snapshot : [])) {
      if (p && typeof p.refId === 'string' && UUID_RE.test(p.refId)) refIds.add(p.refId);
    }
  }
  const msrpByProduct = {};
  if (refIds.size) {
    const rows = await pgRows('product_variants?select=product_id,msrp,is_default&retired_at=is.null' +
      '&product_id=in.(' + [...refIds].join(',') + ')');
    for (const v of rows) {
      if (!v || !v.product_id) continue;
      if (msrpByProduct[v.product_id] === undefined || v.is_default) msrpByProduct[v.product_id] = Number(v.msrp || 0);
    }
  }
  const totals = {};
  for (const b of builds) {
    let sum = 0;
    for (const p of (Array.isArray(b.parts_snapshot) ? b.parts_snapshot : [])) {
      if (p && p.refId && msrpByProduct[p.refId] != null) sum += msrpByProduct[p.refId];
    }
    totals[b.id] = sum;
  }
  return totals;
}

// Hero first, then the rest by position with id as the tiebreak — the order
// every reader of build_photos imposes (PostgREST returns embedded rows in
// arbitrary order).
export function orderedPhotos(build) {
  const photos = (Array.isArray(build.build_photos) ? build.build_photos : []).filter((p) => p && p.storage_path);
  if (!photos.length) return [];
  const hero = photos.find((p) => p.is_hero) ||
               photos.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  const rest = photos.filter((p) => p !== hero).sort((a, b) =>
    (a.position || 0) - (b.position || 0) || String(a.id).localeCompare(String(b.id)));
  return [hero].concat(rest);
}

export function thumbUrl(photo) {
  return photo ? PHOTO_BASE + (photo.thumb_path || photo.storage_path) : null;
}

// ── the model ─────────────────────────────────────────────────────────────
// Three answers, two columns (CLAUDE.md, "Nor is the model question"):
//   a factory model   gun_id set    → the gun's name, linked to its hub when
//                                     one is declared
//   P365 FCU only     fcu_only      → "P365 FCU build", no link
//   not listed        neither       → the platform's name ("SIG P365"),
//                                     no link
// `name` is what a title, kicker or breadcrumb prints; `hub` is the hub's
// path or null. A gun with no declared hub is named and not linked — the
// registry decides what is a page, not a row.
export function buildModel(build) {
  const gun = build && build.guns && typeof build.guns === 'object' && !Array.isArray(build.guns) ? build.guns : null;
  if (build && build.gun_id && gun && gun.name) {
    const slug = gun.slug || '';
    return { kind: 'gun', name: gun.name, slug,
             hub: slug && isLiveGunHub(slug) ? hubPath(slug) : null,
             // The registry's spelling of the name, when it has one — the
             // hubs print GUN_META, so a breadcrumb into one should too.
             hubName: GUN_META[slug] || gun.name };
  }
  if (build && build.fcu_only === true) {
    return { kind: 'fcu', name: 'P365 FCU build', slug: null, hub: null, hubName: null };
  }
  const platform = build && build.platforms && build.platforms.name;
  return { kind: 'platform', name: platform || 'Custom', slug: null, hub: null, hubName: null };
}

// "P365 XMacro build" / "P365 FCU build" / "SIG P365 build" — the phrase a
// title opens with. The FCU answer already carries the word.
export function modelBuildPhrase(model) {
  return model.kind === 'fcu' ? model.name : model.name + ' build';
}

function fireCount(b) {
  return Array.isArray(b.build_fires) && b.build_fires[0] ? Number(b.build_fires[0].count) || 0 : 0;
}

function partsCount(b) {
  return Array.isArray(b.parts_snapshot) ? b.parts_snapshot.length : 0;
}

// A card's photo alt: the model and the builder, never empty. The build
// page's own alts are richer (build-og.mjs photoAltText); a card only needs
// to say whose gun this is.
function cardAlt(b) {
  const model = buildModel(b);
  const who = b.profiles && b.profiles.username;
  return esc((b.name || 'Untitled build') + ' — ' + model.name + (who ? ' by ' + who : ''));
}

// ── the homepage card ─────────────────────────────────────────────────────
// Byte-for-byte the markup index.html's loadFeatured() writes, so the page
// does not change when its script runs over it. Change the two together.
export function homeCardHtml(b, total) {
  const hero = orderedPhotos(b)[0];
  const photoHtml = hero
    ? '<img src="' + esc(thumbUrl(hero)) + '" alt="' + cardAlt(b) + '" loading="lazy"/>'
    : '<span>No photo yet</span>';
  const author = b.profiles ? b.profiles.username : 'unknown';
  const platform = b.platforms ? b.platforms.name : '';
  const acts = Array.isArray(b.activities) ? b.activities.filter(Boolean) : [];
  const activity = acts[0] || '';
  const otherTags = acts.slice(1, 3);
  const totalHtml = total > 0 ? '~$' + total.toFixed(0) + ' total' : partsCount(b) + ' parts';
  return '<a href="' + esc(buildPath(b.id, b.name)) + '" style="text-decoration:none;color:inherit;display:block;"><div class="build-card">' +
    '<div class="build-img">' + photoHtml + '</div>' +
    '<div class="build-body">' +
      '<div class="build-name">' + esc(b.name) + '</div>' +
      '<div class="build-tags">' +
        (activity ? '<span class="build-tag blue">' + esc(activity) + '</span>' : '') +
        (platform ? '<span class="build-tag">' + esc(platform) + '</span>' : '') +
        otherTags.map((t) => '<span class="build-tag">' + esc(t) + '</span>').join('') +
      '</div>' +
      '<div class="build-meta">' +
        '<span class="build-price">' + esc(totalHtml) + '</span>' +
        '<span class="build-author">by ' + esc(author) + '</span>' +
      '</div>' +
    '</div>' +
  '</div></a>';
}

// ── the gallery card ──────────────────────────────────────────────────────
// gunforma-builds.html's renderCard(), served. The like button renders with
// its count and no "fired" state — whether THIS reader liked it needs a
// session, which is the page's job once it loads.
export function galleryCardHtml(b, total) {
  const hero = orderedPhotos(b)[0];
  const photoHtml = hero
    ? '<img src="' + esc(thumbUrl(hero)) + '" alt="' + cardAlt(b) + '" loading="lazy"/>'
    : '<div class="build-card-nophoto">No photo</div>';
  const platform = b.platforms ? b.platforms.name : '';
  const author = b.profiles ? b.profiles.username : 'unknown';
  const tags = (Array.isArray(b.activities) ? b.activities : []).filter(Boolean).slice(0, 3)
    .map((a) => '<span class="build-card-tag">' + esc(a) + '</span>').join('');
  const totalTxt = total != null && total > 0 ? '$' + Number(total).toFixed(0) : '—';
  const n = partsCount(b);
  const parts = n + ' part' + (n !== 1 ? 's' : '');
  const fireBtn =
    '<button class="fire-btn" title="Like" onclick="event.preventDefault();event.stopPropagation();toggleFire(\'' + esc(b.id) + '\',this)">' +
      '<svg class="fire-btn-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
      '<span class="fire-btn-count">' + fireCount(b) + '</span>' +
    '</button>';
  return '<a class="build-card" href="' + esc(buildPath(b.id, b.name)) + '">' +
      '<div class="build-card-photo">' + photoHtml +
        (platform ? '<div class="build-card-badge">' + esc(platform) + '</div>' : '') +
      '</div>' +
      '<div class="build-card-body">' +
        '<div class="build-card-name">' + esc(b.name) + '</div>' +
        '<div class="build-card-author-row">by <strong>' + esc(author) + '</strong> · ' + esc(fmtDate(b.created_at)) + '</div>' +
        (tags ? '<div class="build-card-tags">' + tags + '</div>' : '') +
        '<div class="build-card-footer">' +
          '<div class="build-card-meta">' +
            '<div class="build-card-total">' + esc(totalTxt) + '</div>' +
            '<div class="build-card-parts">' + esc(parts) + '</div>' +
          '</div>' +
          fireBtn +
        '</div>' +
      '</div>' +
    '</a>';
}

// The gallery writes relative dates ("3d ago") from the browser clock; the
// server writes the absolute date, which the page replaces on load. A
// relative date in cached HTML would be wrong within the hour.
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── the compact card: hubs and "More <model> builds" ──────────────────────
// Server-only surfaces, so this markup is its own. Photo, name, builder,
// parts count; the /b/ link is the point.
export function miniCardHtml(b) {
  const hero = orderedPhotos(b)[0];
  const who = b.profiles && b.profiles.username;
  const n = partsCount(b);
  return '<a class="bcard" href="' + esc(buildPath(b.id, b.name)) + '">' +
    '<span class="bcard-img">' +
      (hero ? '<img src="' + esc(thumbUrl(hero)) + '" alt="' + cardAlt(b) + '" loading="lazy"/>' : '<span class="bcard-nophoto">No photo</span>') +
    '</span>' +
    '<span class="bcard-name">' + esc(b.name || 'Untitled build') + '</span>' +
    '<span class="bcard-meta">' + (who ? 'by ' + esc(who) + ' · ' : '') + n + ' part' + (n !== 1 ? 's' : '') + '</span>' +
  '</a>';
}

export function miniCardsCss() {
  return (
    '.bcard-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin: 12px 0; }' +
    '.bcard { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: #1a1a1a; border: 0.5px solid #e5e5e5; border-radius: 8px; background: #fff; overflow: hidden; }' +
    '.bcard:hover { border-color: #4a9edd; }' +
    '.bcard-img { display: block; aspect-ratio: 4/3; background: #f4f3ee; overflow: hidden; }' +
    '.bcard-img img { width: 100%; height: 100%; object-fit: cover; display: block; }' +
    '.bcard-nophoto { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 11px; color: #b8b5ac; letter-spacing: 0.06em; }' +
    '.bcard-name { font-size: 13.5px; font-weight: 700; line-height: 1.3; padding: 0 12px; overflow-wrap: anywhere; }' +
    '.bcard-meta { font-size: 11.5px; color: #888; padding: 0 12px 12px; }'
  );
}
