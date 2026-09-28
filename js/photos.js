// js/photos.js — the build-photo uploader: slots, upload pipeline, and the
// full-size preview overlay.
//
// Shared, verbatim, by every page that puts a photo on a build:
//   gunforma-post-build.html   — a builder posting or editing their own build
//   gunforma-admin-post.html   — an admin posting on a builder's behalf
//
// Loaded as a plain <script src> global, the same way js/redact.js and
// js/affiliate.js are — there is no bundler, so this file is the whole
// module. It owns its CSS, its grid markup and its overlay markup, and
// injects all three, because the alternative is what this file replaces.
//
// WHY THIS IS ONE FILE. The two pages used to carry copy-pasted versions of
// thirteen functions and ~60 CSS rules, and it drifted twice:
//
//   - the admin page had no redact gate at all until PR #62, so there was no
//     way to blur a serial when posting on someone else's behalf
//   - it then missed every part of PR #65 — the preview overlay, square
//     slots, the fixed action strip, the keyboard-reachable slots and the
//     read-the-result storage deletes — so an admin could blur a serial and
//     had no way to confirm the blur had landed
//
// js/redact.js, being shared, delivered the iOS pinch-zoom fix to both pages
// without anyone having to remember the second one. That is the whole point.
//
// USAGE. Each page calls init() once, after its own auth has resolved:
//
//   PhotoUploader.init({
//     mount:    '#photo-grid-mount',   // the grid, messages and file input go here
//     photos:   () => state.photos,    // live getter, see below
//     ownerId:  () => currentUser.id,  // currentAdmin.id on the admin page
//     draftId:  () => draftId,         // storage folder for this draft
//     onChange: renderSidebar,         // called after any change to the photo set
//   });
//
// Every one of those is a FUNCTION, deliberately:
//
//   - `photos` because gunforma-admin-post.html's postAnother() replaces
//     state.photos wholesale to chain builds without a reload. A captured
//     reference would leave the module writing into the old object.
//   - `draftId` because gunforma-post-build.html reassigns it when it loads
//     an existing build to edit, so photos land in that build's folder.
//   - `ownerId` because it is not set until the auth gate resolves, which is
//     after the script has run.
//
// The page still owns state.photos — the module reads and writes it through
// that getter, and the submit step reads it directly, unchanged.
(function () {
'use strict';

// The four slots, in order. 'hero' is canonical: both pages' insert reads
// slot === 'hero' → is_hero, so promoting a photo moves the ENTRY between
// slots rather than tagging it.
const SLOTS = [
  { key: 'hero', empty: 'Add hero photo', filled: 'Hero photo set' },
  { key: 'g1',   empty: 'Add photo',      filled: 'Photo added'    },
  { key: 'g2',   empty: 'Add photo',      filled: 'Photo added'    },
  { key: 'g3',   empty: 'Add photo',      filled: 'Photo added'    },
];
const SLOT_KEYS = SLOTS.map(function (s) { return s.key; });
function slotLabel(key, filled) {
  const s = SLOTS.find(function (x) { return x.key === key; });
  return filled ? s.filled : s.empty;
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;      // matches the bucket's server-side limit
// Two stored sizes per photo — one plan tier away from just using Storage's
// on-the-fly transform API and dropping this, but that's Pro-only and this
// project is on the free plan.
const DISPLAY_MAX_DIMENSION = 1600;            // long edge, px — hero/full view
const DISPLAY_JPEG_QUALITY = 0.80;
const THUMB_MAX_DIMENSION = 480;               // long edge, px — grid/card views
const THUMB_JPEG_QUALITY = 0.70;
const BUCKET = 'build-photos';

// Shown under the photo grid AND inside the preview overlay, because the
// overlay is what is on screen immediately after a re-blur.
const STALE_COPY_NOTICE =
  'Your new blur is saved, and that version is the one that gets posted. The ' +
  'earlier, less-blurred copy could not be deleted from storage — it is not ' +
  'attached to this build and will not be published, but it has not been ' +
  'erased either.';

const PHOTOS_CSS = `
/* PHOTOS */
/* Square slots (matching .existing-photo on the edit grid), hero still visibly bigger:
   the hero column is 1.6fr and every slot is aspect-ratio 1/1, so the hero
   is a larger SQUARE rather than a wider letterbox. align-items:center
   floats the three smaller squares on the hero's centreline instead of
   stretching them back into portraits. */
.photo-grid { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; gap: 8px; align-items: center; }
.photo-slot { background: #fafaf8; border: 1px dashed #d9d6cc; border-radius: 6px; aspect-ratio: 1/1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; cursor: pointer; transition: all 0.15s; text-align: center; padding: 8px; position: relative; overflow: hidden; }
.photo-slot:hover { border-color: #4a9edd; background: #f0f6fc; }
/* The slot is the control now — see .photo-slot-hint — so it is in the tab
   order and has to show where focus is. */
.photo-slot:focus-visible { outline: 2px solid #4a9edd; outline-offset: 2px; }
.photo-slot.filled { border-style: solid; border-color: #4a9edd; background: #eaf4fc; }
.photo-slot.uploading { border-style: solid; border-color: #f9b860; background: #fef3e2; cursor: default; }
.photo-slot.error { border-style: solid; border-color: #e25c3a; background: #fde8e2; }
.photo-slot-icon { font-size: 20px; color: #ccc; position: relative; z-index: 1; }
.photo-slot.filled .photo-slot-icon { color: #2a7bbd; }
.photo-slot-label { font-size: 10px; color: #999; position: relative; z-index: 1; }
.photo-slot.filled .photo-slot-label { color: #1d6fb8; font-weight: 700; }
.photo-slot-preview { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: none; }
.photo-slot.filled .photo-slot-preview { display: block; }
/* A filled slot is now big enough to actually read, so the ✓ and its label
   stop sitting in the middle of the photo the user is trying to look at.
   The JS still writes them (setSlotFilled/clearSlot are untouched); they
   are just not shown once there is an image behind them. */
.photo-slot.filled .photo-slot-icon, .photo-slot.filled .photo-slot-label { display: none; }
/* Hero-badge + hover actions + drag-over target state */
.photo-slot-hero-badge { position: absolute; top: 6px; left: 6px; z-index: 3; display: none; background: #f9b860; color: #4a3c14; font-size: 9px; font-weight: 700; padding: 3px 8px; border-radius: 3px; letter-spacing: 0.1em; text-transform: uppercase; pointer-events: none; }
.photo-slot.filled[data-slot="hero"] .photo-slot-hero-badge { display: block; }
/* This strip used to hold a Set-as-main and a Remove button revealed on
   :hover. It only ever animated OPACITY, while \`.photo-slot.filled
   .photo-slot-actions\` set pointer-events:auto unconditionally — so on a
   filled slot both buttons stayed hit-testable and focusable while
   invisible. Measured on the real page: they sat at tab position 11 of 35,
   opacity:0 hides the focus ring too, and Enter on the unseeable one
   deleted the photo and its storage objects. Every action they offered is
   now in the preview overlay that a tap or click on the photo opens, so
   what is left here is a caption: no buttons, nothing focusable, and
   pointer-events:none so the click always reaches the slot. */
.photo-slot-hint { position: absolute; bottom: 0; left: 0; right: 0; z-index: 3; display: none; align-items: center; justify-content: center; gap: 5px; padding: 7px 8px; background: linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.5) 70%, rgba(0,0,0,0) 100%); color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; pointer-events: none; }
.photo-slot.filled .photo-slot-hint { display: flex; }
/* Amber, not red: whatever the user asked for did happen. */
.photo-warning { display: flex; gap: 7px; align-items: flex-start; margin-top: 8px; padding: 9px 11px; background: #fff8ea; border: 0.5px solid #e8d9ad; border-radius: 6px; font-size: 11px; line-height: 1.6; color: #6b5a2a; }
.photo-warning::before { content: '⚠'; flex-shrink: 0; }
.photo-slot.drag-over { border-style: dashed !important; border-color: #d4a853 !important; background: #fdf6e6 !important; transform: scale(1.02); transition: transform 0.1s, border-color 0.1s, background 0.1s; }

/* ===== PHOTO PREVIEW — the whole photo, uncropped =====
   A slot thumbnail is square and object-fit:cover, which answers "is there
   a photo here" and cannot answer "did the blur actually land on the
   serial". This is where that gets confirmed, at the largest size the
   screen allows, before the build is submitted. Sits BELOW the redact
   modal's z-index on purpose: Edit blur hands off to that modal. */
.photo-preview { position: fixed; inset: 0; z-index: 900; background: rgba(14,15,17,0.9); display: none; align-items: center; justify-content: center; padding: 20px; }
.photo-preview.open { display: flex; }
.photo-preview-panel { background: #fff; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); width: 100%; max-width: 1100px; height: calc(100vh - 40px); display: flex; flex-direction: column; overflow: hidden; }
.photo-preview-head { padding: 12px 18px; border-bottom: 0.5px solid #e5e5e5; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.photo-preview-title { font-size: 13px; font-weight: 700; color: #1a1a1a; letter-spacing: 0.04em; }
.photo-preview-sub { font-size: 11px; color: #666; }
/* The overlay reopens on top of the photo grid after a re-blur, so a
   message left under the grid would be behind it. Anything the user has
   to be told about the photo they are looking at is told here too. */
.photo-preview-notice { flex-basis: 100%; display: flex; gap: 7px; align-items: flex-start; margin-top: 8px; padding: 9px 11px; background: #fff8ea; border: 0.5px solid #e8d9ad; border-radius: 6px; font-size: 11px; line-height: 1.6; color: #6b5a2a; }
.photo-preview-notice::before { content: '⚠'; flex-shrink: 0; }
/* Dark stage + object-fit:contain — the whole frame, letterboxed against
   the backdrop rather than cropped to fill. */
.photo-preview-stage { flex: 1; min-height: 150px; background: #14151a; display: flex; align-items: center; justify-content: center; padding: 12px; overflow: hidden; }
.photo-preview-stage img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.photo-preview-bar { padding: 12px 18px; border-top: 0.5px solid #e5e5e5; background: #fafaf8; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.photo-preview-btn { font-family: inherit; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; padding: 9px 14px; border-radius: 4px; cursor: pointer; border: 0.5px solid #d9d6cc; background: #fff; color: #444; transition: filter 0.15s, background 0.15s; }
.photo-preview-btn:hover { filter: brightness(1.05); }
.photo-preview-btn.danger { color: #c25d3a; border-color: #e6c3b6; }
.photo-preview-btn.danger:hover { background: #fdf0ec; }
.photo-preview-btn.primary { background: #4a9edd; color: #fff; border-color: #4a9edd; margin-left: auto; }

@media (max-width: 640px) {
  .photo-preview { padding: 0; }
  .photo-preview-panel {
    max-width: none; border-radius: 0;
    height: 100vh;
    /* Same lesson as the redact modal: vh keeps the tall value while
       Safari's URL bar is collapsing and pushes the action row off the
       bottom; dvh tracks it. The vh line above is the fallback. */
    height: 100dvh;
  }
  .photo-preview-head { padding: 10px 12px; }
  .photo-preview-sub { display: none; }
  .photo-preview-stage { padding: 6px; }
  /* Three actions on one row, Done on its own — four across a 375px phone
     leaves each one too narrow to hit, and Remove is the last button that
     should be cramped next to anything. The bottom padding clears the
     iPhone home indicator the same way the redact toolbar does. */
  .photo-preview-bar { padding: 12px 12px calc(20px + env(safe-area-inset-bottom, 0px)); gap: 8px; }
  /* 44px minimum, the same floor the redact toolbar got — these were
     37px, which is the size the redact modal's controls were before
     they were measured on a phone. This is the overlay a builder is
     squinting at to decide whether a serial is covered, and Remove
     is one of the buttons on it. */
  .photo-preview-btn { flex: 1; min-width: 0; min-height: 44px; padding: 0 6px; font-size: 11px; text-align: center; }
  .photo-preview-btn.primary { margin-left: 0; flex-basis: 100%; order: 9; }
}

/* The grid's own breakpoint. It used to live in each page's layout media
   query, which is how the admin page ended up with a copy of it. */
@media (max-width: 900px) {
  .photo-grid { grid-template-columns: repeat(2, 1fr); }
}
`;

// The preview overlay. Injected into document.body on first use rather than
// asked of each page, for the same reason the CSS is.
const PREVIEW_HTML = `
<div class="photo-preview" id="photo-preview" role="dialog" aria-modal="true"
     aria-label="Photo preview">
  <div class="photo-preview-panel">
    <div class="photo-preview-head">
      <span class="photo-preview-title" id="photo-preview-title">Photo</span>
      <span class="photo-preview-sub">Check that anything you blurred is actually covered before you post.</span>
      <div class="photo-preview-notice" id="photo-preview-notice" role="status" style="display:none;"></div>
    </div>
    <div class="photo-preview-stage">
      <img id="photo-preview-img" alt="Full-size view of the photo you added" />
    </div>
    <div class="photo-preview-bar">
      <button type="button" class="photo-preview-btn" id="photo-preview-edit">✎ Edit blur</button>
      <button type="button" class="photo-preview-btn" id="photo-preview-hero">★ Set as main</button>
      <button type="button" class="photo-preview-btn danger" id="photo-preview-remove">✕ Remove</button>
      <button type="button" class="photo-preview-btn primary" id="photo-preview-done">Done</button>
    </div>
  </div>
</div>
`;

// The grid, the two message lines and the file input. Rendered into the
// page's mount point by init(). Handlers are attached in JS rather than as
// inline onclick attributes, so none of this needs a global name — which is
// what let the two pages' copies drift apart in the first place.
function gridHTML() {
  const slots = SLOTS.map(function (s) {
    return '' +
      '<div class="photo-slot" data-slot="' + s.key + '" id="slot-' + s.key + '" role="button" tabindex="0">' +
        '<img class="photo-slot-preview" id="preview-' + s.key + '" alt="" />' +
        '<div class="photo-slot-icon">⊕</div><div class="photo-slot-label">' + s.empty + '</div>' +
        '<div class="photo-slot-hero-badge">★ Main</div>' +
        '<div class="photo-slot-hint">⤢ View &amp; edit</div>' +
      '</div>';
  }).join('');
  return '' +
    '<div class="photo-grid">' + slots + '</div>' +
    '<div class="field-sub" id="photo-error" style="color:#c25d3a;display:none;"></div>' +
    // Distinct from #photo-error: the action SUCCEEDED, and something about
    // it still needs saying. Sticky on purpose — it describes a condition
    // that is still true, so no later action clears it.
    '<div class="photo-warning" id="photo-warning" role="status" style="display:none;"></div>' +
    '<input type="file" id="photo-file-input" accept="image/jpeg,image/png,image/webp" style="display:none" />';
}

// ─── WIRING ───────────────────────────────────────────────────────────────

let cfg = null;
let mounted = false;
let activeSlot = null;    // which slot the file picker / drop is filling
let previewSlot = null;   // which slot the overlay is showing

function photos()  { return cfg.photos(); }
function el(id)    { return document.getElementById(id); }
function slotEl(k) { return document.getElementById('slot-' + k); }

function mountStyles() {
  if (document.getElementById('photo-uploader-styles')) return;
  const style = document.createElement('style');
  style.id = 'photo-uploader-styles';
  style.textContent = PHOTOS_CSS;
  document.head.appendChild(style);
}
function mountPreview() {
  if (document.getElementById('photo-preview')) return;
  const host = document.createElement('div');
  host.innerHTML = PREVIEW_HTML;
  while (host.firstChild) document.body.appendChild(host.firstChild);
  el('photo-preview').addEventListener('click', function (e) {
    if (e.target.id === 'photo-preview') closePhotoPreview();
  });
  el('photo-preview-edit').addEventListener('click', previewEditBlur);
  el('photo-preview-hero').addEventListener('click', previewSetAsHero);
  el('photo-preview-remove').addEventListener('click', previewRemove);
  el('photo-preview-done').addEventListener('click', closePhotoPreview);
}
function mountGrid(mount) {
  const host = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!host) throw new Error('PhotoUploader.init: mount point not found: ' + mount);
  host.innerHTML = gridHTML();
  SLOT_KEYS.forEach(function (key) {
    const node = slotEl(key);
    node.addEventListener('click', function () { onSlotClick(key); });
    // The slot carries the click, so it is in the tab order (role=button,
    // tabindex=0) and has to answer the keyboard too.
    node.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      onSlotClick(key);
    });
    node.addEventListener('dragover',  function (e) { onSlotDragOver(e, key); });
    node.addEventListener('dragleave', function ()  { node.classList.remove('drag-over'); });
    node.addEventListener('drop',      function (e) { onSlotDrop(e, key); });
  });
  el('photo-file-input').addEventListener('change', onFileSelected);
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────

function photoError(msg) {
  const node = el('photo-error');
  if (!node) return;
  node.textContent = msg;
  node.style.display = msg ? 'block' : 'none';
}

// For the case photoError does not cover: the thing the user asked for
// worked, and something about it still has to be said. Independent of
// photoError and deliberately sticky — nothing clears it, because what it
// reports (bytes still sitting in storage) stays true until someone deals
// with it. Clearing it on the next unrelated click would be the same kind
// of quiet-on-the-way-up that it exists to prevent.
function photoWarning(msg) {
  const node = el('photo-warning');
  if (!node) return;
  node.textContent = msg;
  node.style.display = msg ? 'flex' : 'none';
}

// ─── SLOT UI ──────────────────────────────────────────────────────────────

function setSlotUploading(slot) {
  photos()[slot] = { uploading: true };
  const node = slotEl(slot);
  node.classList.remove('filled', 'error'); node.classList.add('uploading');
  node.querySelector('.photo-slot-icon').textContent = '…';
  node.querySelector('.photo-slot-label').textContent = 'Uploading…';
}
function setSlotPreview(slot, url) { el('preview-' + slot).src = url; }
function setSlotFilled(slot) {
  const node = slotEl(slot);
  node.classList.remove('uploading', 'error'); node.classList.add('filled');
  node.querySelector('.photo-slot-icon').textContent = '✓';
  node.querySelector('.photo-slot-label').textContent = slotLabel(slot, true);
}
function clearSlot(slot) {
  const node = slotEl(slot);
  node.classList.remove('filled', 'uploading', 'error');
  el('preview-' + slot).removeAttribute('src');
  node.querySelector('.photo-slot-icon').textContent = '⊕';
  node.querySelector('.photo-slot-label').textContent = slotLabel(slot, false);
}
// Repaint one slot from its current entry — used after a hero swap, where
// the slot key does not move but the photo under it does.
function syncSlotUI(slot) {
  const node = slotEl(slot);
  const img = el('preview-' + slot);
  const data = photos()[slot];
  if (!data) { clearSlot(slot); return; }
  if (data.uploading) { setSlotUploading(slot); return; }
  node.classList.remove('uploading', 'error', 'drag-over');
  node.classList.add('filled');
  node.querySelector('.photo-slot-icon').textContent = '✓';
  node.querySelector('.photo-slot-label').textContent = slotLabel(slot, true);
  if (data.previewUrl) img.src = data.previewUrl;
}

// ─── INPUT ────────────────────────────────────────────────────────────────

function onSlotClick(slot) {
  const cur = photos()[slot];
  if (cur && cur.uploading) return;
  // A filled slot opens the photo full size. It used to do nothing at all,
  // which left the hover-only action strip as the only way to touch a
  // photo once it was uploaded — and no way whatsoever to look at one.
  if (cur) { openPhotoPreview(slot); return; }
  activeSlot = slot;
  el('photo-file-input').click();
}

// Drag-and-drop from Finder/desktop straight onto a slot. The drop path
// runs the same validation + normalize + upload pipeline as the click path
// via processFile — the file input just supplies the File a different way.
function onSlotDragOver(e, slot) {
  e.preventDefault();
  const cur = photos()[slot];
  if (cur && cur.uploading) { e.dataTransfer.dropEffect = 'none'; return; }
  e.dataTransfer.dropEffect = 'copy';
  slotEl(slot).classList.add('drag-over');
}
async function onSlotDrop(e, slot) {
  e.preventDefault();
  slotEl(slot).classList.remove('drag-over');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  const cur = photos()[slot];
  if (cur && cur.uploading) return;
  if (cur) { await removePhoto(slot); }         // drop replaces existing photo
  activeSlot = slot;
  await processFile(file);
}
async function onFileSelected(event) {
  const file = event.target.files[0];
  event.target.value = '';                       // allow re-selecting the same file later
  await processFile(file);
}

// Promote any filled non-hero slot by swapping photo objects between slots
// — the hero slot key stays canonical (both pages' insert reads
// slot === 'hero' → is_hero), so nothing changes about how photo rows are
// written; only which photo occupies the "hero" seat.
function setAsHero(slot) {
  if (slot === 'hero') return;
  const store = photos();
  const incoming = store[slot];
  if (!incoming || incoming.uploading) return;
  const heroCur = store.hero;
  store.hero = incoming;
  store[slot] = heroCur;
  syncSlotUI('hero');
  syncSlotUI(slot);
  cfg.onChange();
}

// ─── PIPELINE ─────────────────────────────────────────────────────────────

// The click path (onFileSelected) and the drop path (onSlotDrop) both funnel
// through here, so validation, redaction, normalize and upload are
// guaranteed identical — on both pages.
async function processFile(file) {
  const slot = activeSlot;
  if (!file || !slot) return;
  photoError('');

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    photoError('Please choose a JPEG, PNG, or WebP photo.');
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    photoError('That photo is too large — please choose one under 8MB.');
    return;
  }

  // Redact-before-upload gate. Opens the modal in js/redact.js, where the
  // user can pixelate sensitive regions (serial numbers, faces, addresses)
  // at full resolution. The resulting File is what continues down the
  // pipeline — nothing unredacted ever reaches normalizeImage/upload/preview.
  //   - resolves(File) → user hit Done (with boxes) or Skip
  //   - resolves(null) → user cancelled (Escape / outside click)
  // Posting on someone else's behalf is exactly when a serial is most likely
  // to slip through, since the photo came from the builder and the admin may
  // never have looked closely — which is why this lives here and not in a
  // page, and why the admin page shipped for a while without it.
  const redactedFile = await window.openRedactModal(file);
  if (!redactedFile) return;
  file = redactedFile;

  setSlotUploading(slot);

  let displayBlob, thumbBlob;
  try {
    const normalized = await normalizeImage(file);
    displayBlob = normalized.displayBlob;
    thumbBlob = normalized.thumbBlob;
  } catch (e) {
    console.error(e);
    photoError('Couldn\'t read that image — try a different file.');
    clearSlot(slot);
    photos()[slot] = null;
    return;
  }

  // Two object URLs per photo: the thumb drives the slot, the display
  // version drives the full-size preview. displayBlob itself is kept
  // because "Edit blur" re-opens the redact modal on it — that blob is the
  // redacted image as uploaded, so more blur lands on top of the blur
  // already there. The unredacted original is deliberately never kept.
  const previewUrl = URL.createObjectURL(thumbBlob);
  const displayUrl = URL.createObjectURL(displayBlob);
  setSlotPreview(slot, previewUrl);

  const up = await uploadPair(slot, displayBlob, thumbBlob);
  if (!up) {
    photoError('Upload failed — try again.');
    clearSlot(slot);
    photos()[slot] = null;
    revokeSlotUrls({ previewUrl: previewUrl, displayUrl: displayUrl });
    return;
  }

  photos()[slot] = {
    path: up.path, thumbPath: up.thumbPath, uploading: false,
    previewUrl: previewUrl, displayUrl: displayUrl, displayBlob: displayBlob,
  };
  setSlotFilled(slot);
  cfg.onChange();
}

