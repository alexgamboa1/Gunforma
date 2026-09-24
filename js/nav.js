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
// Shared nav fragments. The mobile account icon and the hamburger live in
// .nav-right after the Post button; the dropdown is the last child of <nav>
// so it anchors to the bar itself. Kept as constants because the "full" and
// "full-authed" variants below must stay byte-identical here — the static
// navs in the HTML pages and both .mjs functions carry the same markup.
//
// The menu deliberately has no Home and no Profile entry: Home is the logo,
// and the account icon is the way to the profile.
var NAV_PROFILE =
  '<a class="nav-profile" href="gunforma-signin.html" aria-label="Account">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">' +
      '<circle cx="12" cy="8" r="4"/>' +
      '<path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke-linecap="round"/>' +
    '</svg>' +
  '</a>';

var NAV_TOGGLE =
  '<button class="nav-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav-menu">' +
    '<span></span><span></span><span></span>' +
  '</button>';

var NAV_MENU =
  '<div class="nav-menu" id="nav-menu">' +
    '<a href="gunforma-builds.html">Builds</a>' +
    '<a href="gunforma-parts-catalog.html">Parts Catalog</a>' +
    '<a href="gunforma-armory.html">Armory</a>' +
  '</div>';

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
    // The eleven pages that ship a static nav carry the hamburger in their own
    // markup, so the toggle has to be wired on this path too — otherwise the
    // links are hidden below 820px with nothing to reveal them.
    wireNavToggle();
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
        '<a class="nav-logo" href="index.html"><img class="nav-logo-full" src="assets/gunforma-logo.png" alt="Gunforma"><img class="nav-logo-mark" src="assets/gunforma-mark.png" alt="Gunforma"></a>' +
        '<a class="nav-link" href="gunforma-signup.html">Create account →</a>' +
      '</nav>';
  } else if (variant === 'auth-signup') {
    html =
      '<nav class="nav">' +
        '<a class="nav-logo" href="index.html"><img class="nav-logo-full" src="assets/gunforma-logo.png" alt="Gunforma"><img class="nav-logo-mark" src="assets/gunforma-mark.png" alt="Gunforma"></a>' +
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
        '<a class="nav-logo" href="index.html"><img class="nav-logo-full" src="assets/gunforma-logo.png" alt="Gunforma"><img class="nav-logo-mark" src="assets/gunforma-mark.png" alt="Gunforma"></a>' +
        '<div class="nav-links">' +
          '<a class="nav-link' + activeIf('index.html') + '" href="index.html">Home</a>' +
          '<a class="nav-link' + activeIf('gunforma-builds.html') + '" href="gunforma-builds.html">Builds</a>' +
          '<a class="nav-link' + activeIf('gunforma-parts-catalog.html') + '" href="gunforma-parts-catalog.html">Parts Catalog</a>' +
          '<a class="nav-link' + activeIf('gunforma-armory.html')        + '" href="gunforma-armory.html">Armory</a>' +
        '</div>' +
        '<div class="nav-right">' +
          '<a class="nav-btn nav-signin-inline" id="nav-signin">…</a>' +
          NAV_PROFILE +
          NAV_TOGGLE +
        '</div>' +
        NAV_MENU +
      '</nav>';
  } else {
    // full — the default
    html =
      '<nav class="nav">' +
        '<a class="nav-logo" href="index.html"><img class="nav-logo-full" src="assets/gunforma-logo.png" alt="Gunforma"><img class="nav-logo-mark" src="assets/gunforma-mark.png" alt="Gunforma"></a>' +
        '<div class="nav-links">' +
          '<a class="nav-link' + activeIf('index.html') + '" href="index.html">Home</a>' +
          '<a class="nav-link' + activeIf('gunforma-builds.html') + '" href="gunforma-builds.html">Builds</a>' +
          '<a class="nav-link' + activeIf('gunforma-parts-catalog.html') + '" href="gunforma-parts-catalog.html">Parts Catalog</a>' +
          '<a class="nav-link' + activeIf('gunforma-armory.html')        + '" href="gunforma-armory.html">Armory</a>' +
        '</div>' +
        '<div class="nav-right">' +
          '<a class="nav-btn nav-signin-inline" href="gunforma-signin.html" id="nav-signin">Sign in</a>' +
          '<a class="nav-btn cta" href="gunforma-post-build-v6.html">+ Post your build</a>' +
          NAV_PROFILE +
          NAV_TOGGLE +
        '</div>' +
        NAV_MENU +
      '</nav>';
  }

  // outerHTML swap discards the mount div; the injected <nav> replaces it in
  // the DOM tree. #nav-signin is looked up by id later, no reference needed.
  mount.outerHTML = html;

  // Session-aware right side (variants that render #nav-signin).
  if (variant === 'full' || variant === 'full-authed') wireNavAuth();
  wireNavToggle();
})();

