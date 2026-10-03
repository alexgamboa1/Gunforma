// js/redact.js — the pre-upload photo redaction modal.
//
// Shared, verbatim, by every page that uploads a build photo:
//   gunforma-post-build.html   — a builder posting their own build
//   gunforma-admin-post.html   — an admin posting on a builder's behalf
//
// Loaded as a plain <script src> global, the same way js/affiliate.js is —
// there is no bundler, so this file is the whole module. It owns its own
// markup and CSS and injects both on first use, rather than asking each
// page to carry a copy in its <style> and <body>: a second copy of any of
// the three is a copy that drifts.
//
// Public surface is one function:
//
//   window.openRedactModal(file) -> Promise<File | null>
//     File → user hit Done (with boxes) or Skip (returns the original file back)
//     null → user cancelled (Escape or clicked the backdrop)
//
// Call it after validating the file and before normalizing it, so nothing
// unredacted ever reaches normalizeImage/upload/preview.
(function () {
'use strict';

// ─── MARKUP + STYLES ──────────────────────────────────────────────────────
// Injected once, lazily, on the first openRedactModal call. Lazily because
// that is the first moment document.body is guaranteed to exist no matter
// where the page puts its <script> tag, and because a page that never
// uploads a photo should not pay for the DOM.
const REDACT_CSS = `
/* ===== REDACT MODAL — pre-upload photo redaction ===== */
/* Both pages that load this happen to set a global border-box reset, but
   the panel's width/padding maths needs one whether or not the host page
   provides it — so it is stated here rather than inherited by luck. */
.redact-overlay, .redact-overlay * { box-sizing: border-box; }
.redact-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(14, 15, 17, 0.88);
  display: none; align-items: center; justify-content: center;
  padding: 20px;
  /* No pinch-zoom of the PAGE from anywhere in the modal, while still
     allowing one- and two-finger panning (the canvas wrap scrolls). This
     is the standards-compliant half and is what Chrome/Android honour;
     Safari needs the gesture* handlers in openRedactModal as well. */
  touch-action: pan-x pan-y;
}
.redact-overlay.open { display: flex; }
.redact-panel {
  background: #fff; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  width: 100%; max-width: 1200px; height: calc(100vh - 40px);
  display: flex; flex-direction: column; overflow: hidden;
  /* Fixed height (not max-height) on purpose: the zoom code sizes the canvas
     from the wrap's client box, and that box has to be stable — a panel that
     shrinks to fit its content would make "fit to screen" chase itself. */
}
.redact-header {
  padding: 14px 18px; border-bottom: 0.5px solid #e5e5e5;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
}
.redact-title { font-size: 13px; font-weight: 700; color: #1a1a1a; letter-spacing: 0.04em; }
.redact-hint { font-size: 11px; color: #666; line-height: 1.5; }
.redact-hint strong { color: #1a1a1a; }
.redact-hint .short { display: none; }

.redact-canvas-wrap {
  flex: 1; min-height: 200px; background: #fafaf8;
  display: flex; align-items: flex-start; justify-content: flex-start;
  overflow: auto; padding: 16px; position: relative;
  /* Panning is native scrolling of this box. Centering is done with
     margin:auto on the canvas rather than align/justify center — flex
     centering of an overflowing child pushes its top-left corner out of
     reach of the scrollbars, so a zoomed-in photo could never be panned
     to its left edge. margin:auto centers when small, scrolls when big. */
}
.redact-canvas {
  display: block; margin: auto; flex: none;
  cursor: crosshair; touch-action: none;
  background: #efece5;
  border: 0.5px solid #e5e5e5;
  /* Display size is set inline by the zoom code (fit-to-wrap × zoom);
     the internal resolution stays at REDACT_MAX_DIMENSION regardless. */
}
.redact-canvas.brush { cursor: cell; }
.redact-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: #888; letter-spacing: 0.04em; background: #fafaf8;
}
/* Touch-only magnifier loupe. Positioned ~70px above the active touch by
   JS so it stays clear of the finger. Circular; samples from an offscreen
   copy of the ORIGINAL image (not the pixelated main canvas) so the user
   sees exactly where they're placing, not the redaction result. */
.redact-loupe {
  position: absolute;
  width: 120px; height: 120px;
  border-radius: 50%;
  background: #efece5;
  box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 0 0 2px #fff, 0 0 0 3px #d4a853;
  pointer-events: none;
  display: none;
  z-index: 2;
}
.redact-loupe.active { display: block; }

.redact-toolbar {
  padding: 12px 18px; border-top: 0.5px solid #e5e5e5; background: #fafaf8;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.redact-count {
  font-size: 11px; color: #666; margin-right: auto; padding: 6px 10px;
  background: #fff; border: 0.5px solid #e5e5e5; border-radius: 4px;
}
.redact-btn {
  font-family: inherit; font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
  padding: 8px 14px; border-radius: 4px; cursor: pointer; border: 0.5px solid;
  transition: filter 0.15s;
}
/* A plain group so the four actions can be given a row of their own on a
   phone. On a wide screen it behaves as the loose buttons did: one flex
   item after the count, which still pushes it right with margin-right. */
.redact-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.redact-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.redact-btn:not(:disabled):hover { filter: brightness(1.08); }
.redact-btn.ghost   { background: #fff; color: #444;      border-color: #d9d6cc; }
.redact-btn.skip    { background: transparent; color: #888; border-color: transparent; text-decoration: underline; }
.redact-btn.primary { background: #4a9edd; color: #fff;   border-color: #4a9edd; }
.redact-btn.primary:disabled { background: #d9e6f2; color: #6a97be; border-color: #d9e6f2; }

/* Tool segmented toggle — Brush (default) / Outline. Same visual pattern
   as an iOS-style segmented control; the active option gets the blue fill. */
.redact-shape-toggle { display: inline-flex; border: 0.5px solid #d9d6cc; border-radius: 4px; overflow: hidden; }
.redact-shape-toggle button {
  font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
  padding: 7px 12px; background: #fff; border: none; cursor: pointer; color: #666;
  border-right: 0.5px solid #d9d6cc; transition: background 0.15s, color 0.15s;
}
.redact-shape-toggle button:last-child { border-right: none; }
.redact-shape-toggle button:hover:not(.active) { background: #fafaf8; color: #1a1a1a; }
.redact-shape-toggle button.active { background: #4a9edd; color: #fff; }

/* Zoom cluster: − / percent / + / Fit. Percent is relative to fit-to-screen,
   so 100% always means "the whole photo is visible". */
.redact-zoom { display: inline-flex; align-items: center; border: 0.5px solid #d9d6cc; border-radius: 4px; overflow: hidden; background: #fff; }
.redact-zoom button {
  font-family: inherit; font-size: 13px; font-weight: 700; line-height: 1;
  width: 30px; height: 28px; background: #fff; border: none; cursor: pointer; color: #444;
}
.redact-zoom button:hover:not(:disabled) { background: #fafaf8; color: #1a1a1a; }
.redact-zoom button:disabled { opacity: 0.35; cursor: not-allowed; }
.redact-zoom button.fit { width: auto; padding: 0 9px; font-size: 11px; letter-spacing: 0.04em; border-left: 0.5px solid #d9d6cc; }
.redact-zoom-label { min-width: 44px; text-align: center; font-size: 11px; color: #666; font-variant-numeric: tabular-nums; }

@media (max-width: 640px) {
  .redact-overlay { padding: 0; }
  .redact-panel {
    max-width: none; border-radius: 0;
    height: 100vh;
    /* dvh tracks Safari's collapsing URL bar; vh does not, and stays on the
       tall value, which pushed the toolbar off the bottom of the screen.
       The vh line above is the fallback for browsers without dvh. */
    height: 100dvh;
  }
  .redact-header { padding: 10px 12px; }
  .redact-hint .long { display: none; }
  .redact-hint .short { display: inline; }
  .redact-canvas-wrap { padding: 8px; }
  /* Two rows on a phone — tools, then actions.

     Every control here is now at least 44px tall. The old ones were 26-37px,
     which is what let the toolbar be 112px at 390px, and it still wrapped
     the four action buttons across two rows of their own at 360px and ran
     to 158px. With a 44px floor the height is rows x 44 plus padding, so
     the only lever left on height is the number of rows: everything below
     is in service of keeping that at two. */
  /* The action row sat hard against the bottom of the screen, on top of the
     iPhone home indicator. That padding is what does the lifting: the site
     sets no \`viewport-fit=cover\` on any page, so env(safe-area-inset-*)
     resolves to 0 here and is carried only so this stays correct if the
     viewport meta is ever opted in. */
  .redact-toolbar {
    padding: 4px 10px calc(18px + env(safe-area-inset-bottom, 0px));
    column-gap: 6px;
    row-gap: 4px;
  }
  /* Row 1 — mode, then zoom pinned right. Horizontal padding comes down so
     the two clusters still fit side by side at 360px once the buttons are
     44px tall. */
  .redact-shape-toggle button { min-height: 44px; padding: 0 9px; }
  .redact-zoom { order: 1; margin-left: auto; }
  .redact-zoom button { width: 44px; height: 44px; font-size: 16px; }
  .redact-zoom button.fit { width: auto; min-width: 44px; padding: 0 8px; font-size: 11px; }
  /* The percent readout is the one thing here that is not a control, and
     it is what does not fit: with it, the mode toggle and the zoom cluster
     come to 356px and wrap onto separate rows at 375px and below. The
     photo itself shows how far in you are, and Fit is right there to go
     back, so the readout is what gives way rather than a tap target or a
     row. It is still written to (see applyZoom) and returns above 640px. */
  .redact-zoom-label { display: none; }
  /* The count lives in the Done label on a phone (see setCount) — one row
     of controls saved. */
  .redact-count { display: none; }
  /* Row 2 — the actions, always on a line of their own. That line is what
     buys "Skip — nothing to blur" the width it needs at 360px; sharing a
     row with the mode toggle is what forced it down to a bare "Skip".
     flex-wrap here is a safety net, not the plan: if a wide system font
     ever overflows the row it becomes two lines rather than pushing a
     control off the edge of the screen. */
  .redact-actions { order: 3; flex-basis: 100%; gap: 5px; }
  .redact-btn { min-height: 44px; padding: 0 8px; }
  /* "Skip" on its own does not tell anyone they are allowed to move on,
     which is the entire job of that button, so its label is the one that
     survives on a phone. "Clear all" gives up its "all" instead — the verb
     alone still reads. */
  .redact-btn .long { display: none; }
  #redact-skip { margin-left: auto; padding: 0 4px; font-size: 10.5px; }
  #redact-skip .long { display: inline; }
}
`;

const REDACT_HTML = `
<!-- REDACT MODAL — pre-upload pixelation of sensitive regions (serials, faces, addresses).
     Opened by openRedactModal(file) after validation, before normalizeImage(). Nothing
     unredacted ever reaches storage: the canvas here is the only place the file
     materializes before the same pipeline that always runs (normalize → upload). -->
<div class="redact-overlay" id="redact-overlay" role="dialog" aria-modal="true" aria-label="Blur sensitive parts of the photo">
  <div class="redact-panel">
    <div class="redact-header">
      <div>
        <div class="redact-title">Blur anything you want to hide before uploading</div>
        <div class="redact-hint" id="redact-hint"></div>
      </div>
    </div>
    <div class="redact-canvas-wrap" id="redact-canvas-wrap">
      <canvas class="redact-canvas" id="redact-canvas"></canvas>
      <canvas class="redact-loupe" id="redact-loupe" width="120" height="120"></canvas>
      <div class="redact-loading" id="redact-loading">Loading photo…</div>
    </div>
    <div class="redact-toolbar">
      <div class="redact-shape-toggle" role="group" aria-label="Blur tool">
        <button type="button" id="redact-shape-brush" class="active" aria-pressed="true"  title="Paint over an area (tap for a dot)">✎ Brush</button>
        <button type="button" id="redact-shape-poly"                 aria-pressed="false" title="Tap points around an area; everything inside is blurred">◇ Outline</button>
      </div>
      <div class="redact-zoom" role="group" aria-label="Zoom">
        <button type="button" id="redact-zoom-out" title="Zoom out (ctrl + scroll)" aria-label="Zoom out">−</button>
        <span class="redact-zoom-label" id="redact-zoom-label">100%</span>
        <button type="button" id="redact-zoom-in"  title="Zoom in (ctrl + scroll, or pinch)" aria-label="Zoom in">+</button>
        <button type="button" id="redact-zoom-fit" class="fit" title="Fit whole photo on screen">Fit</button>
      </div>
      <span class="redact-count" id="redact-count">0 blurred regions</span>
      <div class="redact-actions">
        <button type="button" class="redact-btn ghost"    id="redact-undo"  disabled>Undo</button>
        <button type="button" class="redact-btn ghost"    id="redact-clear" disabled>Clear<span class="long"> all</span></button>
        <button type="button" class="redact-btn skip"     id="redact-skip">Skip<span class="long"> — nothing to blur</span></button>
        <button type="button" class="redact-btn primary"  id="redact-done"  disabled>Done</button>
      </div>
    </div>
  </div>
</div>
`;

let mounted = false;
function mountRedactUI() {
  if (mounted) return;
  mounted = true;
  const style = document.createElement('style');
  style.id = 'redact-modal-styles';
  style.textContent = REDACT_CSS;
  document.head.appendChild(style);
  const host = document.createElement('div');
  host.innerHTML = REDACT_HTML;
  while (host.firstChild) document.body.appendChild(host.firstChild);
}

// ─── REDACTION ────────────────────────────────────────────────────────────
// Cap the working canvas at 2400px long edge — normalizeImage downsamples to
// 1600px right after, so full-resolution 12MP redaction is pointless per-pixel
// work. Pixelation is destructive (per-block averaging via getImageData /
// putImageData), so information in redacted regions is genuinely gone before
// the canvas produces a Blob — not a CSS/filter overlay.
const REDACT_MAX_DIMENSION = 2400;

// `mask`, when given, is RGBA data the size of the region (w×h): only pixels
// whose mask alpha is over half count towards a block's average, and only
// those pixels get it. Every pixel outside the mask is made fully
// transparent, so the region comes out as a cut-out of just the shape,
// ready to be drawn over the original (see pixelateShape).
function pixelateRegion(ctx, x, y, w, h, blockSize, mask) {
  // Clip to canvas bounds so a box dragged partially off-image doesn't throw.
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  x = Math.max(0, Math.min(x, cw - 1));
  y = Math.max(0, Math.min(y, ch - 1));
  w = Math.max(1, Math.min(w, cw - x));
  h = Math.max(1, Math.min(h, ch - y));

  const imgData = ctx.getImageData(x, y, w, h);
  const data = imgData.data;    // Uint8ClampedArray, RGBA per pixel
  for (let by = 0; by < h; by += blockSize) {
    for (let bx = 0; bx < w; bx += blockSize) {
      const bw = Math.min(blockSize, w - bx);
      const bh = Math.min(blockSize, h - by);
      // Average this block's RGB values (ignore alpha — for a JPEG source
      // alpha is always 255; for a PNG with transparency this preserves
      // whatever alpha was there per pixel rather than tinting the block).
      let rSum = 0, gSum = 0, bSum = 0, n = 0;
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const idx = ((by + py) * w + (bx + px)) * 4;
          if (mask && mask[idx + 3] <= 127) continue;
          rSum += data[idx];
          gSum += data[idx + 1];
          bSum += data[idx + 2];
          n++;
        }
      }
      if (n === 0) continue;                    // block lies wholly outside the shape
      const rAvg = (rSum / n) | 0, gAvg = (gSum / n) | 0, bAvg = (bSum / n) | 0;
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const idx = ((by + py) * w + (bx + px)) * 4;
          if (mask && mask[idx + 3] <= 127) continue;
          data[idx]     = rAvg;
          data[idx + 1] = gAvg;
          data[idx + 2] = bAvg;
          // data[idx+3] (alpha) intentionally untouched
        }
      }
    }
  }
  if (mask) {
    for (let i = 3; i < data.length; i += 4) if (mask[i] <= 127) data[i] = 0;
  }
  ctx.putImageData(imgData, x, y);
}