// Put both sizes in the bucket under this draft's folder. Returns the two
// keys, or null after cleaning up whichever half did land — a lone display
// object with no thumbnail is an orphan nothing will ever reference.
async function uploadPair(slot, displayBlob, thumbBlob) {
  const base = cfg.ownerId() + '/' + cfg.draftId() + '/' + slot + '-' + Date.now();
  const path = base + '.jpg';
  const thumbPath = base + '-thumb.jpg';
  const opts = { contentType: 'image/jpeg', upsert: false };

  const [displayRes, thumbRes] = await Promise.all([
    window.sb.storage.from(BUCKET).upload(path, displayBlob, opts),
    window.sb.storage.from(BUCKET).upload(thumbPath, thumbBlob, opts),
  ]);

  if (displayRes.error || thumbRes.error) {
    console.error(displayRes.error || thumbRes.error);
    if (!displayRes.error) window.sb.storage.from(BUCKET).remove([path]);
    if (!thumbRes.error) window.sb.storage.from(BUCKET).remove([thumbPath]);
    return null;
  }
  return { path: path, thumbPath: thumbPath };
}

// Re-encodes through a canvas: normalizes to JPEG regardless of source
// format, strips all EXIF (including GPS — phone photos routinely embed
// geolocation, which nobody posting a carry gun photo wants published),
// and produces two sizes from the one decode — a display version for
// hero/full view and a small thumbnail for grid/card views, so a phone
// on cellular data isn't downloading a 1600px image to render a 100px
// thumbnail.
function normalizeImage(file) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(objectUrl);
      const w0 = img.naturalWidth, h0 = img.naturalHeight;
      if (!w0 || !h0) { reject(new Error('Image has no dimensions')); return; }

      function renderAt(maxDim, quality) {
        const scale = Math.min(1, maxDim / Math.max(w0, h0));
        const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        return new Promise(function (res, rej) {
          canvas.toBlob(function (blob) {
            if (!blob) { rej(new Error('Could not encode image')); return; }
            res(blob);
          }, 'image/jpeg', quality);
        });
      }

      Promise.all([
        renderAt(DISPLAY_MAX_DIMENSION, DISPLAY_JPEG_QUALITY),
        renderAt(THUMB_MAX_DIMENSION, THUMB_JPEG_QUALITY),
      ]).then(function (results) {
        resolve({ displayBlob: results[0], thumbBlob: results[1] });
      }).catch(reject);
    };
    img.onerror = function () { URL.revokeObjectURL(objectUrl); reject(new Error('Unsupported image')); };
    img.src = objectUrl;
  });
}

