// armory-builds — one reader's own Armory builds (gun_guides rows), read and
// drawn ONCE for the two places that list them: the Armory's My builds tab
// and the profile's Armory builds tab. Each page wires its own actions
// (Open, Share, and on the Armory, Delete) into the card's action slot; the
// read, the card and its numbers live here, so the page nobody is looking
// at cannot keep an older card (CLAUDE.md, "Neither is the photo uploader").
//
//   ArmoryBuilds.load(sb, userId)  → Promise<{ rows, variants, byId, defaults, error }>
//   ArmoryBuilds.cardHtml(row, data, actionsHtml) → one card, in an .ab-grid
//   ArmoryBuilds.ensureCss()       → the card and grid styles (cardHtml calls it)
//   ArmoryBuilds.modelName(row)    → "P365 XMacro" | "SIG P365" | ''
//   ArmoryBuilds.shareable(row)    → false for a build an admin took down
//   ArmoryBuilds.copyLink(row)     → Promise<url>; the apex /gg/ URL to the clipboard
//
// The read is the signed-in reader's OWN rows (user_id = them), newest
// first. RLS already returns an owner their taken-down rows as well; those
// are drawn "Taken down" with no title link and no Share, because /gg/
// serves only rows that are not removed (guide-share.mjs).
//
// "Today" is window.buildPriceTotal (js/build-total.js) — the build pages'
// own number: the cheapest fresh partner price in stock first, MSRP only for
// a part with no listing, nothing for a stale one, "+" when some part priced
// to nothing. A failed variants read draws swatches and no total; the list
// still shows.
//
// The card and grid are the Gun Guides card's design (gunforma-gun-guides.html
// .gcard / .guide-grid): the first five parts in build order as 4:3 tiles and
// a "+N" tile for the rest, kicker, title, then a footer with the total and
// the part count. Thumbnails are the SAVED option's photo, else its colour's
// swatch — never another option's photo (loadouts-spec §9), its rule too.
//
// Needs, loaded first: js/build-categories.js (orderParts), js/variant-swatch.js,
// js/build-total.js, js/guide-url.js — check-script-order.mjs holds the order.
(function (global) {
  // gun_guides carries TWO foreign keys to guns (gun_id and the composite),
  // so a bare guns(...) embed is PGRST201 — the same names guide-share.mjs
  // uses (_guide-data.mjs COMMUNITY_SELECT).
  var ROW_SELECT = 'id, user_id, title, platform_id, gun_id, parts_snapshot, is_removed, created_at, ' +
    'guns!gun_guides_gun_id_fkey(name), platforms!gun_guides_platform_id_fkey(name)';
  // The photo columns plus what buildPriceTotal reads (gunforma-builds.html's
  // select, with the photo).
  var VARIANT_SELECT = 'id, product_id, msrp, is_default, color, primary_image_url, ' +
    'affiliate_links(street_price, in_stock, last_checked, op_last_matched_by)';
  var THUMBS = 5;

  async function load(sb, userId) {
    var out = { rows: [], variants: [], byId: {}, defaults: {}, shares: null, error: null };
    if (!userId) return out;
    var r = await sb.from('gun_guides').select(ROW_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (r.error) { out.error = r.error; return out; }
    out.rows = r.data || [];
    // The /l/ slugs, in a read of their OWN: before *_armory_share_links.sql
    // the column does not exist, this read fails, and every link below
    // falls back to the /gg/ address (which still serves, and 301s here
    // once the migration lands). Never name share_id in ROW_SELECT.
    try {
      var s = await sb.from('gun_guides').select('id, share_id').eq('user_id', userId);
      if (!s.error) {
        out.shares = {};
        (s.data || []).forEach(function (row) { if (row.share_id) out.shares[row.id] = row.share_id; });
      }
    } catch (e) {}
    var ids = {};
    out.rows.forEach(function (row) {
      (row.parts_snapshot || []).forEach(function (p) { if (p && p.refId) ids[p.refId] = 1; });
    });
    var list = Object.keys(ids);
    if (list.length) {
      var v = await sb.from('product_variants').select(VARIANT_SELECT)
        .is('retired_at', null)
        .is('affiliate_links.retired_at', null)
        .in('product_id', list);
      if (v.error) console.warn('[armory-builds] variants read failed', v.error);
      else out.variants = v.data || [];
    }
    out.variants.forEach(function (row) {
      out.byId[row.id] = row;
      if (row.is_default) out.defaults[row.product_id] = row;
    });
    return out;
  }

  function modelName(row) {
    if (row && row.guns && row.guns.name) return row.guns.name;
    if (row && row.platforms && row.platforms.name) return row.platforms.name;
    return '';
  }

  function shareable(row) { return !!row && row.is_removed !== true; }

  // The address a build is shared at: its /l/<share_id> page once the
  // share-links migration has given it a slug, else its /gg/ page (still
  // served pre-migration; a 301 onto /l/ after it).
  function shareHref(row, data) {
    var share = data && data.shares ? data.shares[row.id] : null;
    return share ? '/l/' + share : global.gunGuidePath(row.id, row.title);
  }
  function shareUrl(row, data) {
    var share = data && data.shares ? data.shares[row.id] : null;
    return share ? 'https://gunforma.com/l/' + share : global.gunGuideUrl(row.id, row.title);
  }

  function partMedia(p, data) {
    if (p.variantId) {
      var v = data.byId[p.variantId];
      return { url: v ? v.primary_image_url : (p.imageUrl || null), color: v ? v.color : p.variantColor };
    }
    var d = data.defaults[p.refId];
    return { url: d ? d.primary_image_url : null, color: d ? d.color : null };
  }

  function thumbHtml(p, data) {
    var m = partMedia(p, data);
    var swatch = global.variantMediaHtml({ color: m.color }, 'ab-media', p.brand || '');
    var inner = m.url
      ? '<img src="' + esc(m.url) + '" alt="" loading="lazy" data-fallback="' + esc(swatch) + '"' +
          ' onerror="this.parentElement.innerHTML=this.dataset.fallback" />'
      : swatch;
    return '<div class="ab-thumb">' + inner + '</div>';
  }

  function cardHtml(row, data, actionsHtml) {
    ensureCss();
    data = data || { byId: {}, defaults: {}, variants: [] };
    var parts = global.BuildCategories.orderParts(row.parts_snapshot);
    var shown = parts.slice(0, THUMBS);
    var rest = parts.length - shown.length;
    var thumbs = shown.length
      ? '<div class="ab-thumbs">' + shown.map(function (p) { return thumbHtml(p, data); }).join('') +
          (rest > 0 ? '<div class="ab-thumb ab-more">+' + rest + '</div>' : '') + '</div>'
      : '<div class="ab-thumbs-blank">' + esc(modelName(row) || 'Build') + ' · no parts</div>';
    var today = global.priceTotalText(global.buildPriceTotal(row.parts_snapshot, data.variants));
    var title = esc(row.title || 'Untitled build');
    var live = shareable(row);
    return '<div class="ab-card" data-id="' + esc(row.id) + '">' +
      thumbs +
      '<div class="ab-body">' +
        '<div class="ab-kicker">' + esc(modelName(row) || 'Build') +
          (live ? '' : ' · <span class="ab-removed">Taken down</span>') + '</div>' +
        '<div class="ab-title">' + (live ? '<a href="' + esc(shareHref(row, data)) + '">' + title + '</a>' : title) + '</div>' +
      '</div>' +
      '<div class="ab-foot">' +
        '<span class="ab-total">' + (today ? esc(today) + ' today' : '') + '</span>' +
        '<span class="ab-count">' + parts.length + (parts.length === 1 ? ' part' : ' parts') + '</span>' +
      '</div>' +
      (actionsHtml ? '<div class="ab-actions">' + actionsHtml + '</div>' : '') +
    '</div>';
  }

  // The canonical the page declares, never location.origin. A browser
  // without clipboard access gets the link in a prompt to copy by hand.
  async function copyLink(row, data) {
    var url = shareUrl(row, data);
    try {
      await global.navigator.clipboard.writeText(url);
    } catch (e) {
      global.prompt('Copy this link to share your build:', url);
    }
    return url;
  }

  // Values are gunforma-gun-guides.html's .guide-grid / .gcard rules, under
  // this module's own prefix: the profile and the Armory have their own
  // .card / .part-card rules these must not land on.
  var CSS =
    '.ab-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}' +
    '.ab-card{background:#fff;border:0.5px solid #e5e5e5;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;transition:border-color 0.15s,box-shadow 0.15s}' +
    '.ab-card:hover{border-color:#4a9edd;box-shadow:0 4px 16px rgba(0,0,0,0.06)}' +
    '.ab-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:12px;border-bottom:0.5px solid #f0efe9}' +
    '.ab-thumb{position:relative;aspect-ratio:4/3;background:#f4f3ee;border-radius:4px;overflow:hidden;min-width:0}' +
    '.ab-thumb img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.ab-more{display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#555;background:#efeee8}' +
    '.ab-thumbs-blank{padding:28px 12px;text-align:center;font-size:10px;color:#c5c2b8;letter-spacing:0.06em;text-transform:uppercase;border-bottom:0.5px solid #f0efe9}' +
    '.ab-media{display:flex;align-items:center;justify-content:center;width:100%;height:100%}' +
    '.ab-media-swatch{display:block;width:40%;aspect-ratio:1;max-width:30px;border-radius:50%}' +
    '.ab-photo{aspect-ratio:4/3;background:#fff;border-bottom:0.5px solid #f0efe9;overflow:hidden;display:flex;align-items:center;justify-content:center}' +
    '.ab-photo img{width:100%;height:100%;object-fit:contain;padding:10px;display:block}' +
    '.ab-photo .ab-media-swatch{width:56px;max-width:none}' +
    '.ab-body{padding:11px 14px 0;display:flex;flex-direction:column;gap:4px}' +
    '.ab-kicker{font-size:9.5px;color:#2a7bbd;font-weight:700;letter-spacing:0.08em;text-transform:uppercase}' +
    '.ab-removed{color:#b24a2a}' +
    '.ab-title{font-size:15px;font-weight:700;line-height:1.25;color:#1a1a1a;overflow-wrap:anywhere}' +
    '.ab-title a{color:inherit;text-decoration:none}' +
    '.ab-title a:hover{color:#2a7bbd;text-decoration:underline}' +
    '.ab-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:9px 14px 12px;margin-top:auto;border-top:0.5px solid #f0efe9}' +
    '.ab-body + .ab-foot{margin-top:9px}' +
    '.ab-total{font-size:14px;font-weight:700;color:#1a1a1a}' +
    '.ab-total.na{color:#bbb;font-weight:500}' +
    '.ab-count{font-size:11px;color:#888}' +
    '.ab-actions{display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 12px}' +
    '.ab-act{font-family:inherit;font-size:11px;font-weight:700;padding:5px 12px;border-radius:4px;border:0.5px solid #a7cdec;background:#fff;color:#2a7bbd;cursor:pointer;text-decoration:none;white-space:nowrap}' +
    '.ab-act:hover{background:#eaf4fc}' +
    '.ab-act.primary{background:#4a9edd;border-color:#4a9edd;color:#fff}' +
    '.ab-act.primary:hover{background:#2a7bbd}' +
    '.ab-act.danger{color:#b24a2a;border-color:#f3bfae}' +
    '.ab-act.danger:hover{background:#fdeae4}' +
    '.ab-act:disabled,.ab-act.primary:disabled{background:#e8ecf0;border-color:#e8ecf0;color:#7a8590;cursor:default}';
  var cssDone = false;
  function ensureCss() {
    if (cssDone) return;
    var doc = global.document;
    if (!doc || !doc.head || typeof doc.createElement !== 'function') return;
    var el = doc.createElement('style');
    el.setAttribute('data-armory-builds', '');
    el.textContent = CSS;
    doc.head.appendChild(el);
    cssDone = true;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.ArmoryBuilds = {
    load: load,
    cardHtml: cardHtml,
    ensureCss: ensureCss,
    modelName: modelName,
    shareable: shareable,
    shareHref: shareHref,
    shareUrl: shareUrl,
    copyLink: copyLink,
    ROW_SELECT: ROW_SELECT,
  };
})(window);
