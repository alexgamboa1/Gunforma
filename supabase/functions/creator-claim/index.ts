// creator-claim — Supabase Edge Function (PUBLIC by token)
// -----------------------------------------------------------------------------
// What gunforma-creator.html calls. The raw 30-day token from the DM'd URL is
// the credential, exactly as redeem-claim treats claim tokens: the page calls
// with the anon key (verify_jwt stays on), this function hashes the token and
// lets the database functions decide. A read of the database never yields a
// working token.
//
// Body: { action, token, ... }:
//
//   preview   { token }
//             What the private page shows: handle, bio, links, and the draft
//             builds with photos and parts. Stamps opened_at on first load.
//             Everything else in the world sees none of this — the builds
//             are unowned drafts and RLS hides them.
//
//   decline   { token }
//             "Not interested." Deletes the draft builds AND their storage
//             objects, wipes the drafted bio/links, keeps the handle held so
//             nobody can pose as the creator who said no. No account needed:
//             saying no must not require signing up. Works on an expired
//             token too — a no is always accepted.
//
//   claim     { token, agreement_version }  + the creator's own JWT
//             The signed-in creator takes the page: their profile gets the
//             handle, bio and links (never overwriting anything they already
//             set), the builds get their consent and go live under their
//             account, all in ONE database transaction
//             (public.claim_creator_invite). The JWT in the Authorization
//             header is whose account it lands in — the token says WHICH
//             page, the JWT says WHO.
//
// Rate limit: 30 calls per token per hour, same windowed shape as
// redeem-claim, tracked in memory per isolate (cheap brake, not a guarantee —
// the token is 32 random bytes, so enumeration is not a real path in).
//
// Deploy:
//   supabase functions deploy creator-claim --project-ref lagjjcpclvzrjlrswojt
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sha256Hex } from '../_shared/token.ts';

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

// Error code → HTTP status, so the page can switch on either.
const ERROR_STATUS: Record<string, number> = {
  invalid: 404, expired: 410, already_claimed: 409, declined: 410,
  handle_taken: 409, builds_changed: 409, no_profile: 409,
};

const ACTIONS = ['preview', 'decline', 'claim'];
const RATE_MAX_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const rateByHash = new Map<string, { start: number; count: number }>();

function rateLimited(hash: string): boolean {
  const now = Date.now();
  const w = rateByHash.get(hash);
  if (!w || now - w.start > HOUR_MS) {
    rateByHash.set(hash, { start: now, count: 1 });
    return false;
  }
  w.count++;
  return w.count > RATE_MAX_PER_HOUR;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersFor(req) });
  if (req.method !== 'POST')    return json(req, { error: 'method_not_allowed' }, 405);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); }
  catch { return json(req, { error: 'invalid' }, 400); }

  const action   = String(body.action || '').trim().toLowerCase();
  const rawToken = String(body.token || '').trim();
  if (!ACTIONS.includes(action)) return json(req, { error: 'invalid' }, 400);
  if (!rawToken)                 return json(req, { error: 'invalid' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json(req, { error: 'server_misconfigured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tokenHash = await sha256Hex(rawToken);
  if (rateLimited(tokenHash)) return json(req, { error: 'rate_limited' }, 429);

  // Every path funnels through one of the three SQL functions, which run as
  // the service role and return either the data or { error: <code> }.
  // deno-lint-ignore no-explicit-any
  function finish(res: { data: any; error: any }): Response {
    if (res.error) return json(req, { error: 'server_error' }, 500);
    const code = res.data && res.data.error;
    if (code) return json(req, res.data, ERROR_STATUS[code] || 400);
    return json(req, res.data);
  }

  // ============================ action: preview ============================
  if (action === 'preview') {
    return finish(await supabase.rpc('creator_invite_preview', { p_token_hash: tokenHash }));
  }

  // ============================ action: decline ============================
  if (action === 'decline') {
    const res = await supabase.rpc('decline_creator_invite', { p_token_hash: tokenHash });
    if (res.error) return json(req, { error: 'server_error' }, 500);
    if (res.data && res.data.error) {
      return json(req, res.data, ERROR_STATUS[res.data.error] || 400);
    }
    // The rows are gone (one transaction). The storage objects are cleanup:
    // report a failure rather than hiding it, but the decline itself stands.
    const paths: string[] = (res.data && res.data.storage_paths) || [];
    let filesRemoved = 0;
    let fileWarning: string | null = null;
    if (paths.length) {
      const { data: removed, error: rmErr } = await supabase.storage.from('build-photos').remove(paths);
      filesRemoved = (removed || []).length;
      if (rmErr) fileWarning = 'photo rows are gone but some storage files were not removed';
      else if (filesRemoved !== paths.length) fileWarning = `photo rows are gone but only ${filesRemoved} of ${paths.length} storage files were removed`;
    }
    return json(req, {
      declined: true,
      deleted_builds: res.data.deleted_builds,
      ...(fileWarning ? { warning: fileWarning } : {}),
    });
  }

  // ============================= action: claim =============================
  // The Authorization header must be the CREATOR's session JWT — that is the
  // account the page lands in. functions.invoke sends it automatically for a
  // signed-in user; signed out, the header is the anon key and getUser fails.
  const m = (req.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return json(req, { error: 'not_signed_in' }, 401);
  const { data: userData, error: userErr } = await supabase.auth.getUser(m[1].trim());
  const userId = userData?.user?.id;
  if (userErr || !userId) return json(req, { error: 'not_signed_in' }, 401);

  const agreementVersion = String(body.agreement_version || '').trim();
  if (!agreementVersion) return json(req, { error: 'invalid' }, 400);

  return finish(await supabase.rpc('claim_creator_invite', {
    p_token_hash:        tokenHash,
    p_user_id:           userId,
    p_agreement_version: agreementVersion,
  }));
});
