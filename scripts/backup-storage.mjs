#!/usr/bin/env node
// backup-storage.mjs — copy every Supabase storage object out of Supabase
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
// Supabase's daily backups cover the DATABASE, not STORAGE. Every build photo
// on gunforma therefore exists in exactly one place. The database can be
// restored from a snapshot; the photos cannot be restored from anything. With
// ~20 founding builders about to upload pictures of guns they built, that is
// the one class of data here that is genuinely irreplaceable — a lost parts
// row can be retyped, a lost photo cannot.
//
// WHERE THE COPIES GO — and why not a second bucket
// A second Supabase bucket fails the only test that matters: one leaked or
// mistaken service-role key deletes the original AND the copy, because the
// same credential reaches both. Same for anything else inside the project.
//
// This script only ever writes to a local directory. Getting the bytes off
// Supabase entirely is the workflow's job, and it does it twice:
//
//   1. a GitHub Actions artifact, always. Written with the workflow's own
//      GITHUB_TOKEN, which cannot touch Supabase storage, while the Supabase
//      service key cannot touch GitHub artifacts. Different provider,
//      different credential, no overlap in blast radius. Capped at 90 days
//      retention, so it is a rolling window rather than an archive.
//
//   2. Cloudflare R2, when R2_* secrets are present. Separate provider,
//      separate credential, no expiry, and effectively free at this size.
//      This is the durable tier; the artifact is the floor that works with
//      zero setup.
//
// Committing the backup into this repo was considered and rejected outright:
// netlify.toml publishes the repo root, so anything committed here becomes a
// public URL on gunforma.com. Backups of user photos must not be a website.
//
// Env:
//   SUPABASE_SERVICE_ROLE_KEY  required — lists and reads every object
//   SUPABASE_URL               optional, defaults to the Gunforma project
//
// Usage:
//   node backup-storage.mjs --out ./storage-backup
//   node backup-storage.mjs --out ./storage-backup --previous ./prev/manifest.json
//   node backup-storage.mjs --buckets build-photos --dry-run
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ─── args ───────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const OUT_DIR   = path.resolve(arg('out', './storage-backup'));
const PREV_PATH = arg('previous', '');
const DRY_RUN   = process.argv.includes('--dry-run');
const BUCKETS   = arg('buckets', 'build-photos,avatars,product-images').split(',').map(s => s.trim()).filter(Boolean);

// A run that comes back with materially fewer objects than the last one is
// what a partial download, a truncated listing or a botched delete looks
// like. 0.90 = fail if more than 10% of the objects have vanished.
const DROP_THRESHOLD = Number(arg('drop-threshold', '0.90'));

const LIST_PAGE  = 100;
const REQ_TIMEOUT_MS = 30000;

// ─── logging ────────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
function c(color, s) {
  if (!isTTY) return s;
  const codes = { grey:90, red:31, green:32, yellow:33, magenta:35, cyan:36, bold:1 };
  return `\x1b[${codes[color] || 0}m${s}\x1b[0m`;
}
const log  = (m) => console.log(m);
const warn = (m) => console.log(c('yellow', 'warn:  ') + m);
function fail(msg, detail) {
  console.error('');
  console.error(c('red', 'FAIL') + ' ' + msg);
  if (detail) {
    const t = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
    for (const line of String(t).split('\n')) console.error('  ' + line);
  }
  console.error('');
  process.exit(1);
}
const human = (n) => {
  if (n < 1024) return n + ' B';
  const u = ['kB','MB','GB','TB']; let i = -1; let v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return v.toFixed(v < 10 ? 1 : 0) + ' ' + u[i];
};