// Block size from a shape's smallest dimension. The rule is "at most ~2
// blocks across the narrow side": a serial number is only ~25px tall on a
// 2400px canvas, and an 8px block leaves it 3 rows of blocks with the digit
// strokes surviving as light/dark blocks — that read as blurred on screen and
// still lets a determined viewer count characters. Capped at 40 so a big
// face box doesn't turn into four giant squares.
function blockSizeFor(minDim) {
  return Math.max(8, Math.min(40, Math.round(minDim / 2)));
}

// A reusable scratch canvas for clipped redaction (see pixelateShape).
// One per modal session, resized per-shape as needed.
let _redactScratch = null;
let _redactMask = null;    // the shape's coverage, same size as the scratch

// Brush strokes are stored as the raw pointer samples. For clipping and
// outlining they are densified so consecutive points are never more than
// r/2 apart — a fast flick otherwise leaves gaps between the stamped circles.
function densifyStroke(pts, r) {
  const step = Math.max(1, r / 2);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) { out.push(p); continue; }
    const q = pts[i - 1];
    const dx = p.x - q.x, dy = p.y - q.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const n = Math.ceil(dist / step);
    for (let k = 1; k <= n; k++) out.push({ x: q.x + dx * k / n, y: q.y + dy * k / n });
  }
  return out;
}
// Union-of-circles path along a stroke. Each circle is its own subpath
// (moveTo before arc), so the arcs don't get joined by stray chords; the
// nonzero winding rule then treats the overlaps as one region.
function pathStroke(ctx, pts, r) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    ctx.moveTo(pts[i].x + r, pts[i].y);
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
  }
}

