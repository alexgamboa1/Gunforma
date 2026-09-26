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
.redact-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.redact-btn:not(:disabled):hover { filter: brightness(1.08); }
.redact-btn.ghost   { background: #fff; color: #444;      border-color: #d9d6cc; }
.redact-btn.skip    { background: transparent; color: #888; border-color: transparent; text-decoration: underline; }
.redact-btn.primary { background: #4a9edd; color: #fff;   border-color: #4a9edd; }
.redact-btn.primary:disabled { background: #d9e6f2; color: #6a97be; border-color: #d9e6f2; }

/* Shape-mode segmented toggle — Box (default) / Circle. Same visual pattern
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

/* Brush size slider — only shown in Brush mode. */
.redact-brush-size { display: none; align-items: center; gap: 6px; font-size: 11px; color: #666; }
.redact-brush-size.visible { display: inline-flex; }
.redact-brush-size input[type=range] { width: 90px; accent-color: #4a9edd; }

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
  /* Two rows on a phone: tools, then actions. Every control shrinks rather
     than wrapping to a row of its own — a four-row toolbar left the photo
     itself with almost no height, which is the opposite of the point. */
  /* The action row sat hard against the bottom of the screen, on top of the
     iPhone home indicator. The 20px is what actually does the lifting: the
     site sets no \`viewport-fit=cover\` on any page, so env(safe-area-inset-*)
     resolves to 0 here and is carried only so this stays correct if the
     viewport meta is ever opted in. Row gap is up from 6px so the two rows
     read as separate rather than one crushed block. */
  .redact-toolbar {
    padding: 12px 12px calc(20px + env(safe-area-inset-bottom, 0px));
    gap: 10px;
  }
  .redact-shape-toggle button { padding: 9px 10px; }
  /* The size slider gets its own full-width row, and only in Brush mode —
     squeezed inline next to the zoom cluster it collapsed to a few px and
     could not be dragged. */
  .redact-brush-size.visible { order: 2; flex-basis: 100%; }
  .redact-brush-size input[type=range] { flex: 1; width: auto; }
  .redact-zoom { order: 1; margin-left: auto; }
  .redact-zoom button { width: 28px; height: 26px; }
  .redact-zoom-label { min-width: 38px; }
  /* The count lives in the Done label on a phone (see setCount) — one row
     of controls saved. */
  .redact-count { display: none; }
  .redact-btn { padding: 10px 12px; order: 3; }
  .redact-btn .long { display: none; }
  #redact-skip { margin-left: auto; }
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
        <div class="redact-hint"><strong>Drag on the image</strong> to blur serial numbers, plates, addresses, faces.<span class="long"> Small target? <strong>Pinch or use + to zoom in</strong>, or switch to <strong>Brush</strong> and paint over it.</span><span class="short"> Too small? Pinch to zoom, or use <strong>Brush</strong>.</span> Runs before upload.</div>
      </div>
    </div>
    <div class="redact-canvas-wrap" id="redact-canvas-wrap">
      <canvas class="redact-canvas" id="redact-canvas"></canvas>
      <canvas class="redact-loupe" id="redact-loupe" width="120" height="120"></canvas>
      <div class="redact-loading" id="redact-loading">Loading photo…</div>
    </div>
    <div class="redact-toolbar">
      <div class="redact-shape-toggle" role="group" aria-label="Selection shape">
        <button type="button" id="redact-shape-rect"   class="active" aria-pressed="true"  title="Rectangle selection">▭ Box</button>
        <button type="button" id="redact-shape-circle"                aria-pressed="false" title="Circle selection (drag from center)">◯ Circle</button>
        <button type="button" id="redact-shape-brush"                 aria-pressed="false" title="Paint over an area (tap for a dot)">✎ Brush</button>
      </div>
      <label class="redact-brush-size" id="redact-brush-size">Size
        <input type="range" id="redact-brush-range" min="1" max="100" value="25" aria-label="Brush size">
      </label>
      <div class="redact-zoom" role="group" aria-label="Zoom">
        <button type="button" id="redact-zoom-out" title="Zoom out (ctrl + scroll)" aria-label="Zoom out">−</button>
        <span class="redact-zoom-label" id="redact-zoom-label">100%</span>
        <button type="button" id="redact-zoom-in"  title="Zoom in (ctrl + scroll, or pinch)" aria-label="Zoom in">+</button>
        <button type="button" id="redact-zoom-fit" class="fit" title="Fit whole photo on screen">Fit</button>
      </div>
      <span class="redact-count" id="redact-count">0 blurred regions</span>
      <button type="button" class="redact-btn ghost"    id="redact-undo"  disabled>Undo</button>
      <button type="button" class="redact-btn ghost"    id="redact-clear" disabled>Clear all</button>
      <button type="button" class="redact-btn skip"     id="redact-skip">Skip<span class="long"> — nothing to blur</span></button>
      <button type="button" class="redact-btn primary"  id="redact-done"  disabled>Done</button>
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

function pixelateRegion(ctx, x, y, w, h, blockSize) {
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
          rSum += data[idx];
          gSum += data[idx + 1];
          bSum += data[idx + 2];
          n++;
        }
      }
      const rAvg = (rSum / n) | 0, gAvg = (gSum / n) | 0, bAvg = (bSum / n) | 0;
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const idx = ((by + py) * w + (bx + px)) * 4;
          data[idx]     = rAvg;
          data[idx + 1] = gAvg;
          data[idx + 2] = bAvg;
          // data[idx+3] (alpha) intentionally untouched
        }
      }
    }
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

// A reusable scratch canvas for circle-shaped redaction (see below).
// One per modal session, resized per-shape as needed.
let _redactScratch = null;

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

// Apply a redaction shape to ctx. Handles rect, circle and brush.
//   shape.type === 'rect'   → { x, y, w, h }
//   shape.type === 'circle' → { cx, cy, r }
//   shape.type === 'brush'  → { pts: [{x,y},…], r }
// Rects: run pixelateRegion in place — same as before.
// Circles: naive "pixelateRegion(boundingRect) + ctx.clip(arc)" DOES NOT
// work — putImageData ignores canvas clip regions per the Canvas 2D spec.
// So we snapshot the bounding rect of the CURRENT canvas onto a scratch
// canvas (which preserves prior redactions in that area — sampling from
// origCanvas would silently un-mask overlapping earlier boxes), pixelate
// the scratch in place, then drawImage the scratch back onto ctx clipped
// to the arc. Only the circular interior is committed; corners outside
// the circle are untouched.
function pixelateShape(ctx, shape) {
  if (shape.type === 'brush') {
    // Same scratch-then-clip approach as circles, with the clip being the
    // union of circles along the stroke. Block size follows the brush
    // radius so a fine brush over a serial still lands enough blocks to
    // destroy the digits, while a fat brush over a face reads as coarse.
    const r = Math.max(1, shape.r);
    const pts = densifyStroke(shape.pts, r);
    if (!pts.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    });
    const bx = Math.max(0, Math.floor(minX - r));
    const by = Math.max(0, Math.floor(minY - r));
    const bw = Math.min(ctx.canvas.width  - bx, Math.ceil(maxX + r) - bx);
    const bh = Math.min(ctx.canvas.height - by, Math.ceil(maxY + r) - by);
    if (bw <= 0 || bh <= 0) return;
    const block = blockSizeFor(r * 2);

    if (!_redactScratch) _redactScratch = document.createElement('canvas');
    if (_redactScratch.width !== bw)  _redactScratch.width  = bw;
    if (_redactScratch.height !== bh) _redactScratch.height = bh;
    const sctx = _redactScratch.getContext('2d');
    sctx.clearRect(0, 0, bw, bh);
    sctx.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, bw, bh);
    pixelateRegion(sctx, 0, 0, bw, bh, block);

    ctx.save();
    pathStroke(ctx, pts, r);
    ctx.clip();
    ctx.drawImage(_redactScratch, bx, by);
    ctx.restore();
    return;
  }
  if (shape.type === 'circle') {
    const cx = shape.cx, cy = shape.cy, r = Math.max(1, shape.r);
    const bx = Math.max(0, Math.floor(cx - r));
    const by = Math.max(0, Math.floor(cy - r));
    const bw = Math.min(ctx.canvas.width  - bx, Math.ceil(r * 2));
    const bh = Math.min(ctx.canvas.height - by, Math.ceil(r * 2));
    if (bw <= 0 || bh <= 0) return;
    const block = blockSizeFor(r * 2);

    if (!_redactScratch) _redactScratch = document.createElement('canvas');
    if (_redactScratch.width !== bw)  _redactScratch.width  = bw;
    if (_redactScratch.height !== bh) _redactScratch.height = bh;
    const sctx = _redactScratch.getContext('2d');
    sctx.clearRect(0, 0, bw, bh);
    sctx.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, bw, bh);
    pixelateRegion(sctx, 0, 0, bw, bh, block);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(_redactScratch, bx, by);
    ctx.restore();
    return;
  }
  // rect (default)
  const block = blockSizeFor(Math.min(shape.w, shape.h));
  pixelateRegion(ctx, shape.x, shape.y, shape.w, shape.h, block);
}

