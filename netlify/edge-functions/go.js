// go.js — /go/<affiliate_link_id> → 302 to the retailer, click logged behind it.
//         /go/part/<product_id>  → 302 to the part's own products.url, same.
// -----------------------------------------------------------------------------
// Every buy button on the site now points here instead of straight at the
// retailer. Nothing recorded a click before this; Awin's own report is the only
// number we have, and there is no way to hold it against anything.
//
// TWO SHAPES, ONE CONTRACT. The second shape exists because a part with no
// partner listing used to be a dead end ("No listing yet"), and 89 of 250
// live parts were one. It now links to the part's own products.url — usually
// the maker's store, sometimes a reseller — and the click is counted against
// the PRODUCT, because counted clicks to a maker are what we take to that
// maker when we ask for a partnership. Everything below the lookup is shared:
// the redirect is never delayed by logging, the two opt-in headers behave the
// same, and the 404 is the same real 404. The affiliate shape is the money
// path and its behaviour is unchanged by a byte.
//
// THE DESTINATION COMES FROM THE DATABASE, NEVER THE REQUEST. Both shapes
// resolve an id to a stored URL; nothing in the path or query is ever
// redirected to. The maker shape additionally refuses anything that is not
// http(s), since products.url is hand-entered.
//
// BEFORE THE link_clicks.product_id COLUMN EXISTS (supabase/
// link_clicks_product_id.sql), a maker click's insert fails with PGRST204 and
// the click goes uncounted — which is exactly how every other logging failure
// is treated here. x-go-debug: 1 reports it rather than guessing.
//
// AN EDGE FUNCTION, NOT A SERVERLESS ONE, AND THE REASON IS THE MONEY PATH.
// This sits between a reader and a purchase. A Netlify serverless function
// cannot respond-then-work, so the insert would sit in FRONT of the 302 and
// every buy click would pay for it. An edge function has context.waitUntil():
// the redirect goes out immediately and the insert finishes afterwards, on
// Netlify's clock rather than the reader's.
//
// THE INSERT MUST NEVER BLOCK OR DELAY THE REDIRECT. Not when Supabase is
// slow, not when the table is missing, not when the service key is unset.
// Everything about logging is wrapped so that the worst case is a click that
// goes through unlogged. An analytics table is not allowed to break buying —
// which is also why the lookup happens first and the log second.
//
// WHAT IT RECORDS: link id, timestamp, and the on-site path the click came
// from. No cookie, no user id, no IP, no full referrer — a path only, so it
// cannot carry a search term or a token. privacy-policy.html says so.
//
// UNKNOWN id AND RETIRED id ARE THE SAME BRANCH. The lookup carries
// retired_at=is.null, so a retired link returns zero rows exactly as an
// unknown id does, and both fall through to the 404 below. Neither redirects
// to the homepage: a buy link that quietly lands on the front page looks like
// the site working, and nobody would ever report it.
//
// The 404 is a real one — not a soft 404 — for the same reason build-og.mjs
// hard-404s an unresolvable build id.
//
// Diagnostics: x-go-log reports what happened to the LOGGING, never to the
// redirect. Netlify's plumbing has surprised this repo twice (see CLAUDE.md,
// "Netlify redirects"), so the parts that cannot be observed locally report
// themselves on the wire instead of being assumed. Its values: queued,
// skipped, debug, no-service-key, not-found.
//
// TWO OPT-IN REQUEST HEADERS, NEITHER REACHABLE BY A READER — a browser
// cannot attach a custom header to a top-level navigation:
//
//   x-go-no-log: 1   follow the link, write nothing  (our scripts use this).
//                    Answers x-go-key: ok | missing, because a request that
//                    writes nothing would otherwise never notice the service
//                    key had gone.
//   x-go-debug:  1   await the insert and report its status instead of
//                    guessing at it
//
// x-go-no-log wins when both are set.
const SB_URL  = "https://lagjjcpclvzrjlrswojt.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4";