async function removePhoto(slot) {
  const cur = photos()[slot];
  if (!cur) return;
  photos()[slot] = null;
  clearSlot(slot);
  cfg.onChange();
  revokeSlotUrls(cur);
  // The slot is cleared client-side either way — but see deleteStoragePaths
  // for why a null error is not the thing to check, and say so rather than
  // discarding the answer. Lower stakes than the re-blur case: this file is
  // one the user chose to drop entirely, not a less-redacted version of one
  // they are keeping.
  const deleted = await deleteStoragePaths([cur.path, cur.thumbPath].filter(Boolean), 'a removed photo');
  if (!deleted) {
    photoWarning('Photo removed from your build. Its file could not be deleted ' +
                 'from storage — it will not be published, but it is still there.');
  }
}

function revokeSlotUrls(entry) {
  if (!entry) return;
  [entry.previewUrl, entry.displayUrl].forEach(function (u) {
    if (u) { try { URL.revokeObjectURL(u); } catch (_) { /* already revoked */ } }
  });
}

// storage.remove() resolves with the list of objects it ACTUALLY deleted,
// and that list is the fact worth reading. A null error says only that the
// request was accepted — a key that matched nothing comes back exactly the
// same way. Re-fetching the public URL is not a check either: a deleted
// object still answers 200 from the CDN, so that question has to be put to
// object metadata rather than to the cache.
async function deleteStoragePaths(paths, what) {
  if (!paths.length) return true;
  const { data, error } = await window.sb.storage.from(BUCKET).remove(paths);
  if (error) { console.error('storage delete failed for ' + what + ':', error); return false; }
  const gone = Array.isArray(data) ? data.length : 0;
  if (gone !== paths.length) {
    console.warn('storage delete matched only ' + gone + ' of ' + paths.length +
                 ' objects for ' + what + ':', paths, data);
    return false;
  }
  return true;
}

