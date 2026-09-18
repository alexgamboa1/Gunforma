// nav.js — renders the shared top nav into <div id="nav-mount" data-nav="...">
//          and keeps the signed-in state current on pages that ship a
//          static <nav> instead of a mount div.
// -----------------------------------------------------------------------------
// Variants (data-nav="..."):
//   full        — logo + Home/Builds/Parts Catalog/Armory + Sign in / Post btn.
//                 The nine public pages now ship this variant as static HTML so
//                 crawlers see the links in-source; nav.js runs anyway to keep
//                 the #nav-signin hook session-aware (see the no-mount branch).
//   full-authed — same, but no "Post your build" CTA and no "Sign in" link.
//                 Post-build-v6 is the only page still using it — the other
//                 auth-required workflow pages (admin-queue, complete-profile,
//                 claim) ship their own static navs and don't load nav.js.
//   auth-signin — logo + "Create account →"       (used on sign-in page)
//   auth-signup — logo + "Sign in instead →"      (used on sign-up page)
//
// The full variant is session-aware: when a user is signed in, the "Sign in"
// button is replaced with their username and a "Sign out" button is inserted
// beside it. Refreshes on every auth-state change so multi-tab sign-outs
// propagate.
//
// Depends on window.sb (from supabase-client.js). Load order in HTML:
//   1. @supabase/supabase-js CDN
//   2. supabase-client.js
//   3. nav.js
// -----------------------------------------------------------------------------
(function () {
  var mount = document.getElementById('nav-mount');

  // No mount div means one of two things:
  //   1. The page ships its nav as static HTML (the public pages do, so the
  //      markup is in the crawled source). Nothing to render — but that static
  //      markup still carries the #nav-signin hook, so the session-aware
  //      wiring below must run anyway or signed-in users keep seeing "Sign in".
  //   2. The page genuinely opts out of the nav. No hook, nothing to do.
  if (!mount) {
    if (document.getElementById('nav-signin')) wireNavAuth();
    return;
  }

  var variant = mount.getAttribute('data-nav') || 'full';

  // Active-link detection compares the last path segment so `index.html`,
  // `/`, and `/index.html` all resolve the same way.
  var currentFile = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  function activeIf(href) {
    var linkFile = (href.split('/').pop() || '').toLowerCase();
    return currentFile === linkFile ? ' active' : '';
  }

  var html;
  if (variant === 'auth-signin') {
    html =
      '<nav class="nav">' +
        '<a class="nav-logo" href="index.html">GUN<span>FORMA</span></a>' +
        '<a class="nav-link" href="gunforma-signup.html">Create account →</a>' +
      '</nav>';
  } else if (variant === 'auth-signup') {
    html =
      '<nav class="nav">' +
        '<a class="nav-logo" href="index.html">GUN<span>FORMA</span></a>' +
        '<a class="nav-link" href="gunforma-signin.html">Sign in instead →</a>' +
      '</nav>';
  } else if (variant === 'full-authed') {
    // No "Post your build" CTA (avoids self-links from auth-required flows
    // like post-build-v6 that would blow away in-progress form state) and no
    // "Sign in" link (the page's watchdog guarantees a session). Username
    // still populated by updateNavAuth below via the same #nav-signin hook,
    // which also gives it its href — hence an <a> with no initial href.
    html =
      '<nav class="nav">' +
        '<a class="nav-logo" href="index.html">GUN<span>FORMA</span></a>' +
        '<div class="nav-links">' +
          '<a class="nav-link' + activeIf('index.html') + '" href="index.html">Home</a>' +
          '<a class="nav-link' + activeIf('gunforma-builds.html') + '" href="gunforma-builds.html">Builds</a>' +
          '<a class="nav-link' + activeIf('gunforma-parts-catalog.html') + '" href="gunforma-parts-catalog.html">Parts Catalog</a>' +
          '<a class="nav-link' + activeIf('gunforma-armory.html')        + '" href="gunforma-armory.html">Armory</a>' +
        '</div>' +
        '<div class="nav-right">' +
          '<a class="nav-btn" id="nav-signin">…</a>' +
        '</div>' +
      '</nav>';
  } else {
    // full — the default
    html =
      '<nav class="nav">' +
        '<a class="nav-logo" href="index.html">GUN<span>FORMA</span></a>' +
        '<div class="nav-links">' +
          '<a class="nav-link' + activeIf('index.html') + '" href="index.html">Home</a>' +
          '<a class="nav-link' + activeIf('gunforma-builds.html') + '" href="gunforma-builds.html">Builds</a>' +
          '<a class="nav-link' + activeIf('gunforma-parts-catalog.html') + '" href="gunforma-parts-catalog.html">Parts Catalog</a>' +
          '<a class="nav-link' + activeIf('gunforma-armory.html')        + '" href="gunforma-armory.html">Armory</a>' +
        '</div>' +
        '<div class="nav-right">' +
          '<a class="nav-btn" href="gunforma-signin.html" id="nav-signin">Sign in</a>' +
          '<a class="nav-btn cta" href="gunforma-post-build-v6.html">+ Post your build</a>' +
        '</div>' +
      '</nav>';
  }

  // outerHTML swap discards the mount div; the injected <nav> replaces it in
  // the DOM tree. #nav-signin is looked up by id later, no reference needed.
  mount.outerHTML = html;

  // Session-aware right side (variants that render #nav-signin).
  if (variant === 'full' || variant === 'full-authed') wireNavAuth();
})();

