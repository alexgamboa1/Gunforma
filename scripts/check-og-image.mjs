#!/usr/bin/env node
// check-og-image.mjs — the share card's image, checked by reading bytes.
//
// WHAT WENT WRONG, AND WHY A LOOK IN A BROWSER WOULD NOT HAVE CAUGHT IT
// A build link rendered as a ~160px square thumbnail instead of the
// full-width card. Facebook, iMessage, Slack and LinkedIn choose the layout
// from the image's ACTUAL pixels — roughly 1.91:1 and >=600px wide gets the
// big card — and build photos come off phones and are mostly portrait. The
// page looked fine, the tags were present, and the card was still wrong.
//
// So this asserts the things that decide the layout, in the terms the
// scraper uses:
//
//   1. og:image returns 200 — an og:image that 404s for a crawler is worse
//      than a thumbnail, because it drops the card entirely.
//   2. The DECODED BYTES are the size the tags claim — OG_W x OG_H for a
//      transformed hero, og-default.png's own size when that is the card.
//      Not the declared width/height, the actual image. If the CDN declines
//      to upscale a small source, the
//      declaration becomes a lie and the card silently goes back to being
//      small.
//   3. og:image:width / og:image:height match those bytes.
//   4. It is fetchable with NO COOKIE and NO REFERER, which is how a crawler
//      asks. A transform that works in a signed-in browser tab and 403s for
//      facebookexternalhit is exactly this failure mode.
//
// Facebook's own Sharing Debugger is not used to test: its cache lies for
// days after a change. Read the bytes instead.
//
// PREVIEWS. og:image is an absolute https://gunforma.com URL — required, see
// the SEO invariants in CLAUDE.md — so on a deploy preview the tag points at
// PRODUCTION's image CDN. To test the preview's own transform the origin is
// swapped before fetching. That is the whole reason this script exists as a
// script rather than a curl.
//
//   node scripts/check-og-image.mjs https://deploy-preview-77--velvety-stardust-4de48f.netlify.app
//   node scripts/check-og-image.mjs https://gunforma.com
const origin = (process.argv[2] || process.env.DEPLOY_URL || '').replace(/\/$/, '');
if (!origin) { console.error('usage: node scripts/check-og-image.mjs <origin>'); process.exit(2); }

const SITE = 'https://gunforma.com';

// Imported, never hardcoded. A check carrying its own copy of the expected
// size goes red on correct output the day the size changes, and a check that
// cries wolf is a check somebody deletes. These are the same constants the
// function builds the transform and the meta tags from.
const { OG_W, OG_H, OG_DEFAULT_W, OG_DEFAULT_H } =
  await import('../netlify/functions/build-og.mjs');

let failures = 0;
const ok = (c, l, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d !== undefined && d !== '' ? `   [${d}]` : '')); if (!c) failures++; };
const note = (l, d) => console.log(`   ·  ${l}${d !== undefined ? ': ' + d : ''}`);

// Dimensions from the bytes. No dependency, matching the functions it checks.
function jpegSize(b) {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };     // PNG
  if (b[0] === 0xFF && b[1] === 0xD8) return jpegSize(b);                                          // JPEG
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') {               // WebP (VP8X/VP8L/VP8 )
    const fmt = b.slice(12, 16).toString();
    if (fmt === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xFFFFFF) + 1, h: (b.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
    if (fmt === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3FFF, h: b.readUInt16LE(28) & 0x3FFF };
  }
  return null;
}

const BUILDS = [
  ['portrait hero', '/b/p365-icarus-build-eb15adb8-6505-425c-9081-c264944a4761'],
  ['near-square hero', '/b/p365-all-day-9b68ab79-aa94-4446-8a25-8b3356b799fb'],
];

console.log(`checking share-card images on ${origin}\n`);

