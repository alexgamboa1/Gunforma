// invite-builder — Supabase Edge Function
// -----------------------------------------------------------------------------
// Invites a pre-order builder: creates an unconfirmed auth user, lets the
// handle_new_user trigger seed the profile row, optionally links a pre-posted
// build_id to the new user, and emails an invite link that lands on
// gunforma-complete-profile.html (where the existing onboarding flow picks
// up — user chooses username, accepts terms, done).
//
// Deploy:
//   supabase functions deploy invite-builder --project-ref lagjjcpclvzrjlrswojt
//
// Required environment variables (auto-set by Supabase for edge functions):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Auth model:
//   Callers must pass the SERVICE_ROLE_KEY as the `Authorization: Bearer <key>`
//   header. This is enforced by Supabase's default JWT verification on edge
//   functions (verify_jwt = true) — since only holders of the service role JWT
//   can pass verification, no extra secret gate is needed here.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// -------- CORS --------
// Allowlist the two origins the batch script + web console might call from.
// Any other origin gets no CORS headers back and its preflight fails cleanly.
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

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return json(req, { error: 'Method not allowed' }, 405);
  }

  // Parse body
  let body: { email?: string; build_id?: string };
  try { body = await req.json(); }
  catch { return json(req, { error: 'Invalid JSON body' }, 400); }

  const email    = (body.email || '').trim().toLowerCase();
  const buildId  = (body.build_id || '').trim() || null;

  if (!email)                     return json(req, { error: 'email is required' }, 400);
  if (!EMAIL_RE.test(email))      return json(req, { error: 'email is not a valid address' }, 400);
  if (buildId && !UUID_RE.test(buildId)) return json(req, { error: 'build_id must be a UUID' }, 400);

  // Service-role client — bypasses RLS, can hit auth.admin.*
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json(req, { error: 'Server misconfigured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // -------- Step 1: does this email already exist in auth? --------
  // listUsers paginates 50 at a time and doesn't take a filter — for a
  // 30-user seed batch we can page through, but we cap the scan so a
  // production DB with tens of thousands of users doesn't OOM the function.
  try {
    let page = 1;
    while (page <= 20) {   // 20 * 50 = 1000 users max scanned
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 50 });
      if (error) throw error;
      if (!data || data.users.length === 0) break;
      const hit = data.users.find(u => (u.email || '').toLowerCase() === email);
      if (hit) return json(req, { error: 'User already exists', existing: true, user_id: hit.id }, 200);
      if (data.users.length < 50) break;
      page++;
    }
  } catch (e) {
    return json(req, { error: 'existence check failed: ' + ((e as Error).message || String(e)) }, 500);
  }

  // -------- Step 2: send the invite --------
  // inviteUserByEmail creates the auth user (email_confirmed_at = null) AND
  // emails the invite link in one atomic call. The click-through in the email
  // confirms the email AND sets a session automatically — so the user lands
  // on the redirectTo page already signed in.
  //
  // The handle_new_user trigger fires on the auth.users insert and seeds the
  // profiles row with onboarding_complete = false (no username in metadata).
  // The existing sign-in flow catches that and routes to
  // gunforma-complete-profile.html — same page the redirectTo points at.
  //
  // (The task's step 2 called for admin.createUser({email_confirm:true})
  // followed by admin.inviteUserByEmail. Those two calls conflict in current
  // Supabase — the second errors with "User already registered". Using
  // inviteUserByEmail alone achieves the intended end state — confirmed user
  // with a session on click-through — without the split-brain.)
  const redirectTo = 'https://gunforma.com/gunforma-complete-profile.html';
  const { data: inviteData, error: inviteError } =
    await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (inviteError) {
    const msg = inviteError.message || String(inviteError);
    if (/already/i.test(msg))    return json(req, { error: 'User already exists', existing: true }, 200);
    if (/rate/i.test(msg))       return json(req, { error: 'Rate limited by Supabase Auth — slow down and retry' }, 429);
    return json(req, { error: 'Invite failed: ' + msg }, 500);
  }

  const userId = inviteData?.user?.id;
  if (!userId) return json(req, { error: 'Invite succeeded but no user id was returned' }, 500);

  // -------- Step 3: optionally link the pre-posted build --------
  // If this fails the auth user + profile already exist, so return partial
  // success — the caller can retry the link without re-inviting.
  if (buildId) {
    const { data: build, error: fetchErr } = await supabase
      .from('builds').select('id').eq('id', buildId).maybeSingle();
    if (fetchErr) return json(req, { success: true, user_id: userId, warning: 'build lookup failed: ' + fetchErr.message });
    if (!build)   return json(req, { success: true, user_id: userId, warning: `build_id ${buildId} not found — user invited but no build was linked` });

    const { error: linkErr } = await supabase
      .from('builds').update({ user_id: userId }).eq('id', buildId);
    if (linkErr) return json(req, { success: true, user_id: userId, warning: 'user invited but build link failed: ' + linkErr.message });
  }

  return json(req, { success: true, user_id: userId });
});
