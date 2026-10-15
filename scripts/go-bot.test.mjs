// Runs netlify/edge-functions/_lib/go-bot.mjs — the classifier go.js uses to
// set link_clicks.is_bot — over real user-agent strings, and fails the deploy
// if a reader's browser is called a bot or a tool is called a reader.
//
// WHY THIS IS A BUILD GUARD. A wrong verdict renders perfectly: the 302 goes
// out, the row lands, and the only symptom is a number in link_clicks_real
// that is quietly wrong in one direction — which is the number partnership
// decisions are made off. Nobody would see it until a maker asked why the
// clicks we reported did not match theirs.
//
// The human strings are the five browsers nearly every reader uses, as they
// identify themselves today. The bot strings are the clients behind the two
// sweeps this exists for, plus the crawlers and preview fetchers that follow
// links. Change BOT_PATTERNS, re-run this; do not loosen a case to make a
// pattern fit.
//
// Run: node --test scripts/go-bot.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { isBot, secFetch, clickMeta, BOT_PATTERNS, USER_AGENT_MAX } =
  await import(join(ROOT, 'netlify/edge-functions/_lib/go-bot.mjs'));

const HUMAN = [
  ['Chrome 130 on Windows',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'],
  ['Safari on iOS 17',
   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
  ['Firefox 131 on Windows',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'],
  ['Edge 130 on Windows',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'],
  ['Samsung Internet 26 on Android',
   'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36'],
  ['Chrome 130 on macOS',
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'],
  ['Chrome on Android',
   'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'],
];

const BOT = [
  ['curl',                'curl/8.7.1'],
  ['python-requests',     'python-requests/2.32.3'],
  ['Googlebot',           'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['Googlebot smartphone','Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['Screaming Frog',      'Screaming Frog SEO Spider/20.0'],
  ['HeadlessChrome',      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36'],
  ['facebookexternalhit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['Bingbot',             'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36'],
  ['AhrefsBot',           'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
  ['Slackbot link expander', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
  ['node undici',         'undici'],
  ['wget',                'Wget/1.21.4'],
  ['Go http client',      'Go-http-client/2.0'],
  ['Java',                'Java/17.0.9'],
  ['empty string',        ''],
  ['whitespace only',     '   '],
  ['absent',              null],
];

test('every real browser is a reader', () => {
  for (const [label, ua] of HUMAN) {
    assert.equal(isBot(ua), false, `${label} was called a bot: ${ua}`);
  }
});

test('every tool, crawler and preview fetcher is a bot — and so is no user agent at all', () => {
  for (const [label, ua] of BOT) {
    assert.equal(isBot(ua), true, `${label} was called a reader: ${JSON.stringify(ua)}`);
  }
});

test('the pattern is matched case-insensitively', () => {
  assert.equal(isBot('CURL/8'), true);
  assert.equal(isBot('GoogleBot'), true);
});

test('a missing referrer is NOT a bot signal — nothing but the user agent decides', () => {
  // clickMeta sees only the headers it reads; a request with a browser user
  // agent and no referer, no sec-fetch headers, is a reader.
  const h = new Headers({ 'user-agent': HUMAN[0][1] });
  const m = clickMeta(h);
  assert.equal(m.is_bot, false);
  assert.equal(m.sec_fetch, null);
  assert.equal(m.user_agent, HUMAN[0][1]);
});

test('sec_fetch is mode/user, null only when both are absent', () => {
  assert.equal(secFetch('navigate', '?1'), 'navigate/?1');
  assert.equal(secFetch('navigate', null), 'navigate/');
  assert.equal(secFetch(null, '?1'), '/?1');
  assert.equal(secFetch(null, null), null);
  assert.equal(secFetch('', ''), null);
  const h = new Headers({ 'user-agent': HUMAN[1][1], 'sec-fetch-mode': 'navigate', 'sec-fetch-user': '?1' });
  assert.equal(clickMeta(h).sec_fetch, 'navigate/?1');
});

test('user_agent is trimmed, bounded to 256 characters, null when absent', () => {
  assert.equal(clickMeta(new Headers({ 'user-agent': '  curl/8  ' })).user_agent, 'curl/8');
  const long = 'Mozilla/5.0 ' + 'x'.repeat(600);
  const m = clickMeta(new Headers({ 'user-agent': long }));
  assert.equal(m.user_agent.length, USER_AGENT_MAX);
  assert.equal(m.is_bot, false, 'a long browser string is still a reader');
  assert.equal(clickMeta(new Headers({})).user_agent, null);
  assert.equal(clickMeta(new Headers({})).is_bot, true);
});

test('clickMeta returns exactly the three columns the insert sends', () => {
  assert.deepEqual(Object.keys(clickMeta(new Headers({}))).sort(), ['is_bot', 'sec_fetch', 'user_agent']);
});

test('the pattern list is the documented one', () => {
  for (const p of ['bot', 'curl', 'headless', 'screaming frog', 'facebookexternalhit', 'python', 'preview']) {
    assert.ok(BOT_PATTERNS.includes(p), `BOT_PATTERNS lost '${p}'`);
  }
});
