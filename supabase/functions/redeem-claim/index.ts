// redeem-claim — Supabase Edge Function
// -----------------------------------------------------------------------------
// The claim page (gunforma-claim.html) calls this with the raw 7-day token from
// the ?t= URL. It hashes the token, looks up the invite, and — if the invite is
// still open — mints a FRESH Supabase magic link and returns it. The page then
// redirects the browser to that link, which opens a real session on the claim
// page. So the Supabase 24h OTP cap only ever has to survive the few seconds
// between this call and the redirect.
//
// PUBLIC by design: the raw token IS the credential, so there is no service-role
// requirement. The page calls it with the anon key (verify_jwt stays on), and
// this function uses the service role from its own env to look up the invite and
// generate the link. A valid token returns a working link; everything else
// returns a typed error the page renders.
//
// The token stays reusable until claimed or expired, so a builder who bounces
// mid-flow can click the same email link again. Rate-limited to 10 redemptions
// per token per hour as a brake on abuse.
//
// Deploy:
//   supabase functions deploy redeem-claim --project-ref lagjjcpclvzrjlrswojt
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sha256Hex } from '../_shared/token.ts';
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

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req) },
  });
}

const CLAIM_PAGE = `${SITE}/gunforma-claim.html`;
const REDEEM_MAX_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersFor(req) });
  if (req.method !== 'POST')    return json(req, { error: 'method_not_allowed' }, 405);

  let body: { token?: string };
  try { body = await req.json(); }
  catch { return json(req, { error: 'invalid' }, 400); }

  const rawToken = (body.token || '').trim();
  if (!rawToken) return json(req, { error: 'invalid' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json(req, { error: 'server_misconfigured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tokenHash = await sha256Hex(rawToken);

  const { data: invite, error: lookupErr } = await supabase
    .from('claim_invites')
    .select('id, email, claimed_at, expires_at, opened_at, redeem_count, redeem_window_start')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (lookupErr) return json(req, { error: 'server_error' }, 500);
  if (!invite)   return json(req, { error: 'invalid' }, 404);

  if (invite.claimed_at) return json(req, { error: 'already_claimed' }, 409);
  if (new Date(invite.expires_at).getTime() < Date.now()) return json(req, { error: 'expired' }, 410);

  // Rate limit: 10 redemptions per token per rolling hour.
  const now = Date.now();
  const windowStart = invite.redeem_window_start ? new Date(invite.redeem_window_start).getTime() : 0;
  let nextCount: number;
  let nextWindowStartIso: string;
  if (!windowStart || now - windowStart > HOUR_MS) {
    nextCount = 1;
    nextWindowStartIso = new Date(now).toISOString();
  } else {
    if ((invite.redeem_count || 0) >= REDEEM_MAX_PER_HOUR) {
      return json(req, { error: 'rate_limited' }, 429);
    }
    nextCount = (invite.redeem_count || 0) + 1;
    nextWindowStartIso = new Date(windowStart).toISOString();
  }

  const patch: Record<string, unknown> = {
    redeem_count: nextCount,
    redeem_window_start: nextWindowStartIso,
  };
  if (!invite.opened_at) patch.opened_at = new Date(now).toISOString();
  await supabase.from('claim_invites').update(patch).eq('id', invite.id);

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: invite.email,
    options: { redirectTo: CLAIM_PAGE },
  });
  const actionLink = linkData?.properties?.action_link;
  if (linkErr || !actionLink) {
    return json(req, { error: 'link_failed' }, 500);
  }

  return json(req, { action_link: actionLink });
});
