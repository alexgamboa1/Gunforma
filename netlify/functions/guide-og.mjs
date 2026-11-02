// guide-og — /gg-og/<uuid>-<hash>.png, a Gun Guide's share image.
// ─────────────────────────────────────────────────────────────────────────
// The collage of claude/loadouts-spec.md §5, at the size every scraper gives
// the large card (1200x630, ~1.91:1 — CLAUDE.md, "SEO invariants": the card
// is chosen from the image's real pixels): a header band with the Gunforma
// logo (sized to read at ~500px wide, how iMessage and Reddit show it) and
// "GUN GUIDE" or "ARMORY BUILD"; under it the guide's parts in build
// order (BuildCategories.orderParts, the browser's own file —
// _build-categories.mjs), up to six tiles with a "+N" tile for the rest,
// and beside them the title, the model, the part count and "$X today" from
// the same priceTotal() the page prints. A part with no photo of its
// saved option draws as that option's colour swatch (_variant-swatch.mjs),
// never as another option's photo.
//
// THE URL CARRIES A HASH OF WHAT IT DRAWS (_guide-og.mjs): the /gg/ page
// names /gg-og/<uuid>-<hash>.png, this function rebuilds the model from live
// rows and, when the hash in the URL is not the current one, 301s to the
// one that is. So an edited guide gets a new image, an old share link still
// lands on one, and a durably cached image is right for its URL.
//
// NEVER A BROKEN SHARE CARD:
//   - a photo that will not load (an error status, a timeout, a body that is
//     not an image, one too big) draws as the part's swatch, and the
//     response is not cached durably, so the next request tries again;
//   - a failed read, a missing bundle file, a render that throws or decodes
//     to the wrong size serves og-default.png's own bytes (1200x630 PNG,
//     the size the page declared), uncached;
//   - zero rows for the uuid is a 404: the guide is gone, and so is its image.
//
// PHOTOS are maker URLs on other hosts. They are fetched here, server-side,
// with a per-photo timeout and a size cap, and embedded into the SVG; their
// hosts are NOT on the [images] allowlist, which stays scoped to the
// build-photos bucket. Only URLs from product_variants are fetched — never
// a URL a guide's snapshot carried (see partPicture()).
//
// RENDERING is @resvg/resvg-wasm (SVG → PNG, with our own font, no system
// fonts) and @jsquash/webp's decoder (resvg 2.6.2 draws a WebP as nothing;
// 149 of 864 live variant photos are WebP, so they are decoded here and
// re-encoded as PNG). Both are WebAssembly: the same bytes run on a laptop
// and on the function, which is what lets the build test the real renderer.
// Pinned in package.json; the .wasm files, the fonts (brand/fonts/, SIL OFL)
// and the wordmark ship through `included_files` in netlify.toml.
//
// Observable: x-gg-og (rendered | fallback | redirect), -reason on a
// fallback, -photos (loaded/asked), -hash.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { fetchGuide, fetchVariants, guideParts } from './_guide-data.mjs';
import { collageModel, collageHash, parseOgPath, ogImagePath, GG_OG_W, GG_OG_H } from './_guide-og.mjs';
import { loadBuildCategories } from './_build-categories.mjs';
import { CDN_CACHE_BUILD, CDN_CACHE_NO_STORE } from './_cache.mjs';

// ── tuning ───────────────────────────────────────────────────────────────
export const PHOTO_TIMEOUT_MS = 3500;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const PHOTO_MAX_PIXELS = 40e6;      // a decoded photo larger than this is refused, not decoded
const PHOTO_UA = 'Mozilla/5.0 (compatible; GunformaShareCard/1.0; +https://gunforma.com)';

const C = {
  bg: '#0e0f11', cream: '#f2efe8', blue: '#4a9edd', muted: '#a9a69e',
  tile: '#f7f6f2', tileEdge: '#2a2c31', moreBg: '#1b1d21',
  chipEdge: '#d8d5cd', ink: '#3a3833', inkMuted: '#7a766d',
};
const FONT_FAMILY = 'Barlow Condensed';

