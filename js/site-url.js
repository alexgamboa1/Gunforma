// site-url.js — the origin that auth redirects should come back to.
// -----------------------------------------------------------------------------
// Supabase needs an absolute URL for OAuth `redirectTo`, `emailRedirectTo` and
// password-reset links. Hardcoding https://gunforma.com meant signing in on a
// Netlify deploy preview bounced you to production, so signed-in features
// could never be tested before merging.
//
// Three cases:
//
//   localhost          -> http://localhost:8794   (unchanged)
//   deploy preview     -> window.location.origin  (stay where you are)
//   everything else    -> https://gunforma.com
//
// The preview test is a STRICT full-string match, deliberately. A loose
// "ends with .netlify.app" check would also match the production mirrors
// (velvety-stardust-4de48f.netlify.app and main--velvety-stardust-4de48f
// .netlify.app), and those must keep redirecting to the apex — they are the
// duplicate hosts netlify/edge-functions/canonical-host.js 301s away for SEO.
// Sending real users' auth callbacks there would undo that.
//
// Every origin this returns must also be on Supabase's Redirect URL allowlist
// (Authentication -> URL Configuration). The preview wildcard registered there
// is:
//   https://deploy-preview-*--velvety-stardust-4de48f.netlify.app/**
// Site URL stays https://gunforma.com.
//
// Note this does NOT need adding to Google Cloud Console. In Supabase's OAuth
// flow, Google only ever redirects back to Supabase's own callback
// (https://<project-ref>.supabase.co/auth/v1/callback); Supabase then forwards
// to `redirectTo`, which it validates against its own allowlist. Google never
// sees this origin.
// -----------------------------------------------------------------------------
(function (global) {
  var LOCAL_ORIGIN      = 'http://localhost:8794';
  var PRODUCTION_ORIGIN = 'https://gunforma.com';

  // deploy-preview-<number>--velvety-stardust-4de48f.netlify.app — anchored at
  // both ends so nothing longer, shorter or lookalike can match.
  var PREVIEW_HOST_RE = /^deploy-preview-\d+--velvety-stardust-4de48f\.netlify\.app$/;

  function siteBaseUrl() {
    var host = global.location.hostname;
    if (host === 'localhost') return LOCAL_ORIGIN;
    if (PREVIEW_HOST_RE.test(host)) return global.location.origin;
    return PRODUCTION_ORIGIN;
  }

  global.siteBaseUrl = siteBaseUrl;
})(window);
