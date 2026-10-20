// _pg.mjs — the ONE PostgREST reader for the HTML-emitting functions, and
// the ONE answer they give when PostgREST could not be read.
//
// THE RULE: a page is "not found" (404, or 410 for a build that is gone)
// ONLY when PostgREST positively answered with zero rows. A timeout, a
// network error, a non-2xx status, or a 2xx whose body is not the JSON array
// PostgREST always returns is NOT an answer about the row — it is an answer
// about the connection — and the function says 503 with Retry-After, which
// a crawler treats as "keep what you have and come back", the same way
// sitemap.mjs does.
//
// Why this needs a module and not four copies: each function used to hold
// its own `pgGet`, and each `fetchX()` then did
// `Array.isArray(rows) && rows.length ? rows[0] : null`. That line treats a
// 2xx carrying a non-array body — a proxy page, an HTML error served with the
// wrong status, a truncated response — exactly as "zero rows", and the
// function then said 404 (or, since #161, 410 Gone) for a page that exists.
// Google drops a 410 faster than a 404, so the cost of that mistake went up
// in the same PR. The array check lives HERE now, on the failure side.
//
// One retry, after a short pause, for the failures a second attempt can
// plausibly cure: a network error, an abort, a 5xx, a 429, a bad body. A 4xx
// other than 429 is a query bug (PGRST201 is the usual one) and the same
// request will fail the same way — it throws at once, and the caller still
// answers 503, because the row was not shown to be absent.
//
// A per-attempt timeout is attached so that one hung connection cannot eat
// the whole function budget before the retry gets its turn.

import { CDN_CACHE_NO_STORE } from './_cache.mjs';

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

export const PG_ATTEMPTS       = 2;     // one try, one retry
export const PG_TIMEOUT_MS     = 4000;  // per attempt
export const PG_RETRY_DELAY_MS = 200;
export const RETRY_AFTER_SECONDS = 60;

export class UpstreamError extends Error {
  constructor(message, { status = null, retryable = true, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'UpstreamError';
    this.status = status;        // HTTP status PostgREST answered, if it answered
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET /rest/v1/<path> with the anon key. Resolves to the JSON ARRAY PostgREST
// returned — possibly empty, which is the one and only "not found". Rejects
// with UpstreamError on everything else, after the retry.
export async function pgRows(path, { attempts = PG_ATTEMPTS, timeoutMs = PG_TIMEOUT_MS, retryDelayMs = PG_RETRY_DELAY_MS } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1 && retryDelayMs) await sleep(retryDelayMs);
    try {
      const res = await fetch(SB_URL + '/rest/v1/' + path, {
        headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        lastErr = new UpstreamError('PostgREST ' + res.status + ' for ' + path, { status: res.status, retryable });
        if (!retryable) break;
        continue;
      }
      let body;
      try {
        body = await res.json();
      } catch (e) {
        lastErr = new UpstreamError('PostgREST ' + res.status + ' with an unparseable body for ' + path, { status: res.status, cause: e });
        continue;
      }
      if (!Array.isArray(body)) {
        // PostgREST answers a collection GET with an array, always. Anything
        // else is not PostgREST talking — see the header.
        lastErr = new UpstreamError('PostgREST ' + res.status + ' with a non-array body for ' + path, { status: res.status });
        continue;
      }
      return body;
    } catch (e) {
      // fetch itself rejected: DNS, connection reset, abort on timeout.
      lastErr = new UpstreamError('fetch failed for ' + path + ': ' + (e && e.message || e), { cause: e });
    }
  }
  throw lastErr;
}

// The one 503. text/plain and no-store like sitemap.mjs; Retry-After so a
// crawler schedules the re-fetch instead of guessing.
export function unavailable() {
  return new Response('Temporarily unavailable — try again shortly.\n', {
    status: 503,
    headers: {
      'Content-Type':  'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // Said twice on purpose: Netlify reads the CDN-specific header when it
      // is present, and a 503 stored durably is an outage that outlives the
      // outage (_cache.mjs).
      'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE,
      'Retry-After':   String(RETRY_AFTER_SECONDS),
    },
  });
}