// Hamburger. Runs on both paths (rendered nav and static nav) and is a no-op
// on pages without a toggle — the sign-in/sign-up variants, which deliberately
// have neither hamburger nor account icon.
function wireNavToggle() {
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.querySelector('.nav-menu');
  if (!toggle || !menu) return;

  function close() {
    menu.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function () {
    var open = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // Close on link tap. Delegated, because updateNavAuth adds and removes the
  // Sign out item as the session changes — a listener bound per link now would
  // miss it.
  menu.addEventListener('click', function (e) {
    if (e.target.closest('a')) close();
  });

  // Coming back above the breakpoint leaves .open set on a panel that desktop
  // CSS no longer displays; the next drop below 820px would then show it
  // already open. Clearing it here keeps the two widths consistent.
  window.addEventListener('resize', function () {
    if (window.innerWidth > 820) close();
  });
}

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

  // The mobile account icon stands in for the text button below 820px, so it
  // has to track the same session and point at the same place. Resolved on
  // every call rather than cached — the static-nav pages and the rendered nav
  // reach this function through different paths.
  var profileEl = document.querySelector('.nav-profile');
  var menuEl = document.querySelector('.nav-menu');

  var sess = await window.sb.auth.getSession();
  var user = sess && sess.data && sess.data.session && sess.data.session.user;

  // Anon branch — clear any stale Sign out (querySelectorAll, not
  // getElementById, because concurrent invocations can duplicate the id
  // and getElementById only ever returns the first match).
  if (!user) {
    document.querySelectorAll('#nav-signout, #nav-inbox').forEach(function (el) { el.remove(); });
    document.querySelectorAll('.nav-menu a.signout, .nav-menu a.inbox').forEach(function (el) { el.remove(); });
    signInEl.textContent = 'Sign in';
    signInEl.setAttribute('href', 'gunforma-signin.html');
    signInEl.style.cursor = '';
    signInEl.onclick = null;
    if (profileEl) profileEl.setAttribute('href', 'gunforma-signin.html');
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
  if (profileEl) profileEl.setAttribute('href', 'gunforma-profile.html');

  // Inbox — unread count from notifications (RLS scopes it to this user).
  // Fetched before the sweep for the same race reason as Sign out below.
  var unread = 0;
  try {
    var nres = await window.sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    unread = nres.count || 0;
  } catch (e) { /* table may not exist yet on a preview — the link still works */ }

  // Cleanup must happen HERE, after all awaits — updateNavAuth runs
  // concurrently on page load (the mount script calls it, and
  // onAuthStateChange fires INITIAL_SESSION which calls it again). If we
  // checked before the awaits, every concurrent caller would see an empty
  // DOM and each insert its own Sign out — you end up with a stack of
  // them. Sweeping right before insertion, with querySelectorAll (not
  // getElementById, which stops at the first match), is what keeps this
  // idempotent under the race.
  document.querySelectorAll('#nav-signout, #nav-inbox').forEach(function (el) { el.remove(); });
  document.querySelectorAll('.nav-menu a.signout, .nav-menu a.inbox').forEach(function (el) { el.remove(); });

  async function doSignOut(e) {
    e.preventDefault();
    await window.sb.auth.signOut();
    location.reload();
  }

  // Inbox, inline. Takes signInEl's className so it hides below 820px with
  // the username — the menu item further down is the mobile route in.
  var inbox = document.createElement('a');
  inbox.id = 'nav-inbox';
  inbox.href = 'gunforma-notifications.html';
  inbox.className = signInEl.className;
  inbox.textContent = unread ? 'Inbox (' + unread + ')' : 'Inbox';
  if (unread) inbox.style.color = '#4a9edd';
  signInEl.parentNode.insertBefore(inbox, signInEl);

  var signOut = document.createElement('a');
  signOut.id = 'nav-signout';
  signOut.href = '#';
  // Matches whichever nav-btn styling the page has. That className now also
  // carries nav-signin-inline, so this button hides below 820px along with the
  // username — on mobile the menu item below is the way out.
  signOut.className = signInEl.className;
  signOut.textContent = 'Sign out';
  signOut.onclick = doSignOut;
  signInEl.parentNode.insertBefore(signOut, signInEl);

  // Mobile: Sign out is the one menu item that depends on the session, so it
  // is appended here rather than shipped in the static markup. Swept just
  // above, in the same idempotent pass as #nav-signout.
  if (menuEl) {
    // Inbox first, so the menu reads Builds / Parts / Armory / Inbox / Sign out.
    var menuInbox = document.createElement('a');
    menuInbox.className = 'inbox';
    menuInbox.href = 'gunforma-notifications.html';
    menuInbox.textContent = unread ? 'Inbox (' + unread + ')' : 'Inbox';
    if (unread) menuInbox.style.color = '#4a9edd';
    menuEl.appendChild(menuInbox);

    var menuSignOut = document.createElement('a');
    menuSignOut.className = 'signout';
    menuSignOut.href = '#';
    menuSignOut.textContent = 'Sign out';
    menuSignOut.onclick = doSignOut;
    menuEl.appendChild(menuSignOut);
  }
}