// ─── PREVIEW OVERLAY ──────────────────────────────────────────────────────
// A slot is a square, cover-cropped thumbnail. That is enough to answer
// "is there a photo here" and useless for "did the blur land on the
// serial" — so tapping or clicking a filled slot opens the photo at the
// largest size the screen allows, with the actions that used to be hidden
// in the slot's hover strip. Nothing here touches the database; the photo
// is already in storage and these only change which object a slot points
// at, which is what the submit step reads.

function openPhotoPreview(slot, notice) {
  const data = photos()[slot];
  if (!data || data.uploading) return;
  mountPreview();
  previewSlot = slot;
  // Per-open, not sticky: it belongs to the action that just happened to
  // this photo. The copy under the photo grid is the one that persists.
  const noticeEl = el('photo-preview-notice');
  noticeEl.textContent = notice || '';
  noticeEl.style.display = notice ? 'flex' : 'none';
  // displayUrl is the 1600px version; previewUrl (the 480px thumb) is only
  // a fallback for an entry that predates it.
  el('photo-preview-img').src = data.displayUrl || data.previewUrl;
  el('photo-preview-title').textContent = slot === 'hero' ? '★ Main photo' : 'Photo';
  // Nothing to promote when you are already looking at the main photo.
  el('photo-preview-hero').style.display = slot === 'hero' ? 'none' : '';
  el('photo-preview').classList.add('open');
  document.addEventListener('keydown', onPhotoPreviewKey);
  el('photo-preview-done').focus();
}

