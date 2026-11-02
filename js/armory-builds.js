// armory-builds — one reader's own Armory builds (gun_guides rows), read and
// drawn ONCE for the two places that list them: the Armory's My Armory panel
// and the profile's Armory builds tab. Each page wires its own actions
// (Open, Share, and on the Armory, Delete) into the card's action slot; the
// read, the card and its numbers live here, so the page nobody is looking
// at cannot keep an older card (CLAUDE.md, "Neither is the photo uploader").
//
//   ArmoryBuilds.load(sb, userId)  → Promise<{ rows, variants, byId, defaults, error }>
//   ArmoryBuilds.cardHtml(row, data, actionsHtml) → one card
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
// Thumbnails are the SAVED option's photo, else its colour's swatch — never
// another option's photo (loadouts-spec §9), the Gun Guides card's rule.
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
  var THUMBS = 4;

  async function load(sb, userId) {
    var out = { rows: [], variants: [], byId: {}, defaults: {}, error: null };
    if (!userId) return out;
    var r = await sb.from('gun_guides').select(ROW_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (r.error) { out.error = r.error; return out; }
    out.rows = r.data || [];
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
    return '<span class="ab-thumb">' + inner + '</span>';
  }

  function cardHtml(row, data, actionsHtml) {
    ensureCss();
    data = data || { byId: {}, defaults: {}, variants: [] };
    var parts = global.BuildCategories.orderParts(row.parts_snapshot);
    var shown = parts.slice(0, THUMBS);
    var rest = parts.length - shown.length;
    var thumbs = shown.length
      ? shown.map(function (p) { return thumbHtml(p, data); }).join('') +
        (rest > 0 ? '<span class="ab-thumb ab-more">+' + rest + '</span>' : '')
      : '<span class="ab-empty">No parts</span>';
    var today = global.priceTotalText(global.buildPriceTotal(row.parts_snapshot, data.variants));
    var title = esc(row.title || 'Untitled build');
    var live = shareable(row);
    return '<div class="ab-card" data-id="' + esc(row.id) + '">' +
      '<div class="ab-thumbs">' + thumbs + '</div>' +
      '<div class="ab-body">' +
        '<div class="ab-kicker">' + esc(modelName(row) || 'Build') +
          (live ? '' : ' · <span class="ab-removed">Taken down</span>') + '</div>' +
        '<div class="ab-title">' + (live ? '<a href="' + esc(global.gunGuidePath(row.id, row.title)) + '">' + title + '</a>' : title) + '</div>' +
        '<div class="ab-meta">' + parts.length + (parts.length === 1 ? ' part' : ' parts') +
          (today ? ' · <strong>' + esc(today) + '</strong> today' : '') + '</div>' +
      '</div>' +
      (actionsHtml ? '<div class="ab-actions">' + actionsHtml + '</div>' : '') +
    '</div>';
  }

  // The canonical the page declares, never location.origin. A browser
  // without clipboard access gets the link in a prompt to copy by hand.
  async function copyLink(row) {
    var url = global.gunGuideUrl(row.id, row.title);
    try {
      await global.navigator.clipboard.writeText(url);
    } catch (e) {
      global.prompt('Copy this link to share your build:', url);
    }
    return url;
  }

  var CSS =
    '.ab-list{display:flex;flex-direction:column;gap:10px}' +
    '.ab-card{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;background:#fff;border:0.5px solid #e5e5e5;border-radius:6px;padding:10px 12px}' +
    '.ab-thumbs{display:flex;gap:4px}' +
    '.ab-thumb{width:52px;aspect-ratio:4/3;background:#fff;border:0.5px solid #eee;border-radius:3px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#888}' +
    '.ab-thumb img{width:100%;height:100%;object-fit:contain;padding:2px;display:block}' +
    '.ab-thumb .ab-media{display:flex;align-items:center;justify-content:center;width:100%;height:100%}' +
    '.ab-thumb .ab-media-swatch{display:block;width:24px;height:24px;border-radius:50%}' +
    '.ab-more{background:#f4f3ee}' +
    '.ab-empty{font-size:11px;color:#999;padding:8px 0}' +
    '.ab-body{min-width:0}' +
    '.ab-kicker{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#888}' +
    '.ab-removed{color:#b24a2a}' +
    '.ab-title{font-size:13.5px;font-weight:700;line-height:1.3;color:#1a1a1a;overflow-wrap:anywhere}' +
    '.ab-title a{color:inherit;text-decoration:none}' +
    '.ab-title a:hover{color:#2a7bbd;text-decoration:underline}' +
    '.ab-meta{font-size:11.5px;color:#666;margin-top:2px}' +
    '.ab-meta strong{color:#1a1a1a}' +
    '.ab-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}' +
    '.ab-act{font-family:inherit;font-size:11px;font-weight:700;padding:5px 11px;border-radius:4px;border:0.5px solid #a7cdec;background:#fff;color:#2a7bbd;cursor:pointer;text-decoration:none;white-space:nowrap}' +
    '.ab-act:hover{background:#eaf4fc}' +
    '.ab-act.danger{color:#b24a2a;border-color:#f3bfae}' +
    '.ab-act.danger:hover{background:#fdeae4}' +
    '.ab-act:disabled{opacity:0.5;cursor:default}' +
    '@media (max-width:600px){.ab-card{grid-template-columns:1fr}.ab-actions{justify-content:flex-start}}';
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
    modelName: modelName,
    shareable: shareable,
    copyLink: copyLink,
    ROW_SELECT: ROW_SELECT,
  };
})(window);