// ─── http ───────────────────────────────────────────────────────────────────
async function req(url, options = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQ_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: ctl.signal,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function describe(res) {
  let body = '';
  try { body = await res.text(); } catch { body = '(unreadable)'; }
  return `HTTP ${res.status} ${res.statusText} — ${body.slice(0, 400) || '(empty body)'}`;
}

// ─── listing ────────────────────────────────────────────────────────────────
// The storage list API is prefix-based and returns only the IMMEDIATE children
// of a prefix. Folders come back as entries with a null id. build-photos keys
// look like <uid>/<draftId>/<slot>-<ts>.jpg, so a flat listing of the bucket
// root returns three folders and zero files — which is exactly what "backed up
// 0 objects, all good" would have looked like. Hence the recursion.
async function listPrefix(bucket, prefix, out, depth = 0) {
  if (depth > 12) fail(`listing recursed past 12 levels in ${bucket} at "${prefix}" — refusing to continue`);
  let offset = 0;
  for (;;) {
    const res = await req(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) fail(`listing ${bucket} at "${prefix}" failed`, await describe(res));

    const page = await res.json();
    if (!Array.isArray(page)) fail(`listing ${bucket} returned a non-array`, JSON.stringify(page).slice(0, 300));
    if (page.length === 0) break;

    for (const entry of page) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || entry.id === undefined) {
        await listPrefix(bucket, full, out, depth + 1);   // folder
      } else {
        out.push({
          path: full,
          size: Number(entry.metadata?.size ?? -1),
          mime: entry.metadata?.mimetype || null,
          updated_at: entry.updated_at || null,
        });
      }
    }
    if (page.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return out;
}

// ─── download ───────────────────────────────────────────────────────────────
async function download(bucket, obj) {
  const encoded = obj.path.split('/').map(encodeURIComponent).join('/');
  const res = await req(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encoded}`);
  if (!res.ok) throw new Error(`download failed: ${await describe(res)}`);

  const bytes = Buffer.from(await res.arrayBuffer());

  // A short read is the failure this whole script exists to notice. The
  // listing already told us the size, so disagreeing with it means the copy
  // is not the original — treat it as fatal, never as "mostly fine".
  if (obj.size >= 0 && bytes.length !== obj.size) {
    throw new Error(`size mismatch: listing said ${obj.size} bytes, downloaded ${bytes.length}`);
  }

  const dest = path.join(OUT_DIR, bucket, ...obj.path.split('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);

  return {
    path: obj.path,
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    mime: obj.mime,
    updated_at: obj.updated_at,
  };
}

// ─── drop guard ─────────────────────────────────────────────────────────────
// Per bucket AND in total. Totals alone would hide a bucket emptying itself
// while another grows, which is precisely the shape of an accidental prefix
// delete.
function checkDrop(manifest, previous) {
  if (!previous) {
    warn('no previous manifest — drop check skipped (first run, or the last run left no manifest)');
    return [];
  }
  const problems = [];
  const check = (label, now, before) => {
    if (before === 0) return;                       // nothing to drop from
    if (now >= before) return;
    const kept = now / before;
    if (kept < DROP_THRESHOLD) {
      problems.push(
        `${label}: ${before} → ${now} (${Math.round((1 - kept) * 100)}% gone, limit ${Math.round((1 - DROP_THRESHOLD) * 100)}%)`
      );
    }
  };

  for (const [name, cur] of Object.entries(manifest.buckets)) {
    const prev = previous.buckets?.[name];
    if (!prev) continue;
    check(`${name} objects`, cur.objects, prev.objects);
    // Bytes as well: a file replaced by a truncated copy keeps the count
    // identical and would otherwise pass unnoticed.
    check(`${name} bytes`,   cur.bytes,   prev.bytes);
  }
  check('total objects', manifest.totals.objects, previous.totals?.objects ?? 0);
  check('total bytes',   manifest.totals.bytes,   previous.totals?.bytes   ?? 0);
  return problems;
}

// ─── main ───────────────────────────────────────────────────────────────────
(async function main() {
  if (!SERVICE_KEY) {
    fail('SUPABASE_SERVICE_ROLE_KEY is required', {
      why: 'listing and reading every object needs the service role; the anon key cannot see private paths',
      local: "SUPABASE_SERVICE_ROLE_KEY='...' node backup-storage.mjs --out ./storage-backup",
    });
  }

  log(c('bold', 'gunforma storage backup') + c('grey', `  ${new Date().toISOString()}`));
  log(c('grey', `project ${SUPABASE_URL}`));
  log(c('grey', `buckets ${BUCKETS.join(', ')}`));
  log(c('grey', `out     ${OUT_DIR}${DRY_RUN ? '  (DRY RUN — nothing will be written)' : ''}`));
  log('');

  let previous = null;
  if (PREV_PATH) {
    try {
      previous = JSON.parse(fs.readFileSync(PREV_PATH, 'utf8'));
      log(c('grey', `previous manifest: ${PREV_PATH} (${previous.totals?.objects ?? '?'} objects, generated ${previous.generated_at || '?'})`));
    } catch (e) {
      // Not fatal on its own — but it does mean this run has nothing to
      // compare against, which the summary has to say out loud.
      warn(`could not read previous manifest at ${PREV_PATH}: ${e.message}`);
    }
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    project: SUPABASE_URL,
    buckets: {},
    totals: { objects: 0, bytes: 0 },
  };
  const failures = [];

  for (const bucket of BUCKETS) {
    const objects = await listPrefix(bucket, '', []);
    const files = [];
    let bytes = 0;

    for (const obj of objects) {
      if (DRY_RUN) {
        files.push({ path: obj.path, size: obj.size, sha256: null, mime: obj.mime, updated_at: obj.updated_at });
        bytes += Math.max(obj.size, 0);
        continue;
      }
      try {
        const rec = await download(bucket, obj);
        files.push(rec);
        bytes += rec.size;
      } catch (e) {
        failures.push(`${bucket}/${obj.path}: ${e.message}`);
      }
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    manifest.buckets[bucket] = { objects: files.length, bytes, files };
    manifest.totals.objects += files.length;
    manifest.totals.bytes   += bytes;

    const note = objects.length === 0 ? c('grey', '(empty)') : `${human(bytes)}`;
    log(`${c(objects.length ? 'green' : 'grey', '•')} ${bucket.padEnd(16)} ${String(files.length).padStart(5)} objects  ${note}`);
  }

  // A partial copy must never be recorded as a good one — the manifest is
  // what the next run compares against, so writing it after a failed download
  // would bake the loss in as the new normal.
  if (failures.length) {
    fail(`${failures.length} object(s) could not be backed up — the copy is incomplete`, failures.join('\n'));
  }

  if (!DRY_RUN) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  log('');
  log(`${c('bold', 'total')}  ${manifest.totals.objects} objects, ${human(manifest.totals.bytes)}`);

  const problems = checkDrop(manifest, previous);
  if (problems.length) {
    fail('object count or size dropped sharply since the last run', [
      ...problems,
      '',
      'This is what a partial run, a truncated listing or an accidental delete',
      'looks like. The files downloaded this run are still in the output dir —',
      'nothing was deleted — but do not treat this as a good backup until the',
      'drop is explained.',
    ].join('\n'));
  }

  if (previous) log(c('grey', `drop check passed (previous run: ${previous.totals?.objects ?? '?'} objects)`));
  log('');
  log(c('green', 'OK') + (DRY_RUN ? ' — dry run, nothing written' : ` — backup written to ${OUT_DIR}`));
})().catch((e) => fail('unexpected error', e?.stack || String(e)));