function closePhotoPreview() {
  previewSlot = null;
  const overlay = el('photo-preview');
  if (!overlay) return;
  overlay.classList.remove('open');
  // Drop the src so a removed photo is not still being held open here.
  el('photo-preview-img').removeAttribute('src');
  document.removeEventListener('keydown', onPhotoPreviewKey);
}
function onPhotoPreviewKey(e) { if (e.key === 'Escape') closePhotoPreview(); }

// setAsHero swaps the two slots' entries, so the photo on screen moves to
// the 'hero' key. Re-open on that key rather than closing — the user asked
// to promote this photo, not to stop looking at it.
function previewSetAsHero() {
  const slot = previewSlot;
  if (!slot || slot === 'hero') return;
  setAsHero(slot);
  openPhotoPreview('hero');
}

// Close first: the thing the overlay is showing is about to stop existing.
async function previewRemove() {
  const slot = previewSlot;
  if (!slot) return;
  closePhotoPreview();
  await removePhoto(slot);
}

// Re-open the redact modal on a photo that is already uploaded, so more
// blur can be added once it has been seen full size. The modal is fed the
// display blob kept by processFile — the redacted image as uploaded — so
// new boxes stack on the existing blur instead of starting from an
// original this module never retains.
async function previewEditBlur() {
  const slot = previewSlot;
  const data = slot && photos()[slot];
  if (!data || data.uploading || !data.displayBlob) return;
  closePhotoPreview();                                  // the redact modal takes the screen
  const input = new File([data.displayBlob], 'photo.jpg', { type: 'image/jpeg' });
  const out = await window.openRedactModal(input);
  // null = cancelled, and Skip resolves the SAME File object back. Neither
  // is a change, so nothing is re-uploaded and nothing is deleted.
  if (!out || out === input) { openPhotoPreview(slot); return; }
  const res = await replaceSlotPhoto(slot, out);
  // null = the replacement itself failed; photoError under the grid says so
  // and the overlay stays shut so it can be read.
  if (!res) return;
  openPhotoPreview(slot, res.staleCopy ? STALE_COPY_NOTICE : null);
}

