// launch-invite — Supabase Edge Function
// -----------------------------------------------------------------------------
// Coordinated launch-day invite: creates the auth user, links the pre-posted
// build to them, and sends the invite email that lands on the claim page.
// Idempotent per email — if the user already exists we return a skip result
// instead of erroring so the batch runner can retry the whole file safely.
//
// Body: { email, build_id, action? }. `action` is optional:
//   invite   (default) the above. Anything already invited is skipped.
//   resend   a fresh link for a builder who was invited and never clicked.
//   release  undo an unclaimed invite: unlink the build, delete the account.
// resend and release act only on an UNCLAIMED account that this build is
// linked to, and refuse everything else with 409. Both are in the handler
// below, and scripts/launch-invite.test.mjs runs every branch.
//
// This is a SEPARATE function from invite-builder on purpose:
//   • invite-builder is optional-build_id, general-purpose one-off invites
//   • launch-invite is required-build_id, coordinated launch batch
// Neither knows about the other; changes to one don't affect the other.
//
// Deploy:
//   supabase functions deploy launch-invite --project-ref lagjjcpclvzrjlrswojt
//
// Required environment (auto-set by Supabase for edge functions):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Auth model:
//   Caller must pass the SERVICE_ROLE_KEY as `Authorization: Bearer <key>`,
//   and the function CHECKS THE ROLE CLAIM itself. verify_jwt = true is not
//   sufficient on its own: it accepts any validly signed project JWT,
//   including the public anon key. See isServiceRole() below.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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


