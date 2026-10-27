#!/usr/bin/env node
// creator-invites.js — hold a creator's handle, build their page, DM one link
// -----------------------------------------------------------------------------
// The admin CLI for claimable creator pages (creator-invite Edge Function).
// Nothing here emails anyone: the claim link comes back to THIS terminal and
// you DM it yourself from the gunforma Instagram account. That is deliberate —
// a DM from the account they already follow is the trust signal, and we hold
// no email address they never gave us.
//
// The flow:
//   1. Post their builds in /gunforma-admin-post with "Private creator draft"
//      checked. Copy each Build UUID. The builds are invisible to everyone.
//   2. node scripts/creator-invites.js --invite <handle> \
//        --builds <uuid,uuid> [--name "Display Name"] [--bio "..."] \
//        [--ig https://instagram.com/...] [--yt https://youtube.com/@...] \
//        [--via "IG DM"]
//   3. DM the printed link. It lasts 30 days and this is its ONLY copy —
//      the database stores a hash. Lose it: --new-link mints another.
//   4. node scripts/creator-invites.js            ← the status report
//
// Other actions, one handle each:
//   --new-link <handle>   fresh link + 30 days (kills the old link)
//   --revoke  <handle>    withdraw an invite / release a declined handle.
//                         The hidden draft builds are kept; it prints them.
//
// What the creator sees: gunforma.com/gunforma-creator.html?t=… — their page,
// private, with Claim and "Not interested" buttons. Decline deletes the
// drafts and keeps the handle held so nobody can pose as them.
//
// Env: SUPABASE_SERVICE_ROLE_KEY (same key as launch-invites.js; never saved).
// Node 18+ (global fetch).
// -----------------------------------------------------------------------------

const FUNCTION_URL = 'https://lagjjcpclvzrjlrswojt.supabase.co/functions/v1/creator-invite';

const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error(`\x1b[31merror: ${name} needs a value\x1b[0m`);
    process.exit(1);
  }
  return v.trim();
}

const INVITE  = flagValue('--invite');
const NEWLINK = flagValue('--new-link');
const REVOKE  = flagValue('--revoke');
const picked = [INVITE, NEWLINK, REVOKE].filter(Boolean);
if (picked.length > 1) {
  console.error('\x1b[31merror: use one of --invite, --new-link, --revoke\x1b[0m');
  process.exit(1);
}

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('\x1b[31mSUPABASE_SERVICE_ROLE_KEY is not set.\x1b[0m');
  console.error('Copy it from Supabase → Project Settings → API Keys → service_role, then:');
  console.error("  SUPABASE_SERVICE_ROLE_KEY='...' node scripts/creator-invites.js ...");
  process.exit(1);
}

async function call(body) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); } catch { data = { error: `non-JSON response (HTTP ${res.status})` }; }
  return { status: res.status, data };
}

const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;

(async () => {
  // ── invite ────────────────────────────────────────────────────────────
  if (INVITE) {
    const buildsArg = flagValue('--builds');
    if (!buildsArg) {
      console.error(red('error: --invite needs --builds <uuid,uuid,...> — post their builds first (Private creator draft), then invite'));
      process.exit(1);
    }
    const { status, data } = await call({
      action: 'invite',
      handle: INVITE,
      build_ids: buildsArg.split(',').map((s) => s.trim()).filter(Boolean),
      display_name:  flagValue('--name') || undefined,
      bio:           flagValue('--bio') || undefined,
      instagram_url: flagValue('--ig') || undefined,
      youtube_url:   flagValue('--yt') || undefined,
      sent_via:      flagValue('--via') || undefined,
    });
    if (data.error)   { console.error(red('✗ ' + data.error)); process.exit(1); }
    if (data.skipped) { console.log(yellow('– skipped: ' + data.reason)); process.exit(0); }
    console.log(green('✓') + ` @${data.handle} — handle held, ${data.builds} hidden draft build(s) attached`);
    console.log('');
    console.log(bold('  DM them this link (its only copy — expires ' + String(data.expires_at).slice(0, 10) + '):'));
    console.log('  ' + data.claim_url);
    console.log('');
    console.log('  Until they claim, nothing is public and /u/' + data.handle + ' is a 404.');
    process.exit(0);
  }

  // ── new-link ──────────────────────────────────────────────────────────
  if (NEWLINK) {
    const { data } = await call({ action: 'new-link', handle: NEWLINK });
    if (data.error) { console.error(red('✗ ' + data.error)); process.exit(1); }
    console.log(green('✓') + ` fresh link for @${data.handle} (the old one is dead, expires ${String(data.expires_at).slice(0, 10)}):`);
    console.log('  ' + data.claim_url);
    process.exit(0);
  }

  // ── revoke ────────────────────────────────────────────────────────────
  if (REVOKE) {
    const { data } = await call({ action: 'revoke', handle: REVOKE });
    if (data.error) { console.error(red('✗ ' + data.error)); process.exit(1); }
    console.log(green('✓') + ` @${data.handle} revoked — the handle is free again.`);
    if ((data.draft_builds_kept || []).length) {
      console.log(yellow('  Draft builds kept (hidden), delete or reuse them:'));
      for (const id of data.draft_builds_kept) console.log('    ' + id);
    }
    process.exit(0);
  }

  // ── status (the default) ──────────────────────────────────────────────
  const { data } = await call({ action: 'status' });
  if (data.error) { console.error(red('✗ ' + data.error)); process.exit(1); }
  const invites = data.invites || [];
  if (!invites.length) { console.log('No creator invites yet.'); process.exit(0); }
  const MARK = { invited: yellow('…'), claimed: green('✓'), declined: red('✗'), revoked: '–' };
  console.log(bold('creator invites') + ` (${invites.length})`);
  for (const i of invites) {
    const expired = i.status === 'invited' && new Date(i.expires_at) < new Date();
    const state = i.status === 'invited'
      ? (expired ? 'invited, link EXPIRED — --new-link to refresh'
                 : (i.opened ? 'invited, opened, not claimed' : 'invited, never opened'))
      : i.status + (i.claimed_at ? ' ' + String(i.claimed_at).slice(0, 10) : '');
    console.log(`  ${MARK[i.status] || '?'} @${String(i.handle).padEnd(24)} ${String(i.builds).padStart(2)} build(s)  ${state}${i.sent_via ? '  via ' + i.sent_via : ''}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(red('✗ ' + (e && e.message ? e.message : String(e))));
  process.exit(1);
});
