// _cache — the CDN cache directives for server-rendered pages, in one place.
// ─────────────────────────────────────────────────────────────────────────
// Measured on production 2026-10-20, before this file existed: every
// server-rendered page sent `Cache-Control: public, max-age=300,
// s-maxage=1800`, which Netlify's edge honoured per node ("Netlify Edge;
// hit") but never stored in the durable cache ("Netlify Durable;
// fwd=bypass"). Each edge node warmed separately, so a "warm" second hit on
// a hub was still a miss at 814 ms, and a cold hub, guide, part or build
// answered in 1.5–1.6 s — the Supabase round trips, paid again on every
// node and again every 30 minutes.
//
// `durable` is what fixes that: one shared cache in front of every node, so
// the first request anywhere fills it for everyone. s-maxage=3600 bounds
// how old a served page can be; stale-while-revalidate lets a request past
// that hour get the stale copy at once while the fresh one is fetched
// behind it, so a reader never pays the cold path.
//
// Only a successful 200 gets this. A 404, 410, 502 or 503 carries
// CDN_CACHE_NO_STORE: a not-found cached durably would keep saying not-found
// for an hour after the row appeared, and a 503 is by definition a thing to
// retry. Both constants are exported so a function cannot spell either one
// differently.
//
// Browser caching is unchanged (Cache-Control stays as each function set
// it). Netlify reads Netlify-CDN-Cache-Control for the CDN when present and
// strips it before the response leaves the edge.
//
// WHAT HOLDS FOR A LIVE BUILD. The review queue can correct, add and
// remove parts on a live build (CLAUDE.md, "A reviewer's part changes"),
// and that change must reach readers within an hour. With CDN_CACHE_PAGE
// the durable copy is fresh for at most 3600 s, so no reader sees a page
// older than an hour while it is fresh; the one request that arrives after
// the hour is served the stale copy and triggers the refetch, and every
// request after it gets the corrected page. Builds use CDN_CACHE_BUILD —
// the same hour, WITHOUT stale-while-revalidate — so even that one request
// goes to the origin and sees the correction. One cold hit per build per
// hour is the price, and it is the hour the brief allows.
export const CDN_CACHE_PAGE     = 'public, durable, s-maxage=3600, stale-while-revalidate=86400';
export const CDN_CACHE_BUILD    = 'public, durable, s-maxage=3600';
export const CDN_CACHE_NO_STORE = 'no-store';