// Test seams, unset in production: beforeRender runs just before the render
// (the suite makes it throw to see the fallback); afterRender is handed the
// rendered RGBA pixels (the suite reads them to prove a WebP was DRAWN —
// resvg draws an undecodable image as nothing, and says nothing).
export const _hooks = { beforeRender: null, afterRender: null };

// ── bundled files ────────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const repoFile = (rel) => [rel, './' + rel, new URL('../../' + rel, import.meta.url)];
function moduleFile(spec, rel) {
  const out = [];
  try { out.push(require.resolve(spec)); } catch { /* bundled without node resolution */ }
  return out.concat(repoFile(rel));
}
async function readFirst(candidates) {
  for (const c of candidates) {
    try { return await readFile(c); } catch { /* next */ }
  }
  throw new Error('not in the bundle: ' + String(candidates[candidates.length - 1]));
}

let assetsPromise = null;
function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const [resvgWasm, webpWasm, bold, medium, logo] = await Promise.all([
        readFirst(moduleFile('@resvg/resvg-wasm/index_bg.wasm', 'node_modules/@resvg/resvg-wasm/index_bg.wasm')),
        readFirst(moduleFile('@jsquash/webp/codec/dec/webp_dec.wasm', 'node_modules/@jsquash/webp/codec/dec/webp_dec.wasm')),
        readFirst(repoFile('brand/fonts/BarlowCondensed-Bold.ttf')),
        readFirst(repoFile('brand/fonts/BarlowCondensed-Medium.ttf')),
        readFirst(repoFile('assets/gunforma-logo.png')),
      ]);
      await initWasm(resvgWasm);
      // The emscripten glue builds its result with ImageData, which Node
      // does not have.
      globalThis.ImageData ??= class ImageData {
        constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
      };
      const webp = await import('@jsquash/webp/decode.js');
      await webp.init(await WebAssembly.compile(webpWasm));
      return {
        decodeWebp: webp.default,
        font: { fontBuffers: [new Uint8Array(bold), new Uint8Array(medium)], loadSystemFonts: false,
                defaultFontFamily: FONT_FAMILY },
        logoUri: 'data:image/png;base64,' + logo.toString('base64'),
      };
    })();
    // A failed load is retried by the next request, not remembered.
    assetsPromise.catch(() => { assetsPromise = null; });
  }
  return assetsPromise;
}

let defaultPng = null;
async function loadDefaultPng() {
  if (!defaultPng) defaultPng = await readFirst(repoFile('og-default.png'));
  return defaultPng;
}

// ── image bytes ──────────────────────────────────────────────────────────
// What the bytes are and how big, from their own headers — never from a
// file extension or a Content-Type, which maker CDNs get wrong.
export function imageInfo(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
    return { type: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) {
        return { type: 'image/jpeg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  if (b.slice(0, 6).toString('latin1') === 'GIF87a' || b.slice(0, 6).toString('latin1') === 'GIF89a') {
    return { type: 'image/gif', w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  }
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') {
    const fmt = b.slice(12, 16).toString('latin1');
    if (fmt === 'VP8X') return { type: 'image/webp', w: (b.readUIntLE(24, 3) & 0xFFFFFF) + 1, h: (b.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
    if (fmt === 'VP8 ') return { type: 'image/webp', w: b.readUInt16LE(26) & 0x3FFF, h: b.readUInt16LE(28) & 0x3FFF };
    if (fmt === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { type: 'image/webp', w: (bits & 0x3FFF) + 1, h: ((bits >> 14) & 0x3FFF) + 1 };
    }
  }
  return null;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// RGBA pixels → PNG. Used for decoded WebP, and by the test for fixtures.
export function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// One photo → a data: URI resvg can draw, or a thrown Error saying why not.
// The timeout covers the body as well as the headers, and is a plain
// setTimeout, not AbortSignal.timeout(): on Node 20 that timer is unref'd,
// so a photo host that stalls could outlive the timer it was meant to obey.
async function fetchPhotoBytes(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('timed out after ' + PHOTO_TIMEOUT_MS + 'ms')), PHOTO_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'User-Agent': PHOTO_UA, Accept: 'image/png,image/jpeg,image/webp,image/gif;q=0.9,*/*;q=0.1' },
    });
    if (!res.ok) throw new Error('status ' + res.status);
    const declared = Number(res.headers.get('content-length'));
    if (declared > PHOTO_MAX_BYTES) throw new Error('too large: ' + declared);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > PHOTO_MAX_BYTES) throw new Error('too large: ' + buf.length);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function loadPhoto(url, assets) {
  const buf = await fetchPhotoBytes(url);
  const info = imageInfo(buf);
  if (!info || !(info.w > 0) || !(info.h > 0)) throw new Error('not an image we can draw');
  if (info.w * info.h > PHOTO_MAX_PIXELS) throw new Error('too many pixels: ' + info.w + 'x' + info.h);
  if (info.type === 'image/webp') {
    const img = await assets.decodeWebp(buf);
    return 'data:image/png;base64,' + encodePng(img.data, img.width, img.height).toString('base64');
  }
  return 'data:' + info.type + ';base64,' + buf.toString('base64');
}

