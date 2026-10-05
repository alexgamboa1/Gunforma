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
// A plain run is safe to repeat. Anyone already invited is skipped, never
// emailed again — so a re-run is also the status report: it prints who has
// claimed and who has not.
//
// Two single-builder actions, each for one email that is in builders.json:
//
//   node scripts/launch-invites.js --resend  someone@example.com
//       A fresh invite link. For a builder whose link expired (24 hours) or
//       who lost the email. Only works while they have NOT claimed.
//
//   node scripts/launch-invites.js --release someone@example.com
//       Undo an invite nobody claimed: the build goes back to having no
//       owner and the unclaimed account is deleted. For a mistyped address —
//       release it, correct builders.json, then run normally.
//
// NEVER delete an invited user by hand in the Supabase dashboard. Their build
// and its photo rows are deleted with them. --release is the safe way.
//
// Node 18+ required (uses global fetch).
// -----------------------------------------------------------------------------

const fs   = require('node:fs');
const path = require('node:path');

const DRY_RUN       = process.argv.includes('--dry-run');

// --resend <email> / --release <email>. The value is required and must not be
// another flag: `--release --dry-run` would otherwise treat "--dry-run" as the
// address, fail to find it, and read like a typo rather than a missing value.
function flagValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error(`\x1b[31merror: ${name} needs an email address, e.g. ${name} someone@example.com\x1b[0m`);
    process.exit(1);
  }
  return v.trim().toLowerCase();
}
const RESEND_EMAIL  = flagValue('--resend');
const RELEASE_EMAIL = flagValue('--release');
if (RESEND_EMAIL && RELEASE_EMAIL) {
  console.error('\x1b[31merror: use --resend or --release, not both\x1b[0m');
  process.exit(1);
}
const ACTION       = RESEND_EMAIL ? 'resend' : RELEASE_EMAIL ? 'release' : 'invite';
const TARGET_EMAIL = RESEND_EMAIL || RELEASE_EMAIL;
const BUILDERS_PATH = path.resolve(__dirname, 'builders.json');
const FUNCTION_URL  = process.env.FUNCTION_URL
  || 'https://lagjjcpclvzrjlrswojt.supabase.co/functions/v1/launch-invite';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DELAY_MS      = 1500;
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE       = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function c(color, s) {
  const codes = { grey:90, red:31, green:32, yellow:33, magenta:35, cyan:36, bold:1 };
  return `\x1b[${codes[color] || 0}m${s}\x1b[0m`;
}
// msgColor defaults to grey, which is right for routine per-entry detail. A
// warning passes something louder, because the whole failure this guards
// against was a half-finished invite reading like a clean one.
function log(icon, entry, message, color, msgColor) {
  console.log(`${c(color, icon)} ${entry.email.padEnd(40)} ${c(msgColor || 'grey', message)}`);
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
    // `action` is left out of a normal invite so the request is byte-for-byte
    // what it has always been.
    body: JSON.stringify(ACTION === 'invite'
      ? { email: entry.email, build_id: entry.build_id }
      : { email: entry.email, build_id: entry.build_id, action: ACTION }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function main() {
  if (DRY_RUN) console.log(c('bold', '\n== DRY RUN — no network calls will be made ==\n'));
  preflightEnv();
  let entries = readAndValidate();

  // --resend / --release act on exactly one builder, and the build_id comes
  // from builders.json rather than the command line: the email-to-build
  // pairing was written down once, at invite time, and retyping a UUID is how
  // the wrong build gets released.
  if (TARGET_EMAIL) {
    entries = entries.filter(e => e.email.toLowerCase() === TARGET_EMAIL);
    if (entries.length !== 1) {
      console.error(c('red', `error: ${TARGET_EMAIL} is not in builders.json`));
      console.error(c('grey', '      --resend and --release look the build up there. Check the spelling.'));
      process.exit(1);
    }
    console.log(c('bold', `action:   ${ACTION}`));
  }

  console.log(c('grey', `endpoint: ${FUNCTION_URL}`));
  console.log(c('grey', `entries:  ${entries.length}`));
  console.log(c('grey', `delay:    ${DELAY_MS}ms between calls\n`));

  let ok = 0, skipped = 0, failed = 0;
  // Invited, link not used yet. Listed at the end with the command that sends
  // a fresh link, because a 24-hour link is usually dead by the time anyone
  // looks.
  const unclaimed = [];
  // Entries the function reported as successful but incomplete. Kept as a
  // list, not just a count, because each one needs a human — see the recap
  // block below.
  const warnings = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (DRY_RUN) {
      log('◇', entry, `would POST { email, build_id=${entry.build_id}${ACTION === 'invite' ? '' : `, action=${ACTION}`} }`, 'cyan');
      ok++;
      continue;
    }
    try {
      const { status, body } = await sendOne(entry);
      if (body && body.skipped && ACTION !== 'invite') {
        // A skip is an invite's answer. Getting one back from a resend or a
        // release means the deployed function is an older one that ignored
        // `action` — nothing was re-sent or released, so it is a failure.
        log('✗', entry, `not done — the function answered as if this were a normal invite (${body.reason || 'skipped'}). Is the new launch-invite deployed?`, 'red');
        failed++;
      } else if (body && body.skipped) {
        log('•', entry, `skipped: ${body.reason || 'unknown'}${body.user_id ? ` (user_id=${body.user_id})` : ''}`, 'yellow');
        if (body.unclaimed) unclaimed.push({ entry, invitedAt: body.invited_at });
        skipped++;
      } else if (status >= 200 && status < 300 && body && body.success && body.warning) {
        // success:true WITH a warning is the dangerous case: the invite went
        // out and part of the work landed, so retrying the batch will not fix
        // it — launch-invite refuses any build that already has a user_id.
        // It used to take the green tick below and be counted as clean.
        log('!', entry, `INCOMPLETE — ${body.warning}`, 'magenta', 'magenta');
        warnings.push({ entry, warning: body.warning, userId: body.user_id });
      } else if (status >= 200 && status < 300 && body && body.success) {
        // Each action must come back saying it did THAT action. A bare
        // success:true from a resend or a release would mean the deployed
        // function is an older one that ignored `action` and ran a normal
        // invite instead — so it is a failure here, not a green tick.
        if (ACTION === 'resend' && !body.resent) {
          log('✗', entry, 'the function did not report a resend — is the new launch-invite deployed?', 'red');
          failed++;
        } else if (ACTION === 'release' && !body.released) {
          log('✗', entry, 'the function did not report a release — is the new launch-invite deployed?', 'red');
          failed++;
        } else if (ACTION === 'resend') {
          log('✓', entry, `fresh invite sent (user_id=${body.user_id}) — good for 24 hours`, 'green');
          ok++;
        } else if (ACTION === 'release') {
          log('✓', entry, `released: build ${body.build_id} has no owner again, unclaimed account deleted`, 'green');
          ok++;
        } else {
          log('✓', entry, `launched (user_id=${body.user_id}, build linked)`, 'green');
          ok++;
        }
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

  // Recap, because a warning scrolls past in a 30-entry batch and the whole
  // point is that it must not be missed. Re-running the batch is NOT the
  // remedy, so say so rather than leaving the operator to discover it.
  if (warnings.length) {
    console.log('');
    console.log(c('magenta', c('bold', `${warnings.length} invite(s) half-finished — these need fixing by hand:`)));
    warnings.forEach(w => {
      console.log(c('magenta', `  ${w.entry.email}`));
      console.log(c('grey',    `    build_id ${w.entry.build_id}${w.userId ? `  user_id ${w.userId}` : ''}`));
      console.log(c('grey',    `    ${w.warning}`));
    });
    console.log(c('grey', '  Re-running this batch will not repair them: launch-invite skips any'));
    console.log(c('grey', '  build that already has a user_id, so these entries return "already"'));
    console.log(c('grey', '  on the next run and the unfinished half stays unfinished.'));
  }

  if (unclaimed.length) {
    console.log('');
    console.log(c('yellow', c('bold', `${unclaimed.length} invited, not claimed yet:`)));
    unclaimed.forEach(u => {
      console.log(c('yellow', `  ${u.entry.email}`) + c('grey', u.invitedAt ? `   invited ${u.invitedAt}` : ''));
    });
    console.log(c('grey', '  An invite link lasts 24 hours. To send one of them a fresh link:'));
    console.log(c('grey', '    node scripts/launch-invites.js --resend <email>'));
  }

  console.log('');
  const launched = ok + warnings.length;
  const verb = ACTION === 'resend' ? 'Re-sent' : ACTION === 'release' ? 'Released' : 'Launched';
  const summary =
    `${verb} ${launched} of ${entries.length} invites` +
    (warnings.length ? ` — ${warnings.length} WITH WARNINGS` : '') +
    `. ${skipped} skipped. ${failed} failed.`;
  // Warnings colour the summary like a failure on purpose: a batch that only
  // half-worked must not read as a clean run.
  console.log(c(failed || warnings.length ? 'red' : 'green', summary));
  process.exit(failed || warnings.length ? 1 : 0);
})();