// Swap a slot's uploaded photo for a newly redacted version of itself.
// Order matters: the new objects go up FIRST and the old ones come down
// only once the new ones are stored. The other order loses the photo
// outright if the upload fails — and the copy being deleted here is the
// one with LESS blur on it, so leaving it behind on a failure is the safe
// direction to fail in.
async function replaceSlotPhoto(slot, file) {
  const old = photos()[slot];
  if (!old) return null;
  photoError('');
  setSlotUploading(slot);

  function restore() { photos()[slot] = old; syncSlotUI(slot); cfg.onChange(); }

  let normalized;
  try {
    normalized = await normalizeImage(file);
  } catch (e) {
    console.error(e);
    photoError('Couldn\'t re-encode that photo — the one you had is untouched.');
    restore();
    return null;
  }

  const up = await uploadPair(slot, normalized.displayBlob, normalized.thumbBlob);
  if (!up) {
    photoError('Upload failed — the photo you had is still there, with the blur it already had.');
    restore();
    return null;
  }

  const previewUrl = URL.createObjectURL(normalized.thumbBlob);
  const displayUrl = URL.createObjectURL(normalized.displayBlob);
  photos()[slot] = {
    path: up.path, thumbPath: up.thumbPath, uploading: false,
    previewUrl: previewUrl, displayUrl: displayUrl, displayBlob: normalized.displayBlob,
  };
  setSlotPreview(slot, previewUrl);
  setSlotFilled(slot);
  cfg.onChange();
  revokeSlotUrls(old);

  // Only now is the less-redacted copy safe to destroy. It must not
  // survive: it is the same photo with less of it covered up. If it does
  // survive, that is the one outcome here the user has to hear about —
  // the replacement worked, so nothing upstream fails, and a silent
  // partial delete would leave them believing the older version is gone.
  const deleted = await deleteStoragePaths([old.path, old.thumbPath].filter(Boolean),
                                           'the pre-blur copy of a re-blurred photo');
  if (!deleted) photoWarning(STALE_COPY_NOTICE);
  return { staleCopy: !deleted };
}

// ─── PUBLIC SURFACE ───────────────────────────────────────────────────────

window.PhotoUploader = {
  SLOTS: SLOT_KEYS,

  init: function (config) {
    ['mount', 'photos', 'ownerId', 'draftId', 'onChange'].forEach(function (k) {
      if (!config || !config[k]) throw new Error('PhotoUploader.init: missing ' + k);
    });
    cfg = config;
    mountStyles();
    mountGrid(config.mount);
    mounted = true;
    SLOT_KEYS.forEach(syncSlotUI);   // honour anything the page pre-seeded
  },

  // Empty every slot: revoke the object URLs, null the entries IN PLACE and
  // repaint. In place because gunforma-post-build.html's photoCount() and
  // both pages' submit step read state.photos directly — handing them a new
  // object would leave them reading a detached one. Storage is not touched:
  // the caller is starting a new draft, and the old draft's objects belong
  // to the build that was just published.
  reset: function () {
    if (!mounted) return;
    closePhotoPreview();
    const store = photos();
    SLOT_KEYS.forEach(function (key) {
      revokeSlotUrls(store[key]);
      store[key] = null;
      clearSlot(key);
    });
    photoError('');
    photoWarning('');
  },

  error: photoError,
  warn: photoWarning,
};
})();