for (const [label, path] of BUILDS) {
  console.log(`── ${label}  ${path}`);
  const page = await fetch(origin + path);
  const html = await page.text();
  ok(page.status === 200, '  page returns 200', page.status);

  const tag = (prop) => (html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`)) || [])[1];
  // twitter:* are name=, not property=. A property-only reader is exactly how
  // twitter:image sat broken through every check this file already had.
  const nameTag = (n) => (html.match(new RegExp(`<meta name="${n}" content="([^"]*)"`)) || [])[1];
  const img = (tag('og:image') || '').replace(/&amp;/g, '&');
  const w = tag('og:image:width'), h = tag('og:image:height'), alt = tag('og:image:alt');
  const declaredType = tag('og:image:type');
  const twImg = (nameTag('twitter:image') || '').replace(/&amp;/g, '&');

  ok(!!img, '  og:image present');
  ok(img.startsWith(SITE + '/'), '  og:image is an absolute apex URL', img.slice(0, 60) + '…');
  // The declared size depends on WHICH image the card uses: a transformed
  // hero photo is OG_W x OG_H, og-default.png is its own 1200x630 and says
  // so. Both are legitimate; what is not legitimate is either one lying,
  // which the byte check below is what actually settles.
  const isDefault = /\/og-default\.png$/.test(img);
  const expectW = isDefault ? OG_DEFAULT_W : OG_W;
  const expectH = isDefault ? OG_DEFAULT_H : OG_H;
  if (isDefault) note('this build has no photo — card falls back to og-default.png');
  ok(w === String(expectW) && h === String(expectH),
     `  og:image:width/height declared`, `${w}x${h}, expected ${expectW}x${expectH}`);
  ok(!!alt && alt.length > 3, '  og:image:alt present', alt);

  // twitter:image shipped as the literal string "[object Object]" — the tag
  // was present, non-empty, and worthless. "present and non-empty" is not
  // the assertion; "is a URL, and that URL answers" is. Checked as its own
  // tag rather than assumed equal to og:image, because the bug was exactly
  // the two disagreeing.
  ok(/^https:\/\//.test(twImg), '  twitter:image is an https URL',
     twImg === '' ? '<missing>' : twImg.slice(0, 60) + (twImg.length > 60 ? '…' : ''));
  ok(twImg === img, '  twitter:image matches og:image');

  // Swap the origin so a preview tests ITS OWN transform, not production's.
  const fetchUrl = img.replace(SITE, origin);
  if (fetchUrl !== img) note('fetching from this origin instead of the apex', origin);

  // As a crawler asks: no cookie, no referer, no credentials. Node's fetch
  // sends none of those by default; `credentials: 'omit'` and the explicit
  // absence of Cookie/Referer headers make that a property of the test
  // rather than a default someone could change.
  const res = await fetch(fetchUrl, {
    redirect: 'follow',
    credentials: 'omit',
    headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
  });
  ok(res.status === 200, '  og:image returns 200 to an anonymous crawler', res.status);
  const servedType = (res.headers.get('content-type') || '').split(';')[0].trim();
  ok(servedType.startsWith('image/'), '  served as an image', servedType);

  // og:image:type against the bytes' own header, not against a constant.
  // The Image CDN content-negotiates on Accept unless the format is pinned,
  // so this also fails if fm=jpg is ever dropped from ogTransform — which is
  // the change that would quietly turn this declaration into a lie.
  ok(!!declaredType, '  og:image:type present', declaredType);
  ok(declaredType === servedType, '  og:image:type matches what the server sent',
     `declared ${declaredType}, served ${servedType}`);

  // The crawler that actually motivated this: it prefers the Twitter tags.
  // Only fetched when the tag parsed as a URL — a malformed tag has already
  // been reported above, and letting fetch() throw on it would replace four
  // legible FAIL lines with a stack trace, which reads as "the check is
  // broken" rather than "the page is broken". A guard must fail loudly and
  // still finish.
  if (/^https:\/\//.test(twImg)) {
    let twStatus;
    try {
      const twRes = await fetch(twImg.replace(SITE, origin), {
        redirect: 'follow', credentials: 'omit',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)' },
      });
      twStatus = twRes.status;
    } catch (e) {
      twStatus = 'fetch failed: ' + e.message;
    }
    ok(twStatus === 200, '  twitter:image returns 200 to an anonymous crawler', twStatus);
  }

  if (res.status === 200) {
    const buf = Buffer.from(await res.arrayBuffer());
    const size = imageSize(buf);
    ok(!!size, '  bytes decode as an image', size ? `${size.w}x${size.h}` : 'unrecognised');
    if (size) {
      ok(size.w === expectW && size.h === expectH,
         `  ACTUAL pixels are ${expectW}x${expectH} — the declaration is not a lie`,
         `${size.w}x${size.h}, ratio ${(size.w / size.h).toFixed(2)}`);
      ok(size.w >= 600, '  wide enough for the large card', size.w + 'px');
    }
    note('bytes', buf.length.toLocaleString());
  }
  console.log('');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