// -------- Authorization --------
// `verify_jwt = true` only proves the bearer token is a validly signed,
// unexpired JWT for THIS project. It does NOT check which role the token
// carries. The anon key is exactly such a token, and it is published in
// js/supabase-client.js on every page — so platform verification alone let
// anyone who viewed the page source create auth users and send invite emails
// from our domain. (Audit finding #1.)
//
// The only legitimate callers are scripts/batch-invite.js and
// scripts/launch-invites.js, both of which send SUPABASE_SERVICE_ROLE_KEY.
// Nothing in the browser calls these endpoints, so require the service role
// and reject everything else with 403.
//
// CORS is not a defence here: it is enforced by browsers only, and curl
// ignores it entirely.
function bearerOf(req: Request): string | null {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function roleOf(jwt: string): string | null {
  // Signature and expiry are already checked by the platform; this only reads
  // the role claim out of the payload segment.
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
  if (envKey && token === envKey) return true;   // the key we were given
  return roleOf(token) === 'service_role';       // or any service_role JWT
}

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A user has CLAIMED once they have clicked an invite (or recovery) link:
// that is what sets email_confirmed_at. Until then the account exists, the
// build is linked to it, and nobody has ever held a session for it.
// deno-lint-ignore no-explicit-any
function isClaimed(user: any): boolean {
  return !!(user && (user.email_confirmed_at || user.confirmed_at));
}

// listUsers paginates 50 at a time and has no email filter — for a 30-user
// launch batch we cap the scan at 1000 users which is well above target.
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

// The launch cohort lands on the dedicated claim page (not the generic
// onboarding page). Ordinary post-launch invites via invite-builder still
// use gunforma-complete-profile.html.
const CLAIM_REDIRECT = 'https://gunforma.com/gunforma-claim.html';

const ACTIONS = ['invite', 'resend', 'release'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersFor(req) });
  if (req.method !== 'POST')    return json(req, { error: 'Method not allowed' }, 405);


  // Reject before parsing the body, so an unauthorized call does no work and
  // never reaches auth.admin.*.
  if (!isServiceRole(req)) {
    return json(req, { error: 'Forbidden: this endpoint requires the service role key' }, 403);
  }

  // -------- Parse + validate body --------
  let body: { email?: string; build_id?: string; action?: string };
  try { body = await req.json(); }
  catch { return json(req, { error: 'Invalid JSON body' }, 400); }

  const email   = (body.email    || '').trim().toLowerCase();
  const buildId = (body.build_id || '').trim();
  // Absent means 'invite', so every existing caller behaves exactly as before.
  const action  = (body.action   || 'invite').trim().toLowerCase();

  if (!email)                     return json(req, { error: 'email is required' }, 400);
  if (!EMAIL_RE.test(email))      return json(req, { error: 'email is not a valid address' }, 400);
  // launch-invite REQUIRES build_id — this endpoint is for the coordinated
  // launch where every builder has a pre-posted build waiting.
  if (!buildId)                   return json(req, { error: 'build_id is required' }, 400);
  if (!UUID_RE.test(buildId))     return json(req, { error: 'build_id must be a UUID' }, 400);
  if (!ACTIONS.includes(action))  return json(req, { error: 'action must be one of: ' + ACTIONS.join(', ') }, 400);

  // -------- Supabase service-role client --------
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json(req, { error: 'Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // -------- Step 1: fail fast if the target build doesn't exist --------
  // Verifying up-front means we don't create an orphan auth user in the case
  // where the build_id was mistyped in builders.json.
  const { data: build, error: buildErr } = await supabase
    .from('builds').select('id, user_id').eq('id', buildId).maybeSingle();
  if (buildErr) return json(req, { error: 'build lookup failed: ' + buildErr.message }, 500);
  if (!build)   return json(req, { error: `build_id ${buildId} not found` }, 404);

  // -------- Step 2: is this email already in auth? --------
  // deno-lint-ignore no-explicit-any
  let existing: any | null;
  try { existing = await findAuthUserByEmail(supabase, email); }
  catch (e) {
    return json(req, { error: 'existence check failed: ' + ((e as Error).message || String(e)) }, 500);
  }

  // True only for the exact pair this call names: this email's account is the
  // one this build is linked to. resend and release act on nothing else.
  const linkedToThisEmail = !!(existing && build.user_id && existing.id === build.user_id);

  // ============================ action: resend ============================
  // A fresh invite email for a builder who was invited and never clicked —
  // the link is single-use and dies after the OTP expiry (24h, see
  // claude/operations.md). Supabase's invite endpoint re-sends to an existing
  // UNCONFIRMED address without creating anything, so the user id, the build
  // link and the photo rows are all left exactly as they are.
  //
  // Explicit on purpose. If a plain re-run of the batch re-sent, every re-run
  // would email every builder who has not claimed yet.
  if (action === 'resend') {
    if (!existing) {
      return json(req, { error: 'nothing to resend: no account exists for this email — send a normal invite instead' }, 409);
    }
    if (!build.user_id) {
      return json(req, { error: 'nothing to resend: this build has no builder linked — send a normal invite instead' }, 409);
    }
    if (!linkedToThisEmail) {
      return json(req, { error: 'refusing to resend: this build is linked to a different account than this email' }, 409);
    }
    if (isClaimed(existing)) {
      return json(req, {
        error: 'already claimed: this builder has used their link. They sign in with their password, and "Forgot password?" on the sign-in page sets a new one',
        claimed: true,
        user_id: existing.id,
        build_id: buildId,
      }, 409);
    }

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: CLAIM_REDIRECT });
    if (error) {
      const msg = error.message || String(error);
      if (/rate/i.test(msg)) return json(req, { error: 'Rate limited by Supabase Auth — slow down and retry' }, 429);
      return json(req, { error: 'resend failed: ' + msg }, 500);
    }
    // The call reports on itself, so check the one thing that would mean it
    // did something else: a resend must come back as the SAME user.
    const returnedId = data?.user?.id;
    if (returnedId !== existing.id) {
      return json(req, {
        success: true,
        user_id: existing.id,
        build_id: buildId,
        warning: `invite sent, but Supabase answered with user ${returnedId || '(none)'} instead of ${existing.id} — check Authentication → Users for a duplicate`,
      }, 200);
    }
    return json(req, { success: true, resent: true, user_id: existing.id, build_id: buildId });
  }

  // ============================ action: release ============================
  // Undo an invite nobody claimed: unlink the build, hand its photo rows back
  // to an admin, and delete the unclaimed account. For an address that was
  // typed wrong, or a builder who should not have been invited. Afterwards
  // the build is unowned again and a normal invite (to the right address)
  // works.
  //
  // This exists so that nobody deletes the user by hand. builds.user_id ->
  // profiles and profiles.id -> auth.users are both ON DELETE CASCADE, and so
  // is build_photos.user_id -> auth.users — deleting an invited user in the
  // dashboard deletes their build and its photo rows with them.
  //
  // Never touches a claimed account. Order matters: everything is moved OFF
  // the user first, that is confirmed by reading it back, and only then is
  // the user deleted — so a step that silently did nothing stops the delete
  // instead of feeding the cascade.
  if (action === 'release') {
    if (!existing) {
      return json(req, { error: 'nothing to release: no account exists for this email' }, 409);
    }
    if (!linkedToThisEmail) {
      return json(req, { error: 'refusing to release: this build is not linked to this email\'s account' }, 409);
    }
    if (isClaimed(existing) || existing.last_sign_in_at) {
      return json(req, {
        error: 'refusing to release: this builder has already claimed their account. Releasing would delete a real person\'s account',
        claimed: true,
        user_id: existing.id,
        build_id: buildId,
      }, 409);
    }
    const userId = existing.id;

    // build_photos.user_id is NOT NULL, so the rows need an owner. The oldest
    // admin, which is who gunforma-admin-post.html filed them under.
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

    // Read back, independently of the updates that claimed to work: nothing
    // may still point at this user when it is deleted.
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
          + `${(stillPhotos || []).length} photo row(s), so it was NOT deleted — deleting it would take those with it`,
      }, 200);
    }

    const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
    if (delErr) {
      return json(req, {
        success: true, build_id: buildId, user_id: userId,
        warning: 'build released, but the unclaimed account could not be deleted: ' + (delErr.message || String(delErr))
          + '. Nothing is linked to it any more, so it is safe to delete under Authentication → Users',
      }, 200);
    }

    return json(req, { success: true, released: true, build_id: buildId, deleted_user_id: userId });
  }
  // ======================= action: invite (the default) =======================
  // Idempotent: anything already invited is reported and left alone, so the
  // whole of builders.json can be re-run safely. A re-run is therefore also
  // the status report — it sends nothing and says who has not claimed yet.
  if (build.user_id) {
    if (linkedToThisEmail && !isClaimed(existing)) {
      return json(req, {
        skipped: true,
        unclaimed: true,
        reason: 'already invited, not claimed yet — resend to send a fresh link',
        user_id: existing.id,
        build_id: buildId,
        invited_at: existing.invited_at || null,
      }, 200);
    }
    return json(req, {
      skipped: true,
      reason: linkedToThisEmail
        ? 'already claimed by this builder'
        : 'build already has a user linked — refusing to overwrite',
      build_id: buildId,
      existing_user_id: build.user_id,
    }, 200);
  }
  if (existing) {
    return json(req, {
      skipped: true,
      reason: 'already exists',
      user_id: existing.id,
      build_id: buildId,
    }, 200);
  }

  // -------- Step 3: create user + send invite in one atomic call --------
  // inviteUserByEmail creates the auth user (email_confirmed_at = null),
  // fires the handle_new_user trigger (which seeds the profile row with
  // onboarding_complete=false), and emails the invite link. The click-through
  // confirms the email AND opens a session on gunforma-claim.html, where the
  // builder picks a username and a password.
  const { data: inviteData, error: inviteError } =
    await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: CLAIM_REDIRECT });

  if (inviteError) {
    const msg = inviteError.message || String(inviteError);
    // Should be unreachable given the check above, but Supabase might have
    // seen this email on a page we didn't scan — treat as skip.
    if (/already/i.test(msg)) return json(req, { skipped: true, reason: 'already exists', build_id: buildId }, 200);
    if (/rate/i.test(msg))    return json(req, { error: 'Rate limited by Supabase Auth — slow down and retry' }, 429);
    return json(req, { error: 'invite failed: ' + msg }, 500);
  }

  const userId = inviteData?.user?.id;
  if (!userId) return json(req, { error: 'invite succeeded but no user id was returned' }, 500);

  // -------- Step 4: link the pre-posted build to the new user --------
  // If this fails the auth user + profile already exist, so return partial
  // success — the caller can retry the link out-of-band via a raw SQL update.
  const { error: linkErr } = await supabase
    .from('builds').update({ user_id: userId }).eq('id', buildId);
  if (linkErr) {
    return json(req, {
      success: true,
      user_id: userId,
      build_id: buildId,
      warning: 'user invited but build link failed: ' + linkErr.message,
    }, 200);
  }

  // -------- Step 5: hand the photo ROWS over as well --------
  // gunforma-admin-post.html inserts build_photos with the ADMIN's user_id,
  // because the column is NOT NULL and the real builder does not exist yet.
  // Nothing used to move it afterwards, which left every owner-write policy
  // on build_photos pointing at the wrong person:
  //
  //   DELETE / UPDATE  auth.uid() = build_photos.user_id AND build is draft|pending
  //   INSERT           the same, plus builds.user_id = auth.uid()
  //
  // So a claimed builder editing their own build could ADD photos (inserted
  // under their own id) but never remove the ones posted for them — and the
  // failure was silent, because an RLS-filtered DELETE matches zero rows and
  // returns no error. The row survived while the UI reported success.
  //
  // This transfers the rows only. The storage OBJECTS stay at
  // <adminUid>/<draftId>/... forever: the bucket's insert policy requires the
  // first path segment to equal auth.uid(), so the admin's upload could never
  // have been written anywhere else, and moving them now would mean copying
  // every file and rewriting storage_path. Row ownership and byte ownership
  // are already separable here — gunforma-post-build.html's photo delete
  // treats the storage half as best-effort and tolerates orphaned bytes on
  // purpose. Transferring the row is what gives the builder control of what
  // the site actually renders; the bytes are a storage-cost question, not a
  // permissions one.
  //
  // Runs as service role, so RLS does not apply to this update.
  const { error: photoErr } = await supabase
    .from('build_photos').update({ user_id: userId }).eq('build_id', buildId);
  if (photoErr) {
    return json(req, {
      success: true,
      user_id: userId,
      build_id: buildId,
      warning: 'build linked but photo ownership transfer failed: ' + photoErr.message,
    }, 200);
  }

  return json(req, { success: true, user_id: userId, build_id: buildId });
});
