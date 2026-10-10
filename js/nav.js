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
//                 Post-build is the only page still using it — the other
//                 auth-required workflow pages (admin-queue, complete-profile,
//                 claim) ship their own static navs and don't load nav.js.
//   auth-signin — logo + "Create account →"       (used on sign-in page)
//   auth-signup — logo + "Sign in instead →"      (used on sign-up page)
//
// The full variant is session-aware: when a user is signed in, the "Sign in"
// button is replaced with their username, a mail icon with the unread count
// is inserted beside it, and the three-line menu — shown at every width once
// signed in — gains My Builds, Saved Builds and Sign out. Refreshes on every
// auth-state change so multi-tab sign-outs propagate.
//
// It is also ROLE-aware. An admin gets Queue (/admin) and Post build
// (/admin-post) added to the bar and to the hamburger menu, because nothing
// on the site linked to either and an admin otherwise had to remember two
// URLs. Convenience only: requireAdmin() on those pages and is_admin()/RLS
// underneath it are what actually protect them, and neither is touched by
// any of this. The entries are built from scratch when the role says admin
// and REMOVED — not hidden — otherwise, so there is nothing in a
// non-admin's DOM to find.
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
  '</div>';

// Admin entries. Convenience only — /admin and /admin-post are protected by
// requireAdmin() on the page and by is_admin()/RLS underneath it, and nothing
// here changes either. This just means an admin does not have to remember two
// URLs that nothing on the site links to.
// The width below which a nav carrying admin entries collapses to the
// hamburger. One constant because it is needed in two places — the injected
// media query and wireNavToggle's resize handler — and a mismatch between
// them would leave an open menu at a width where it is still the only route
// to /admin. Measured on index.html with a username, Inbox, Sign out and the
// Post CTA all present: 1024px still wraps a button label onto two lines,
// 1100px does not.
//
// That measurement predates the mail icon: the bar it was taken on carried
// the word "Inbox" and a Sign out button, and today's is narrower (Sign out
// gone, an icon for the word, the three-line button added). So 1099 is
// conservative for today's bar, not tight. It has not been re-measured and
// lowered — do that against a real admin session, not by subtraction.
var ADMIN_COLLAPSE_AT = 1099;

// The account entries in the three-line menu, in order, ahead of Sign out.
var ACCOUNT_LINKS = [
  { href: 'gunforma-profile.html?tab=my-builds', label: 'My Builds' },
  { href: 'gunforma-profile.html?tab=saved',     label: 'Saved Builds' },
];

var ADMIN_LINKS = [
  { id: 'nav-admin-queue', href: '/admin',
    label: 'Queue',      title: 'Admin only — the build review queue' },
  { id: 'nav-admin-post',  href: '/admin-post',
    label: 'Post build', title: 'Admin only — post a build on a builder\'s behalf' },
];