// Paints the session-aware right side once, then repaints on every auth-state
// change so sign-outs in another tab propagate. Hoisted, so the IIFE above can
// call it from either the static-nav path or the rendered-nav path.
function wireNavAuth() {
  updateNavAuth();
  if (window.sb && window.sb.auth) {
    window.sb.auth.onAuthStateChange(function () { updateNavAuth(); });
  }
}

// Exposed globally so pages that need to trigger a nav refresh from their own
// code (e.g. after an in-app sign-out) can call it.
async function updateNavAuth() {
  var signInEl = document.getElementById('nav-signin');
  if (!signInEl || !window.sb) return;

  var sess = await window.sb.auth.getSession();
  var user = sess && sess.data && sess.data.session && sess.data.session.user;

  // Anon branch — clear any stale Sign out (querySelectorAll, not
  // getElementById, because concurrent invocations can duplicate the id
  // and getElementById only ever returns the first match).
  if (!user) {
    document.querySelectorAll('#nav-signout').forEach(function (el) { el.remove(); });
    signInEl.textContent = 'Sign in';
    signInEl.setAttribute('href', 'gunforma-signin.html');
    signInEl.style.cursor = '';
    signInEl.onclick = null;
    return;
  }

  // Signed-in state: show username in place of Sign in, insert Sign out next to it.
  var profile = null;
  try {
    var res = await window.sb.from('profiles').select('username').eq('id', user.id).maybeSingle();
    profile = res.data;
  } catch (e) { /* nav degrades gracefully to email */ }
  var displayName = (profile && profile.username) || user.email || 'Signed in';
  signInEl.textContent = displayName;
  signInEl.setAttribute('href', 'gunforma-profile.html');
  signInEl.style.cursor = 'pointer';
  signInEl.onclick = null;

  // Cleanup must happen HERE, after all awaits — updateNavAuth runs
  // concurrently on page load (the mount script calls it, and
  // onAuthStateChange fires INITIAL_SESSION which calls it again). If we
  // checked before the awaits, every concurrent caller would see an empty
  // DOM and each insert its own Sign out — you end up with a stack of
  // them. Sweeping right before insertion, with querySelectorAll (not
  // getElementById, which stops at the first match), is what keeps this
  // idempotent under the race.
  document.querySelectorAll('#nav-signout').forEach(function (el) { el.remove(); });

  var signOut = document.createElement('a');
  signOut.id = 'nav-signout';
  signOut.href = '#';
  signOut.className = signInEl.className;   // matches whichever nav-btn styling the page has
  signOut.textContent = 'Sign out';
  signOut.onclick = async function (e) {
    e.preventDefault();
    await window.sb.auth.signOut();
    location.reload();
  };
  signInEl.parentNode.insertBefore(signOut, signInEl);
}
