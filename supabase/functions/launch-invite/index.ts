// launch-invite — Supabase Edge Function
// -----------------------------------------------------------------------------
// Coordinated launch-day invite. Creates the auth user (email pre-confirmed),
// links the pre-posted build, mints a DURABLE 7-day Gunforma claim token, and
// sends our OWN branded invite email (through Resend, via ../_shared/email.ts)
// carrying gunforma-claim.html?t=<raw_token>.
//
// Why not inviteUserByEmail any more: Supabase's invite email dies at the
// single OTP-expiry setting (24h), which we will not raise. Our token lasts 7
// days and redeem-claim mints a fresh magic link on each click, so the 24h cap
// never faces the builder. See supabase/claim_invites.sql.
//
// THE CLAIMED SIGNAL IS claim_invites.claimed_at, NOT email_confirmed_at.
// Because we now create users with email_confirm:true, email_confirmed_at is
// set at creation and means nothing about whether the builder has onboarded.
// The profiles trigger (mark_claim_claimed) stamps claimed_at when onboarding
// completes.
//
// Body: { email, build_id, name?, phone?, action? }. `action`:
//   invite   (default) create + link + mint + send. Idempotent: an email that
//            already has an unclaimed invite is reported, not re-sent.
//   resend   a fresh 7-day token + a new branded invite, for an unclaimed
//            invite. (The public/claim-page resend path is resend-claim.)
//   release  undo an UNCLAIMED invite: unlink the build, hand photos back to an
//            admin, delete the account (its claim_invites row cascades away).
//
// Deploy:
//   supabase functions deploy launch-invite --project-ref lagjjcpclvzrjlrswojt
//
// Auth: caller must pass SUPABASE_SERVICE_ROLE_KEY as `Authorization: Bearer`.
// The function checks the role claim itself (verify_jwt alone accepts the anon
// key, which is public). See isServiceRole().
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { newToken } from '../_shared/token.ts';
import { inviteEmail, sendEmail, SITE } from '../_shared/email.ts';

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

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req) },
  });
}

function bearerOf(req: Request): string | null {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function roleOf(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded));
    return typeof claims?.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

function isServiceRole(req: Request): boolean {
  const token = bearerOf(req);
  if (!token) return false;
  const envKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (envKey && token === envKey) return true;
  return roleOf(token) === 'service_role';
}

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CLAIM_PAGE = `${SITE}/gunforma-claim.html`;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIONS = ['invite', 'resend', 'release'];

// listUsers paginates 50 at a time with no email filter; a launch batch is ~30
// users, so cap the scan at 1000.
// deno-lint-ignore no-explicit-any
async function findAuthUserByEmail(supabase: any, email: string): Promise<any | null> {
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 50 });
    if (error) throw error;
    if (!data || data.users.length === 0) break;
    // deno-lint-ignore no-explicit-any
    const hit = data.users.find((u: any) => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 50) break;
    page++;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
