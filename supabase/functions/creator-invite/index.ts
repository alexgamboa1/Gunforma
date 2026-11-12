// creator-invite — Supabase Edge Function (service role, or a signed-in ADMIN)
// -----------------------------------------------------------------------------
// The admin side of claimable creator pages. Driven by
// scripts/creator-invites.js (service role) and, since the admin portal grew
// gunforma-admin-creators.html, by an admin's browser session; never called by
// the public site.
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
//               instagram_url?, youtube_url?, sent_via?, source?, notes? }
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
//   update    { handle, source?, notes?, sent_via?, display_name?, bio?,
//               instagram_url?, youtube_url? }
//             Edits an invite in place. source / notes / sent_via are OUR
//             record-keeping (where they were found, what we noted, how the
//             link was delivered) and stay editable in every state;
//             display_name / bio / instagram_url / youtube_url are the
//             creator's page and are refused once claimed — the page belongs
//             to the creator then. Only keys present in the body are
//             written; an empty string clears the column. Same validation
//             as invite.
//
//   status    {}           Every invite with its state — the status report.
//             Returns source and notes too (null, with migrated:false, until
//             the source/notes migration is applied — see the ladder below),
//             and each invite's build_ids so the admin page can grey out
//             drafts already attached to an invite.
//
// Why 30 days and not claim_invites' 7: a launch invite goes to an email the
// builder gave us minutes earlier; a creator invite is a cold DM that may sit
// unread for weeks. The token is the only credential either way.
//
// Auth, two doors, checked in this order:
//   1. SUPABASE_SERVICE_ROLE_KEY as `Authorization: Bearer` — the CLI path,
//      unchanged. Same isServiceRole() check as launch-invite (verify_jwt
//      alone accepts the anon key, which is public).
//   2. A signed-in ADMIN's session JWT: auth.getUser(jwt) resolves the user,
//      then profiles.role = 'admin' is read with the SERVICE client. NOT
//      is_admin() — that reads auth.uid() from request.jwt.claims, and a
//      service-client query carries no request context, so it would answer
//      false for everyone. Anyone else: 403.
//
// CORS exists because a browser calls this now (gunforma-admin-creators.html).
// Same ALLOWED_ORIGINS as creator-claim: the apex plus netlify dev. The raw
// claim link going back to an admin's browser is DELIBERATE — it is the only
// copy (the database stores a hash), and the admin is the person who DMs it.
// That is also why the admin page, like gunforma-creator.html, carries no
// analytics tag (gunforma-admin-* is excluded wholesale).
//
// The source/notes columns ship in a migration AFTER this code (CLAUDE.md:
// code first). Until it is applied: status falls back to a select without
// them (migrated: false), and invite/update answer a readable error rather
// than a raw PGRST204 when asked to write them.
//
// Deploy:
//   supabase functions deploy creator-invite --project-ref lagjjcpclvzrjlrswojt
// -----------------------------------------------------------------------------

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { newToken } from '../_shared/token.ts';
import { SITE } from '../_shared/email.ts';

