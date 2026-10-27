// creator-invite — Supabase Edge Function (SERVICE ROLE ONLY)
// -----------------------------------------------------------------------------
// The admin side of claimable creator pages. Driven by
// scripts/creator-invites.js; never called by the site.
//
// A creator invite is a page prepared BEFORE the creator agreed to anything:
// their handle held, a bio and social links drafted, their builds posted as
// ownerless DRAFTS (invisible to the public — "Public can view approved
// builds" already hides drafts). One private link goes out in a DM. Until the
// creator claims, nothing is public and /u/<handle> stays a 404.
//
// Body: { action, ... }:
//
//   invite    { handle, build_ids: [uuid...], display_name?, bio?,
//               instagram_url?, youtube_url?, sent_via? }
//             Holds the handle, attaches the draft builds, mints a 30-day
//             token and returns { claim_url } — the ONLY copy of the raw
//             token; the database stores its sha256 hex. Refuses a handle an
//             existing profile already uses (case-insensitively), a handle
//             already held, and any build that is not an unowned draft.
//
//   new-link  { handle }   A fresh token + 30 days for an unclaimed invite.
//             The old link stops working the moment this returns.
//
//   revoke    { handle }   Withdraw an invite (also how a declined handle is
//             released). The drafts are left alone for the admin to delete
//             or reuse; the response lists them.
//
//   status    {}           Every invite with its state — the status report.
//
// Why 30 days and not claim_invites' 7: a launch invite goes to an email the
// builder gave us minutes earlier; a creator invite is a cold DM that may sit
// unread for weeks. The token is the only credential either way.
//
// Auth: caller must pass SUPABASE_SERVICE_ROLE_KEY as `Authorization: Bearer`.
// Same isServiceRole() check as launch-invite (verify_jwt alone accepts the
// anon key, which is public).
//
// Deploy:
//   supabase functions deploy creator-invite --project-ref lagjjcpclvzrjlrswojt
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { newToken } from '../_shared/token.ts';
import { SITE } from '../_shared/email.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function roleOf(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return typeof claims?.role === 'string' ? claims.role : null;
  } catch { return null; }
}

function isServiceRole(req: Request): boolean {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const token = m[1].trim();
  const envKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return (envKey && token === envKey) || roleOf(token) === 'service_role';
}

