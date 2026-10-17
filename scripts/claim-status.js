#!/usr/bin/env node
// claim-status.js — see who has claimed, nudge who hasn't, text the stragglers
// -----------------------------------------------------------------------------
// Reads the claim_invites table (service role, via PostgREST — no supabase-js
// dependency, same as launch-invites.js) and reports the launch cohort.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY='...' node scripts/claim-status.js
//       Default: a table of every invite — name, email, hours since sent,
//       opened?, claimed?.
//
//   node scripts/claim-status.js --remind [--dry-run]
//       For every invite that is UNCLAIMED, was sent >= 18h ago, and has not
//       been reminded yet: send the reminder email (resend-claim, which also
//       mints a fresh 7-day link) and stamp reminded_at. --dry-run lists the
//       people who WOULD be reminded and sends nothing.
//
//   node scripts/claim-status.js --texts
//       Print a ready-to-send text for each unclaimed builder who has a phone,
//       and write them to scripts/out/texts-<timestamp>.csv (scripts/out is
//       gitignored). Phone numbers are for your personal texts — never emailed.
//
// The hour-20 pass is: --remind, then --texts, then text each person by hand.
//
// Node 18+ (global fetch).
// -----------------------------------------------------------------------------

const fs   = require('node:fs');
const path = require('node:path');

const DRY_RUN = process.argv.includes('--dry-run');
const REMIND  = process.argv.includes('--remind');
const TEXTS   = process.argv.includes('--texts');

const BASE = (process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const REST = `${BASE}/rest/v1/claim_invites`;
const RESEND_FN = `${BASE}/functions/v1/resend-claim`;
const REMIND_AFTER_MS = 18 * 60 * 60 * 1000;

function c(color, s) {
  const codes = { grey: 90, red: 31, green: 32, yellow: 33, cyan: 36, bold: 1 };
  return `\x1b[${codes[color] || 0}m${s}\x1b[0m`;
}

function requireKey() {
  if (!SERVICE_KEY) {
    console.error(c('red', 'error: SUPABASE_SERVICE_ROLE_KEY env var is required'));
    console.error(c('grey', '      Dashboard → Project Settings → API → service_role secret'));
    process.exit(1);
  }
}

async function getInvites() {
  const url = `${REST}?select=id,email,name,phone,sent_at,opened_at,claimed_at,reminded_at,send_count&order=created_at.asc`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(c('red', `error: reading claim_invites failed — HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`));
    process.exit(1);
  }
  return res.json();
}

function hoursSince(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

function fmtHours(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

async function sendReminder(email) {
  const res = await fetch(RESEND_FN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, kind: 'reminder' }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

async function stampReminded(id) {
  const res = await fetch(`${REST}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ reminded_at: new Date().toISOString() }),
  });
  return res.ok;
}

function firstName(inv) {
  if (inv.name) return inv.name.trim().split(/\s+/)[0];
  return (inv.email || '').split('@')[0];
}

function textFor(inv) {
  return `Hey ${firstName(inv)}, Alex from Gunforma. Your build is live on the site and it's `
    + `got your name on it. Check your email for the claim link (from Gunforma, might be `
    + `in promotions/spam). Takes a minute. Want the founding-builder username before `
    + `launch traffic hits.`;
}

function printTable(invites) {
  console.log('');
  console.log(c('bold', 'name'.padEnd(18) + 'email'.padEnd(34) + 'sent'.padEnd(8) + 'opened'.padEnd(8) + 'claimed'));
  console.log(c('grey', '-'.repeat(80)));
  for (const inv of invites) {
    const claimed = inv.claimed_at ? c('green', 'yes') : c('yellow', 'no');
    const opened  = inv.opened_at ? 'yes' : '—';
    const row = (inv.name || '').slice(0, 16).padEnd(18)
      + (inv.email || '').slice(0, 32).padEnd(34)
      + fmtHours(hoursSince(inv.sent_at)).padEnd(8)
      + opened.padEnd(8);
    console.log(row + claimed);
  }
  const total = invites.length;
  const claimed = invites.filter(i => i.claimed_at).length;
  const opened = invites.filter(i => i.opened_at && !i.claimed_at).length;
  console.log('');
  console.log(c('bold', `${total} invited · ${claimed} claimed · ${opened} opened-not-claimed · ${total - claimed - opened} cold`));
}

(async function main() {
  requireKey();
  const invites = await getInvites();

  if (!REMIND && !TEXTS) {
    printTable(invites);
    return;
  }

  if (REMIND) {
    const due = invites.filter(i =>
      !i.claimed_at && !i.reminded_at && hoursSince(i.sent_at) != null && hoursSince(i.sent_at) >= REMIND_AFTER_MS / 3600000);
    if (DRY_RUN) console.log(c('bold', '\n== DRY RUN — no reminders will be sent ==\n'));
    console.log(c('grey', `${due.length} invite(s) due a reminder (unclaimed, sent >= 18h ago, not yet reminded)\n`));
    let sent = 0, failed = 0;
    for (const inv of due) {
      if (DRY_RUN) { console.log(c('cyan', `◇ would remind ${inv.email}`)); continue; }
      const r = await sendReminder(inv.email);
      if (r.status >= 200 && r.status < 300 && r.body && r.body.ok) {
        const stamped = await stampReminded(inv.id);
        console.log(c('green', `✓ reminded ${inv.email}`) + (stamped ? '' : c('red', ' (but reminded_at stamp failed — may remind again next run)')));
        sent++;
      } else {
        console.log(c('red', `✗ ${inv.email}: resend-claim ${r.status} ${JSON.stringify(r.body)}`));
        failed++;
      }
      await new Promise(res => setTimeout(res, 800));
    }
    if (!DRY_RUN) console.log('\n' + c(failed ? 'red' : 'green', `Reminded ${sent}. ${failed} failed.`));
  }

  if (TEXTS) {
    const withPhone = invites.filter(i => !i.claimed_at && i.phone);
    if (!withPhone.length) { console.log(c('yellow', '\nNo unclaimed builders with a phone number on file.')); return; }
    console.log(c('bold', `\n${withPhone.length} text(s) to send by hand:\n`));
    const rows = [['name', 'phone', 'email', 'text']];
    for (const inv of withPhone) {
      const t = textFor(inv);
      console.log(c('cyan', `${inv.name || inv.email} (${inv.phone})`));
      console.log('  ' + t + '\n');
      rows.push([inv.name || '', inv.phone, inv.email, t]);
    }
    const outDir = path.resolve(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const csvPath = path.join(outDir, `texts-${stamp}.csv`);
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    fs.writeFileSync(csvPath, csv);
    console.log(c('grey', `written: ${path.relative(process.cwd(), csvPath)}`));
  }
})();
