#!/usr/bin/env node
// seed-prep.js — Bookkeeping harness for the founding-builder seeding flow
// -----------------------------------------------------------------------------
// Pre-creates auth users, mints one-time sign-in links, tracks who's finished
// their build, and exports the finished set into scripts/builders.json (the
// exact shape launch-invites.js already reads).
//
// This script does bookkeeping and credential generation ONLY. A human still
// posts each build through the real site UI (gunforma-post-build-v6.html)
// after using the generated magic link to sign in as that builder. This
// script does NOT send any invite email — that's launch-invites.js.
//
// State file: scripts/seed-state.json  (gitignored — contains real emails)
// Input:      scripts/seed-emails.txt  (gitignored — one email per line)
//
// Commands:
//   node scripts/seed-prep.js create              # pre-create auth users
//   node scripts/seed-prep.js link <email>        # mint one magic link
//   node scripts/seed-prep.js check-builds        # scan for finished builds
//   node scripts/seed-prep.js export              # emit builders.json rows
//
// Both `create` and `export` support --dry-run (they mutate state).
//
// Env:
//   SUPABASE_SERVICE_ROLE_KEY  required (Dashboard → Project Settings → API)
//   SUPABASE_URL               optional, defaults to the Gunforma project
//   NEXT_TARGET                optional, defaults to /gunforma-post-build-v6.html
//                              (the ?next= path baked into the magic link)
//
// Node 18+ required (uses global fetch).
// -----------------------------------------------------------------------------

const fs   = require('node:fs');
const path = require('node:path');

const DRY_RUN     = process.argv.includes('--dry-run');
const CMD         = process.argv[2];
const ARG         = process.argv[3];
const STATE_PATH  = path.resolve(__dirname, 'seed-state.json');
const EMAILS_PATH = path.resolve(__dirname, 'seed-emails.txt');
const BUILDERS_PATH = path.resolve(__dirname, 'builders.json');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const NEXT_TARGET  = process.env.NEXT_TARGET || '/gunforma-post-build-v6.html';
const REDIRECT_TO  = `https://gunforma.com/auth-callback.html?next=${encodeURIComponent(NEXT_TARGET)}`;
const EMAIL_RE     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES       = ['created', 'link_issued', 'build_submitted', 'handed_off'];

// ─── formatting helpers (match batch-invite.js / launch-invites.js) ───
function c(color, s) {
  const codes = { grey: 90, red: 31, green: 32, yellow: 33, cyan: 36, bold: 1 };
  return `\x1b[${codes[color] || 0}m${s}\x1b[0m`;
}
function log(icon, email, message, color) {
  console.log(`${c(color, icon)} ${String(email).padEnd(40)} ${c('grey', message)}`);
}

// ─── state file I/O ───
function readState() {
  if (!fs.existsSync(STATE_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch (e) {
    console.error(c('red', `error: ${STATE_PATH} is not valid JSON: ${e.message}`));
    process.exit(1);
  }
}
function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}
function readEmailList() {
  if (!fs.existsSync(EMAILS_PATH)) {
    console.error(c('red', `error: ${EMAILS_PATH} not found`));
    console.error(c('grey', '      write one email per line; lines starting with # are ignored.'));
    process.exit(1);
  }
  const lines = fs.readFileSync(EMAILS_PATH, 'utf8').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  const bad = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const key = line.toLowerCase();
    if (seen.has(key)) return;                    // silent dedupe
    if (!EMAIL_RE.test(line)) { bad.push(`  line ${i + 1}: "${line}"`); return; }
    seen.add(key);
    out.push(line);
  });
  if (bad.length) {
    console.error(c('red', `error: ${EMAILS_PATH} has invalid entries:`));
    bad.forEach(b => console.error(c('red', b)));
    process.exit(1);
  }
  return out;
}

// ─── env / preflight ───
function preflightEnv() {
  if (DRY_RUN) return;
  if (!SERVICE_KEY) {
    console.error(c('red', 'error: SUPABASE_SERVICE_ROLE_KEY env var is required'));
    console.error(c('grey', '      Dashboard → Project Settings → API → service_role secret'));
    process.exit(1);
  }
}
function adminHeaders() {
  return {
    'apikey':        SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type':  'application/json',
  };
}

