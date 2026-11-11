// safe-next — where a sign-in may send the reader afterwards. ONE rule, read
// by every page that honours ?next=: gunforma-signin.html, gunforma-signup.html,
// gunforma-complete-profile.html and auth-callback.html. A plain <script>
// global, like js/site-url.js; auth-callback.html loads it on its own (it
// deliberately loads no shared client).
//
//   SafeNext.check(raw)        → a same-site path, or null
//   SafeNext.fromLocation()    → check(this page's ?next=)
//   SafeNext.withNext(href, next)   href with ?next= appended when next is set
//   SafeNext.ALLOWED_NEXT      the pages a sign-in may land on
//
// This is the only thing standing between ?next= and an open redirect, so
// it is an allowlist of PAGES, not a pattern of URLs. A value passes only
// when it is a bare page path — "/", "/x.html" or "x.html" — whose page is
// on the list, optionally followed by a query and a hash drawn from a small
// alphabet (letters, digits, - . _ ~ = & : in the query; letters, digits,
// - _ in the hash). That alphabet has no "/", "\", "%", whitespace or
// scheme separator in it, so nothing after the page can name a host or be
// decoded into one. Anything else — a scheme, "//", a backslash, an encoded
// slash, a host, an unlisted page — is null, and the caller does what it did
// before ?next= existed.
//
// The result always starts with exactly one "/" followed by a listed page,
// so location.href = result can only stay on this origin.
(function (global) {
  var ALLOWED_NEXT = [
    '/',
    '/gunforma-admin-queue.html',
    '/gunforma-admin-post.html',
    '/gunforma-post-build.html',
    '/gunforma-armory.html',
    '/gunforma-complete-profile.html',
    '/gunforma-profile.html',
  ];

  var SHAPE = /^(\/?)([a-z0-9-]+\.html)?(\?[A-Za-z0-9._~=&:-]*)?(#[A-Za-z0-9_-]*)?$/;

  // The ONE path family beside the page list: an Armory build's share page,
  // /l/<share_id> — exactly one segment of armory_share_id()'s alphabet,
  // nothing after it. "Save to my account" on one sends the reader to
  // sign-in and must land them back on that page to claim it. The alphabet
  // has no "/", "\", "%", "." or scheme characters, so nothing here can
  // name a host or traverse.
  var SHARE_SHAPE = /^\/l\/[a-z0-9]{6,12}$/;

  function check(raw) {
    if (typeof raw !== 'string' || !raw || raw.length > 256) return null;
    if (SHARE_SHAPE.test(raw)) return raw;
    var m = SHAPE.exec(raw);
    if (!m) return null;
    if (!m[1] && !m[2]) return null;              // a bare "?x" or "#x" names no page
    var path = '/' + (m[2] || '');
    if (ALLOWED_NEXT.indexOf(path) === -1) return null;
    return path + (m[3] || '') + (m[4] || '');
  }

  function fromLocation() {
    try { return check(new URLSearchParams(global.location.search).get('next')); } catch (e) { return null; }
  }

  function withNext(href, next) {
    var safe = check(next);
    if (!safe) return href;
    return href + (href.indexOf('?') === -1 ? '?' : '&') + 'next=' + encodeURIComponent(safe);
  }

  global.SafeNext = { ALLOWED_NEXT: ALLOWED_NEXT.slice(), check: check, fromLocation: fromLocation, withNext: withNext };
})(window);