// Closed path through a polygon's vertices.
function pathPoly(ctx, pts) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
}
// How thick a polygon is across its narrow side, near enough: 2·area /
// perimeter. Exact for a long thin strip (a serial number outlined at an
// angle), and half the side for a square — which only makes the blocks
// finer on a shape big enough to hit the cap anyway. This is what sizes the
// pixelation blocks, and it has to be the strip's own thickness rather than
// its bounding box: a 25px-tall serial lying at 45° has a bounding box
// hundreds of px on both sides.
function polyThickness(pts) {
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    perim += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return perim > 0 ? Math.abs(polyArea2(pts)) / perim : 0;
}
// Twice the signed (shoelace) area.
function polyArea2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

// The shape that actually gets blurred for a set of outline points.
//
// Points tapped out of order make a polygon that crosses itself, and that is
// worse than it looks. Four corners of a serial tapped TL, TR, BL, BR give an
// hourglass: the two side wedges of the serial are outside it, so they are
// never blurred — and its signed area nearly cancels to zero, so
// polyThickness() collapses and the blocks drop to the 8px floor over the
// part that is. Measured on a tilted 25px serial: 62% of the glyph pixels
// came through untouched. A crossed outline is a mistake, never a shape
// anyone means, so it is replaced by its convex hull — the error goes towards
// blurring more, which is the only safe direction for this one.
function blurPoly(pts) {
  return polySelfIntersects(pts) ? convexHull(pts) : pts;
}
function polySelfIntersects(pts) {
  const n = pts.length;
  if (n < 4) return false;
  function orient(a, b, c) { return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)); }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;          // adjacent through the closing edge
      const c = pts[j], d = pts[(j + 1) % n];
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return true;
    }
  }
  return false;
}
// Andrew's monotone chain.
function convexHull(pts) {
  const p = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  const lower = [], upper = [];
  for (let i = 0; i < p.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop();
    lower.push(p[i]);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Apply a redaction shape to ctx.
//   shape.type === 'brush' → { pts: [{x,y},…], r }   a painted stroke
//   shape.type === 'poly'  → { pts: [{x,y},…] }      a closed outline
//
// There is deliberately no rectangle and no circle. Build photos are almost
// always shot with the gun at an angle, so the thing being hidden — a serial
// on a slide or a grip module — runs diagonally, and an upright box around a
// diagonal strip has to cover far more of the gun than the strip itself:
// its corners hang off both ends. The outline tool does the box's job (four
// taps is a box) at whatever angle the photo is at.
//
// Both shapes go the same way. We snapshot the bounding rect of the CURRENT
// canvas onto a scratch canvas (which preserves prior redactions in that
// area — sampling from origCanvas would silently un-mask overlapping earlier
// shapes), rasterise the shape into a hard-edged mask the same size, and
// pixelate the scratch with every block averaging and writing only the
// mask's pixels. The result is a cut-out of just the shape, which replaces
// exactly those pixels on ctx. Nothing outside the shape is read into an
// average or written.
function pixelateShape(ctx, shape) {
  let pts, pad, block, path;
  if (shape.type === 'poly') {
    pts = blurPoly(shape.pts);
    if (pts.length < 3) return;
    pad = 0;
    block = blockSizeFor(polyThickness(pts) * 2);
    path = function (c) { pathPoly(c, pts); };
  } else {
    // Block size follows the brush radius so a fine brush over a serial
    // still lands enough blocks to destroy the digits, while a fat brush
    // over a face reads as coarse.
    const r = Math.max(1, shape.r);
    pts = densifyStroke(shape.pts, r);
    if (!pts.length) return;
    pad = r;
    block = blockSizeFor(r * 2);
    path = function (c) { pathStroke(c, pts, r); };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(function (p) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  });
  const bx = Math.max(0, Math.floor(minX - pad));
  const by = Math.max(0, Math.floor(minY - pad));
  const bw = Math.min(ctx.canvas.width  - bx, Math.ceil(maxX + pad) - bx);
  const bh = Math.min(ctx.canvas.height - by, Math.ceil(maxY + pad) - by);
  if (bw <= 0 || bh <= 0) return;

  if (!_redactScratch) _redactScratch = document.createElement('canvas');
  if (_redactScratch.width !== bw)  _redactScratch.width  = bw;
  if (_redactScratch.height !== bh) _redactScratch.height = bh;
  const sctx = _redactScratch.getContext('2d');
  sctx.clearRect(0, 0, bw, bh);
  sctx.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, bw, bh);

  // The shape's own coverage, at the scratch's size and offset. Every block
  // averages and writes ONLY the pixels inside it. Averaging the whole
  // rectangular block is what made the blur the wrong colour: a block on the
  // edge of a tilted outline is half outside it, so its average pulled in
  // whatever surrounded the shape — measured as solid red inside an outline
  // with no red in it — and the clip then pasted that colour in. The clip
  // below only decides which pixels are drawn; it cannot fix their colour.
  if (!_redactMask) _redactMask = document.createElement('canvas');
  if (_redactMask.width !== bw)  _redactMask.width  = bw;
  if (_redactMask.height !== bh) _redactMask.height = bh;
  const mctx = _redactMask.getContext('2d', { willReadFrequently: true });
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, bw, bh);
  mctx.setTransform(1, 0, 0, 1, -bx, -by);
  path(mctx);
  mctx.fillStyle = '#fff';
  mctx.fill();
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  // Hard-edged: a pixel is in the shape or it is not. The fill above is
  // anti-aliased, and a soft edge here would be a pixel that is partly
  // blurred and partly the original.
  const maskImg = mctx.getImageData(0, 0, bw, bh);
  const md = maskImg.data;
  for (let i = 3; i < md.length; i += 4) md[i] = md[i] > 127 ? 255 : 0;
  mctx.putImageData(maskImg, 0, 0);
  pixelateRegion(sctx, 0, 0, bw, bh, block, md);

  // Put the cut-out in place: erase exactly the mask's pixels, then draw the
  // pixelated copy into exactly those pixels. Outside the mask both layers
  // are fully transparent, so nothing there can change.
  //
  // This replaced a ctx.clip(path) + drawImage, and the clip is not a safe
  // backstop: it is anti-aliased. On a tilted outline it blended every rim
  // pixel part-way back towards the original — measured as 228 rim pixels
  // that were not the block average, off by up to 39 levels — and slightly
  // altered pixels just outside the shape. The erase-then-draw also covers
  // what the clear was for: a semi-transparent original pixel is replaced,
  // not composited under its own pixelated version.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(_redactMask, bx, by);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(_redactScratch, bx, by);
  ctx.restore();
}

