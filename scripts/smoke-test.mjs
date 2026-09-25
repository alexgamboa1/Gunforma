#!/usr/bin/env node
// smoke-test.mjs — critical-path smoke test for gunforma.com
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
// Photo upload broke on 2026-09-22 and nobody noticed until 2026-09-25. Every
// upload returned a 400 and the only symptom was a generic "Upload failed"
// toast. The cause was two layers down: a storage policy read `profiles`
// inline, a revoke took `SELECT` on that table away from `authenticated`, and
// Postgres then threw 42501 on every write to storage.objects whatever the
// bucket. Full incident record: supabase/fix_product_image_policies.sql, and
// the invariant it cost us is in CLAUDE.md.
//
// So this test walks the real upload path end to end, on a schedule, and goes
// red loudly when it can't.
//
// IT SIGNS IN AS A REAL USER, NOT service_role
// This is the whole point and it is easy to get wrong. The service-role key
// bypasses RLS, so a run using it would have sailed straight through the
// outage above — the broken policy only ever affected the `authenticated`
// role. A test that cannot observe the bug it was written for is worse than
// no test, because it also tells you everything is fine.
//
// RAW fetch, NOT supabase-js
// Same reason. supabase-js wraps a failure into a tidy Error and the useful
// part — the response body carrying `code`, `message` and `hint` — is what
// gets lost. Every request here reports status, statusText and the raw body,
// because "upload failed" is precisely the message that cost three days.
//
// Env:
//   SMOKE_TEST_EMAIL     required — dedicated non-admin account
//   SMOKE_TEST_PASSWORD  required
//   SUPABASE_URL         optional, defaults to the Gunforma project
//   SUPABASE_ANON_KEY    optional, defaults to the site's public anon key
//
// Local run (Node 20.6+ reads the env file itself, no dotenv dependency):
//   node --env-file=../.env smoke-test.mjs
// -----------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';

// The site's public anon key — the same one js/supabase-client.js ships to
// every visitor. Not a secret, and deliberately not the service-role key.
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

const BUCKET = process.env.SMOKE_TEST_BUCKET || 'build-photos';

// Per-request ceiling. The job has its own timeout-minutes, but an individual
// hung socket should fail as itself rather than as a job-level kill with no
// step attributed.
const REQUEST_TIMEOUT_MS = 20000;

// ─── logging ────────────────────────────────────────────────────────────────
// Matches refresh-affiliate-prices.mjs: colour only on a TTY, so the Actions
// log stays clean.
const isTTY = process.stdout.isTTY;
function c(color, s) {
  if (!isTTY) return s;
  const codes = { grey: 90, red: 31, green: 32, yellow: 33, cyan: 36, bold: 1 };
  return `\x1b[${codes[color] || 0}m${s}\x1b[0m`;
}
function log(msg)  { console.log(msg); }
function warn(msg) { console.log(c('yellow', 'warn:  ') + msg); }

// ─── failure ────────────────────────────────────────────────────────────────
// Carries the step it died in plus whatever the server actually said. The
// detail is the product here, not decoration.
class StepError extends Error {
  constructor(step, message, detail) {
    super(message);
    this.step = step;
    this.detail = detail;
  }
}

// Reads the body whatever its type, and pretty-prints JSON when it is JSON —
// PostgREST and Storage both return the interesting part (code / message /
// hint) as a JSON body alongside an unhelpful status.
async function describeResponse(res) {
  let body = '';
  try { body = await res.text(); } catch { body = '(body unreadable)'; }
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* not JSON, keep the text */ }
  return {
    status: res.status,
    statusText: res.statusText,
    body: parsed ? JSON.stringify(parsed, null, 2) : (body || '(empty)'),
  };
}