// ─── auth admin HTTP calls (raw fetch — no supabase-js dependency) ───
// POST /auth/v1/admin/users — creates a user. email_confirm: true skips the
// confirmation email so the account is immediately usable. No user_metadata
// is set, so handle_new_user() lands the profile with onboarding_complete:
// false, which is exactly what the claim flow expects downstream.
async function adminCreateUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// GET /auth/v1/admin/users?email=xxx — server-side email filter, one row max.
// Avoids paging through listUsers(). Supported by gotrue v2.7+ (well below
// what Supabase Cloud runs today).
async function adminFindUserByEmail(email) {
  const url = `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: adminHeaders() });
  if (!res.ok) return { status: res.status, user: null, error: await res.text().catch(() => '') };
  const body = await res.json().catch(() => ({}));
  // Response shape: { users: [...] } (list, even for exact-match filter).
  const list = Array.isArray(body.users) ? body.users : [];
  const match = list.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
  return { status: res.status, user: match || null };
}

// POST /auth/v1/admin/generate_link — mint a magic sign-in link without
// sending an email. GoTrue's HTTP response shape is:
//   { action_link, email_otp, hashed_token, redirect_to,
//     verification_type, user }
// The properties are INLINED at the top level — the `{ properties: {...} }`
// nesting you see in the supabase-js return type is added by the SDK
// wrapper, not the raw endpoint. Read both, prefer the raw shape.
// The link's actual expiry is set by the project's Auth OTP-expiry config
// (default 3600s / 1h; adjustable in Dashboard → Auth → Configuration).
// The response itself contains NO explicit expiry field.
async function adminGenerateLink(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      type:  'magiclink',
      email,
      // supabase gotrue accepts both top-level `redirect_to` and nested
      // `options.redirect_to` depending on version — the top-level form
      // is the canonical HTTP shape and is what supabase-js sends today.
      redirect_to: REDIRECT_TO,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// PostgREST select from public.builds — no service-role RLS to fight through.
// Newest build first so a builder who accidentally submits twice still
// closes cleanly (we take the first one).
async function findBuildByUser(userId) {
  const url = `${SUPABASE_URL}/rest/v1/builds?user_id=eq.${userId}&select=id,status,created_at&order=created_at.desc&limit=1`;
  const res = await fetch(url, { headers: adminHeaders() });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return rows[0] || null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── commands ───

async function cmdCreate() {
  if (DRY_RUN) console.log(c('bold', '\n== DRY RUN — no auth users will be created ==\n'));
  preflightEnv();

  const emails = readEmailList();
  const state  = readState();
  const knownEmails = new Set(state.map(e => e.email.toLowerCase()));
  const targets = emails.filter(e => !knownEmails.has(e.toLowerCase()));

  console.log(c('grey', `input:  ${emails.length} email(s) in ${path.basename(EMAILS_PATH)}`));
  console.log(c('grey', `state:  ${state.length} tracked, ${targets.length} new to process\n`));

  if (!targets.length) {
    console.log(c('yellow', 'nothing to do — every input email is already tracked.'));
    return;
  }

  let ok = 0, existing = 0, failed = 0;
  for (const email of targets) {
    if (DRY_RUN) {
      log('◇', email, `would createUser (email_confirm: true, no metadata)`, 'cyan');
      ok++;
      continue;
    }
    try {
      const created = await adminCreateUser(email);
      let userId = created.body && created.body.id;
      let note   = 'created';

      if (!userId) {
        // Supabase surfaces the collision as either code:'email_exists' or a
        // 422/409 with a "already been registered"-style message. Rather
        // than pattern-match on strings, if we didn't get an id back we
        // fall through to a direct email lookup.
        const found = await adminFindUserByEmail(email);
        if (found.user) {
          userId = found.user.id;
          note = 'already existed';
          existing++;
        } else {
          const msg = (created.body && (created.body.msg || created.body.message || created.body.error)) || `HTTP ${created.status}`;
          log('✗', email, `createUser failed: ${msg}`, 'red');
          failed++;
          continue;
        }
      } else {
        ok++;
      }

      state.push({
        email,
        user_id: userId,
        build_id: null,
        status: 'created',
        created_at: new Date().toISOString(),
        link_issued_at: null,
      });
      log(note === 'created' ? '✓' : '•', email, `${note} (user_id=${userId})`, note === 'created' ? 'green' : 'yellow');
    } catch (e) {
      log('✗', email, `network error: ${e.message}`, 'red');
      failed++;
    }
    await sleep(200);         // gentle rate-limit — admin API is generous but respect it
  }

  if (!DRY_RUN) writeState(state);

  console.log('');
  const line = `Created ${ok}, ${existing} already existed, ${failed} failed.`;
  console.log(c(failed ? 'yellow' : 'green', line));
  if (!DRY_RUN) console.log(c('grey', `state written to ${STATE_PATH}`));
  process.exit(failed ? 1 : 0);
}

async function cmdLink() {
  preflightEnv();
  if (!ARG) {
    console.error(c('red', 'error: link requires an email argument'));
    console.error(c('grey', '      node scripts/seed-prep.js link builder@example.com'));
    process.exit(1);
  }
  const state = readState();
  const entry = state.find(e => e.email.toLowerCase() === ARG.toLowerCase());
  if (!entry) {
    console.error(c('red', `error: ${ARG} is not in seed-state.json — run \`create\` first`));
    process.exit(1);
  }
  // Allow re-issue at any pre-build stage (magic links expire — regenerating
  // is common). Block at 'build_submitted' or 'handed_off' to prevent
  // accidental link-generation after the build is already done.
  if (entry.status === 'build_submitted' || entry.status === 'handed_off') {
    console.error(c('red', `error: ${ARG} is already at status='${entry.status}' — build is done, no link needed`));
    process.exit(1);
  }

  console.log(c('grey', `email:       ${entry.email}`));
  console.log(c('grey', `user_id:     ${entry.user_id}`));
  console.log(c('grey', `redirect_to: ${REDIRECT_TO}\n`));

  try {
    const { status, body } = await adminGenerateLink(entry.email);
    // Prefer the raw HTTP shape (top-level action_link); fall back to the
    // SDK-nested shape if some future version or proxy re-wraps it.
    const link = (body && body.action_link)
              || (body && body.properties && body.properties.action_link)
              || null;
    if (!link) {
      // Real HTTP failure → surface Supabase's own error text. Also dump
      // the raw body so a future shape change is diagnosable on first run
      // instead of showing up as an opaque "HTTP 200".
      const msg = (body && (body.msg || body.message || body.error_description || body.error))
               || `HTTP ${status} with no action_link in response`;
      console.error(c('red', `generateLink failed: ${msg}`));
      console.error(c('grey', 'raw response body:'));
      console.error(c('grey', JSON.stringify(body, null, 2)));
      process.exit(1);
    }

    // Persist only the fact that a link was issued — NOT the token itself.
    // Tokens are single-use and short-lived; the state file is on-disk and
    // gitignored, but even so, "the link that was issued" is an ephemeral
    // credential and doesn't belong in bookkeeping.
    entry.status = 'link_issued';
    entry.link_issued_at = new Date().toISOString();
    writeState(state);

    console.log(c('bold', 'MAGIC LINK (single-use, share by opening in the target browser):\n'));
    console.log(link + '\n');
    console.log(c('yellow', 'Expiry: the generate_link response does not include an expiry field.'));
    console.log(c('yellow', 'Supabase project setting controls it — default 3600s (1 hour), configurable'));
    console.log(c('yellow', 'in Dashboard → Auth → Configuration → OTP expiration. Verify your project'));
    console.log(c('yellow', 'setting before generating several links ahead of a building session.\n'));
    console.log(c('grey', `state updated → status='link_issued', link_issued_at=${entry.link_issued_at}`));
  } catch (e) {
    console.error(c('red', `network error: ${e.message}`));
    process.exit(1);
  }
}