// Double-stroke marching-ants outline for the in-progress brush stroke.
// Thin white dashed line on top of a slightly wider black solid line —
// standard trick that reads on any background. The white line's dash
// offset is driven from outside so the caller can animate marching.
function drawSelectionOutline(ctx, shape, dashOffset) {
  const cw = ctx.canvas.width;
  const inner = Math.max(2, Math.round(cw / 800));
  const outer = inner + 2;

  function pathShape() {
    ctx.beginPath();
    // Outline the stroke's centerline plus a ring at the last point so
    // the brush footprint is legible while painting.
    const pts = shape.pts;
    if (!pts.length) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    const last = pts[pts.length - 1];
    ctx.moveTo(last.x + shape.r, last.y);
    ctx.arc(last.x, last.y, Math.max(0.5, shape.r), 0, Math.PI * 2);
  }

  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.setLineDash([]);
  ctx.lineWidth = outer;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  pathShape();
  ctx.stroke();

  ctx.lineWidth = inner;
  ctx.strokeStyle = 'rgba(255,255,255,0.98)';
  // Pronounced dash so ants read as active, not a decorative border.
  ctx.setLineDash([inner * 3, inner * 2]);
  ctx.lineDashOffset = -dashOffset;
  pathShape();
  ctx.stroke();
  ctx.restore();
}