// ── drawing ──────────────────────────────────────────────────────────────
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function measurer(font) {
  const cache = new Map();
  return (text, size, weight, spacing = 0) => {
    const key = size + '|' + weight + '|' + spacing + '|' + text;
    if (cache.has(key)) return cache.get(key);
    const r = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="400">' +
      '<text x="0" y="200" font-family="' + FONT_FAMILY + '" font-size="' + size + '" font-weight="' + weight + '"' +
      (spacing ? ' letter-spacing="' + spacing + '"' : '') + '>' + xml(text) + '</text></svg>', { font });
    const box = r.getBBox();
    const w = box ? box.width : 0;
    if (box) box.free();
    r.free();
    cache.set(key, w);
    return w;
  };
}

// Greedy word wrap into at most `maxLines`; the last line takes an ellipsis
// when words are left over. A single word wider than the line is cut.
function wrap(text, width, maxLines, measure) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    let line = words[i++];
    while (measure(line) > width && line.length > 1) line = line.slice(0, -1);
    while (i < words.length && measure(line + ' ' + words[i]) <= width) line += ' ' + words[i++];
    lines.push(line);
  }
  if (i < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && measure(last + '…') > width) last = last.replace(/\s*\S$/, '');
    lines[lines.length - 1] = last.replace(/[\s,;:–—-]+$/, '') + '…';
  }
  return { lines, fits: i >= words.length };
}

function swatchFill(sw, id) {
  const cs = sw.colors.length ? sw.colors : ['#f2f1ee'];
  if (sw.kind === 'split' && cs.length >= 2) {
    return { def: '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0.495" stop-color="' + cs[0] + '"/><stop offset="0.505" stop-color="' + cs[1] + '"/></linearGradient>',
      fill: 'url(#' + id + ')' };
  }
  if (sw.kind === 'iridescent' && cs.length >= 2) {
    return { def: '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      cs.map((c, k) => '<stop offset="' + (k / (cs.length - 1)).toFixed(3) + '" stop-color="' + c + '"/>').join('') +
      '</linearGradient>', fill: 'url(#' + id + ')' };
  }
  if (sw.kind === 'clear' && cs.length >= 2) {
    return { def: '<pattern id="' + id + '" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="6" height="12" fill="' + cs[0] + '"/><rect x="6" width="6" height="12" fill="' + cs[1] + '"/></pattern>',
      fill: 'url(#' + id + ')' };
  }
  return { def: '', fill: cs[0] };
}

// The header band: the Gunforma logo, left, at a height that still reads
// when the card is shown ~500px wide (iMessage, Reddit: 60px → 25px), and
// what kind of guide this is, right. A reader's Armory build says so here,
// so its author's title never reads as a Gunforma guide.
export function bandLabel(kind) {
  return kind === 'curated' ? 'GUN GUIDE' : 'ARMORY BUILD';
}
// The band label and the model line are the card's smallest text; 36px is
// 15px at 500px wide, the floor for reading them on a phone.
const SMALL_TEXT = 36;
const BAND = { h: 112, logoH: 60, labelSize: SMALL_TEXT };
const LOGO_RATIO = 1496 / 211;   // assets/gunforma-logo.png