// The nav's own CSS is copied into all sixteen pages that load this file, so
// a new nav class cannot be added there without adding it sixteen times —
// which is the drift CLAUDE.md keeps a list of. Injected once instead, the
// same way js/redact.js and js/photos.js carry theirs. Amber is already this
// codebase's admin colour (see .nav-admin-tag on the admin pages) and reads
// as privileged against a nav that is otherwise white and blue.
function ensureAdminNavStyles() {
  if (document.getElementById('nav-admin-styles')) return;
  var style = document.createElement('style');
  style.id = 'nav-admin-styles';
  style.textContent =
    '.nav-btn.nav-admin { color: #f9b860; border-color: #6b4a1e;' +
    '  background: rgba(249,184,96,0.08); white-space: nowrap; }' +
    '.nav-btn.nav-admin:hover { color: #ffd79a; border-color: #a87433;' +
    '  background: rgba(249,184,96,0.16); }' +
    // Two admin entries make the right-hand cluster about 150px wider than
    // a normal one, and that does not fit between the hamburger breakpoint
    // and ADMIN_COLLAPSE_AT: measured on index.html, the bar overflowed by
    // 127px at 840px and still wrapped a label onto two lines at 1024px,
    // with the labels already as short as they usefully get. So a nav
    // carrying admin entries collapses to the
    // hamburger earlier than one that is not — the menu group below is the
    // route in for that whole band, and nothing becomes unreachable. The
    // rules are the page's own ≤820px ones; they are repeated here because
    // the nav's CSS is copied into all sixteen pages that load this file and
    // this is the one copy that is not.
    '@media (max-width: ' + ADMIN_COLLAPSE_AT + 'px) {' +
    '  nav.nav-admin-on .nav-links { display: none; }' +
    '  nav.nav-admin-on .nav-signin-inline { display: none; }' +
    '  nav.nav-admin-on .nav-profile { display: flex; }' +
    '  nav.nav-admin-on .nav-toggle { display: block; }' +
    '  nav.nav-admin-on .nav-menu { position: absolute; top: 52px; left: 0; right: 0;' +
    '    background: #0e0f11; border-bottom: 0.5px solid #2a2b2e; flex-direction: column;' +
    '    padding: 8px 0; z-index: 99; }' +
    '  nav.nav-admin-on .nav-menu.open { display: flex; }' +
    '  nav.nav-admin-on .nav-menu a { padding: 13px 28px; font-size: 13px;' +
    '    letter-spacing: 0.06em; text-transform: uppercase; color: #ffffff;' +
    '    text-decoration: none; border-bottom: 0.5px solid #1a1b1e; }' +
    // Must come after, and out-specify, the rule right above it — that one
    // is (0,2,2) and would otherwise repaint the admin entries white in
    // exactly the band where the menu is the only way to reach them.
    '  nav.nav-admin-on .nav-menu a.admin { color: #f9b860; }' +
    '}' +
    // The admin colouring in the menu applies wherever the menu is shown —
    // the page's own ≤820px block and the ≤1023px one above.
    '.nav-menu .nav-menu-label { padding: 12px 28px 5px; font-size: 8.5px; font-weight: 700;' +
    '  letter-spacing: 0.14em; text-transform: uppercase; color: #f9b860;' +
    '  border-top: 0.5px solid #2a2b2e; }' +
    '.nav-menu a.admin { color: #f9b860; }';
  document.head.appendChild(style);
}

// The signed-in bar: a mail icon with the unread count where the word
// "Inbox" was, no Sign out button, and the three-line button shown at every
// width. Above the collapse width that button opens a small dropdown holding
// only the account entries (My Builds, Saved Builds, Sign out); below it the
// panel is the page's own full-width list, which carries those same entries
// after the site links.
//
// Injected for the same reason as the admin styles above: the nav's CSS is
// copied into every page that loads this file, and this is one copy.
//
// Only a nav marked .nav-authed gets any of it. Signed out there is nothing
// to put in a dropdown at full width — Builds and Parts Catalog are already
// on the bar — so the button stays hidden there exactly as before.
var INBOX_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"' +
  ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="5" width="18" height="14" rx="2"/>' +
    '<path d="M3.5 7.5l8.5 6 8.5-6"/>' +
  '</svg>';