// Opens a redaction modal, returns a Promise<File | null>.
//   File → user hit Done (with boxes) or Skip (returns the original file back)
//   null → user cancelled (Escape or clicked the backdrop)
function openRedactModal(file) {
  return new Promise(function (resolve) {
    mountRedactUI();
    const overlay   = document.getElementById('redact-overlay');
    const wrap      = document.getElementById('redact-canvas-wrap');
    const canvas    = document.getElementById('redact-canvas');
    const loupe     = document.getElementById('redact-loupe');
    const loading   = document.getElementById('redact-loading');
    const countEl   = document.getElementById('redact-count');
    const undoBtn   = document.getElementById('redact-undo');
    const clearBtn  = document.getElementById('redact-clear');
    const skipBtn   = document.getElementById('redact-skip');
    const doneBtn   = document.getElementById('redact-done');
    const shapeBrushBtn  = document.getElementById('redact-shape-brush');
    const shapePolyBtn   = document.getElementById('redact-shape-poly');
    const hintEl         = document.getElementById('redact-hint');
    const zoomOutBtn     = document.getElementById('redact-zoom-out');
    const zoomInBtn      = document.getElementById('redact-zoom-in');
    const zoomFitBtn     = document.getElementById('redact-zoom-fit');
    const zoomLabel      = document.getElementById('redact-zoom-label');

    const ctx = canvas.getContext('2d');
    const loupeCtx = loupe.getContext('2d');

    // Tool — 'brush' | 'poly'. Brush = paint a stroke, a bare tap drops one
    // dot. Poly ("Outline") = tap points around an area, tap the first point
    // again to close it, and everything inside is blurred.
    let shapeMode = 'brush';
    // The brush is one fixed, small size: 0.34% of the canvas's LONG edge,
    // an 8px radius (16px stroke) at the 2400px cap, in either orientation.
    // Not the width — on a portrait photo that is the short edge, and every
    // brush came out a third smaller than in landscape.
    //
    // There used to be a Size slider. Small is the point: the brush is for
    // painting precisely over a serial, a plate or an address, zoomed in,
    // and anything big is the Outline tool's job. Its top end was a 144px
    // disc, and every size it offered was one more way to cover the wrong
    // thing. A fine brush takes a few strokes to cover a serial — the live
    // pixelation shows what is still exposed while painting.
    const BRUSH_FRAC = 0.0034;
    function brushRadius() { return Math.max(3, Math.round(BRUSH_FRAC * Math.max(canvas.width, canvas.height))); }

    // ── Zoom ────────────────────────────────────────────────────────────
    // zoom = 1 is "fit to the wrap"; the canvas's internal resolution never
    // changes, only its CSS size. Panning is the wrap's native scrolling.
    // toCanvasCoords reads getBoundingClientRect, so every pointer handler
    // is zoom-agnostic for free.
    const ZOOM_MIN = 1, ZOOM_MAX = 8;
    let zoom = 1;
    let fitScale = 1;   // CSS px per canvas px at zoom 1

    function computeFit() {
      const pad = parseFloat(getComputedStyle(wrap).paddingLeft) || 0;
      const availW = Math.max(50, wrap.clientWidth  - pad * 2);
      const availH = Math.max(50, wrap.clientHeight - pad * 2);
      fitScale = Math.min(availW / canvas.width, availH / canvas.height);
    }
    // Resize the canvas's CSS box for `z`, keeping the image point that sits
    // under `anchor` (viewport px) in place. `frac` optionally overrides which
    // image point is pinned — the pinch handler passes the fraction it read at
    // gesture start so the photo tracks both fingers rather than re-anchoring
    // every frame.
    function applyZoom(z, anchor, frac) {
      z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
      const rect = canvas.getBoundingClientRect();
      if (!anchor) anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      if (!frac) frac = { x: (anchor.x - rect.left) / rect.width, y: (anchor.y - rect.top) / rect.height };
      zoom = z;
      canvas.style.width  = Math.round(canvas.width  * fitScale * zoom) + 'px';
      canvas.style.height = Math.round(canvas.height * fitScale * zoom) + 'px';
      const after = canvas.getBoundingClientRect();
      wrap.scrollLeft += (after.left + frac.x * after.width)  - anchor.x;
      wrap.scrollTop  += (after.top  + frac.y * after.height) - anchor.y;
      zoomLabel.textContent = Math.round(zoom * 100) + '%';
      zoomOutBtn.disabled = zoom <= ZOOM_MIN;
      zoomInBtn.disabled  = zoom >= ZOOM_MAX;
    }
    function zoomStep(dir) { applyZoom(zoom * (dir > 0 ? 1.5 : 1 / 1.5)); }
    function zoomFit()     { applyZoom(1); }
    function onResize()    { if (origCanvas) { computeFit(); applyZoom(zoom); } }
    // Trackpad pinch arrives as wheel + ctrlKey; ⌘/ctrl + mouse wheel too.
    // Plain wheel is left alone so it scrolls (pans) the wrap natively.
    function onWheel(e) {
      if (!(e.ctrlKey || e.metaKey) || !origCanvas) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.01);
      applyZoom(zoom * factor, { x: e.clientX, y: e.clientY });
    }

    // ── Pinch ───────────────────────────────────────────────────────────
    // Two fingers on the canvas = zoom + pan, never a selection. The first
    // finger's in-progress shape is thrown away the moment the second lands
    // (it was almost certainly the start of a pinch, not a box), and no new
    // shape can start until every finger has lifted.
    const pointers = new Map();     // pointerId → { x, y } (viewport px)
    let pinch = null;               // { dist, zoom, frac } at gesture start
    let gestureLock = false;        // true from pinch start until all fingers up
    function pinchGeom() {
      const it = pointers.values();
      const a = it.next().value, b = it.next().value;
      return {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        mid:  { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
    function beginPinch() {
      const g = pinchGeom();
      const rect = canvas.getBoundingClientRect();
      pinch = {
        dist: Math.max(1, g.dist),
        zoom: zoom,
        frac: { x: (g.mid.x - rect.left) / rect.width, y: (g.mid.y - rect.top) / rect.height },
      };
      gestureLock = true;
    }
    function updatePinch() {
      const g = pinchGeom();
      applyZoom(pinch.zoom * (g.dist / pinch.dist), g.mid, pinch.frac);
    }
    // Marching-ants dash offset, incremented every animation frame while
    // dragging so the outline visibly moves and reads as "active".
    let dashOffset = 0;
    // Offscreen copy of the untouched original image at canvas resolution.
    // Two uses: (1) fast repaint base — ctx.drawImage(origCanvas,0,0) replaces
    // the earlier putImageData(originalImageData) approach and is faster
    // because the browser can hardware-accelerate canvas→canvas blits; (2)
    // the loupe samples from origCanvas so the user always sees the pristine
    // image under the crosshair, not the pixelated preview underneath.
    let origCanvas = null;

    let boxes = [];                 // committed shapes, in canvas-natural pixels
    // Outline tool: the vertices placed so far for the shape being drawn.
    // Not a blur yet — it becomes one (and moves into `boxes`) when closed.
    let polyPts = [];
    let pendingPt = null;           // the vertex under a held-down pointer, not yet placed
    let dragging = false;
    let startCanvas = { x: 0, y: 0 };  // natural-px start (for boxes we save)
    let startWrap   = { x: 0, y: 0 };  // wrap-local start (for loupe positioning if needed later)
    let currentDrag = null;            // live drag rect (natural-px) — nullable
    let currentTouch = null;           // { canvas, wrap } — set only for pointerType==='touch'
    let activePointerId = null;
    let activePointerType = null;
    let rafScheduled = false;

    const LOUPE_SIZE = 120;    // px (matches CSS)
    const LOUPE_ZOOM = 4;      // 4× — 30 canvas-px sampled → 120 loupe-px shown
    const LOUPE_OFFSET_ABOVE = 70;  // px above the touch point per spec

    function setCount() {
      countEl.textContent = boxes.length + ' blurred region' + (boxes.length === 1 ? '' : 's');
      // The count badge is hidden on phones, so the number rides on Done.
      doneBtn.textContent = boxes.length ? 'Done (' + boxes.length + ')' : 'Done';
      // An outline in progress counts for Undo/Clear (they act on its points),
      // and for Done once it has the three points that make it an area —
      // Done closes it. See finishAsDone.
      const marked = boxes.length > 0 || polyPts.length > 0;
      undoBtn.disabled  = !marked;
      clearBtn.disabled = !marked;
      doneBtn.disabled  = boxes.length === 0 && polyPts.length < 3;   // skip covers "nothing to blur"
      // Skip uploads the ORIGINAL file. Once anything is marked that is the
      // one button that throws the marking away and uploads what it covered,
      // and on a phone it sits one thumb-width from Done. "Nothing to blur"
      // is no longer true at that point either — Clear all, then Skip, is
      // still there for someone who really means it.
      skipBtn.disabled  = marked;
    }

    // Committed layer: original image + every committed shape pixelated on
    // top, cached offscreen. Rebuilt only when `boxes` changes. Every drag
    // and hover frame then starts from a single blit instead of re-running
    // pixelation for the whole list — matters once a photo has a dozen
    // shapes and the brush is repainting at 60fps.
    let committedCanvas = null;
    //
    // Both blits clear first. drawImage composites, so on a PNG with
    // transparency, whatever was under a transparent pixel — an undone blur,
    // last frame's brush ring and outline dots — would otherwise stay there.
    function rebuildCommitted() {
      if (!origCanvas) return;
      if (!committedCanvas) committedCanvas = document.createElement('canvas');
      if (committedCanvas.width !== canvas.width || committedCanvas.height !== canvas.height) {
        committedCanvas.width = canvas.width; committedCanvas.height = canvas.height;
      }
      const cctx = committedCanvas.getContext('2d');
      cctx.clearRect(0, 0, committedCanvas.width, committedCanvas.height);
      cctx.drawImage(origCanvas, 0, 0);
      boxes.forEach(function (b) { pixelateShape(cctx, b); });
    }
    // Base repaint onto the visible canvas. Does NOT draw the live drag
    // shape; that's layered by renderDragFrame.
    function repaintAllBoxes() {
      if (!committedCanvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(committedCanvas, 0, 0);
    }
    function commitBoxes() { rebuildCommitted(); renderIdle(); setCount(); }

    // ── Outline tool ────────────────────────────────────────────────────
    // Everything the draft draws is sized in CSS px and converted, so the
    // dots and lines stay the same size on screen at 100% and at 800%.
    function cssUnit() { return 1 / Math.max(1e-6, fitScale * zoom); }   // canvas px per CSS px
    // How close to the first point a tap has to land to close the shape. A
    // finger gets more room than a mouse, but not the full 22px half-target:
    // on a small serial the fourth corner is legitimately that close to the
    // first, and closing early would leave a sliver of it unblurred.
    //
    // Neither radius may cost a vertex, though, and both used to. At fit zoom
    // on a phone a 25px serial is about 4 CSS px tall, so 16 CSS px of close
    // radius is ~107 canvas px: the bottom-right corner fell inside the
    // "repeat tap on the last point" zone and was dropped, the bottom-left
    // fell inside the first point's zone and closed the shape, and what got
    // blurred was a triangle with most of the digits outside it. So:
    //   - a repeat tap counts as a double-tap only if it comes QUICKLY after
    //     the previous tap (DOUBLE_TAP_MS); a slow tap near the last point is
    //     a vertex. Timed from the previous TAP, not the previous vertex, so
    //     placing a point, pausing, then double-clicking it still closes.
    //   - whatever closes the shape, the tap that closed it is kept as a
    //     vertex if keeping it makes the shape bigger (see closingPts). A
    //     corner that lands in the close zone still gets its corner.
    const DOUBLE_TAP_MS = 350;
    let lastTapAt = 0;
    function closeRadius(pointerType) { return (pointerType === 'touch' ? 16 : 10) * cssUnit(); }
    function nearPoint(p, q, r) { return Math.hypot(p.x - q.x, p.y - q.y) <= r; }
    function closesOnFirst(p, pointerType) {
      return polyPts.length >= 3 && nearPoint(p, polyPts[0], closeRadius(pointerType));
    }
    function isDoubleTap(p, pointerType, quick) {
      const last = polyPts[polyPts.length - 1];
      return quick && !!last && nearPoint(p, last, closeRadius(pointerType) * 0.6);
    }
    // The outline as it closes on `p`. `p` joins it when that adds area —
    // the closing tap was a corner that landed near the first point — and is
    // dropped when it would only cut a notch, because then it was aimed at
    // the first point and simply missed. Either way the result covers at
    // least everything the plain close would have.
    function closingPts(p) {
      if (!p) return polyPts;
      const withP = polyPts.concat([{ x: Math.round(p.x), y: Math.round(p.y) }]);
      return Math.abs(polyArea2(blurPoly(withP))) > Math.abs(polyArea2(blurPoly(polyPts))) ? withP : polyPts;
    }
    function commitPoly(pts) {
      if (pts.length >= 3) boxes.push({ type: 'poly', pts: blurPoly(pts) });
      polyPts = [];
    }
    function closePoly(pts) {
      if (pts.length < 3) return;
      commitPoly(pts);
      commitBoxes();
    }
    function placePolyPoint(p, pointerType) {
      const now = performance.now();
      const quick = now - lastTapAt < DOUBLE_TAP_MS;
      lastTapAt = now;
      if (polyPts.length >= 3 && (closesOnFirst(p, pointerType) || isDoubleTap(p, pointerType, quick))) {
        closePoly(closingPts(p));
        return;
      }
      // Before there is a shape to close, only a true duplicate (the second
      // half of a double-click) is ignored — 2 CSS px, not the close radius,
      // which at fit zoom is wide enough to swallow a real corner.
      const last = polyPts[polyPts.length - 1];
      if (last && nearPoint(p, last, 2 * cssUnit())) { renderIdle(); return; }
      polyPts.push({ x: Math.round(p.x), y: Math.round(p.y) });
      renderIdle();
      setCount();
    }
    // The draft: a tint over the area that will be blurred, the edges, and a
    // dot per point. `cursor` is where the pointer is (hovering or held
    // down) and is drawn as the next point; null on touch between taps.
    function drawPolyDraft(cursor, pointerType) {
      if (!polyPts.length) return;
      const u = cssUnit();
      const closing = !!cursor && closesOnFirst(cursor, pointerType);
      const pts = !cursor ? polyPts : closing ? closingPts(cursor) : polyPts.concat([cursor]);
      ctx.save();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (pts.length >= 3) {
        // The tint is the area that will actually be blurred — the hull, if
        // the points cross — so the preview never promises less than it does.
        pathPoly(ctx, blurPoly(pts));
        ctx.fillStyle = 'rgba(74,158,221,0.30)';
        ctx.fill();
      }
      // Edges, black under dashed white so they read on any photo. The
      // closing edge back to the first point is drawn too, so the shape on
      // screen is always the shape that would be blurred.
      if (pts.length >= 3) pathPoly(ctx, pts);
      else { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); }
      ctx.setLineDash([]);
      ctx.lineWidth = 4 * u; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.stroke();
      ctx.setLineDash([6 * u, 5 * u]); ctx.lineDashOffset = -dashOffset * u;
      ctx.lineWidth = 2 * u; ctx.strokeStyle = 'rgba(255,255,255,0.98)'; ctx.stroke();
      ctx.setLineDash([]);
      // Points. The first one turns gold once tapping it would close the
      // shape, and grows when the pointer is on it.
      for (let i = polyPts.length - 1; i >= 0; i--) {
        const first = i === 0 && polyPts.length >= 3;
        const r = (first ? (closing ? 10 : 7) : 4.5) * u;
        ctx.beginPath();
        ctx.arc(polyPts[i].x, polyPts[i].y, r, 0, Math.PI * 2);
        ctx.fillStyle = first ? '#d4a853' : '#fff';
        ctx.fill();
        ctx.lineWidth = 1.5 * u; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.stroke();
      }
      ctx.restore();
    }

    // What the canvas shows when no pointer is down: the committed blurs,
    // plus whatever the current tool keeps on screen between gestures — the
    // outline being drawn, or the brush ring under the mouse so the user can
    // judge its size before committing. Touch has no hover; the loupe and
    // the live stroke cover that case.
    //
    // None of this is ever exported: finishAsDone repaints the bare
    // committed layer before it encodes.
    let hoverPoint = null;
    function renderIdle() {
      repaintAllBoxes();
      if (shapeMode === 'poly') {
        drawPolyDraft(hoverPoint, 'mouse');
      } else if (hoverPoint) {
        drawSelectionOutline(ctx, { type: 'brush', pts: [hoverPoint], r: brushRadius() }, 0);
      }
    }

    // Render one frame while a pointer is down. Brush: the stroke so far,
    // pixelated live through pixelateShape so the preview matches the
    // committed result exactly, with a marching-ants outline on top.
    // Outline: the draft with the held point as its next vertex.
    function renderDragFrame() {
      repaintAllBoxes();
      if (shapeMode === 'poly') {
        if (pendingPt) {
          if (!polyPts.length) {
            // Very first point: nothing to connect to yet, so show the dot.
            const u = cssUnit();
            ctx.save();
            ctx.beginPath(); ctx.arc(pendingPt.x, pendingPt.y, 4.5 * u, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();
            ctx.lineWidth = 1.5 * u; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.stroke();
            ctx.restore();
          } else {
            drawPolyDraft(pendingPt, activePointerType);
          }
        }
      } else if (currentDrag && currentDrag.pts.length > 0) {
        pixelateShape(ctx, currentDrag);
        drawSelectionOutline(ctx, currentDrag, dashOffset);
      }
      if (currentTouch) {
        drawLoupe(currentTouch.canvas);
        positionLoupe(currentTouch.wrap);
      }
    }

    // Loupe: sample 30×30 canvas-px around the touch from origCanvas
    // (pristine image), draw scaled 4× onto the 120px round loupe canvas,
    // overlay crosshairs. imageSmoothingEnabled:false so each source pixel
    // is a crisp 4×4 block — makes exact placement legible.
    function drawLoupe(centerCanvas) {
      if (!origCanvas) return;
      // Magnification is relative to what's already on screen: at fit, this
      // is the flat 4×; zoomed in, it stays 2.5× beyond the current view so
      // the loupe keeps earning its place instead of showing the same scale
      // as the canvas underneath it.
      const screenScale = fitScale * zoom;          // CSS px per canvas px
      const loupeScale = Math.max(LOUPE_ZOOM, screenScale * 2.5);
      const sampleSize = LOUPE_SIZE / loupeScale;
      const sx = centerCanvas.x - sampleSize / 2;
      const sy = centerCanvas.y - sampleSize / 2;
      loupeCtx.imageSmoothingEnabled = false;
      loupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
      loupeCtx.drawImage(origCanvas, sx, sy, sampleSize, sampleSize, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
      // Crosshairs
      loupeCtx.strokeStyle = 'rgba(212, 168, 83, 0.95)';
      loupeCtx.lineWidth = 1;
      loupeCtx.beginPath();
      loupeCtx.moveTo(LOUPE_SIZE / 2 + 0.5, 0);
      loupeCtx.lineTo(LOUPE_SIZE / 2 + 0.5, LOUPE_SIZE);
      loupeCtx.moveTo(0,          LOUPE_SIZE / 2 + 0.5);
      loupeCtx.lineTo(LOUPE_SIZE, LOUPE_SIZE / 2 + 0.5);
      loupeCtx.stroke();
    }
    function positionLoupe(centerWrap) {
      // centerWrap is in wrap's VISIBLE-viewport coords (from clientX - rect.left).
      // Clamp in visible-coord space so the loupe stays on-screen regardless of
      // how far the wrap is scrolled; then add wrap.scrollLeft/scrollTop to
      // convert to CONTENT-coord space, which is what absolutely-positioned
      // children of a scrollable parent are interpreted in. Skipping this
      // conversion drifts the loupe by exactly the current scroll offset.
      let left = centerWrap.x - LOUPE_SIZE / 2;
      let top  = centerWrap.y - LOUPE_OFFSET_ABOVE - LOUPE_SIZE;
      left = Math.max(0, Math.min(wrap.clientWidth  - LOUPE_SIZE, left));
      top  = Math.max(0, Math.min(wrap.clientHeight - LOUPE_SIZE, top));
      loupe.style.left = (left + wrap.scrollLeft) + 'px';
      loupe.style.top  = (top  + wrap.scrollTop)  + 'px';
    }
    function showLoupe() { loupe.classList.add('active'); }
    function hideLoupe() { loupe.classList.remove('active'); }

    // Continuous rAF loop while dragging — pointermove no longer triggers a
    // one-shot frame. This is required for the marching-ants animation: the
    // dash offset needs to advance every frame regardless of whether the
    // pointer is moving, otherwise the outline visibly freezes the moment
    // the user holds their finger still, which reads as broken.
    function loopFrame() {
      if (!dragging) return;
      dashOffset = (dashOffset + 1) % 1000000;
      renderDragFrame();
      requestAnimationFrame(loopFrame);
    }
    function startLoop() {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(function () {
        rafScheduled = false;
        loopFrame();
      });
    }

    // Convert a pointer event's viewport coordinates to canvas-natural pixels.
    function toCanvasCoords(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: Math.max(0, Math.min(canvas.width  - 1, (e.clientX - rect.left) * scaleX)),
        y: Math.max(0, Math.min(canvas.height - 1, (e.clientY - rect.top)  * scaleY)),
      };
    }
    // Same, but returning wrap-local coords for positioning the loupe.
    function toWrapCoords(e) {
      const rect = wrap.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    // Extend the live brush stroke with the pointer position.
    function makeDragShape(p) {
      const s = currentDrag || { type: 'brush', pts: [], r: brushRadius() };
      const last = s.pts[s.pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1) {
        s.pts.push({ x: Math.round(p.x), y: Math.round(p.y) });
      }
      return s;
    }

    // Drop the in-progress gesture without committing it. Used when a second
    // finger turns a drag into a pinch, and by pointercancel. For the outline
    // tool that is only the point under the finger — the points already
    // placed stay, so zooming in mid-outline does not cost the outline.
    function abandonDrag() {
      dragging = false;
      activePointerId = null;
      activePointerType = null;
      currentDrag = null;
      pendingPt = null;
      currentTouch = null;
      hideLoupe();
      renderIdle();
    }

    function onPointerDown(e) {
      if (!origCanvas) return;
      canvas.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          abandonDrag();
          beginPinch();
          e.preventDefault();
          return;
        }
        if (pointers.size > 2 || gestureLock) { e.preventDefault(); return; }
      }
      if (activePointerId !== null) return;   // a mouse button is already down
      activePointerId = e.pointerId;
      activePointerType = e.pointerType;
      dragging = true;
      startCanvas = toCanvasCoords(e);
      startWrap   = toWrapCoords(e);
      dashOffset = 0;
      hoverPoint = null;
      if (shapeMode === 'poly') pendingPt = startCanvas;
      else currentDrag = makeDragShape(startCanvas);
      if (activePointerType === 'touch') {
        currentTouch = { canvas: startCanvas, wrap: startWrap };
        showLoupe();
      }
      startLoop();
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (e.pointerType === 'touch' && pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pointers.size === 2) { updatePinch(); return; }
      }
      if (!dragging) {
        // Mouse/pen only: the brush ring, or the outline's next edge.
        if (e.pointerType !== 'touch' && origCanvas) {
          hoverPoint = toCanvasCoords(e);
          renderIdle();
        }
        return;
      }
      if (e.pointerId !== activePointerId) return;
      const p = toCanvasCoords(e);
      if (shapeMode === 'poly') pendingPt = p;
      else currentDrag = makeDragShape(p);
      if (activePointerType === 'touch') {
        currentTouch = { canvas: p, wrap: toWrapCoords(e) };
      }
      // No scheduling needed — the rAF loop is already running.
    }
    function releaseTouch(e) {
      if (e.pointerType !== 'touch') return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) gestureLock = false;
    }
    function onPointerUp(e) {
      releaseTouch(e);
      if (!dragging || e.pointerId !== activePointerId) return;
      dragging = false;                            // stops the loop
      activePointerId = null;
      const pointerType = activePointerType;
      activePointerType = null;
      currentTouch = null;
      if (pointerType === 'touch') hideLoupe();
      const p = toCanvasCoords(e);
      if (shapeMode === 'poly') {
        // The point lands where the pointer is LIFTED, not where it went
        // down — on a phone that is what lets you press, slide under the
        // loupe until the crosshair is on the spot, and let go.
        pendingPt = null;
        if (pointerType !== 'touch') hoverPoint = p;
        placePolyPoint(p, pointerType);
        return;
      }
      // A bare tap is a deliberate dot — that is exactly the gesture for a
      // target too small to paint a stroke over — so nothing is too small.
      const shape = makeDragShape(p);
      currentDrag = null;
      boxes.push(shape);
      commitBoxes();                                // wipes the outline; commits pixelation
    }
    function onPointerCancel(e) {
      releaseTouch(e);
      abandonDrag();
    }
    function onPointerLeave() {
      if (hoverPoint) { hoverPoint = null; if (!dragging) renderIdle(); }
    }

    // Undo takes back the last thing done: a point of the outline being
    // drawn if there is one, otherwise the last finished blur.
    function onUndo() {
      if (polyPts.length) { polyPts.pop(); renderIdle(); setCount(); return; }
      boxes.pop(); commitBoxes();
    }
    function onClear() { boxes = []; polyPts = []; commitBoxes(); }

    function cleanup() {
      overlay.classList.remove('open');
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      wrap.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      undoBtn.onclick = null; clearBtn.onclick = null;
      skipBtn.onclick = null; doneBtn.onclick = null;
      shapeBrushBtn.onclick = null; shapePolyBtn.onclick = null;
      zoomInBtn.onclick = null; zoomOutBtn.onclick = null; zoomFitBtn.onclick = null;
      // Reset to the default tool so the next modal open doesn't inherit
      // this one's — and drop any unfinished outline first, so the reset
      // does not try to commit it to a photo that is being torn down.
      polyPts = []; pendingPt = null;
      setShapeMode('brush');
      overlay.removeEventListener('click', onBackdropClick);
      removeGestureGuards();
      document.removeEventListener('keydown', onKeydown);
      // Free the canvas backing store so a very large photo doesn't linger.
      canvas.width = 0; canvas.height = 0;
      canvas.style.width = ''; canvas.style.height = '';
      zoom = 1; pinch = null; gestureLock = false; pointers.clear();
      hideLoupe();
      loupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
      origCanvas = null;   // GC the offscreen copy
      committedCanvas = null;
      boxes = [];
      currentDrag = null;
      currentTouch = null;
      hoverPoint = null;
      // A gesture still in flight when the modal closed would otherwise keep
      // its rAF loop running, drawing into this same canvas element on the
      // next photo's modal.
      dragging = false; activePointerId = null; activePointerType = null; pendingPt = null;
    }
    function finishAsSkip()   { cleanup(); resolve(file); }
    function finishAsCancel() { cleanup(); resolve(null); }
    function finishAsDone() {
      // Anything still in progress was marked to be hidden. A brush stroke
      // whose finger is still down is committed as it stands. An outline
      // with three or more points is an area the user marked and forgot to
      // close — and a held, unplaced point joins it on the same terms as a
      // closing tap. Dropping either would upload exactly the thing they
      // were in the middle of covering.
      if (dragging && currentDrag && currentDrag.pts.length) boxes.push(currentDrag);
      currentDrag = null;
      commitPoly(closingPts(pendingPt));
      hoverPoint = null;
      if (boxes.length === 0) { finishAsSkip(); return; }   // guard — button *should* be disabled
      rebuildCommitted();
      // Encode the committed layer itself, never the visible canvas: that
      // one carries editing chrome — the brush ring, outline dots and edges,
      // the tint — and toBlob encodes whatever is on it. Repainting the
      // visible canvas first is not enough, because a transparent pixel in
      // the photo lets the chrome under it through.
      const out = committedCanvas;
      // Same MIME as input so JPEG stays JPEG (avoids double lossy re-encode
      // when normalizeImage does its own JPEG re-encode later); PNG stays PNG.
      const mime = (file.type === 'image/png' || file.type === 'image/webp') ? file.type : 'image/jpeg';
      const quality = mime === 'image/jpeg' ? 0.95 : undefined;
      out.toBlob(function (blob) {
        if (!blob) { cleanup(); resolve(file); return; }   // fall back to original if encoding fails
        const outFile = new File([blob], file.name, { type: mime });
        cleanup();
        resolve(outFile);
      }, mime, quality);
    }
    function onBackdropClick(e) { if (e.target === overlay) finishAsCancel(); }
    function onKeydown(e) {
      if (e.key === 'Escape') {
        // First Escape abandons an outline in progress; only an Escape with
        // nothing in progress closes the modal and throws the photo away.
        if (polyPts.length) { polyPts = []; pendingPt = null; renderIdle(); setCount(); return; }
        finishAsCancel();
      } else if (e.key === 'Enter' && polyPts.length >= 3 && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        closePoly(polyPts);
      }
    }

    // iOS Safari zooms the PAGE on a pinch and does not route that through
    // touch-action — it fires its own non-standard gesture* events. That is
    // why `touch-action: none` on the canvas only ever protected the canvas:
    // a pinch starting a few px outside it zoomed Safari itself, and the
    // toolbar went off-screen with no way to get it back. (`user-scalable=no`
    // in the viewport meta is not the fix — iOS has ignored it since 10, and
    // the site sets no such meta anyway.) Blocking these across the whole
    // overlay means a pinch anywhere in the modal can only ever zoom the
    // photo. The modal's own pinch runs on pointer events and is untouched,
    // and panning a zoomed photo is ordinary scrolling of the canvas wrap,
    // which gesture events are not involved in.
    function onGesture(e) { e.preventDefault(); }
    const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'];
    function addGestureGuards() {
      GESTURE_EVENTS.forEach(function (t) { overlay.addEventListener(t, onGesture, { passive: false }); });
    }
    function removeGestureGuards() {
      GESTURE_EVENTS.forEach(function (t) { overlay.removeEventListener(t, onGesture); });
    }

    // Show shell + loading state before we decode — large phone photos take a beat.
    overlay.classList.add('open');
    // Bound here rather than in img.onload: the overlay is on screen and
    // pinchable during the decode, which on a 12MP phone photo is not a
    // short window.
    addGestureGuards();
    loading.style.display = '';
    setCount();

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(objectUrl);
      const w0 = img.naturalWidth, h0 = img.naturalHeight;
      if (!w0 || !h0) {
        // Can't redact something with no dimensions — treat as skip so the
        // upstream pipeline can decide what to do (normalizeImage will fail
        // there and surface a proper error).
        finishAsSkip();
        return;
      }
      const scale = Math.min(1, REDACT_MAX_DIMENSION / Math.max(w0, h0));
      const cw = Math.round(w0 * scale), ch = Math.round(h0 * scale);
      canvas.width = cw; canvas.height = ch;
      // Offscreen pristine copy at canvas resolution — repaint base + loupe source.
      origCanvas = document.createElement('canvas');
      origCanvas.width = cw; origCanvas.height = ch;
      origCanvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
      rebuildCommitted();
      repaintAllBoxes();
      loading.style.display = 'none';
      computeFit();
      applyZoom(1);

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerCancel);
      canvas.addEventListener('pointerleave', onPointerLeave);
      wrap.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('resize', onResize);
      undoBtn.onclick  = onUndo;
      clearBtn.onclick = onClear;
      skipBtn.onclick  = finishAsSkip;
      doneBtn.onclick  = finishAsDone;
      shapeBrushBtn.onclick  = function () { setShapeMode('brush'); };
      shapePolyBtn.onclick   = function () { setShapeMode('poly');  };
      zoomInBtn.onclick  = function () { zoomStep(1);  };
      zoomOutBtn.onclick = function () { zoomStep(-1); };
      zoomFitBtn.onclick = zoomFit;
      overlay.addEventListener('click', onBackdropClick);
      document.addEventListener('keydown', onKeydown);
    };

    // What the header tells the user to do, per tool. .long / .short are the
    // desktop and phone wordings (see the 640px block in the CSS).
    const HINTS = {
      brush: '<strong>Paint over</strong> serial numbers, plates, addresses, faces.' +
             '<span class="long"> Small target? <strong>Pinch or use + to zoom in</strong>. Bigger area, or a tilted strip? Trace it with <strong>Outline</strong>.</span>' +
             '<span class="short"> Too small? Pinch to zoom.</span> Runs before upload.',
      poly:  '<strong>Tap around the area</strong> to drop points, then <strong>tap the first point</strong> to close it. Everything inside is blurred.' +
             '<span class="long"> Works at any angle — four taps around a tilted serial is enough. Double-click also closes.</span> Runs before upload.',
    };
    // Tool switch — flips the segmented-control active state and updates
    // aria-pressed for screen readers. The shapeMode variable is what the
    // pointer handlers consult on each gesture.
    function setShapeMode(mode) {
      // Leaving Outline mid-shape: three or more points is a marked area, so
      // it is blurred rather than dropped (Undo takes it back); fewer is
      // nothing yet.
      if (mode !== 'poly' && polyPts.length) {
        commitPoly(polyPts);
        if (origCanvas) { rebuildCommitted(); setCount(); }
      }
      shapeMode = mode;
      const btns = { brush: shapeBrushBtn, poly: shapePolyBtn };
      Object.keys(btns).forEach(function (k) {
        btns[k].classList.toggle('active', k === mode);
        btns[k].setAttribute('aria-pressed', String(k === mode));
      });
      hintEl.innerHTML = HINTS[mode];
      canvas.classList.toggle('brush', mode === 'brush');
      hoverPoint = null;
      if (origCanvas) renderIdle();
    }
    setShapeMode('brush');
    img.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      // Same fallthrough as no-dimensions — let the downstream pipeline
      // fail loudly rather than swallowing here.
      finishAsSkip();
    };
    img.src = objectUrl;
  });
}

window.openRedactModal = openRedactModal;
})();