async function request(step, url, options = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { ...options, signal: ctl.signal });
  } catch (err) {
    throw new StepError(step, `request failed: ${err.message}`, {
      url,
      method: options.method || 'GET',
      cause: err.name === 'AbortError' ? `aborted after ${REQUEST_TIMEOUT_MS}ms` : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
  return res;
}

async function requireOk(step, res, what) {
  if (res.ok) return res;
  const d = await describeResponse(res);
  throw new StepError(step, `${what} — HTTP ${d.status} ${d.statusText}`, d);
}

// ─── fixture ────────────────────────────────────────────────────────────────
// A 1x1 JPEG, inline so the test has no fixture file to go missing. Checked
// for its SOI/EOI markers at startup: a mangled constant should fail as
// "bad fixture" and not as a mystery byte-mismatch in step 3.
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
  'CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
  'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
  'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG' +
  'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl' +
  '5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA' +
  'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk' +
  'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE' +
  'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk' +
  '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

const JPEG_BYTES = Buffer.from(JPEG_B64, 'base64');

// ─── steps ──────────────────────────────────────────────────────────────────

// 1. Sign in as the test user. Everything after this runs on that user's JWT,
//    so every policy the real site depends on is in play.
async function signIn() {
  const step = '1/5 sign in';
  const email = process.env.SMOKE_TEST_EMAIL;
  const password = process.env.SMOKE_TEST_PASSWORD;
  if (!email || !password) {
    throw new StepError(step, 'SMOKE_TEST_EMAIL and SMOKE_TEST_PASSWORD must both be set', {
      hint: 'Locally: node --env-file=../.env smoke-test.mjs. In Actions: repo secrets of the same names.',
      SMOKE_TEST_EMAIL: email ? 'set' : 'MISSING',
      SMOKE_TEST_PASSWORD: password ? 'set' : 'MISSING',
    });
  }

  const res = await request(step, `${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  await requireOk(step, res, 'sign-in rejected');

  const json = await res.json();
  if (!json.access_token || !json.user?.id) {
    throw new StepError(step, 'sign-in returned no access token', {
      keys: Object.keys(json).join(', '),
    });
  }
  log(`${c('green', 'ok')}  ${step} — ${json.user.email} (${json.user.id})`);
  return { token: json.access_token, userId: json.user.id };
}

// 2. Upload. This is the exact call the builder makes: same bucket, same
//    content type, same authenticated role.
//
//    On the path: build_photos_owner_insert requires
//    (storage.foldername(name))[1] = auth.uid(), so the FIRST segment has to
//    be the user id — a top-level smoke-test/ folder is refused outright.
//    The prefix therefore sits one level in. Because the account is dedicated
//    to this test, <uid>/smoke-test/ is still a single fixed prefix, and
//    orphans are still one query:
//        select name from storage.objects
//         where bucket_id = 'build-photos' and name like '%/smoke-test/%';
async function upload(session) {
  const step = '2/5 upload';
  const path = `${session.userId}/smoke-test/${Date.now()}-${process.pid}.jpg`;
  const res = await request(step, `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'false',
    },
    body: JPEG_BYTES,
  });
  await requireOk(step, res, `upload to ${BUCKET} rejected`);
  log(`${c('green', 'ok')}  ${step} — ${JPEG_BYTES.length} bytes to ${BUCKET}/${path}`);
  return path;
}

// 3. Read back and compare bytes. A 200 on upload only says the API accepted
//    it; this says the object is really there and is really what we sent.
async function readBack(session, path) {
  const step = '3/5 read back';
  const res = await request(step, `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${session.token}` },
  });
  await requireOk(step, res, 'download rejected');

  const got = Buffer.from(await res.arrayBuffer());
  if (got.length !== JPEG_BYTES.length || !got.equals(JPEG_BYTES)) {
    throw new StepError(step, 'downloaded bytes do not match what was uploaded', {
      uploaded_bytes: JPEG_BYTES.length,
      downloaded_bytes: got.length,
      uploaded_head: JPEG_BYTES.subarray(0, 16).toString('hex'),
      downloaded_head: got.subarray(0, 16).toString('hex'),
    });
  }
  log(`${c('green', 'ok')}  ${step} — ${got.length} bytes, identical`);
}

