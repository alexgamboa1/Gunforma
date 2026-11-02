// favorites — the ♥ on a part: one reader's part_favorites, read, written
// and drawn ONCE for every page that hearts parts (the Parts Catalog and the
// Armory). A plain <script> global, like js/affiliate.js.
//
//   Favorites.init({ sb, user, toast, signInHref, onChange })
//     sb          the supabase client
//     user()      the signed-in user, or null — a function: the session is
//                 not known when the page mounts this
//     toast(msg, href, linkText)   the page's own toast
//     signInHref  where "Sign in to save parts" links (the Armory passes
//                 ?next=gunforma-armory.html so the reader comes back)
//     onChange(productId, isFav, phase)   after every change of state, so
//                 the page can keep its counts and grids in step. phase is
//                 'optimistic' (flipped, write in flight), 'saved' (a row
//                 came back), or 'revert' (the write failed; flipped back)
//   Favorites.load()        → Promise<{ error }>; reads the reader's ids
//   Favorites.set(ids)      seed from a read the page already made
//   Favorites.clear()
//   Favorites.has(id) / Favorites.size() / Favorites.ids()
//   Favorites.toggle(id, btn)   → Promise<boolean> — true when it saved
//   Favorites.buttonHtml(id, isFav, extraClass)   the heart, as markup
//   Favorites.paint(btn, isFav)
//   Favorites.repaint()     every heart on the page, from the current set
//
// Optimistic, the way the catalog always did it: flip, paint, write, and on
// failure flip back and say so. What it adds is the house rule for a write
// (CLAUDE.md, "A green result is not evidence the work happened"): an
// insert or a delete counts only when a row comes back. An RLS-refused
// delete matches nothing and returns no error; that is a failure here, not
// a success. One write per part at a time — a second click on a heart that
// is still saving does nothing, so two writes can never race each other.
//
// The heart never picks, opens or adds anything: its click stops at the
// button (stopPropagation + preventDefault), whatever card it sits on.
(function (global) {
  var opts = null;
  var IDS = new Set();
  var PENDING = {};

  function init(o) {
    opts = o || {};
    ensureCss();
    return api;
  }

  function user() { return opts && typeof opts.user === 'function' ? opts.user() : null; }

  async function load() {
    var u = user();
    if (!u) { IDS = new Set(); return { error: null }; }
    var res = await opts.sb.from('part_favorites').select('product_id').eq('user_id', u.id);
    if (res.error) { console.error(res.error); return { error: res.error }; }
    IDS = new Set((res.data || []).map(function (r) { return r.product_id; }));
    return { error: null };
  }

  function set(ids) { IDS = new Set(ids || []); }
  function clear() { IDS = new Set(); }
  function has(id) { return IDS.has(id); }
  function size() { return IDS.size; }
  function ids() { return Array.from(IDS); }

  function changed(id, isFav, phase) {
    paintAll(id, isFav);
    if (opts && typeof opts.onChange === 'function') opts.onChange(id, isFav, phase);
  }

  async function toggle(productId, btn) {
    var u = user();
    if (!u) {
      if (opts && opts.toast) opts.toast('Sign in to save parts', opts.signInHref || 'gunforma-signin.html', 'Sign in');
      return false;
    }
    if (PENDING[productId]) return false;
    PENDING[productId] = true;
    var wasFav = IDS.has(productId);
    if (wasFav) IDS.delete(productId); else IDS.add(productId);
    paint(btn, !wasFav);
    changed(productId, !wasFav, 'optimistic');

    var res;
    try {
      if (wasFav) {
        res = await opts.sb.from('part_favorites').delete()
          .eq('user_id', u.id).eq('product_id', productId).select('product_id');
      } else {
        res = await opts.sb.from('part_favorites')
          .insert({ user_id: u.id, product_id: productId }).select('product_id');
      }
    } catch (e) { res = { error: e }; }
    delete PENDING[productId];

    var ok = !!res && !res.error && Array.isArray(res.data) && res.data.length === 1;
    if (!ok) {
      if (wasFav) IDS.add(productId); else IDS.delete(productId);
      paint(btn, wasFav);
      changed(productId, wasFav, 'revert');
      console.error('favorite toggle failed', res && res.error ? res.error : 'no row came back');
      if (opts.toast) opts.toast('Couldn\'t save — try again');
      return false;
    }
    if (opts && typeof opts.onChange === 'function') opts.onChange(productId, !wasFav, 'saved');
    return true;
  }

  function paint(btn, isFav) {
    if (!btn) return;
    btn.classList.toggle('active', !!isFav);
    btn.textContent = isFav ? '♥' : '♡';
    btn.setAttribute('aria-pressed', String(!!isFav));
    btn.setAttribute('aria-label', isFav ? 'Unfavorite' : 'Favorite');
  }

  // Every heart for that part on the page — a part can be on a picker card
  // and a picked card at once, and both must say the same thing.
  function paintAll(id, isFav) {
    var doc = global.document;
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    var list = doc.querySelectorAll('[data-fav-id="' + cssId(id) + '"]');
    for (var i = 0; i < list.length; i++) paint(list[i], isFav);
  }

  function repaint() {
    var doc = global.document;
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    var list = doc.querySelectorAll('[data-fav-id]');
    for (var i = 0; i < list.length; i++) paint(list[i], IDS.has(list[i].getAttribute('data-fav-id')));
  }

  function buttonHtml(id, isFav, extraClass) {
    var safe = esc(id);
    return '<button type="button" class="fav-btn' + (extraClass ? ' ' + esc(extraClass) : '') + (isFav ? ' active' : '') + '"' +
      ' data-fav-id="' + safe + '"' +
      ' onclick="event.stopPropagation();event.preventDefault();Favorites.toggle(\'' + jsId(id) + '\',this)"' +
      ' aria-label="' + (isFav ? 'Unfavorite' : 'Favorite') + '" aria-pressed="' + !!isFav + '">' +
      (isFav ? '♥' : '♡') + '</button>';
  }

  // Product ids are uuids; anything else is refused from the inline handler
  // rather than escaped into it.
  function jsId(id) { return /^[0-9a-fA-F-]+$/.test(String(id)) ? String(id) : ''; }
  function cssId(id) { return String(id).replace(/["\\]/g, ''); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The catalog's heart, top-right over a card's photo. A page that wants it
  // in the flow adds its own modifier (the Armory's picked card does).
  var CSS =
    '.fav-btn { position: absolute; top: 8px; right: 8px; z-index: 2;' +
    ' width: 32px; height: 32px; border-radius: 50%;' +
    ' background: rgba(255,255,255,0.9); border: 0.5px solid #e5e5e5;' +
    ' display: flex; align-items: center; justify-content: center; cursor: pointer;' +
    ' font-family: inherit; font-size: 15px; color: #888; padding: 0;' +
    ' transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.1s; }' +
    '.fav-btn:hover { background: #fff; color: #d85a30; border-color: #d85a30; }' +
    '.fav-btn.active { background: #fff; color: #d85a30; border-color: #d85a30; }' +
    '.fav-btn:active { transform: scale(0.9); }';
  var cssDone = false;
  function ensureCss() {
    if (cssDone) return;
    var doc = global.document;
    if (!doc || !doc.head || typeof doc.createElement !== 'function') return;
    var el = doc.createElement('style');
    el.setAttribute('data-favorites', '');
    el.textContent = CSS;
    // First in <head>, so a page's own rules (a modifier, a position) win.
    if (doc.head.firstChild) doc.head.insertBefore(el, doc.head.firstChild);
    else doc.head.appendChild(el);
    cssDone = true;
  }

  var api = {
    init: init, load: load, set: set, clear: clear, has: has, size: size, ids: ids,
    toggle: toggle, paint: paint, repaint: repaint, buttonHtml: buttonHtml, ensureCss: ensureCss,
  };
  global.Favorites = api;
})(window);