const ALLOWED_ORIGINS = new Set([
  'https://gunforma.com',
  'http://localhost:8794',
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin':  allowOrigin,
    'Vary':                         'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
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

function bearerOf(req: Request): string | null {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function isServiceRole(req: Request): boolean {
  const token = bearerOf(req);
  if (!token) return false;
  const envKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return (!!envKey && token === envKey) || roleOf(token) === 'service_role';
}

// The admin door. The service client resolves the JWT to a user, then reads
// that user's role. Deliberately NOT is_admin(): a service-client query
// carries no request context, so auth.uid() inside it is NULL and is_admin()
// answers false for every caller (CLAUDE.md, "service_role bypasses RLS. It
// does not bypass triggers." — same NULL, different trap).
async function isAdminSession(req: Request, supabase: SupabaseClient): Promise<boolean> {
  const token = bearerOf(req);
  if (!token) return false;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: prof } = await supabase
    .from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  return !!prof && prof.role === 'admin';
}

const HANDLE_RE = /^[a-zA-Z0-9_]{3,24}$/;          // profiles_username_check
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IG_RE     = /^https:\/\/(www\.)?instagram\.com\//;
const YT_RE     = /^https:\/\/(www\.|m\.)?youtube\.com\//;
const CLAIM_PAGE = `${SITE}/gunforma-creator.html`;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIONS = ['invite', 'new-link', 'revoke', 'update', 'status'];

// The row shape status and update return. source/notes are added separately
// so the pre-migration ladder can leave them off the select.
const INVITE_COLS =
  'id, handle, status, display_name, bio, instagram_url, youtube_url, ' +
  'sent_via, expires_at, opened_at, claimed_at, declined_at, revoked_at, created_at';

// deno-lint-ignore no-explicit-any
function inviteRow(r: any, migrated: boolean) {
  return {
    handle:        r.handle,
    status:        r.status,
    builds:        (r.creator_invite_builds || []).length,
    // deno-lint-ignore no-explicit-any
    build_ids:     (r.creator_invite_builds || []).map((l: any) => l.build_id),
    sent_via:      r.sent_via,
    source:        migrated ? (r.source ?? null) : null,
    notes:         migrated ? (r.notes ?? null) : null,
    display_name:  r.display_name,
    bio:           r.bio,
    instagram_url: r.instagram_url,
    youtube_url:   r.youtube_url,
    opened:        !!r.opened_at,
    created_at:    r.created_at,
    expires_at:    r.expires_at,
    claimed_at:    r.claimed_at,
    declined_at:   r.declined_at,
    revoked_at:    r.revoked_at,
  };
}

// An unknown column fails the WHOLE query — 42703 on a select, PGRST204 on a
// write — the same shape go.js ladders around.
// deno-lint-ignore no-explicit-any
function isMissingColumn(err: any): boolean {
  return !!err && (err.code === '42703' || err.code === 'PGRST204');
}

// Shared validation for invite and update; values arrive trimmed-or-null.
function badField(displayName: string | null, bio: string | null, ig: string | null, yt: string | null, notes: string | null): string | null {
  if (displayName && displayName.length > 60) return 'display_name is over 60 characters';
  if (bio && bio.length > 280)                return 'bio is over 280 characters';
  if (ig && !IG_RE.test(ig))                  return 'instagram_url must start with https://instagram.com/';
  if (yt && !YT_RE.test(yt))                  return 'youtube_url must start with https://youtube.com/';
  if (notes && notes.length > 4000)           return 'notes is over 4000 characters';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersFor(req) });

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req) },
    });

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (!isServiceRole(req) && !(await isAdminSession(req, supabase))) {
    return json({ error: 'Forbidden: this endpoint requires the service role key or an admin session' }, 403);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const action = String(body.action || '').trim().toLowerCase();
  if (!ACTIONS.includes(action)) {
    return json({ error: 'action must be one of: ' + ACTIONS.join(', ') }, 400);
  }

  // ============================ action: status ============================
  if (action === 'status') {
    const base = INVITE_COLS + ', creator_invite_builds(build_id)';
    let migrated = true;
    let { data, error } = await supabase
      .from('creator_invites')
      .select(base + ', source, notes')
      .order('created_at', { ascending: false });
    if (error && isMissingColumn(error)) {
      // Migration not applied yet: same report, source/notes read as null.
      migrated = false;
      ({ data, error } = await supabase
        .from('creator_invites')
        .select(base)
        .order('created_at', { ascending: false }));
    }
    if (error) return json({ error: error.message }, 500);
    return json({ invites: (data || []).map((r) => inviteRow(r, migrated)), migrated });
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

  // ============================ action: update ============================
  if (action === 'update') {
    if (!existing) return json({ error: 'no live invite for this handle' }, 404);

    const PAGE_FIELDS   = ['display_name', 'bio', 'instagram_url', 'youtube_url'];
    const RECORD_FIELDS = ['source', 'notes', 'sent_via'];
    // Only keys PRESENT in the body are written; an empty string clears.
    // deno-lint-ignore no-explicit-any
    const upd: Record<string, any> = {};
    for (const k of [...PAGE_FIELDS, ...RECORD_FIELDS]) {
      if (k in body) upd[k] = String(body[k] ?? '').trim() || null;
    }
    if (!Object.keys(upd).length) {
      return json({ error: 'nothing to update: send at least one of ' + [...RECORD_FIELDS, ...PAGE_FIELDS].join(', ') }, 400);
    }

    if (PAGE_FIELDS.some((k) => k in upd) && existing.status === 'claimed') {
      return json({ error: 'claimed: the page belongs to the creator now — display name, bio and links are theirs to edit. (source, notes and sent_via are still editable.)' }, 409);
    }
    const bad = badField(
      'display_name' in upd ? upd.display_name : null,
      'bio' in upd ? upd.bio : null,
      'instagram_url' in upd ? upd.instagram_url : null,
      'youtube_url' in upd ? upd.youtube_url : null,
      'notes' in upd ? upd.notes : null,
    );
    if (bad) return json({ error: bad }, 400);

    const { data: updRows, error: updErr } = await supabase
      .from('creator_invites')
      .update(upd)
      .eq('id', existing.id)
      .select(INVITE_COLS + ', source, notes, creator_invite_builds(build_id)');
    if (updErr && isMissingColumn(updErr)) {
      return json({ error: ('source' in upd || 'notes' in upd)
        ? 'the source/notes migration has not been applied yet (supabase db push --linked) — until then only sent_via, display_name, bio and the links can be edited'
        : 'update failed: ' + updErr.message }, 500);
    }
    if (updErr || !updRows || updRows.length !== 1) {
      return json({ error: 'update failed: ' + (updErr?.message || 'no row updated') }, 500);
    }
    return json({ success: true, invite: inviteRow(updRows[0], true) });
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
  const source      = String(body.source || '').trim() || null;
  const notes       = String(body.notes || '').trim() || null;
  const badInv = badField(displayName, bio, ig, yt, notes);
  if (badInv) return json({ error: badInv }, 400);

  // Mint, insert WITH the hash (no placeholder), then attach the builds.
  // source/notes keys ride along only when set, so an invite without them
  // still works before their migration is applied.
  const { raw, hash } = await newToken();
  const expiresIso = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
  const { data: inserted, error: insErr } = await supabase
    .from('creator_invites')
    .insert({
      handle, display_name: displayName, bio,
      instagram_url: ig, youtube_url: yt,
      token_hash: hash, expires_at: expiresIso, sent_via: sentVia,
      ...(source ? { source } : {}),
      ...(notes ? { notes } : {}),
    })
    .select('id')
    .single();
  if (insErr && isMissingColumn(insErr) && (source || notes)) {
    return json({ error: 'the source/notes migration has not been applied yet (supabase db push --linked) — retry without source/notes, or apply it first' }, 500);
  }
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