// 4. Delete through the Storage API, never SQL. storage.protect_delete()
//    blocks SQL deletes outright, and the DELETE policy is one of the three
//    that broke in the outage — so deleting any other way would skip the
//    thing most worth testing.
async function remove(session, path) {
  const step = '4/5 delete';
  const res = await request(step, `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${session.token}` },
  });
  await requireOk(step, res, 'delete rejected');

  // Confirm it is actually gone rather than trusting the 200.
  const check = await request(step, `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${session.token}` },
  });
  if (check.ok) {
    throw new StepError(step, 'delete returned success but the object is still readable', {
      path, status_after_delete: check.status,
    });
  }
  log(`${c('green', 'ok')}  ${step} — removed, and confirmed gone (${check.status})`);
}

// 5. The builder's own platforms query, filter and all. Catches the 42703
//    shape twice over: the is_primary drop broke readers by removing a column
//    they named, and the is_live add would have broken this one had the code
//    shipped first. A query naming a column the database does not have fails
//    whole, so "zero platforms" and "query rejected" are different failures
//    and both are caught here.
async function platformsQuery(session) {
  const step = '5/5 platforms query';
  const url = `${SUPABASE_URL}/rest/v1/platforms?select=id,name&is_live=eq.true&order=name`;
  const res = await request(step, url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${session.token}` },
  });
  await requireOk(step, res, 'platforms query rejected');

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new StepError(step, 'platforms query returned no rows — the builder would show an empty picker', {
      query: url.replace(SUPABASE_URL, ''),
      returned: JSON.stringify(rows),
    });
  }
  log(`${c('green', 'ok')}  ${step} — ${rows.length} live platform(s): ${rows.map(r => r.name).join(', ')}`);
}

// ─── run ────────────────────────────────────────────────────────────────────
async function main() {
  // Fixture sanity first, so a corrupted constant is named as such.
  if (JPEG_BYTES.length < 100 ||
      JPEG_BYTES[0] !== 0xff || JPEG_BYTES[1] !== 0xd8 ||
      JPEG_BYTES[JPEG_BYTES.length - 2] !== 0xff || JPEG_BYTES[JPEG_BYTES.length - 1] !== 0xd9) {
    throw new StepError('0/5 fixture', 'inline JPEG fixture is not a valid JPEG', {
      bytes: JPEG_BYTES.length,
      head: JPEG_BYTES.subarray(0, 4).toString('hex'),
      tail: JPEG_BYTES.subarray(-4).toString('hex'),
    });
  }

  log(c('bold', 'gunforma smoke test') + c('grey', `  ${new Date().toISOString()}`));
  log(c('grey', `project ${SUPABASE_URL}  bucket ${BUCKET}  role authenticated (not service_role)`));
  log('');

  const session = await signIn();
  let path = null;
  try {
    path = await upload(session);
    await readBack(session, path);
    await remove(session, path);
    path = null;               // step 4 is the cleanup; nothing left to sweep
    await platformsQuery(session);
  } finally {
    // Best effort only, and only if step 4 never got to run. A failure here
    // is reported but does not mask the real failure above it — the orphan is
    // findable under the fixed prefix, which is why the prefix exists.
    if (path) {
      try {
        const res = await request('cleanup', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
          method: 'DELETE',
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${session.token}` },
        });
        if (res.ok) warn(`cleaned up ${path} after an earlier failure`);
        else warn(`ORPHAN LEFT: ${BUCKET}/${path} (cleanup HTTP ${res.status})`);
      } catch (err) {
        warn(`ORPHAN LEFT: ${BUCKET}/${path} (cleanup threw: ${err.message})`);
      }
    }
  }

  log('');
  log(c('green', 'PASS') + ' — all 5 steps green');
}

main().catch((err) => {
  console.error('');
  if (err instanceof StepError) {
    console.error(c('red', 'FAIL') + ` at step ${c('bold', err.step)}`);
    console.error(`  ${err.message}`);
    if (err.detail) {
      console.error('');
      console.error('  underlying detail:');
      const text = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail, null, 2);
      for (const line of String(text).split('\n')) console.error(`    ${line}`);
    }
  } else {
    console.error(c('red', 'FAIL') + ' — unexpected error');
    console.error(err?.stack || String(err));
  }
  console.error('');
  process.exit(1);
});