// The tile grid below the band: 1 tile alone, up to 4 in two columns, 5–6
// in three. Left-aligned under the logo and centred vertically; the text
// column starts just right of it, so fewer tiles leave the title more room.
const GRID = { x: 40, y: BAND.h + 24, w: 600, h: GG_OG_H - BAND.h - 24 - 36, gap: 14 };
function gridSpan(n) {
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(n / cols));
  const size = Math.floor(Math.min((GRID.w - GRID.gap * (cols - 1)) / cols, (GRID.h - GRID.gap * (rows - 1)) / rows));
  const w = cols * size + GRID.gap * (cols - 1);
  const h = rows * size + GRID.gap * (rows - 1);
  return { cols, size, w, h, x0: GRID.x, y0: GRID.y + Math.round((GRID.h - h) / 2) };
}
export function gridFor(n) {
  const { cols, size, x0, y0 } = gridSpan(n);
  return (k) => ({ x: x0 + (k % cols) * (size + GRID.gap), y: y0 + Math.floor(k / cols) * (size + GRID.gap), size });
}

// The SVG for a model whose photos are already data: URIs (or null).
export function collageSvg(model, photos, assets, measure) {
  const defs = [];
  const body = [];
  const n = model.tiles.length + (model.more > 0 ? 1 : 0);
  const at = gridFor(n);

  model.tiles.forEach((t, k) => {
    const { x, y, size } = at(k);
    const r = Math.round(size * 0.06);
    const uri = photos[k];
    if (uri) {
      const pad = Math.round(size * 0.07);
      body.push('<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" rx="' + r + '" fill="' + C.tile + '"/>');
      body.push('<image x="' + (x + pad) + '" y="' + (y + pad) + '" width="' + (size - 2 * pad) + '" height="' + (size - 2 * pad) +
        '" preserveAspectRatio="xMidYMid meet" href="' + uri + '"/>');
    } else {
      // No photo of this option, or it would not load: its colour, as the
      // page draws it.
      const sw = t.swatch || { kind: 'unknown', colors: ['#f2f1ee'] };
      const f = swatchFill(sw, 'sw' + k);
      if (f.def) defs.push(f.def);
      const chip = Math.round(size * 0.46);
      const cx = x + (size - chip) / 2, cy = y + size * 0.16;
      body.push('<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" rx="' + r + '" fill="' + C.tile + '"/>');
      body.push('<rect x="' + cx + '" y="' + cy + '" width="' + chip + '" height="' + chip + '" rx="' + Math.round(chip * 0.12) +
        '" fill="' + f.fill + '" stroke="' + C.chipEdge + '" stroke-width="2"/>');
      const words = [
        { text: String(t.label || 'Part').toUpperCase(), size: Math.round(size * 0.075), weight: 700, fill: C.ink, spacing: 1.5 },
        ...(t.color ? [{ text: t.color, size: Math.round(size * 0.075), weight: 500, fill: C.inkMuted, spacing: 0 }] : []),
      ];
      let ty = cy + chip + size * 0.12;
      for (const w of words) {
        let s = w.text;
        while (s.length > 1 && measure(s, w.size, w.weight, w.spacing) > size * 0.86) s = s.slice(0, -2) + '…';
        body.push('<text x="' + (x + size / 2) + '" y="' + ty + '" text-anchor="middle" font-family="' + FONT_FAMILY +
          '" font-weight="' + w.weight + '" font-size="' + w.size + '"' + (w.spacing ? ' letter-spacing="' + w.spacing + '"' : '') +
          ' fill="' + w.fill + '">' + xml(s) + '</text>');
        ty += w.size * 1.25;
      }
    }
  });

  if (model.more > 0) {
    const { x, y, size } = at(model.tiles.length);
    const r = Math.round(size * 0.06);
    body.push('<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" rx="' + r + '" fill="' + C.moreBg +
      '" stroke="' + C.tileEdge + '" stroke-width="2"/>');
    body.push('<text x="' + (x + size / 2) + '" y="' + (y + size * 0.55) + '" text-anchor="middle" font-family="' + FONT_FAMILY +
      '" font-weight="700" font-size="' + Math.round(size * 0.34) + '" fill="' + C.cream + '">+' + model.more + '</text>');
    body.push('<text x="' + (x + size / 2) + '" y="' + (y + size * 0.74) + '" text-anchor="middle" font-family="' + FONT_FAMILY +
      '" font-weight="500" font-size="' + Math.round(size * 0.11) + '" fill="' + C.muted + '">more ' +
      (model.more === 1 ? 'part' : 'parts') + '</text>');
  }

  const span = gridSpan(n);
  if (n === 0) {
    span.w = GRID.h;
    body.push('<rect x="' + GRID.x + '" y="' + GRID.y + '" width="' + span.w + '" height="' + GRID.h + '" rx="24" fill="' + C.moreBg + '"/>');
    body.push('<text x="' + (GRID.x + span.w / 2) + '" y="' + (GRID.y + GRID.h / 2 + 14) + '" text-anchor="middle" font-family="' +
      FONT_FAMILY + '" font-weight="500" font-size="40" fill="' + C.muted + '">No parts yet</text>');
  }

  // The header band.
  const LH = BAND.logoH, LW = Math.round(LH * LOGO_RATIO);
  body.push('<image x="' + GRID.x + '" y="' + Math.round((BAND.h - LH) / 2) + '" width="' + LW + '" height="' + LH +
    '" href="' + assets.logoUri + '"/>');
  const label = bandLabel(model.kind);
  body.push('<text x="' + (GG_OG_W - 40) + '" y="' + Math.round(BAND.h / 2 + BAND.labelSize * 0.36) + '" text-anchor="end" font-family="' +
    FONT_FAMILY + '" font-weight="500" font-size="' + BAND.labelSize + '" letter-spacing="4" fill="' + C.muted + '">' + label + '</text>');
  body.push('<rect x="' + GRID.x + '" y="' + BAND.h + '" width="' + (GG_OG_W - 2 * GRID.x) + '" height="2" fill="' + C.tileEdge + '"/>');

  // The text column, beside the grid. The title is the largest text on the
  // card.
  const TX = GRID.x + span.w + 44, TW = GG_OG_W - TX - 40;
  let titleSize = 62, title = wrap(model.title, TW, 3, (s) => measure(s, 62, 700));
  if (!title.fits) {
    titleSize = 52;
    title = wrap(model.title, TW, 4, (s) => measure(s, 52, 700));
  }
  const titleLead = Math.round(titleSize * 1.04);
  const stats = model.count + (model.count === 1 ? ' part' : ' parts') + (model.total ? '  ·  ' + model.total + ' today' : '');
  let modelLine = model.model;
  while (modelLine.length > 1 && measure(modelLine, SMALL_TEXT, 500) > TW) modelLine = modelLine.slice(0, -2) + '…';
  let statsSize = 38;
  while (statsSize > SMALL_TEXT && measure(stats, statsSize, 700) > TW) statsSize -= 2;

  // Centred in the space under the band. Baselines: the first title line
  // sits one cap height below the block's top.
  const blockH = Math.round(titleSize * 0.74) + (title.lines.length - 1) * titleLead + 22 + SMALL_TEXT + 18 + statsSize;
  let y = GRID.y + Math.round((GRID.h - blockH) / 2) + Math.round(titleSize * 0.74) - titleLead;
  for (const line of title.lines) {
    y += titleLead;
    body.push('<text x="' + TX + '" y="' + y + '" font-family="' + FONT_FAMILY + '" font-weight="700" font-size="' + titleSize +
      '" fill="' + C.cream + '">' + xml(line) + '</text>');
  }
  y += 22 + SMALL_TEXT;
  body.push('<text x="' + TX + '" y="' + y + '" font-family="' + FONT_FAMILY + '" font-weight="500" font-size="' + SMALL_TEXT + '" fill="' + C.muted + '">' +
    xml(modelLine) + '</text>');
  y += 18 + statsSize;
  body.push('<text x="' + TX + '" y="' + y + '" font-family="' + FONT_FAMILY + '" font-weight="700" font-size="' + statsSize + '" fill="' + C.cream + '">' +
    xml(stats) + '</text>');

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + GG_OG_W + '" height="' + GG_OG_H + '" viewBox="0 0 ' + GG_OG_W + ' ' + GG_OG_H + '">' +
    (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') +
    '<rect width="' + GG_OG_W + '" height="' + GG_OG_H + '" fill="' + C.bg + '"/>' + body.join('') + '</svg>';
}

// model → { png, loaded, asked }. Photos are fetched in parallel; each one
// that fails is logged and drawn as its swatch.
export async function renderCollage(model) {
  const assets = await loadAssets();
  const asked = model.tiles.filter((t) => t.photo).length;
  const photos = await Promise.all(model.tiles.map(async (t) => {
    if (!t.photo) return null;
    try { return await loadPhoto(t.photo, assets); }
    catch (e) { console.error('[guide-og] photo skipped', t.photo, e && e.message); return null; }
  }));
  const loaded = photos.filter(Boolean).length;
  if (_hooks.beforeRender) _hooks.beforeRender(model);
  const svg = collageSvg(model, photos, assets, measurer(assets.font));
  const resvg = new Resvg(svg, { font: assets.font, fitTo: { mode: 'original' } });
  const img = resvg.render();
  if (_hooks.afterRender) _hooks.afterRender(img.pixels, model);
  const png = Buffer.from(img.asPng());
  img.free(); resvg.free();
  const info = imageInfo(png);
  // Never serve a size the page did not declare.
  if (!info || info.w !== GG_OG_W || info.h !== GG_OG_H) {
    throw new Error('rendered ' + (info ? info.w + 'x' + info.h : 'unreadable') + ', expected ' + GG_OG_W + 'x' + GG_OG_H);
  }
  return { png, loaded, asked };
}

// ── responses ────────────────────────────────────────────────────────────
function extractPath(req) {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/gg-og/')) return url.pathname;
  const splat = url.searchParams.get('p');   // what `netlify dev` substitutes
  return splat === null ? null : '/gg-og/' + splat.replace(/^\/+/, '');
}

function notFound() {
  return new Response('Not found\n', { status: 404, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60',
    'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE, 'x-gg-og': 'not-found' } });
}

// og-default.png's own bytes — the card the page would have named, at the
// size it declared. Uncached at the CDN, so the next request renders.
async function fallback(reason, err) {
  console.error('[guide-og] serving og-default.png:', reason, err || '');
  const headers = { 'Cache-Control': 'public, max-age=300', 'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE,
                    'x-gg-og': 'fallback', 'x-gg-og-reason': reason };
  try {
    return new Response(await loadDefaultPng(), { status: 200, headers: { ...headers, 'Content-Type': 'image/png' } });
  } catch {
    return new Response(null, { status: 302, headers: { ...headers, Location: '/og-default.png' } });
  }
}

export default async (req) => {
  const parsed = parseOgPath(extractPath(req));
  if (!parsed) return notFound();

  let found, variants;
  try {
    found = await fetchGuide(parsed.id);
    if (!found) return notFound();   // zero rows from both tables: the guide is gone
    variants = await fetchVariants(guideParts(found.row));
  } catch (err) {
    return fallback('read-failed', err);
  }

  let model, hash;
  try {
    const BuildCategories = await loadBuildCategories();
    if (!BuildCategories) return fallback('no-taxonomy');
    model = collageModel({ kind: found.kind, row: found.row, variants }, BuildCategories);
    hash = collageHash(model);
  } catch (err) {
    return fallback('model-failed', err);
  }

  if (parsed.hash !== hash) {
    return new Response(null, { status: 301, headers: {
      Location: ogImagePath(parsed.id, hash),
      'Cache-Control': 'public, max-age=60', 'Netlify-CDN-Cache-Control': CDN_CACHE_NO_STORE,
      'x-gg-og': 'redirect', 'x-gg-og-hash': hash } });
  }

  let out;
  try {
    out = await renderCollage(model);
  } catch (err) {
    return fallback('render-failed', err);
  }
  const complete = out.loaded === out.asked;
  return new Response(out.png, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
      // The page's own promise (_cache.mjs, CDN_CACHE_BUILD): an hour, no
      // stale-while-revalidate, so a taken-down guide's image goes with its
      // page. A collage missing a photo is not stored at all — the next
      // request tries the photo again.
      'Netlify-CDN-Cache-Control': complete ? CDN_CACHE_BUILD : CDN_CACHE_NO_STORE,
      'x-gg-og': 'rendered',
      'x-gg-og-photos': out.loaded + '/' + out.asked,
      'x-gg-og-hash': hash,
    },
  });
};
