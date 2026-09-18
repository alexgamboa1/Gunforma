// canonical-host.js — keeps *.netlify.app hostnames out of the search index.
// -----------------------------------------------------------------------------
// gunforma.com is served by Netlify behind Cloudflare, but the same deploy is
// also reachable at velvety-stardust-4de48f.netlify.app and
// main--velvety-stardust-4de48f.netlify.app. Both returned 200 with
// byte-identical HTML and no canonical tag, which is a duplicate of the whole
// site competing with the apex.
//
// Netlify's redirect engine can't branch on Host (its `conditions` cover
// Country, Language, Role and Cookie only), so the host test has to happen in
// an edge function.
//
// Two different treatments, because the two cases want opposite things:
//
//   production netlify.app  → 301 to the same path on the apex. Nobody should
//                             be reading the site there, and a permanent
//                             redirect consolidates any link equity it picked up.
//
//   deploy preview / branch → served normally, with X-Robots-Tag: noindex.
//                             Redirecting these would defeat the entire point
//                             of a preview, so they stay browsable instead.
//
// The apex itself is never touched: it returns before anything else runs.
// -----------------------------------------------------------------------------

const CANONICAL_ORIGIN = "https://gunforma.com";

export default async (request, context) => {
  const host = (request.headers.get("host") || "").toLowerCase();

  // gunforma.com (and any future custom domain) passes straight through.
  // Returning no response continues the request chain to the origin.
  if (!host.endsWith(".netlify.app")) return;

  // The published production deploy — the indexable duplicate. Send it home,
  // preserving path and query so deep links survive the hop.
  if (context.deploy && context.deploy.context === "production") {
    const url = new URL(request.url);
    return Response.redirect(
      `${CANONICAL_ORIGIN}${url.pathname}${url.search}`,
      301
    );
  }

  // Deploy previews and branch deploys: keep them working, keep them unindexed.
  const response = await context.next();
  const out = new Response(response.body, response);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  return out;
};

export const config = { path: "/*" };