// Double-stroke marching-ants outline for the in-progress selection.
// Thin white dashed line on top of a slightly wider black solid line —
// standard trick that reads on any background. The white line's dash
// offset is driven from outside so the caller can animate marching.
function drawSelectionOutline(ctx, shape, dashOffset) {
  const cw = ctx.canvas.width;
  const inner = Math.max(2, Math.round(cw / 800));
  const outer = inner + 2;

  function pathShape() {
    ctx.beginPath();
    if (shape.type === 'brush') {
      // Outline the stroke's centerline plus a ring at the last point so
      // the brush footprint is legible while painting.
      const pts = shape.pts;
      if (!pts.length) return;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      const last = pts[pts.length - 1];
      ctx.moveTo(last.x + shape.r, last.y);
      ctx.arc(last.x, last.y, Math.max(0.5, shape.r), 0, Math.PI * 2);
    } else if (shape.type === 'circle') {
      ctx.arc(shape.cx, shape.cy, Math.max(0.5, shape.r), 0, Math.PI * 2);
    } else {
      // half-pixel offset so a 1-px stroke sits sharp on the pixel grid
      ctx.rect(shape.x + 0.5, shape.y + 0.5, Math.max(0, shape.w - 1), Math.max(0, shape.h - 1));
    }
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
    const shapeRectBtn   = document.getElementById('redact-shape-rect');
    const shapeCircleBtn = document.getElementById('redact-shape-circle');
    const shapeBrushBtn  = document.getElementById('redact-shape-brush');
    const brushSizeWrap  = document.getElementById('redact-brush-size');
    const brushRange     = document.getElementById('redact-brush-range');
    const zoomOutBtn     = document.getElementById('redact-zoom-out');
    const zoomInBtn      = document.getElementById('redact-zoom-in');
    const zoomFitBtn     = document.getElementById('redact-zoom-fit');
    const zoomLabel      = document.getElementById('redact-zoom-label');

    const ctx = canvas.getContext('2d');
    const loupeCtx = loupe.getContext('2d');

    // Selection shape mode — 'rect' | 'circle' | 'brush'. Rect = corner-to-
    // corner drag; circle = center-out drag (pointerdown sets center, distance
    // sets radius); brush = paint a stroke, a bare tap drops one dot.
    let shapeMode = 'rect';
    // Brush radius as a fraction of canvas width, so the same slider position
    // means the same thing on every photo. Slider 1..100 → 0.3%..6% of width.
    let brushFrac = 0.015;
    function brushRadius() { return Math.max(3, Math.round(brushFrac * canvas.width)); }

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

    let boxes = [];                 // committed {x,y,w,h} in canvas-natural pixels
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
      undoBtn.disabled  = boxes.length === 0;
      clearBtn.disabled = boxes.length === 0;
      doneBtn.disabled  = boxes.length === 0;   // Done requires at least one box; skip covers "nothing to blur"
    }

    // Committed layer: original image + every committed shape pixelated on
    // top, cached offscreen. Rebuilt only when `boxes` changes. Every drag
    // and hover frame then starts from a single blit instead of re-running
    // pixelation for the whole list — matters once a photo has a dozen
    // shapes and the brush is repainting at 60fps.
    let committedCanvas = null;
    function rebuildCommitted() {
      if (!origCanvas) return;
      if (!committedCanvas) committedCanvas = document.createElement('canvas');
      if (committedCanvas.width !== canvas.width || committedCanvas.height !== canvas.height) {
        committedCanvas.width = canvas.width; committedCanvas.height = canvas.height;
      }
      const cctx = committedCanvas.getContext('2d');
      cctx.drawImage(origCanvas, 0, 0);
      boxes.forEach(function (b) { pixelateShape(cctx, b); });
    }
    // Base repaint onto the visible canvas. Does NOT draw the live drag
    // shape; that's layered by renderDragFrame.
    function repaintAllBoxes() {
      if (!committedCanvas) return;
      ctx.drawImage(committedCanvas, 0, 0);
    }
    function commitBoxes() { rebuildCommitted(); repaintAllBoxes(); setCount(); }

    function shapeHasArea(s) {
      if (!s) return false;
      if (s.type === 'brush')  return s.pts.length > 0;
      if (s.type === 'circle') return s.r > 0;
      return s.w > 0 && s.h > 0;
    }

    // Brush-only: a ring under the mouse while hovering so the user can
    // judge the size before committing. Touch has no hover; the loupe and
    // the live stroke cover that case.
    let hoverPoint = null;
    function renderHover() {
      repaintAllBoxes();
      if (hoverPoint && shapeMode === 'brush') {
        drawSelectionOutline(ctx, { type: 'brush', pts: [hoverPoint], r: brushRadius() }, 0);
      }
    }

    // Render one drag frame: base + committed shapes + live-pixelated
    // in-progress shape (rect or circle, whichever mode) + subtle white
    // highlight overlay + double-stroke marching-ants outline on top. Uses
    // pixelateShape so the circle preview is clipped to the arc — matches
    // the final committed result exactly.
    function renderDragFrame() {
      repaintAllBoxes();
      if (shapeHasArea(currentDrag)) {
        pixelateShape(ctx, currentDrag);
        // 10% white fill highlight — reads as "in-progress selection" vs
        // the plain pixelation of already-committed shapes. Subtle so it
        // doesn't wash out the pixelation preview underneath.
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        if (currentDrag.type === 'circle') {
          ctx.arc(currentDrag.cx, currentDrag.cy, currentDrag.r, 0, Math.PI * 2);
        } else {
          ctx.rect(currentDrag.x, currentDrag.y, currentDrag.w, currentDrag.h);
        }
        ctx.fill();
        ctx.restore();
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

    // Build the current drag shape from the pointer position, respecting mode.
    // rect:   startCanvas is one corner; drag extends the opposite corner.
    // circle: startCanvas IS the center; drag distance sets the radius.
    function makeDragShape(p) {
      if (shapeMode === 'brush') {
        // Brush accumulates rather than recomputes: extend the live stroke.
        const s = currentDrag && currentDrag.type === 'brush'
          ? currentDrag
          : { type: 'brush', pts: [], r: brushRadius() };
        const last = s.pts[s.pts.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1) {
          s.pts.push({ x: Math.round(p.x), y: Math.round(p.y) });
        }
        return s;
      }
      if (shapeMode === 'circle') {
        const dx = p.x - startCanvas.x, dy = p.y - startCanvas.y;
        return {
          type: 'circle',
          cx: Math.round(startCanvas.x),
          cy: Math.round(startCanvas.y),
          r:  Math.round(Math.sqrt(dx * dx + dy * dy)),
        };
      }
      return {
        type: 'rect',
        x: Math.round(Math.min(startCanvas.x, p.x)),
        y: Math.round(Math.min(startCanvas.y, p.y)),
        w: Math.round(Math.abs(p.x - startCanvas.x)),
        h: Math.round(Math.abs(p.y - startCanvas.y)),
      };
    }

    // Drop the in-progress shape without committing it. Used when a second
    // finger turns a drag into a pinch, and by pointercancel.
    function abandonDrag() {
      dragging = false;
      activePointerId = null;
      activePointerType = null;
      currentDrag = null;
      currentTouch = null;
      hideLoupe();
      repaintAllBoxes();
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
      currentDrag = makeDragShape(startCanvas);
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
        // Hover ring for the brush (mouse/pen only).
        if (shapeMode === 'brush' && e.pointerType !== 'touch' && origCanvas) {
          hoverPoint = toCanvasCoords(e);
          renderHover();
        }
        return;
      }
      if (e.pointerId !== activePointerId) return;
      const p = toCanvasCoords(e);
      currentDrag = makeDragShape(p);
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
      const wasTouch = activePointerType === 'touch';
      activePointerType = null;
      currentTouch = null;
      if (wasTouch) hideLoupe();
      const shape = makeDragShape(toCanvasCoords(e));
      currentDrag = null;
      // Below-threshold drag — treat as "meant to scroll / stray click".
      // Brush is exempt: a tap is a deliberate dot, and that is exactly the
      // gesture for a target too small to drag a box around.
      const tooSmall = shape.type === 'brush'  ? false
                     : shape.type === 'circle' ? shape.r < 8
                     : (shape.w < 8 || shape.h < 8);
      if (tooSmall) { repaintAllBoxes(); return; }
      boxes.push(shape);
      commitBoxes();                                // wipes fill + outline; commits pixelation
    }
    function onPointerCancel(e) {
      releaseTouch(e);
      abandonDrag();
    }
    function onPointerLeave() {
      if (hoverPoint) { hoverPoint = null; if (!dragging) repaintAllBoxes(); }
    }

    function onUndo() { boxes.pop(); commitBoxes(); }
    function onClear() { boxes = []; commitBoxes(); }

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
      shapeRectBtn.onclick = null; shapeCircleBtn.onclick = null; shapeBrushBtn.onclick = null;
      zoomInBtn.onclick = null; zoomOutBtn.onclick = null; zoomFitBtn.onclick = null;
      brushRange.oninput = null;
      // Reset toggle to default (Box) so the next modal open doesn't inherit
      // the previous session's circle/brush mode.
      setShapeMode('rect');
      overlay.removeEventListener('click', onBackdropClick);
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
    }
    function finishAsSkip()   { cleanup(); resolve(file); }
    function finishAsCancel() { cleanup(); resolve(null); }
    function finishAsDone() {
      if (boxes.length === 0) { finishAsSkip(); return; }   // guard — button *should* be disabled
      // Same MIME as input so JPEG stays JPEG (avoids double lossy re-encode
      // when normalizeImage does its own JPEG re-encode later); PNG stays PNG.
      const mime = (file.type === 'image/png' || file.type === 'image/webp') ? file.type : 'image/jpeg';
      const quality = mime === 'image/jpeg' ? 0.95 : undefined;
      canvas.toBlob(function (blob) {
        if (!blob) { cleanup(); resolve(file); return; }   // fall back to original if encoding fails
        const outFile = new File([blob], file.name, { type: mime });
        cleanup();
        resolve(outFile);
      }, mime, quality);
    }
    function onBackdropClick(e) { if (e.target === overlay) finishAsCancel(); }
    function onKeydown(e) { if (e.key === 'Escape') finishAsCancel(); }

    // Show shell + loading state before we decode — large phone photos take a beat.
    overlay.classList.add('open');
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
      shapeRectBtn.onclick   = function () { setShapeMode('rect');   };
      shapeCircleBtn.onclick = function () { setShapeMode('circle'); };
      shapeBrushBtn.onclick  = function () { setShapeMode('brush');  };
      zoomInBtn.onclick  = function () { zoomStep(1);  };
      zoomOutBtn.onclick = function () { zoomStep(-1); };
      zoomFitBtn.onclick = zoomFit;
      brushRange.oninput = function () {
        // 1..100 → 0.3%..6% of canvas width, eased so the low end (where
        // serial numbers live) gets most of the slider's travel.
        const t = brushRange.value / 100;
        brushFrac = 0.003 + (0.06 - 0.003) * t * t;
        if (hoverPoint) renderHover();
      };
      brushRange.oninput();
      overlay.addEventListener('click', onBackdropClick);
      document.addEventListener('keydown', onKeydown);
    };

    // Toggle helper — flips the segmented-control active state and updates
    // aria-pressed for screen readers. The shapeMode variable is what the
    // pointer handlers consult on each drag.
    function setShapeMode(mode) {
      shapeMode = mode;
      const btns = { rect: shapeRectBtn, circle: shapeCircleBtn, brush: shapeBrushBtn };
      Object.keys(btns).forEach(function (k) {
        btns[k].classList.toggle('active', k === mode);
        btns[k].setAttribute('aria-pressed', String(k === mode));
      });
      brushSizeWrap.classList.toggle('visible', mode === 'brush');
      canvas.classList.toggle('brush', mode === 'brush');
      if (mode !== 'brush' && hoverPoint) { hoverPoint = null; if (origCanvas) repaintAllBoxes(); }
    }
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