async function cmdCheckBuilds() {
  preflightEnv();
  const state = readState();
  const targets = state.filter(e => e.status === 'link_issued');

  console.log(c('grey', `tracked: ${state.length}`));
  console.log(c('grey', `waiting on builds: ${targets.length}\n`));

  if (!targets.length) {
    console.log(c('yellow', 'nothing at status=link_issued — either everyone finished or no one has started.'));
    return;
  }

  let promoted = 0, waiting = 0, failed = 0;
  for (const entry of targets) {
    try {
      const build = await findBuildByUser(entry.user_id);
      if (build && UUID_RE.test(build.id)) {
        entry.build_id = build.id;
        entry.status = 'build_submitted';
        log('✓', entry.email, `build ${build.id.slice(0, 8)}… (status=${build.status})`, 'green');
        promoted++;
      } else {
        log('○', entry.email, 'no build row yet', 'grey');
        waiting++;
      }
    } catch (e) {
      log('✗', entry.email, `query failed: ${e.message}`, 'red');
      failed++;
    }
    await sleep(150);
  }

  writeState(state);

  console.log('');
  console.log(c(failed ? 'yellow' : 'green',
    `Promoted ${promoted} → build_submitted. ${waiting} still waiting. ${failed} query error(s).`));
  process.exit(failed ? 1 : 0);
}

