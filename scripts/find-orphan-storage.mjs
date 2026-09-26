#!/usr/bin/env node
// find-orphan-storage.mjs — objects in build-photos with no build_photos row
// -----------------------------------------------------------------------------
// Months of testing left files in the bucket whose rows are long gone: builds
// deleted before the delete path cleaned storage, uploads that failed after
// the object landed but before the row was written, admin posts from when
// /admin-post could not attach photos at all. Nothing references them, nothing
// serves them, and nothing was ever going to notice them.
//
// REPORTS BY DEFAULT. Deleting needs --delete, and prints the full list first.
// A tool that removes files from the only copy of irreplaceable photos should
// have to be asked twice, and the asking should be explicit rather than a
// confirmation prompt nobody reads.
//
// THE LISTING HAS TO RECURSE
// Same trap as scripts/backup-storage.mjs: the storage list API returns only
// the immediate children of a prefix, with folders as entries whose id is
// null. build-photos keys are <uid>/<draftId>/<file>, so a flat listing of the
// root returns folders and zero files — and this script would cheerfully
// report "no orphans" forever.
//
// Env:
//   SUPABASE_SERVICE_ROLE_KEY  required
//   SUPABASE_URL               optional, defaults to the Gunforma project
//
// Usage:
//   node find-orphan-storage.mjs                 # report only
//   node find-orphan-storage.mjs --delete        # report, then delete
//   node find-orphan-storage.mjs --bucket build-photos
// -----------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const BUCKET  = arg('bucket', 'build-photos');
const DELETE  = process.argv.includes('--delete');
const LIST_PAGE = 100;
const DELETE_BATCH = 50;

const isTTY = process.stdout.isTTY;
function c(color, s) {
  if (!isTTY) return s;
  const codes = { grey:90, red:31, green:32, yellow:33, magenta:35, cyan:36, bold:1 };
  return `\x1b[${codes[color] || 0}m${s}\x1b[0m`;
}
const log = (m) => console.log(m);
function fail(msg, detail) {
  console.error('');
  console.error(c('red', 'FAIL') + ' ' + msg);
  if (detail) for (const l of String(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)).split('\n')) console.error('  ' + l);
  console.error('');
  process.exit(1);
}
const human = (n) => {
  if (n < 1024) return n + ' B';
  const u = ['kB','MB','GB']; let i = -1, v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return v.toFixed(v < 10 ? 1 : 0) + ' ' + u[i];
};

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function describe(res) {
  let b = ''; try { b = await res.text(); } catch { b = '(unreadable)'; }
  return `HTTP ${res.status} ${res.statusText} — ${b.slice(0, 400) || '(empty)'}`;
}

// ─── every object in the bucket, recursively ────────────────────────────────
async function listAll(prefix, out, depth = 0) {
  if (depth > 12) fail(`listing recursed past 12 levels at "${prefix}"`);
  let offset = 0;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) fail(`listing ${BUCKET} at "${prefix}" failed`, await describe(res));
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    for (const e of page) {
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null || e.id === undefined) await listAll(full, out, depth + 1);
      else out.push({ path: full, size: Number(e.metadata?.size ?? 0), updated_at: e.updated_at || null });
    }
    if (page.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return out;
}

// ─── every path build_photos still points at ────────────────────────────────
// Paged explicitly rather than trusting one request: PostgREST caps rows, and
// a silently truncated reference set would mark real, referenced photos as
// orphans. That is the one mistake here that destroys data.
async function referencedPaths() {
  const refs = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/build_photos?select=storage_path,thumb_path`,
      { headers: { ...headers, Range: `${from}-${from + PAGE - 1}`, Prefer: 'count=exact' } });
    if (!res.ok) fail('could not read build_photos', await describe(res));
    const rows = await res.json();
    if (!Array.isArray(rows)) fail('build_photos returned a non-array', JSON.stringify(rows).slice(0, 300));
    for (const r of rows) {
      if (r.storage_path) refs.add(r.storage_path);
      if (r.thumb_path)   refs.add(r.thumb_path);
    }
    if (rows.length < PAGE) break;
  }
  return refs;
}

(async function main() {
  if (!SERVICE_KEY) {
    fail('SUPABASE_SERVICE_ROLE_KEY is required', {
      local: "SUPABASE_SERVICE_ROLE_KEY='...' node find-orphan-storage.mjs",
    });
  }

  log(c('bold', 'orphan storage objects') + c('grey', `  ${new Date().toISOString()}`));
  log(c('grey', `bucket ${BUCKET}  mode ${DELETE ? 'DELETE' : 'report only'}`));
  log('');

  const objects = await listAll('', []);
  const refs = await referencedPaths();

  const orphans = objects.filter(o => !refs.has(o.path));
  const orphanBytes = orphans.reduce((n, o) => n + o.size, 0);

  log(`objects in bucket     ${String(objects.length).padStart(6)}`);
  log(`referenced by rows    ${String(refs.size).padStart(6)}`);
  log(`${c('bold', 'orphans')}               ${c(orphans.length ? 'yellow' : 'green', String(orphans.length).padStart(6))}   ${human(orphanBytes)}`);
  log('');

  if (orphans.length === 0) {
    log(c('green', 'Nothing to clean up.'));
    return;
  }

  // Always print the list, in both modes. In --delete mode this is the last
  // thing shown before the files go, so it is the record of what was removed.
  for (const o of orphans) {
    log(`  ${c('grey', String(o.size).padStart(8))}  ${o.path}${o.updated_at ? c('grey', '  ' + o.updated_at.slice(0, 10)) : ''}`);
  }
  log('');

  if (!DELETE) {
    log(c('yellow', `${orphans.length} orphan(s), ${human(orphanBytes)}. Nothing was deleted.`));
    log(c('grey',   'Re-run with --delete to remove them.'));
    return;
  }

  // The guard that matters. If build_photos came back empty — a failed query,
  // a bad key, a schema change — every object in the bucket looks orphaned and
  // --delete would empty the bucket. Storage is the one thing here with no
  // backup on the Supabase side, so refuse rather than proceed.
  if (refs.size === 0 && objects.length > 0) {
    fail('refusing to delete: build_photos returned zero referenced paths', [
      `The bucket holds ${objects.length} object(s) and not one is referenced, which is far`,
      'more likely to be a broken query than a genuinely empty table. Deleting now',
      'would clear the bucket. Check build_photos by hand before re-running.',
    ].join('\n'));
  }
  // Same shape, less extreme: a run that would delete most of the bucket is
  // more likely to be a bug than a cleanup.
  if (orphans.length / objects.length > 0.9) {
    fail('refusing to delete: that would remove more than 90% of the bucket', [
      `${orphans.length} of ${objects.length} objects are unreferenced.`,
      'Check build_photos before re-running.',
    ].join('\n'));
  }

  let removed = 0;
  const problems = [];
  for (let i = 0; i < orphans.length; i += DELETE_BATCH) {
    const batch = orphans.slice(i, i + DELETE_BATCH).map(o => o.path);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: batch }),
    });
    if (!res.ok) problems.push(`batch ${i / DELETE_BATCH + 1}: ${await describe(res)}`);
    else removed += batch.length;
  }

  log(`${c('green', 'deleted')} ${removed} of ${orphans.length} orphan(s), ${human(orphanBytes)} reclaimed`);
  if (problems.length) fail(`${problems.length} delete batch(es) failed`, problems.join('\n'));
})().catch(e => fail('unexpected error', e?.stack || String(e)));
