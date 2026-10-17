// resend-claim — Supabase Edge Function
// -----------------------------------------------------------------------------
// Issues a FRESH 7-day token and sends the branded email again, for an invite
// that has not been claimed. Two ways in:
//
//   PUBLIC, by token:   POST { token }   (works even if the token has expired)
//       The claim page's "send me a fresh link" button. Always returns the same
//       generic message — "If this invite is still open, a new link is on its
//       way" — so it never reveals whether an email/token exists (no
//       enumeration). Rate-limited to 3 resends per invite per 24h.
//
//   SERVICE-ROLE, by email:  POST { email, kind? }  with the service-role bearer
//       Used by scripts/claim-status.js. `kind` is 'invite' (default) or
//       'reminder' (the hour-20 copy). Returns real detail, since the caller is
//       trusted. No public rate limit on this path.
//
// Deploy:
//   supabase functions deploy resend-claim --project-ref lagjjcpclvzrjlrswojt
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { newToken, sha256Hex } from '../_shared/token.ts';
import { inviteEmail, reminderEmail, sendEmail, SITE } from '../_shared/email.ts';

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
  return token === envKey || roleOf(token) === 'service_role';
}

const GENERIC = 'If this invite is still open, a new link is on its way.';
const CLAIM_PAGE = `${SITE}/gunforma-claim.html`;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RESEND_MAX_PER_24H = 3;

// Mint a fresh token, write it onto the row (bumping counters), send the chosen
// email. Returns the Resend result. On the public path, rate-limit state is
// checked by the caller before this runs.
// deno-lint-ignore no-explicit-any
async function reissue(supabase: any, resendKey: string, invite: any, kind: 'invite' | 'reminder', bumpResendWindow: { count: number; startIso: string } | null) {
  const { raw, hash } = await newToken();
  const expiresIso = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();
  const nowIso = new Date().toISOString();
  const prevSend = typeof invite.send_count === 'number' ? invite.send_count : 0;

  const patch: Record<string, unknown> = {
    token_hash: hash,
    expires_at: expiresIso,
    last_sent_at: nowIso,
    send_count: prevSend + 1,
  };
  if (bumpResendWindow) {
    patch.resend_count = bumpResendWindow.count;
    patch.resend_window_start = bumpResendWindow.startIso;
  }
  const { error: updErr } = await supabase.from('claim_invites').update(patch).eq('id', invite.id);
  if (updErr) return { ok: false, status: 500, body: 'db: ' + updErr.message, expiresIso };

  const claimUrl = `${CLAIM_PAGE}?t=${raw}`;
  const mail = kind === 'reminder' ? reminderEmail(claimUrl) : inviteEmail(claimUrl);
  const res = await sendEmail({ apiKey: resendKey, to: invite.email, subject: mail.subject, html: mail.html });
  return { ...res, expiresIso };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeadersFor(req) });
  if (req.method !== 'POST')    return json(req, { error: 'method_not_allowed' }, 405);

  let body: { token?: string; email?: string; kind?: string };
  try { body = await req.json(); }
  catch { return json(req, { error: 'invalid' }, 400); }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey   = Deno.env.get('RESEND_API_KEY');
  if (!supabaseUrl || !serviceKey) return json(req, { error: 'server_misconfigured' }, 500);
  if (!resendKey)                  return json(req, { error: 'server_misconfigured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const serviceCall = isServiceRole(req);

  // ---------------- service-role path: by email, real detail ----------------
  if (serviceCall && body.email) {
    const email = body.email.trim().toLowerCase();
    const kind = body.kind === 'reminder' ? 'reminder' : 'invite';
    const { data: invite, error } = await supabase
      .from('claim_invites')
      .select('id, email, claimed_at, send_count')
      .eq('email', email)
      .is('claimed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return json(req, { ok: false, error: 'lookup failed: ' + error.message }, 500);
    if (!invite) return json(req, { ok: true, skipped: true, reason: 'no open invite for this email' });

    const r = await reissue(supabase, resendKey, invite, kind, null);
    if (!r.ok) return json(req, { ok: false, error: `send failed (${r.status}): ${r.body}` }, 502);
    return json(req, { ok: true, resent: true, kind, email, expires_at: r.expiresIso });
  }

  // ---------------- public path: by token, generic response ----------------
  const rawToken = (body.token || '').trim();
  if (!rawToken) return json(req, { message: GENERIC });

  const tokenHash = await sha256Hex(rawToken);

  const { data: invite } = await supabase
    .from('claim_invites')
    .select('id, email, claimed_at, send_count, resend_count, resend_window_start')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  // Unknown or already-claimed: say nothing specific.
  if (!invite || invite.claimed_at) return json(req, { message: GENERIC });

  // Rate limit: 3 per invite per rolling 24h. Over the limit → generic, no send.
  const now = Date.now();
  const winStart = invite.resend_window_start ? new Date(invite.resend_window_start).getTime() : 0;
  let count: number, startIso: string;
  if (!winStart || now - winStart > 24 * HOUR_MS) {
    count = 1; startIso = new Date(now).toISOString();
  } else {
    if ((invite.resend_count || 0) >= RESEND_MAX_PER_24H) return json(req, { message: GENERIC });
    count = (invite.resend_count || 0) + 1; startIso = new Date(winStart).toISOString();
  }

  await reissue(supabase, resendKey, invite, 'invite', { count, startIso });
  // Always generic, whether or not the send itself succeeded.
  return json(req, { message: GENERIC });
});