// 8-4-4-4-12, anchored. Anything else 404s without a database round trip,
// which is also what keeps arbitrary path input out of the PostgREST query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors isHttpUrl in netlify/functions/_maker-link.mjs. Not imported: an
// edge function runs on Deno and must stay self-contained, the same reason it
// carries its own SB_URL.
function isHttpUrl(u) {
  try {
    const p = new URL(String(u)).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

function notFound() {
  return new Response(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
    '<meta name="robots" content="noindex"/>' +
    '<title>Link not found — Gunforma</title></head>' +
    '<body style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1a1a1a;">' +
    '<h1 style="font-size:1.25rem;margin:0 0 .5rem;">That retailer link is no longer available</h1>' +
    '<p style="color:#6b6b6b;line-height:1.6;margin:0 0 1.5rem;">It may have been retired since the page you came from was published.</p>' +
    '<p><a href="/parts" style="color:#2a7bbd;">Browse parts</a></p>' +
    "</body></html>",
    { status: 404, headers: { "content-type": "text/html; charset=UTF-8", "x-go-log": "not-found" } },
  );
}

export default async (request, context) => {
  const url = new URL(request.url);

  // The id is the LAST path segment on both shapes; the segment before it is
  // what tells them apart. /go/<id> has "go" there, /go/part/<id> has "part".
  // Anything else — /go/part, /go/x/y/<id> — is not a shape and 404s.
  const segs = url.pathname.replace(/\/+$/, "").split("/");
  const id = segs[segs.length - 1] || "";
  const kind = segs[segs.length - 2] || "";
  if (!UUID_RE.test(id)) return notFound();
  if (kind !== "go" && kind !== "part") return notFound();
  const isPart = kind === "part";

  let dest = null;
  try {
    if (isPart) {
      // is_discontinued=eq.false is this shape's retired_at: a discontinued
      // part returns zero rows exactly as an unknown id does. The product page
      // still renders one (so old builds keep their links), but a buy button
      // to a part that is no longer made is not a buy button.
      const res = await fetch(
        `${SB_URL}/rest/v1/products?select=url&is_discontinued=eq.false&id=eq.${encodeURIComponent(id)}&limit=1`,
        { headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` } },
      );
      if (res.ok) {
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        // Hand-entered column, so the scheme is checked: a value that is not
        // http(s) is a data error and 404s rather than being redirected to.
        // Same rule _maker-link.mjs applies before it draws the button.
        if (row && row.url && isHttpUrl(row.url)) dest = row.url;
      }
    } else {
      // retired_at=is.null is load-bearing: it is what makes a retired link
      // behave as an unknown one instead of still sending traffic to a
      // listing we have deliberately taken down.
      const res = await fetch(
        `${SB_URL}/rest/v1/affiliate_links?select=url,affiliate_url&retired_at=is.null&id=eq.${encodeURIComponent(id)}&limit=1`,
        { headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` } },
      );
      if (res.ok) {
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        // Same preference the buy rows used before this existed: the tracked
        // URL when there is one, the plain retailer URL otherwise.
        if (row) dest = row.affiliate_url || row.url || null;
      }
    }
  } catch {
    // Lookup failed at the network level. Fall through to 404 rather than
    // guessing a destination — sending a reader somewhere we did not resolve
    // is worse than telling them the link is gone.
  }
  if (!dest) return notFound();

  // ── The redirect is built and returned before anything is logged ──────────
  const out = Response.redirect(dest, 302);
  const headers = new Headers(out.headers);
  // Never cache: the destination can change under the same id when the sync
  // re-points a link, and a cached 302 would outlive that.
  headers.set("cache-control", "no-store, private");
  headers.set("referrer-policy", "no-referrer");

  // ── OUR OWN TOOLING FOLLOWS THE LINK WITHOUT LOGGING A CLICK ─────────────
  // x-go-no-log: 1 skips the insert. The redirect is byte-for-byte the one a
  // reader gets — same destination, same cache-control, same referrer-policy;
  // only x-go-log differs, and that header has never described the redirect.
  //
  // WHY IT HAS TO BE A HEADER THE CALLER SETS, AND NOT A FILTER WE APPLY.
  // On 2026-10-01, 493 rows landed between 23:25:13 and 23:25:22 — one per
  // live affiliate link, 54 a second, none with a referrer. That is a link
  // sweep, and it put 493 of the table's 537 rows beyond use for the Awin
  // attribution check. Nothing in this repo walks every link, so it was an
  // ad-hoc run from one of our own sessions.
  //
  // The obvious cleanup — drop rows with no referrer — is WRONG, and this is
  // the trap worth writing down. 24 of the 36 real clicks on 2026-09-30 also
  // have no referrer_path: a click from an app, from a client that strips the
  // header, or across an origin we do not match looks exactly like the sweep.
  // A missing referrer is not a bot signal. So the caller declares itself
  // rather than being inferred, which is the only version that cannot be
  // wrong about a real reader.
  //
  // NO READER CAN REACH THIS. A browser cannot attach a custom header to a
  // top-level navigation, so a click, a crawl and a prefetch all log exactly
  // as before. Someone could of course curl it themselves and suppress their
  // own row — the cost of that is one analytics row, which is not worth
  // defending against.
  //
  // It wins over x-go-debug on purpose: one says "tell me what the insert
  // did", the other says "do not insert", and the refusal is the stronger
  // instruction.
  // Read before the skip branch, so that branch can report it. Deno.env.get is
  // a map lookup with no side effects, so moving it up costs nothing.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (request.headers.get("x-go-no-log") === "1") {
    headers.set("x-go-log", "skipped");
    // x-go-key: the ONE thing a no-log request would otherwise stop telling
    // us. A normal click reports a missing key as x-go-log: no-service-key —
    // but the scheduled production check no longer makes a normal request, so
    // without this the key could be unset for weeks and the only symptom
    // would be a click table that quietly stopped growing. Nobody watches a
    // number for not going up.
    //
    // ok/missing, never the key or its length: this header is on a response
    // any caller can ask for, and "is it configured" is the whole question.
    // x-go-debug already reports the length to a caller that has opted into
    // the round trip.
    headers.set("x-go-key", serviceKey ? "ok" : "missing");
    return new Response(null, { status: 302, headers });
  }

  if (!serviceKey) {
    // The click is not logged, and that is a configuration problem, not a
    // reader-facing one. It is reported on the wire so it cannot be silent —
    // a logging layer that quietly records nothing is worse than none.
    headers.set("x-go-log", "no-service-key");
    return new Response(null, { status: 302, headers });
  }

  // referrer_path: the ON-SITE path only. Never the full referrer — that would
  // carry query strings, and a query string can carry a search term.
  let referrerPath = null;
  try {
    const ref = request.headers.get("referer");
    if (ref) {
      const r = new URL(ref);
      if (r.hostname === url.hostname) referrerPath = r.pathname.slice(0, 512);
    }
  } catch { /* unparseable referrer is simply not recorded */ }

  const insert = () => fetch(`${SB_URL}/rest/v1/link_clicks`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    // One target per row — link_id OR product_id, never both. The table's
    // check constraint (once link_clicks_product_id.sql is applied) refuses
    // anything else; before it is applied the product_id key is unknown to
    // PostgREST and the insert fails, which is the documented, harmless case.
    body: JSON.stringify(
      isPart
        ? { product_id: id, referrer_path: referrerPath }
        : { link_id: id, referrer_path: referrerPath },
    ),
  });

  // DEBUG PATH, request-header gated so no normal click can reach it.
  // "queued" says the insert was HANDED to waitUntil. It does not say the
  // insert worked, and the first real run proved the difference: the header
  // read queued and the table stayed empty, because the failure was swallowed.
  // That is this repo's own "a green result is not evidence" rule, reproduced
  // in the thing built to measure it.
  //
  // So there is a way to ask. x-go-debug: 1 AWAITS the insert and reports its
  // status and body instead of guessing. It costs the caller the round trip —
  // which is exactly why it is opt-in and why normal traffic never takes it.
  if (request.headers.get("x-go-debug") === "1") {
    let status = "no-response", body = "";
    try {
      const r = await insert();
      status = String(r.status);
      if (!r.ok) body = (await r.text()).slice(0, 220);
    } catch (e) {
      status = "threw";
      body = String((e && e.message) || e).slice(0, 220);
    }
    headers.set("x-go-log", "debug");
    headers.set("x-go-insert-status", status);
    if (body) headers.set("x-go-insert-body", body.replace(/[\r\n]+/g, " "));
    headers.set("x-go-key-len", String(serviceKey.length));
    return new Response(null, { status: 302, headers });
  }

  // waitUntil, not await: the response is already on its way out.
  if (context && typeof context.waitUntil === "function") {
    context.waitUntil(insert().catch(() => {}));
  }
  headers.set("x-go-log", "queued");
  return new Response(null, { status: 302, headers });
};

export const config = { path: "/go/*" };