const HANDLE_RE = /^[a-zA-Z0-9_]{3,24}$/;          // profiles_username_check
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IG_RE     = /^https:\/\/(www\.)?instagram\.com\//;
const YT_RE     = /^https:\/\/(www\.|m\.)?youtube\.com\//;
const CLAIM_PAGE = `${SITE}/gunforma-creator.html`;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIONS = ['invite', 'new-link', 'revoke', 'status'];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isServiceRole(req)) {
    return json({ error: 'Forbidden: this endpoint requires the service role key' }, 403);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const action = String(body.action || '').trim().toLowerCase();
  if (!ACTIONS.includes(action)) {
    return json({ error: 'action must be one of: ' + ACTIONS.join(', ') }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ============================ action: status ============================
  if (action === 'status') {
    const { data, error } = await supabase
      .from('creator_invites')
      .select('handle, status, sent_via, expires_at, opened_at, claimed_at, declined_at, revoked_at, created_at, creator_invite_builds(build_id)')
      .order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, 500);
    // deno-lint-ignore no-explicit-any
    const rows = (data || []).map((r: any) => ({
      handle:     r.handle,
      status:     r.status,
      builds:     (r.creator_invite_builds || []).length,
      sent_via:   r.sent_via,
      opened:     !!r.opened_at,
      expires_at: r.expires_at,
      claimed_at: r.claimed_at,
    }));
    return json({ invites: rows });
  }

  const handle = String(body.handle || '').trim();
  if (!HANDLE_RE.test(handle)) {
    return json({ error: 'handle must be 3–24 characters, letters/numbers/underscores' }, 400);
  }

  // The one live invite for this handle, if any (revoked rows don't count —
  // the partial unique index creator_invites_handle_live says the same).
  const { data: existing, error: exErr } = await supabase
    .from('creator_invites')
    .select('*')
    .ilike('handle', handle)
    .neq('status', 'revoked')
    .maybeSingle();
  if (exErr) return json({ error: 'invite lookup failed: ' + exErr.message }, 500);

  // =========================== action: new-link ===========================
  if (action === 'new-link') {
    if (!existing)               return json({ error: 'no live invite for this handle' }, 404);
    if (existing.status === 'claimed')  return json({ error: 'already claimed — nothing to send' }, 409);
    if (existing.status === 'declined') return json({ error: 'they said no. Respect it: no new link for a declined invite. (revoke releases the handle)' }, 409);
    const { raw, hash } = await newToken();
    const expiresIso = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
    const { data: upd, error: updErr } = await supabase
      .from('creator_invites')
      .update({ token_hash: hash, expires_at: expiresIso })
      .eq('id', existing.id)
      .select('id');
    if (updErr || !upd || upd.length !== 1) {
      return json({ error: 'could not write the fresh token: ' + (updErr?.message || 'no row updated') }, 500);
    }
    return json({ success: true, handle: existing.handle, claim_url: `${CLAIM_PAGE}?t=${raw}`, expires_at: expiresIso });
  }

  // ============================ action: revoke ============================
  if (action === 'revoke') {
    if (!existing) return json({ error: 'no live invite for this handle' }, 404);
    if (existing.status === 'claimed') {
      return json({ error: 'already claimed: this is a real account now. Nothing here can take it back.' }, 409);
    }
    const { data: links } = await supabase
      .from('creator_invite_builds').select('build_id').eq('invite_id', existing.id);
    const { data: upd, error: updErr } = await supabase
      .from('creator_invites')
      .update({ status: 'revoked', revoked_at: new Date().toISOString(), token_hash: null,
                display_name: null, bio: null, instagram_url: null, youtube_url: null })
      .eq('id', existing.id)
      .select('id');
    if (updErr || !upd || upd.length !== 1) {
      return json({ error: 'revoke failed: ' + (updErr?.message || 'no row updated') }, 500);
    }
    return json({
      success: true,
      handle: existing.handle,
      released: true,
      // deno-lint-ignore no-explicit-any
      draft_builds_kept: (links || []).map((l: any) => l.build_id),
      note: 'The handle is free again. The draft builds still exist (hidden); delete them in /gunforma-admin-queue or attach them to a new invite.',
    });
  }

  // ============================ action: invite ============================
  if (existing) {
    return json({
      skipped: true,
      reason: `an invite for this handle already exists (status: ${existing.status})`,
      handle: existing.handle,
    }, 200);
  }

  // A real profile already uses this name, in any case form.
  const { data: taken, error: takenErr } = await supabase
    .from('profiles').select('id').ilike('username', handle).limit(1);
  if (takenErr) return json({ error: 'profile lookup failed: ' + takenErr.message }, 500);
  if (taken && taken.length) {
    return json({ error: 'a profile already uses this username — invite them to claim THAT account, or pick another handle' }, 409);
  }

  const buildIds: string[] = Array.isArray(body.build_ids) ? body.build_ids : [];
  if (!buildIds.length)                        return json({ error: 'build_ids is required: post their builds first (as private drafts), then invite' }, 400);
  if (buildIds.some((b) => !UUID_RE.test(b)))  return json({ error: 'every build_id must be a UUID' }, 400);

  // Every build must be an unowned draft not already on another invite.
  const { data: builds, error: bErr } = await supabase
    .from('builds').select('id, status, user_id').in('id', buildIds);
  if (bErr) return json({ error: 'build lookup failed: ' + bErr.message }, 500);
  const found = new Map((builds || []).map((b) => [b.id, b]));
  for (const id of buildIds) {
    const b = found.get(id);
    if (!b)                    return json({ error: `build ${id} not found` }, 404);
    if (b.status !== 'draft')  return json({ error: `build ${id} is ${b.status}, not a private draft — post creator builds with "Private creator draft" checked` }, 409);
    if (b.user_id)             return json({ error: `build ${id} already has an owner` }, 409);
  }
  const { data: alreadyLinked } = await supabase
    .from('creator_invite_builds').select('build_id').in('build_id', buildIds);
  if (alreadyLinked && alreadyLinked.length) {
    return json({ error: `build ${alreadyLinked[0].build_id} is already on another invite` }, 409);
  }

  const displayName = String(body.display_name || '').trim() || null;
  const bio         = String(body.bio || '').trim() || null;
  const ig          = String(body.instagram_url || '').trim() || null;
  const yt          = String(body.youtube_url || '').trim() || null;
  const sentVia     = String(body.sent_via || '').trim() || null;
  if (displayName && displayName.length > 60) return json({ error: 'display_name is over 60 characters' }, 400);
  if (bio && bio.length > 280)                return json({ error: 'bio is over 280 characters' }, 400);
  if (ig && !IG_RE.test(ig))                  return json({ error: 'instagram_url must start with https://instagram.com/' }, 400);
  if (yt && !YT_RE.test(yt))                  return json({ error: 'youtube_url must start with https://youtube.com/' }, 400);

  // Mint, insert WITH the hash (no placeholder), then attach the builds.
  const { raw, hash } = await newToken();
  const expiresIso = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
  const { data: inserted, error: insErr } = await supabase
    .from('creator_invites')
    .insert({
      handle, display_name: displayName, bio,
      instagram_url: ig, youtube_url: yt,
      token_hash: hash, expires_at: expiresIso, sent_via: sentVia,
    })
    .select('id')
    .single();
  if (insErr || !inserted) return json({ error: 'invite insert failed: ' + (insErr?.message || 'no row') }, 500);

  const linkRows = buildIds.map((b, i) => ({ invite_id: inserted.id, build_id: b, position: i }));
  const { error: linkErr } = await supabase.from('creator_invite_builds').insert(linkRows);
  if (linkErr) {
    // Clean up so a retry starts fresh; read the delete back (CLAUDE.md: a
    // zero-row delete returns success).
    const { data: del } = await supabase.from('creator_invites').delete().eq('id', inserted.id).select('id');
    const cleaned = Array.isArray(del) && del.length === 1;
    return json({ error: 'builds could not be attached: ' + linkErr.message + (cleaned ? ' (invite rolled back)' : ' — AND the invite row could not be rolled back; revoke it by hand') }, 500);
  }

  return json({
    success: true,
    handle,
    builds: buildIds.length,
    claim_url: `${CLAIM_PAGE}?t=${raw}`,
    expires_at: expiresIso,
    note: 'This is the only copy of that link. DM it to the creator; the database holds only its hash.',
  });
});
