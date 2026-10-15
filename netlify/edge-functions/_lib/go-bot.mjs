// go-bot.mjs — what go.js records about the CLIENT of a /go/ click, so that
// link_clicks can tell a reader from a crawler.
// -----------------------------------------------------------------------------
// Pure: strings in, a plain object out. No fetch, no Deno, no Netlify. It is
// imported by netlify/edge-functions/go.js (Deno) and run under Node by
// scripts/go-bot.test.mjs, which is why it is an .mjs with no runtime calls.
//
// WHY IT LIVES IN A SUBDIRECTORY. Netlify treats every top-level file in
// netlify/edge-functions/ as an edge function and bundles it as one; a
// helper beside go.js would be deployed as a function with no handler. The
// bundler only looks inside a subdirectory for an index file or one named
// after the directory, so _lib/go-bot.mjs is a module and nothing else.
// (The serverless side, netlify/functions/_pg.mjs, has no such problem.)
//
// WHAT THE THREE FIELDS MEAN, and the one thing they must never mean:
//
//   user_agent  the User-Agent header, trimmed, at most 256 characters, null
//               when absent. Stored so the classification below can be
//               re-run later with a better pattern — a row's is_bot is what
//               the pattern said on the day, the user agent is the evidence.
//   sec_fetch   "<sec-fetch-mode>/<sec-fetch-user>", e.g. navigate/?1, null
//               when both are absent. A real click in a modern browser is a
//               user-initiated top-level navigation and says navigate/?1; a
//               script following the link says nothing, or something else.
//               Recorded, not judged: a reader on an older browser sends
//               neither header, so its absence sets nothing.
//   is_bot      true when the user agent is MISSING or matches BOT_RE. Both
//               the sweeps this exists for were missing one or wearing a
//               tool's. Otherwise false. NOTHING ELSE SETS IT — in particular
//               a missing referrer never does. 24 of the 36 real clicks on
//               2026-09-30 had no referrer_path, and go.js's comment on
//               x-go-no-log says why that must stay a non-signal.
//
// The pattern is a list of substrings, not a heuristic. Every one is the
// self-declared name of a crawler, an HTTP client or a link-preview fetcher.
// A browser that matched one by accident would have to carry a word no
// browser carries in its user agent; the human cases in the test are the
// real strings of the five browsers nearly every reader uses.
export const BOT_PATTERNS = [
  'bot', 'crawl', 'spider', 'slurp', 'headless', 'lighthouse', 'preview',
  'python', 'curl', 'wget', 'node-fetch', 'undici', 'axios', 'go-http',
  'java/', 'okhttp', 'libwww', 'screaming frog', 'ahrefs', 'semrush',
  'mj12', 'dotbot', 'petalbot', 'bytespider', 'gptbot', 'claudebot', 'ccbot',
  'facebookexternalhit', 'slackbot', 'discordbot', 'whatsapp', 'telegrambot',
  'twitterbot', 'linkedinbot', 'applebot', 'googlebot', 'bingbot', 'yandex',
  'duckduckbot', 'baiduspider',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
export const BOT_RE = new RegExp(BOT_PATTERNS.map(escapeRe).join('|'), 'i');

export const USER_AGENT_MAX = 256;

// A header value as stored: trimmed, bounded, null for absent or blank.
function clean(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

// userAgent: the raw header value or null. Missing counts as a bot: no
// browser omits it, and the clients that do are scripts.
export function isBot(userAgent) {
  const ua = clean(userAgent, 0);
  if (!ua) return true;
  return BOT_RE.test(ua);
}

export function secFetch(mode, user) {
  const m = clean(mode, 32);
  const u = clean(user, 32);
  if (!m && !u) return null;
  return `${m || ''}/${u || ''}`;
}

// headers: anything with .get(name) → string | null (a Headers object in
// Deno and in Node 18+). Returns exactly the three columns the insert sends.
export function clickMeta(headers) {
  const get = (n) => (headers && typeof headers.get === 'function' ? headers.get(n) : null);
  const ua = get('user-agent');
  return {
    user_agent: clean(ua, USER_AGENT_MAX),
    sec_fetch:  secFetch(get('sec-fetch-mode'), get('sec-fetch-user')),
    is_bot:     isBot(ua),
  };
}
