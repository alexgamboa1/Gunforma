// js/gun-model.js — which pistol a build is: "Which P365 is it?"
//
// A build used to name its platform ("SIG P365") and nothing narrower. The
// only way to say XL, XMacro Comp or FUSE was to type the factory slide in as
// a part — so thorough builders did, and the factory slide catch, takedown
// lever and trigger with it: rows with no buy link that everyone who owns the
// gun already has. And nothing that read a build could tell a 3.1" gun from a
// 4.3" one, which is what the fit of every barrel and compensator turns on.
//
// public.guns already has one row per factory model (slide length, barrel
// length, grip-module class, built-in comp), and the parts catalog has
// filtered on it for a while. This puts the same question on the two pages
// that create a build and stores the answer in builds.gun_id.
//
// ONE COPY, TWO PAGES. gunforma-post-build.html and gunforma-admin-post.html
// both mount it — the same split, and the same reason, as js/part-picker.js
// and js/photos.js: a rule copied into both pages is a rule the admin page
// keeps the old version of.
//
//   GunModel.init({
//     state:    () => state,          // reads state.platform; owns state.gun,
//                                     //   state.gunFcuOnly, state.gunNotListed
//     mount:    '#gun-model-mount',
//     onChange: () => { renderParts(); renderSidebar(); },
//     locked:   () => bool,           // optional: a live build's owner edit
//   });
//
// The page keeps the store; this module only ever writes three keys of it.
// Functions, not values, for the reason js/photos.js documents.
//
// ── IT IS DARK UNTIL THE COLUMN EXISTS ────────────────────────────────────
// builds.gun_id arrives with supabase/builds_gun_id.sql, and the house order
// is code first, migration second. So nothing here assumes the column:
//
//   probe()     asks PostgREST for builds.gun_id and builds.fcu_only, in one
//               request, once per page load. An error
//               — any error — means "not there", and from then on the
//               question is never drawn, answered() never blocks a submit,
//               payload() is {} and hydrate() does nothing. The two pages
//               behave exactly as they did before this file existed.
//   payload()   is spread into the page's own insert/update, so when it is
//               {} the request names no column the database lacks.
//   hydrate()   reads gun_id in a query of its OWN. Adding it to the page's
//               select list would fail the whole load before the migration.
//
// After the migration the same pages light up on their next load. Do not
// "simplify" this by naming gun_id in a page's select once the column is
// live without also deleting the probe — half of each is the state that
// breaks.
//
// ── WHAT IS STORED ────────────────────────────────────────────────────────
// Three answers, two columns:
//
//   a factory model     gun_id = guns.id,  fcu_only = false
//   "P365 FCU only"     gun_id = NULL,     fcu_only = true
//   "Not listed"        gun_id = NULL,     fcu_only = false
//
// The last is the same row as "nobody asked" (every build before this). The
// form tells those apart only while it is open, in state.gunNotListed, to
// know the question was answered; a build reopened that way is asked again.
//
// FCU ONLY is a real answer and is stored as one. It means the build started
// from a bare fire control unit — the serialised internals — and everything
// around it was chosen: there is no factory slide, barrel or grip module to
// assume. So it is NOT a row in guns (a "model" with no slide length would
// have to be special-cased by every other reader of that table), and the
// Slides section does the opposite of what it does for a model: instead of
// "leave this empty", it asks for the slide. Until a slide is in the parts
// list an FCU build has no slide length at all, and anything that fits parts
// by length has nothing to go on — by design, not by omission.
//
// The trigger, slide catch, takedown lever and safety still get the
// factory-part line on an FCU build: those ARE the fire control unit.
//
// The foreign key is (gun_id, platform_id) -> guns, so a model must belong to
// the build's platform. reset() clears the model whenever the pistol changes,
// which is what keeps a save from sending a P365 model with another platform.
//
// ── THE STOCK NOTES ───────────────────────────────────────────────────────
// sectionNoteHtml() is why this is more than a dropdown. With a model chosen,
// the Slides section says "Stock P365 XL slide (3.7") — leave this empty
// unless you swapped it", and the sections flagged stockDefault in
// js/build-categories.js say the factory part needs no entry. An empty
// section then reads as an answer instead of a gap to fill in.
// A stock slide is NOT written to parts_snapshot. It is implied by the model
// plus the absence of a slide part, so there is no new part shape for the
// snapshot whitelists, the Armory or the review queue to learn.
(function (global) {
  'use strict';

  var cfg = null;
  var MODELS = [];          // guns rows for the platform loaded last
  var loadedFor = null;     // platform id MODELS belongs to
  var loadingFor = null;    // platform id in flight, or null
  var supported = null;     // null = not probed; then true/false for good

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function st() { return cfg.state(); }

  // 3.7 -> 3.7"   5 -> 5.0"   null -> ''. One decimal always: the catalog and
  // every maker write these lengths that way, and "5"" beside "4.7"" reads as
  // a different kind of number.
  function inches(n) {
    if (n == null || n === '') return '';
    var x = Number(n);
    return isFinite(x) && x > 0 ? x.toFixed(1) + '"' : '';
  }

  // The line under a model's name: its BARREL length, because that is how the
  // guns are told apart in a shop ("the 3.1 or the 3.7?"), plus the one fact
  // that length alone hides — a Comp model's barrel is shorter than its slide.
  function modelSub(g) {
    var bits = [];
    var barrel = inches(g.barrel_length_in);
    if (barrel) bits.push(barrel + ' barrel');
    if (g.integrated_comp) bits.push('built-in comp');
    return bits.join(' · ');
  }

  // "SIG P365" + "P365 XL" -> "SIG P365 XL". The make is the platform name's
  // first word; a model name that already starts with it is left alone.
  function displayName(platform, gun) {
    var pName = platform && platform.name ? String(platform.name) : '';
    if (!gun || !gun.name) return pName;
    var make = pName.split(' ')[0] || '';
    var gName = String(gun.name);
    if (make && gName.toLowerCase().indexOf(make.toLowerCase()) !== 0) return make + ' ' + gName;
    return gName;
  }

  // "SIG P365" -> "P365", for "Which P365 is it?".
  function shortPlatform(platform) {
    var words = String((platform && platform.name) || '').split(' ');
    return words.length > 1 ? words.slice(1).join(' ') : words[0];
  }

  // Slide length first, plain models before Comp ones, then by name — so the
  // grid reads short to long the way the line-up does: P365, P365 X, P365 XL,
  // P365 XMacro, the Comp models, then the FUSE family.
  function byLineup(a, b) {
    var la = Number(a.slide_length_in != null ? a.slide_length_in : a.barrel_length_in) || 0;
    var lb = Number(b.slide_length_in != null ? b.slide_length_in : b.barrel_length_in) || 0;
    if (la !== lb) return la - lb;
    if (!!a.integrated_comp !== !!b.integrated_comp) return a.integrated_comp ? 1 : -1;
    return String(a.name).localeCompare(String(b.name));
  }

  // Are builds.gun_id and builds.fcu_only there? One migration adds both, so
  // one request asks for both. Asked once. RLS decides which rows this could see
  // and that does not matter — a missing column fails the request (42703)
  // before any row is read, and zero rows with no error is a yes. A plain GET
  // rather than head:true: a failed HEAD has no body, and what supabase-js
  // makes of an empty error body is not something to build a feature gate on.
  async function probe() {
    if (supported !== null) return supported;
    try {
      var res = await global.sb.from('builds').select('gun_id,fcu_only').limit(1);
      supported = !res.error;
    } catch (e) {
      supported = false;
    }
    return supported;
  }

  function mountEl() {
    return cfg && cfg.mount ? document.querySelector(cfg.mount) : null;
  }

  function render() {
    var el = mountEl();
    if (!el) return;
    var s = st();
    var platform = s.platform;
    if (!platform || supported !== true) { el.innerHTML = ''; return; }
    if (loadingFor === platform.id) {
      el.innerHTML = '<div class="gun-model"><div class="gun-model-loading">Loading models…</div></div>';
      return;
    }
    if (loadedFor !== platform.id || !MODELS.length) { el.innerHTML = ''; return; }

    var chosen = s.gun ? s.gun.id : null;
    var buttons = MODELS.map(function (g) {
      var on = g.id === chosen;
      var sub = modelSub(g);
      return '<button type="button" class="gun-model-btn' + (on ? ' selected' : '') + '"' +
          ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
          ' onclick="GunModel.pick(\'' + esc(g.id) + '\')">' +
          '<span class="gun-model-name">' + esc(g.name) + '</span>' +
          (sub ? '<span class="gun-model-sub">' + esc(sub) + '</span>' : '') +
        '</button>';
    }).join('');
    // After the factory models, the two answers that are not one. FCU only
    // first: it is a real kind of build, and common on this platform — the
    // fire control unit is the serialised part, so a P365 can be assembled
    // around one with no factory gun involved.
    var fcu = !!s.gunFcuOnly && !chosen;
    buttons += '<button type="button" class="gun-model-btn fcu' + (fcu ? ' selected' : '') + '"' +
        ' aria-pressed="' + (fcu ? 'true' : 'false') + '" onclick="GunModel.pickFcuOnly()">' +
        '<span class="gun-model-name">' + esc(shortPlatform(platform)) + ' FCU only</span>' +
        '<span class="gun-model-sub">Fire control unit only</span>' +
      '</button>';
    var other = !!s.gunNotListed && !chosen && !fcu;
    buttons += '<button type="button" class="gun-model-btn other' + (other ? ' selected' : '') + '"' +
        ' aria-pressed="' + (other ? 'true' : 'false') + '" onclick="GunModel.pickNotListed()">' +
        '<span class="gun-model-name">Not listed</span>' +
        '<span class="gun-model-sub">A model that isn’t here</span>' +
      '</button>';

    el.innerHTML =
      '<div class="gun-model">' +
        '<div class="gun-model-head">' +
          '<span class="gun-model-title">Which ' + esc(shortPlatform(platform)) + ' is it?</span>' +
          '<span class="gun-model-hint">What it started as — sets the stock slide and barrel</span>' +
        '</div>' +
        '<div class="gun-model-grid" role="group" aria-label="Pistol model">' + buttons + '</div>' +
      '</div>';
  }

  // Loads the models for a platform and draws the question. Safe to call
  // again for the same platform. A result that arrives after the pistol has
  // been changed again is dropped — loadingFor is the token.
  async function loadFor(platformId) {
    if (!cfg || !platformId) return;
    if (loadedFor === platformId && supported !== null) { render(); return; }
    loadingFor = platformId;
    try {
      var ok = await probe();
      if (loadingFor !== platformId) return;
      if (!ok) { MODELS = []; loadedFor = platformId; return; }
      render();   // "Loading models…"
      var res = await global.sb.from('guns')
        .select('id,slug,name,platform_id,housing_class,slide_length_in,barrel_length_in,integrated_comp')
        .eq('platform_id', platformId);
      if (loadingFor !== platformId) return;
      // A failed load leaves MODELS empty, and an empty list never blocks a
      // submit (see answered) — the build posts without a model rather than
      // not at all.
      if (res.error) console.warn('[gun-model] models did not load', res.error);
      MODELS = (res.error ? [] : (res.data || [])).slice().sort(byLineup);
      loadedFor = platformId;
      // A model carried in from hydrate() before the list arrived is only an
      // id; swap in the full row now so its name and lengths are known.
      var s = st();
      if (s.gun && s.gun.id) {
        var full = MODELS.find(function (g) { return g.id === s.gun.id; });
        if (full) s.gun = full;
      }
    } finally {
      var current = loadingFor === platformId;
      if (current) loadingFor = null;
      render();
      // The page's gate and checklist read answered(), which has just
      // changed from "still loading" to a real answer. Without this they
      // wait for the catalog — a separate, slower read — before saying what
      // is missing. Not for a superseded load: that pistol is gone.
      if (current && cfg.onChange) cfg.onChange();
    }
  }

  // Edit mode: read the stored model for a build. Its own query on purpose —
  // see the header. Call after loadFor() for the build's platform.
  async function hydrate(buildId) {
    if (!cfg || !buildId) return;
    if (!(await probe())) return;
    var res;
    try {
      res = await global.sb.from('builds').select('gun_id,fcu_only').eq('id', buildId).maybeSingle();
    } catch (e) { return; }
    if (!res || res.error || !res.data) { render(); return; }
    var s = st();
    if (res.data.fcu_only) {
      s.gun = null; s.gunFcuOnly = true; s.gunNotListed = false;
      render();
      return;
    }
    if (!res.data.gun_id) { render(); return; }
    var id = res.data.gun_id;
    // If the list did not load, keep the bare id: payload() then sends back
    // what was stored instead of quietly clearing it on the next save.
    s.gun = MODELS.find(function (g) { return g.id === id; }) || { id: id, name: '' };
    s.gunFcuOnly = false;
    s.gunNotListed = false;
    render();
  }

  function changed() {
    render();
    if (cfg.onChange) cfg.onChange();
  }

  function pick(id) {
    var g = MODELS.find(function (m) { return m.id === id; });
    if (!g) return;
    var s = st();
    s.gun = g;
    s.gunFcuOnly = false;
    s.gunNotListed = false;
    changed();
  }

  function pickFcuOnly() {
    var s = st();
    s.gun = null;
    s.gunFcuOnly = true;
    s.gunNotListed = false;
    changed();
  }

  function pickNotListed() {
    var s = st();
    s.gun = null;
    s.gunFcuOnly = false;
    s.gunNotListed = true;
    changed();
  }

  // The pistol was changed or the form was cleared. Drops the answer — a
  // model belongs to one platform, and the foreign key will refuse the pair
  // otherwise — and forgets the list, so the next platform loads its own.
  function reset() {
    if (!cfg) return;
    var s = st();
    s.gun = null;
    s.gunFcuOnly = false;
    s.gunNotListed = false;
    MODELS = [];
    loadedFor = null;
    loadingFor = null;
    render();
  }

  // Has the model question been dealt with? Part of the page's "pistol
  // chosen" gate. It must never be the reason a build cannot be posted when
  // the question could not be asked: no column, no models for this platform,
  // or a list that failed to load all count as answered.
  function answered() {
    if (!cfg) return true;
    var s = st();
    if (!s.platform) return false;
    if (cfg.locked && cfg.locked()) return true;
    if (supported !== true) return loadingFor === null;
    if (loadedFor !== s.platform.id) return loadingFor === null;
    if (!MODELS.length) return true;
    return !!s.gun || !!s.gunFcuOnly || !!s.gunNotListed;
  }

  // Spread into the page's insert/update. {} until the columns exist, so the
  // request never names a column the database does not have. Both columns
  // always travel together: the check constraint refuses fcu_only beside a
  // gun_id, and sending one without the other would leave the old value of
  // the other in place — a model picked over a stored FCU answer, say.
  function payload() {
    if (!cfg || supported !== true) return {};
    var s = st();
    var gunId = s.gun && s.gun.id ? s.gun.id : null;
    return { gun_id: gunId, fcu_only: !gunId && !!s.gunFcuOnly };
  }

  // "SIG P365 XL" for the summary; "SIG P365 · FCU only"; the platform's own
  // name until the question is answered; '' with no pistol at all.
  function summary() {
    if (!cfg) return '';
    var s = st();
    if (s.platform && s.gunFcuOnly && !s.gun) return displayName(s.platform, null) + ' · FCU only';
    return displayName(s.platform, s.gun);
  }

  // The checklist line for the pistol step. Its own words ("Choose a pistol")
  // are right until a pistol IS chosen and the model is what is missing —
  // then the unticked line has to name the thing still to do. The line is a
  // dot element followed by a text node; only the text node is touched, so
  // the page's own setCheck() keeps owning the tick.
  function syncChecklist(id) {
    var el = document.getElementById(id);
    if (!el || !cfg) return;
    var text = el.lastChild;
    if (!text || text.nodeType !== 3) return;
    if (el.dataset.gunModelLabel === undefined) el.dataset.gunModelLabel = text.nodeValue;
    var s = st();
    var needsModel = !!s.platform && supported === true && loadedFor === s.platform.id &&
                     MODELS.length > 0 && !answered();
    text.nodeValue = needsModel
      ? ' Say which ' + shortPlatform(s.platform) + ' it is'
      : el.dataset.gunModelLabel;
  }

  function note(text) {
    return '<div class="stock-note">' + esc(text) + '</div>';
  }

  // The line under a section's heading when nothing has been added to it.
  // Empty string for every section that has no stock answer worth stating.
  function sectionNoteHtml(cat, addedCount) {
    if (!cfg || !cat || addedCount || supported !== true) return '';
    var s = st();
    if (cat.key === 'slides') {
      // The one section where FCU only says the opposite of a model: there
      // is no factory slide to fall back on, so the empty section is a gap.
      if (s.gunFcuOnly && !s.gun) return note('An FCU build has no stock slide — add the slide you used.');
      if (!s.gun || !s.gun.name) return '';
      var bits = [];
      var len = inches(s.gun.slide_length_in);
      if (len) bits.push(len);
      if (s.gun.integrated_comp) bits.push('built-in comp');
      return note('Stock ' + s.gun.name + ' slide' + (bits.length ? ' (' + bits.join(', ') + ')' : '') +
                  ' — leave this empty unless you swapped it.');
    }
    if (cat.stockDefault) return note('Still the factory part? Leave this empty.');
    return '';
  }

  var CSS = [
    '.gun-model { margin-top: 14px; }',
    '.gun-model-head { display: flex; align-items: baseline; justify-content: space-between; gap: 4px 12px; flex-wrap: wrap; margin-bottom: 8px; }',
    '.gun-model-title { font-size: 12px; font-weight: 700; color: #1a1a1a; }',
    '.gun-model-hint { font-size: 11px; color: #999; }',
    '.gun-model-loading { font-size: 12px; color: #bbb; padding: 6px 0; }',
    '.gun-model-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 6px; }',
    '.gun-model-btn { display: flex; flex-direction: column; gap: 2px; text-align: left; border: 0.5px solid #e5e5e5; border-radius: 4px; padding: 8px 11px; background: #fff; font-family: inherit; cursor: pointer; transition: border-color 0.15s, background 0.15s; }',
    '.gun-model-btn:hover { border-color: #4a9edd; background: #f0f6fc; }',
    '.gun-model-btn:focus-visible { outline: 2px solid #4a9edd; outline-offset: 1px; }',
    '.gun-model-btn.selected { border-color: #2a7bbd; background: #eaf4fc; box-shadow: inset 0 0 0 1px #2a7bbd; }',
    '.gun-model-name { font-size: 12px; font-weight: 600; color: #1a1a1a; line-height: 1.3; }',
    '.gun-model-sub { font-size: 10.5px; color: #8a8a8a; line-height: 1.3; }',
    '.gun-model-btn.other .gun-model-name { font-weight: 500; color: #555; }',
    '.gun-model-btn.selected .gun-model-sub { color: #2a6aa0; }',
    // Sits between a section's heading and its picker, on the section's own
    // background, so it reads as part of the heading and not as a part row.
    '.stock-note { font-size: 11px; line-height: 1.45; color: #8a8780; padding: 0 16px 11px; background: #fafaf8; margin-top: -4px; }',
    '.category-block.open .stock-note { display: none; }',
    '@media (max-width: 600px) { .gun-model-btn { padding: 10px 11px; } .gun-model-name { font-size: 13px; } .gun-model-sub { font-size: 11px; } }',
  ].join('\n');

  function mountStyles() {
    if (document.getElementById('gun-model-styles')) return;
    var el = document.createElement('style');
    el.id = 'gun-model-styles';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function init(opts) {
    if (!opts || typeof opts.state !== 'function') {
      throw new Error('GunModel.init needs { state: () => state }');
    }
    cfg = opts;
    mountStyles();
    render();
  }

  global.GunModel = {
    init: init,
    loadFor: loadFor,
    hydrate: hydrate,
    reset: reset,
    pick: pick,
    pickFcuOnly: pickFcuOnly,
    pickNotListed: pickNotListed,
    answered: answered,
    payload: payload,
    summary: summary,
    sectionNoteHtml: sectionNoteHtml,
    syncChecklist: syncChecklist,
    render: render,
    // For the page that wants to say why something is missing, and for tests.
    isSupported: function () { return supported; },
    // Exposed so the review queue can label a model the same way without
    // mounting the picker.
    displayName: displayName,
    modelSub: modelSub,
  };
})(window);
