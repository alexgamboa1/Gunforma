#!/usr/bin/env node
// launch-invites.js — Send every pre-launch invite in one coordinated batch
// -----------------------------------------------------------------------------
// Reads scripts/builders.json (an array of { email, build_id }), posts each
// entry to the launch-invite Edge Function with a 1.5-second delay between
// calls, and prints a per-entry log + summary suitable for launch day.
//
// Every entry MUST have both email AND build_id — by launch day every builder
// should have their build posted and their build UUID recorded here.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY='...' node scripts/launch-invites.js
//   node scripts/launch-invites.js --dry-run   # validate + preview, no network
//
// Node 18+ required (uses global fetch).
// -----------------------------------------------------------------------------

const fs   = require('node:fs');
const path = require('node:path');

const DRY_RUN       = process.argv.includes('--dry-run');
const BUILDERS_PATH = path.resolve(__dirname, 'builders.json');
const FUNCTION_URL  = process.env.FUNCTION_URL
  || 'https://lagjjcpclvzrjlrswojt.supabase.co/functions/v1/launch-invite';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DELAY_MS      = 1500;
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE       = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function c(color, s) {
  const codes = { grey:90, red:31, green:32, yellow:33, cyan:36, bold:1 };
  return `\x1b[${codes[color] || 0}m${s}\x1b[0m`;
}
function log(icon, entry, message, color) {
  console.log(`${c(color, icon)} ${entry.email.padEnd(40)} ${c('grey', message)}`);
}

function readAndValidate() {
  if (!fs.existsSync(BUILDERS_PATH)) {
    console.error(c('red', `error: ${BUILDERS_PATH} not found`));
    console.error(c('grey', '      fill in scripts/builders.json with one { email, build_id } per builder.'));
    process.exit(1);
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(BUILDERS_PATH, 'utf8')); }
  catch (e) {
    console.error(c('red', `error: builders.json is not valid JSON: ${e.message}`));
    process.exit(1);
  }
  if (!Array.isArray(raw)) {
    console.error(c('red', 'error: builders.json must be a JSON array'));
    process.exit(1);
  }

  // launch-invites is stricter than the one-off batch-invite: build_id is
  // required per entry, since the whole point is coordinated user↔build
  // linking on launch day.
  const errors = [];
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object')                errors.push(`row ${i}: not an object`);
    else {
      if (!entry.email    || !EMAIL_RE.test(entry.email))   errors.push(`row ${i}: invalid or missing email`);
      if (!entry.build_id)                                  errors.push(`row ${i}: build_id is required for launch invites`);
      else if (!UUID_RE.test(entry.build_id))               errors.push(`row ${i}: build_id must be a UUID`);
    }
  });
  if (errors.length) {
    console.error(c('red', 'validation failed:'));
    errors.forEach(e => console.error(c('red', '  ' + e)));
    process.exit(1);
  }

  // Duplicate email or build_id in the batch would silently create two invites
  // pointed at the same person, or leave one build unlinked. Catch here.
  const seenEmails = new Set(), seenBuilds = new Set();
  const dupErrors = [];
  raw.forEach((entry, i) => {
    const em = entry.email.toLowerCase();
    if (seenEmails.has(em))            dupErrors.push(`row ${i}: duplicate email ${em}`);
    if (seenBuilds.has(entry.build_id)) dupErrors.push(`row ${i}: duplicate build_id ${entry.build_id}`);
    seenEmails.add(em);
    seenBuilds.add(entry.build_id);
  });
  if (dupErrors.length) {
    console.error(c('red', 'duplicate check failed:'));
    dupErrors.forEach(e => console.error(c('red', '  ' + e)));
    process.exit(1);
  }

  return raw;
}

function preflightEnv() {
  if (DRY_RUN) return;
  if (!SERVICE_KEY) {
    console.error(c('red', 'error: SUPABASE_SERVICE_ROLE_KEY env var is required'));
    console.error(c('grey', '      Dashboard → Project Settings → API → service_role secret'));
    process.exit(1);
  }
}

async function sendOne(entry) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ email: entry.email, build_id: entry.build_id }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function main() {
  if (DRY_RUN) console.log(c('bold', '\n== DRY RUN — no network calls will be made ==\n'));
  preflightEnv();
  const entries = readAndValidate();

  console.log(c('grey', `endpoint: ${FUNCTION_URL}`));
  console.log(c('grey', `entries:  ${entries.length}`));
  console.log(c('grey', `delay:    ${DELAY_MS}ms between calls\n`));

  let ok = 0, skipped = 0, failed = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (DRY_RUN) {
      log('◇', entry, `would POST { email, build_id=${entry.build_id} }`, 'cyan');
      ok++;
      continue;
    }
    try {
      const { status, body } = await sendOne(entry);
      if (body && body.skipped) {
        log('•', entry, `skipped: ${body.reason || 'unknown'}${body.user_id ? ` (user_id=${body.user_id})` : ''}`, 'yellow');
        skipped++;
      } else if (status >= 200 && status < 300 && body && body.success) {
        log('✓', entry, `launched (user_id=${body.user_id}, build linked)${body.warning ? ' — ' + body.warning : ''}`, 'green');
        ok++;
      } else {
        log('✗', entry, `HTTP ${status}: ${(body && body.error) || 'unknown error'}`, 'red');
        failed++;
      }
    } catch (e) {
      log('✗', entry, `network error: ${e.message}`, 'red');
      failed++;
    }
    if (i < entries.length - 1) await sleep(DELAY_MS);
  }

  console.log('');
  const summary = `Launched ${ok} of ${entries.length} invites. ${skipped} skipped. ${failed} failed.`;
  console.log(c(failed ? 'yellow' : 'green', summary));
  process.exit(failed ? 1 : 0);
})();