function ensureAccountNavStyles() {
  if (document.getElementById('nav-account-styles')) return;

  // The dropdown rules, for one nav selector at one minimum width. Written
  // once and emitted twice because an admin nav collapses earlier: between
  // 821px and ADMIN_COLLAPSE_AT it is still the full-width list and still
  // the only route to the site links and the admin pages, so the dropdown —
  // which hides both — must not apply there.
  function dropdown(nav, minWidth) {
    return '@media (min-width: ' + minWidth + 'px) {' +
      nav + ' .nav-toggle { display: block; }' +
      nav + ' .nav-menu { position: absolute; top: 52px; right: 28px; min-width: 190px;' +
      '  background: #0e0f11; border: 0.5px solid #2a2b2e; border-top: 0;' +
      '  border-radius: 0 0 6px 6px; flex-direction: column; padding: 6px 0; z-index: 99;' +
      '  box-shadow: 0 10px 24px rgba(0,0,0,0.35); }' +
      nav + ' .nav-menu.open { display: flex; }' +
      nav + ' .nav-menu a { padding: 11px 18px; font-size: 12px; letter-spacing: 0.06em;' +
      '  text-transform: uppercase; color: #ffffff; text-decoration: none; white-space: nowrap; }' +
      nav + ' .nav-menu a:hover { background: #17181b; color: #4a9edd; }' +
      // Everything that is not an account entry is already on the bar at
      // this width: the site links, and for an admin the two admin links.
      nav + ' .nav-menu > :not(.acct) { display: none; }' +
    '}';
  }

  var style = document.createElement('style');
  style.id = 'nav-account-styles';
  style.textContent =
    '.nav-inbox { display: inline-flex; align-items: center; gap: 6px; color: #ffffff;' +
    '  text-decoration: none; font-size: 12px; font-weight: 600; line-height: 1;' +
    '  padding: 6px 2px; white-space: nowrap; }' +
    '.nav-inbox svg { width: 20px; height: 20px; display: block; flex-shrink: 0; }' +
    '.nav-inbox:hover, .nav-inbox.has-unread { color: #4a9edd; }' +
    '.nav-inbox-count { font-variant-numeric: tabular-nums; }' +
    // The icon is one more thing on the phone bar, and at 320px it was the
    // one that wrapped "+ Post your build" onto two lines (measured: fits at
    // 360px, wraps at 320px). The account icon is what gives way there — it
    // goes to the profile, and so do My Builds and Saved Builds in the menu.
    // .nav-right is in the selector to out-specify the admin block's own
    // `nav.nav-admin-on .nav-profile { display: flex }`.
    '@media (max-width: 350px) { nav.nav-authed .nav-right .nav-profile { display: none; } }' +
    dropdown('nav.nav-authed:not(.nav-admin-on)', 821) +
    dropdown('nav.nav-authed.nav-admin-on', ADMIN_COLLAPSE_AT + 1);
  document.head.appendChild(style);
}

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
    // The twelve pages that ship a static nav carry the hamburger in their own
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
    // like post-build that would blow away in-progress form state) and no
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
        '</div>' +
        '<div class="nav-right">' +
          '<a class="nav-btn nav-signin-inline" href="gunforma-signin.html" id="nav-signin">Sign in</a>' +
          '<a class="nav-btn cta" href="gunforma-post-build.html">+ Post your build</a>' +
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
  // account items as the session changes — a listener bound per link now
  // would miss them.
  menu.addEventListener('click', function (e) {
    if (e.target.closest('a')) close();
  });

  // Signed in, the same panel is a small dropdown at full width (see
  // ensureAccountNavStyles), and a dropdown that only its own button can
  // close reads as stuck. A click anywhere else and Escape both close it;
  // Escape hands focus back to the button it came from.
  document.addEventListener('click', function (e) {
    if (!menu.classList.contains('open')) return;
    if (e.target.closest('.nav-toggle') || e.target.closest('.nav-menu')) return;
    close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !menu.classList.contains('open')) return;
    close();
    toggle.focus();
  });

  // The panel is laid out two ways — the full-width list below the collapse
  // width, the dropdown above it — and an open one carried across that line
  // would reappear in the other layout. Closing it on the crossing, rather
  // than on every resize above the line, is what lets the dropdown survive a
  // window being nudged wider.
  function layout() {
    // An admin nav collapses from ADMIN_COLLAPSE_AT down, not 820px, so the
    // line moves with it.
    var collapseAt = document.querySelector('nav.nav-admin-on') ? ADMIN_COLLAPSE_AT : 820;
    return window.innerWidth > collapseAt ? 'wide' : 'narrow';
  }
  var lastLayout = layout();
  window.addEventListener('resize', function () {
    var now = layout();
    if (now === lastLayout) return;
    lastLayout = now;
    close();
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

  // Anon branch — clear anything a signed-in paint left behind
  // (querySelectorAll, not getElementById, because concurrent invocations can
  // duplicate the id and getElementById only ever returns the first match).
  if (!user) {
    document.querySelectorAll('#nav-inbox, #nav-admin-queue, #nav-admin-post')
      .forEach(function (el) { el.remove(); });
    // .admin rather than a.admin: the group's label is a div, and it has to
    // go with the links it labels.
    document.querySelectorAll('.nav-menu .acct, .nav-menu .admin')
      .forEach(function (el) { el.remove(); });
    // .nav-authed is what shows the three-line button at full width. Signed
    // out it must go, or the button would open a dropdown with nothing in it.
    document.querySelectorAll('nav.nav-admin-on, nav.nav-authed')
      .forEach(function (el) { el.classList.remove('nav-admin-on', 'nav-authed'); });
    signInEl.textContent = 'Sign in';
    signInEl.setAttribute('href', 'gunforma-signin.html');
    signInEl.style.cursor = '';
    signInEl.onclick = null;
    if (profileEl) profileEl.setAttribute('href', 'gunforma-signin.html');
    return;
  }

  // Signed-in state: username in place of Sign in, the inbox icon beside it,
  // and the account entries in the three-line menu.
  //
  // One RPC, not the old `from('profiles').select('username')` plus a second
  // read for the role. get_my_profile() already returns both, it is what
  // CLAUDE.md names as the way role is read, and it is the same call
  // gunforma-admin-post.html's requireAdmin() makes. `role` is deliberately
  // NOT in the column grants that `authenticated` holds on profiles, so a
  // direct read of it would come back empty rather than wrong — which is
  // exactly the sort of quiet nothing that is hard to notice in a nav.
  // Failure falls through to `profile = null`: email for the name, and not
  // an admin. Fails closed, which is the right direction even for something
  // that is only convenience.
  var profile = null;
  try {
    var res = await window.sb.rpc('get_my_profile').maybeSingle();
    profile = res.data;
  } catch (e) { /* nav degrades gracefully to email, and to non-admin */ }
  var displayName = (profile && profile.username) || user.email || 'Signed in';
  var isAdmin = !!(profile && profile.role === 'admin');
  signInEl.textContent = displayName;
  signInEl.setAttribute('href', 'gunforma-profile.html');
  signInEl.style.cursor = 'pointer';
  signInEl.onclick = null;
  if (profileEl) profileEl.setAttribute('href', 'gunforma-profile.html');

  // Inbox — unread count from notifications (RLS scopes it to this user).
  // Fetched before the sweep, for the race the sweep's own comment describes.
  var unread = 0;
  try {
    var nres = await window.sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    unread = nres.count || 0;
  } catch (e) { /* table may not exist yet on a preview — the link still works */ }

  // Cleanup must happen HERE, after all awaits — updateNavAuth runs
  // concurrently on page load (the mount script calls it, and
  // onAuthStateChange fires INITIAL_SESSION which calls it again). If we
  // checked before the awaits, every concurrent caller would see an empty
  // DOM and each insert its own entries — you end up with a stack of
  // them. Sweeping right before insertion, with querySelectorAll (not
  // getElementById, which stops at the first match), is what keeps this
  // idempotent under the race.
  document.querySelectorAll('#nav-inbox, #nav-admin-queue, #nav-admin-post')
    .forEach(function (el) { el.remove(); });
  document.querySelectorAll('.nav-menu .acct, .nav-menu .admin')
    .forEach(function (el) { el.remove(); });
  document.querySelectorAll('nav.nav-admin-on')
    .forEach(function (el) { el.classList.remove('nav-admin-on'); });

  // From here the bar is the signed-in one. The class is what the injected
  // styles key on; it is taken off again in the anon branch above.
  ensureAccountNavStyles();
  var authedNav = signInEl.closest('nav');
  if (authedNav) authedNav.classList.add('nav-authed');

  async function doSignOut(e) {
    e.preventDefault();
    await window.sb.auth.signOut();
    location.reload();
  }

  // Admin entries, inline. Inserted before the inbox icon so the bar reads
  //   Queue  Post build  [mail] n  <username>  + Post your build  [menu]
  // and the two privileged links sit together behind one label rather than
  // being mistaken for ordinary nav. They take signInEl's className so they
  // hide below 820px along with everything else in .nav-signin-inline; the
  // menu group further down is the mobile route in.
  //
  // Nothing is rendered at all unless isAdmin — there is no hidden copy, no
  // display:none entry, nothing in the DOM for a non-admin to find. That is
  // not the access control (requireAdmin() and RLS are), it just means the
  // markup does not claim something the server would refuse.
  if (isAdmin) {
    ensureAdminNavStyles();
    // Marks the nav as carrying admin entries, which is what the earlier
    // collapse breakpoint keys on. Removed again in both sweeps.
    var navRoot = signInEl.closest('nav');
    if (navRoot) navRoot.classList.add('nav-admin-on');

    // Amber is this codebase's admin colour — .nav-admin-tag on the admin
    // pages is the same treatment — so against a bar that is otherwise
    // white and blue these read as privileged at a glance. There is no
    // separate "Admin" pill inline: measured, it cost ~66px and pushed the
    // bar over the edge below 1100px. The word is carried by title and
    // aria-label instead, and the hamburger group spells it out in full.
    ADMIN_LINKS.forEach(function (link) {
      var a = document.createElement('a');
      a.id = link.id;
      a.href = link.href;
      a.className = signInEl.className + ' nav-admin';
      a.textContent = link.label;
      a.title = link.title;
      a.setAttribute('aria-label', link.title);
      signInEl.parentNode.insertBefore(a, signInEl);
    });
  }

  // Inbox, inline: a mail icon and the unread count, always showing a
  // number so the zero reads as "nothing waiting" rather than as a missing
  // badge. It deliberately does NOT take signInEl's className — that carries
  // .nav-signin-inline, which hides below 820px, and this stays on the bar
  // at every width. So the menu has no Inbox entry any more.
  //
  // The icon carries no words, so the name is on aria-label and title.
  // `unread` is a count from PostgREST, never user text, which is why it can
  // sit in innerHTML beside the icon's markup.
  var inbox = document.createElement('a');
  inbox.id = 'nav-inbox';
  inbox.href = 'gunforma-notifications.html';
  inbox.className = 'nav-inbox' + (unread ? ' has-unread' : '');
  var inboxLabel = unread ? 'Inbox, ' + unread + ' unread' : 'Inbox, nothing unread';
  inbox.title = inboxLabel;
  inbox.setAttribute('aria-label', inboxLabel);
  inbox.innerHTML = INBOX_ICON + '<span class="nav-inbox-count">' + Number(unread) + '</span>';
  signInEl.parentNode.insertBefore(inbox, signInEl);

  // There is no Sign out on the bar. It lives in the three-line menu with
  // the other account entries, at every width.
  //
  // The account entries depend on the session, so they are appended here
  // rather than shipped in the static markup, and swept just above in the
  // same idempotent pass as the rest. Every one carries .acct: above the
  // collapse width the dropdown shows .acct entries and nothing else.
  if (menuEl) {
    // Admin group first, under its own label: below 820px the inline entries
    // are hidden with .nav-signin-inline, so this is the only way in. Swept
    // in the same idempotent pass as the rest.
    if (isAdmin) {
      ensureAdminNavStyles();

      var menuLabel = document.createElement('div');
      menuLabel.className = 'nav-menu-label admin';
      menuLabel.textContent = 'Admin';
      menuEl.appendChild(menuLabel);

      ADMIN_LINKS.forEach(function (link) {
        var a = document.createElement('a');
        a.className = 'admin';
        a.href = link.href;
        a.textContent = link.label;
        menuEl.appendChild(a);
      });
    }

    // Then the account entries, so below the collapse width the menu reads
    // Builds / Parts Catalog / [Admin: Queue, Post build] /
    // My Builds / Saved Builds / Sign out
    // and above it, where the rest is on the bar, just the last three.
    // Both links open a tab of the signed-in user's own profile; ?tab= is
    // matched against a fixed list in gunforma-profile.html.
    ACCOUNT_LINKS.forEach(function (link) {
      var a = document.createElement('a');
      a.className = 'acct';
      a.href = link.href;
      a.textContent = link.label;
      menuEl.appendChild(a);
    });

    var menuSignOut = document.createElement('a');
    menuSignOut.className = 'acct signout';
    menuSignOut.href = '#';
    menuSignOut.textContent = 'Sign out';
    menuSignOut.onclick = doSignOut;
    menuEl.appendChild(menuSignOut);
  }
}