async function findInvite(supabase: any, email: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('claim_invites')
    .select('*')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersFor(req) });
  if (req.method !== 'POST')    return json(req, { error: 'Method not allowed' }, 405);

  if (!isServiceRole(req)) {
    return json(req, { error: 'Forbidden: this endpoint requires the service role key' }, 403);
  }

  let body: { email?: string; build_id?: string; name?: string; phone?: string; action?: string };
  try { body = await req.json(); }
  catch { return json(req, { error: 'Invalid JSON body' }, 400); }

  const email   = (body.email    || '').trim().toLowerCase();
  const buildId = (body.build_id || '').trim();
  const name    = (body.name     || '').trim() || null;
  const phone   = (body.phone    || '').trim() || null;
  const action  = (body.action   || 'invite').trim().toLowerCase();

  if (!email)                     return json(req, { error: 'email is required' }, 400);
  if (!EMAIL_RE.test(email))      return json(req, { error: 'email is not a valid address' }, 400);
  if (!buildId)                   return json(req, { error: 'build_id is required' }, 400);
  if (!UUID_RE.test(buildId))     return json(req, { error: 'build_id must be a UUID' }, 400);
  if (!ACTIONS.includes(action))  return json(req, { error: 'action must be one of: ' + ACTIONS.join(', ') }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey   = Deno.env.get('RESEND_API_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json(req, { error: 'Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' }, 500);
  }
  if (!resendKey) {
    return json(req, { error: 'Server misconfigured: RESEND_API_KEY missing (Edge Function secret)' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Build must exist (so a mistyped build_id never creates an orphan user).
  const { data: build, error: buildErr } = await supabase
    .from('builds').select('id, user_id').eq('id', buildId).maybeSingle();
  if (buildErr) return json(req, { error: 'build lookup failed: ' + buildErr.message }, 500);
  if (!build)   return json(req, { error: `build_id ${buildId} not found` }, 404);

  // deno-lint-ignore no-explicit-any
  let existing: any | null;
  // deno-lint-ignore no-explicit-any
  let invite: any | null;
  try {
    existing = await findAuthUserByEmail(supabase, email);
    invite   = await findInvite(supabase, email);
  } catch (e) {
    return json(req, { error: 'lookup failed: ' + ((e as Error).message || String(e)) }, 500);
  }

  const linkedToThisEmail = !!(existing && build.user_id && existing.id === build.user_id);

  // Send the branded invite for a token that is ALREADY written to its row,
  // and shape the response. Shared by invite (new row) and resend (updated
  // row). The DB write happens at each call site so the token hash is stored
  // before the email carrying the raw token ever leaves.
  async function finishWithEmail(userId: string, rawToken: string, expiresIso: string, resent: boolean): Promise<Response> {
    const claimUrl = `${CLAIM_PAGE}?t=${rawToken}`;
    const mail = inviteEmail(claimUrl);
    const res = await sendEmail({ apiKey: resendKey!, to: email, subject: mail.subject, html: mail.html });
    if (!res.ok) {
      return json(req, {
        success: true,
        user_id: userId,
        build_id: buildId,
        expires_at: expiresIso,
        warning: `invite row is ready but the email failed to send (resend ${res.status}: ${res.body}). `
          + `Retry with: node scripts/launch-invites.js --resend ${email}`,
      }, 200);
    }
    return json(req, { success: true, resent, user_id: userId, build_id: buildId, expires_at: expiresIso });
  }

  // ============================ action: resend ============================
  if (action === 'resend') {
    if (!invite) {
      return json(req, { error: 'nothing to resend: no invite exists for this email — send a normal invite instead' }, 409);
    }
    if (invite.claimed_at) {
      return json(req, {
        error: 'already claimed: this builder has onboarded. They sign in with their password; "Forgot password?" sets a new one',
        claimed: true,
        user_id: invite.user_id,
        build_id: invite.build_id,
      }, 409);
    }
    // Fresh token onto the existing row, THEN send.
    const { raw, hash } = await newToken();
    const expiresIso = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();
    const prev = typeof invite.send_count === 'number' ? invite.send_count : 0;
    const { error: updErr } = await supabase
      .from('claim_invites')
      .update({ token_hash: hash, expires_at: expiresIso, last_sent_at: new Date().toISOString(), send_count: prev + 1 })
      .eq('id', invite.id);
    if (updErr) return json(req, { error: 'could not write the fresh claim token: ' + updErr.message }, 500);
    return await finishWithEmail(invite.user_id, raw, expiresIso, true);
  }

  // ============================ action: release ============================
  if (action === 'release') {
    if (!existing) {
      return json(req, { error: 'nothing to release: no account exists for this email' }, 409);
    }
    if (!linkedToThisEmail) {
      return json(req, { error: "refusing to release: this build is not linked to this email's account" }, 409);
    }
    if ((invite && invite.claimed_at) || existing.last_sign_in_at) {
      return json(req, {
        error: "refusing to release: this builder has already claimed their account. Releasing would delete a real person's account",
        claimed: true,
        user_id: existing.id,
        build_id: buildId,
      }, 409);
    }
    const userId = existing.id;

    const { data: admins, error: adminErr } = await supabase
      .from('profiles').select('id').eq('role', 'admin')
      .order('created_at', { ascending: true }).limit(1);
    if (adminErr) return json(req, { error: 'admin lookup failed, nothing changed: ' + adminErr.message }, 500);
    const adminId = admins && admins[0] && admins[0].id;
    if (!adminId) return json(req, { error: 'no admin profile found to hold the photo rows, nothing changed' }, 500);

    const { error: photoErr } = await supabase
      .from('build_photos').update({ user_id: adminId }).eq('build_id', buildId).eq('user_id', userId);
    if (photoErr) return json(req, { error: 'photo hand-back failed, nothing else changed: ' + photoErr.message }, 500);

    const { data: unlinked, error: unlinkErr } = await supabase
      .from('builds').update({ user_id: null }).eq('id', buildId).eq('user_id', userId).select('id');
    if (unlinkErr) return json(req, { error: 'build unlink failed, account kept: ' + unlinkErr.message }, 500);
    if (!Array.isArray(unlinked) || unlinked.length !== 1) {
      return json(req, { error: 'build unlink matched no row, account kept' }, 500);
    }

    const { data: stillBuilds, error: sbErr } = await supabase
      .from('builds').select('id').eq('user_id', userId);
    const { data: stillPhotos, error: spErr } = await supabase
      .from('build_photos').select('id').eq('user_id', userId);
    if (sbErr || spErr) {
      return json(req, {
        success: true, build_id: buildId, user_id: userId,
        warning: 'build released, but the read-back failed so the unclaimed account was NOT deleted: '
          + ((sbErr || spErr) as { message: string }).message,
      }, 200);
    }
    if ((stillBuilds || []).length || (stillPhotos || []).length) {
      return json(req, {
        success: true, build_id: buildId, user_id: userId,
        warning: `build released, but the account still owns ${(stillBuilds || []).length} build(s) and `
          + `${(stillPhotos || []).length} photo row(s), so it was NOT deleted`,
      }, 200);
    }

    // Deleting the user cascades its claim_invites row away (user_id FK ON
    // DELETE CASCADE), so the live token dies with the account.
    const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
    if (delErr) {
      return json(req, {
        success: true, build_id: buildId, user_id: userId,
        warning: 'build released, but the unclaimed account could not be deleted: ' + (delErr.message || String(delErr)),
      }, 200);
    }
    return json(req, { success: true, released: true, build_id: buildId, deleted_user_id: userId });
  }

  // ======================= action: invite (the default) =======================
  // Idempotent. An email with an existing invite is reported, never re-sent, so
  // the whole of builders.json can be re-run as a status check.
  if (invite) {
    if (invite.claimed_at) {
      return json(req, { skipped: true, reason: 'already claimed by this builder', user_id: invite.user_id, build_id: invite.build_id }, 200);
    }
    return json(req, {
      skipped: true,
      unclaimed: true,
      reason: 'already invited, not claimed yet — resend to send a fresh link',
      user_id: invite.user_id,
      build_id: invite.build_id,
      invited_at: invite.sent_at || null,
    }, 200);
  }

  // No invite row. Guard the build and the account before creating anything.
  if (build.user_id) {
    return json(req, {
      skipped: true,
      reason: linkedToThisEmail
        ? 'build linked to this email but no invite row — release it first, then re-invite'
        : 'build already has a user linked — refusing to overwrite',
      build_id: buildId,
      existing_user_id: build.user_id,
    }, 200);
  }
  if (existing) {
    return json(req, { skipped: true, reason: 'an account already exists for this email but no invite — investigate before inviting', user_id: existing.id, build_id: buildId }, 200);
  }

  // Create the user (email pre-confirmed; the token, not the email link, is the
  // credential). handle_new_user seeds the profile with onboarding_complete=false.
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { invited: true },
  });
  if (createErr) {
    const msg = createErr.message || String(createErr);
    if (/already|registered|exists/i.test(msg)) {
      return json(req, { skipped: true, reason: 'already exists', build_id: buildId }, 200);
    }
    return json(req, { error: 'createUser failed: ' + msg }, 500);
  }
  const userId = created?.user?.id;
  if (!userId) return json(req, { error: 'createUser returned no user id' }, 500);

  // Link the build (fail loudly on 0 rows).
  const { data: linked, error: linkErr } = await supabase
    .from('builds').update({ user_id: userId }).eq('id', buildId).is('user_id', null).select('id');
  if (linkErr) {
    return json(req, { success: true, user_id: userId, build_id: buildId, warning: 'user created but build link failed: ' + linkErr.message }, 200);
  }
  if (!Array.isArray(linked) || linked.length !== 1) {
    return json(req, { success: true, user_id: userId, build_id: buildId, warning: 'user created but the build was already linked by someone else — not overwritten' }, 200);
  }

  // Hand the admin-posted photo ROWS to the new user (storage objects stay put;
  // see the long note that used to live here — row ownership is what the UI
  // renders from).
  const { error: photoErr } = await supabase
    .from('build_photos').update({ user_id: userId }).eq('build_id', buildId);
  if (photoErr) {
    return json(req, { success: true, user_id: userId, build_id: buildId, warning: 'build linked but photo ownership transfer failed: ' + photoErr.message }, 200);
  }

  // Mint the real token, insert the row with it (no placeholder → no unique
  // collision), then send.
  const { raw, hash } = await newToken();
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();
  const { data: inserted, error: insErr } = await supabase
    .from('claim_invites')
    .insert({
      email, user_id: userId, build_id: buildId, name, phone,
      token_hash: hash, expires_at: expiresIso,
      sent_at: nowIso, last_sent_at: nowIso, send_count: 1,
    })
    .select('id')
    .single();
  if (insErr || !inserted) {
    return json(req, { success: true, user_id: userId, build_id: buildId, warning: 'user + build ready but the claim-invite row failed: ' + (insErr?.message || 'no row') }, 200);
  }
  return await finishWithEmail(userId, raw, expiresIso, false);
});