async function cmdExport() {
  if (DRY_RUN) console.log(c('bold', '\n== DRY RUN — builders.json will NOT be written ==\n'));

  const state = readState();
  const ready = state.filter(e => e.status === 'build_submitted');

  console.log(c('grey', `at status=build_submitted: ${ready.length}\n`));

  if (!ready.length) {
    console.log(c('yellow', 'nothing to export.'));
    return;
  }

  // Merge with the existing builders.json rather than overwrite — someone
  // may have added rows by hand, and re-running export shouldn't nuke them.
  let existing = [];
  if (fs.existsSync(BUILDERS_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(BUILDERS_PATH, 'utf8')) || []; }
    catch (e) {
      console.error(c('red', `error: existing ${BUILDERS_PATH} is not valid JSON: ${e.message}`));
      process.exit(1);
    }
    if (!Array.isArray(existing)) {
      console.error(c('red', `error: existing ${BUILDERS_PATH} is not an array`));
      process.exit(1);
    }
  }
  const existingEmails = new Set(existing.map(r => (r && r.email || '').toLowerCase()));

  let appended = 0, skipped = 0;
  for (const entry of ready) {
    if (existingEmails.has(entry.email.toLowerCase())) {
      log('•', entry.email, 'already in builders.json — skipped', 'yellow');
      skipped++;
      continue;
    }
    existing.push({ email: entry.email, build_id: entry.build_id });
    entry.status = 'handed_off';
    log('✓', entry.email, `→ builders.json (build_id=${entry.build_id.slice(0, 8)}…)`, 'green');
    appended++;
  }

  if (!DRY_RUN) {
    fs.writeFileSync(BUILDERS_PATH, JSON.stringify(existing, null, 2) + '\n');
    writeState(state);
  }

  console.log('');
  console.log(c('green', `Exported ${appended} builder(s) to ${path.basename(BUILDERS_PATH)}. ${skipped} skipped as duplicates.`));
  if (!DRY_RUN) {
    console.log(c('grey', `Next: node scripts/launch-invites.js --dry-run`));
  }
}

// ─── entry point ───
function usageAndExit() {
  console.error(c('bold', 'usage:'));
  console.error('  node scripts/seed-prep.js create              # pre-create auth users');
  console.error('  node scripts/seed-prep.js link <email>        # mint one magic link');
  console.error('  node scripts/seed-prep.js check-builds        # scan for finished builds');
  console.error('  node scripts/seed-prep.js export              # emit builders.json rows');
  console.error('');
  console.error(c('grey', 'flags:  --dry-run   (supported on `create` and `export`)'));
  process.exit(1);
}

(async function main() {
  const dispatch = {
    'create':       cmdCreate,
    'link':         cmdLink,
    'check-builds': cmdCheckBuilds,
    'export':       cmdExport,
  };
  const fn = dispatch[CMD];
  if (!fn) usageAndExit();
  await fn();
})();
