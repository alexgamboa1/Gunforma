// _analytics — the Cloudflare Web Analytics beacon, ONE copy for every
// server-rendered page.
//
// Every function that emits an HTML document imports this and puts it
// immediately before </body>, which is where Cloudflare's docs place the
// manual snippet ("before the ending body tag"). The static pages carry the
// same tag as a literal — they have no build step to import it with — and
// scripts/check-analytics-snippet.mjs holds them to THIS string byte for
// byte, so the two cannot drift.
//
// WHERE IT IS DELIBERATELY ABSENT, and must stay absent:
//   - gunforma-admin-*.html — admin tools, not visitor traffic.
//   - auth-callback.html and gunforma-claim.html — both receive an
//     access_token in the URL hash. The current beacon strips the hash and
//     query string before sending (cleanLocation in beacon.min.js), but
//     that is a property of today's third-party script, not a guarantee;
//     a page carrying a credential in its URL gets no analytics at all.
//   - netlify/edge-functions/go.js — its only HTML is the "retailer link
//     no longer available" 404 on the click-tracking path.
//   - build-og.mjs / profile-og.mjs serve gunforma-build-detail.html /
//     gunforma-profile.html, which already carry the tag. Adding it there
//     too would load the beacon twice and count every /b/ and /u/ view
//     double. Those two functions use it only in documents they build
//     themselves (404, and the "page not bundled" fallback).
// The guard enforces all of the above.
//
// NON-PRODUCTION HOSTS: no host check is needed. Cloudflare accepts a
// beacon only from hostnames ending in the site's registered hostname, so
// deploy previews (*.netlify.app) are not recorded, and the production
// *.netlify.app mirrors 301 to the apex before any page renders.
//
// Paste exactly as Cloudflare issued it; do not reformat.
export const ANALYTICS_SNIPPET =
  `<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "81a104a53b724fdf87d30d3b963a1161"}'></script><!-- End Cloudflare Web Analytics -->`;
