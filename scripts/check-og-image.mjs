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
//   2. The DECODED BYTES are 1200x630. Not the declared width/height, the
//      actual image. If the CDN declines to upscale a small source, the
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
const WANT_W = 1200, WANT_H = 630;

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
  const img = (tag('og:image') || '').replace(/&amp;/g, '&');
  const w = tag('og:image:width'), h = tag('og:image:height'), alt = tag('og:image:alt');

  ok(!!img, '  og:image present');
  ok(img.startsWith(SITE + '/'), '  og:image is an absolute apex URL', img.slice(0, 60) + '…');
  ok(w === String(WANT_W) && h === String(WANT_H), '  og:image:width/height declared', `${w}x${h}`);
  ok(!!alt && alt.length > 3, '  og:image:alt present', alt);

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
  ok((res.headers.get('content-type') || '').startsWith('image/'), '  served as an image',
     res.headers.get('content-type'));

  if (res.status === 200) {
    const buf = Buffer.from(await res.arrayBuffer());
    const size = imageSize(buf);
    ok(!!size, '  bytes decode as an image', size ? `${size.w}x${size.h}` : 'unrecognised');
    if (size) {
      ok(size.w === WANT_W && size.h === WANT_H,
         '  ACTUAL pixels are 1200x630 — the declaration is not a lie',
         `${size.w}x${size.h}, ratio ${(size.w / size.h).toFixed(2)}`);
      ok(size.w >= 600, '  wide enough for the large card', size.w + 'px');
    }
    note('bytes', buf.length.toLocaleString());
  }
  console.log('');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
