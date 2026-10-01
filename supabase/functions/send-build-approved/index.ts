// send-build-approved — Supabase Edge Function
// -----------------------------------------------------------------------------
// Drains notifications where kind = 'approved' and email_sent_at is null,
// sends each through Resend, and stamps email_sent_at.
//
// Deploy:
//   supabase functions deploy send-build-approved --project-ref lagjjcpclvzrjlrswojt
//
// Environment:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   auto-set by Supabase
//   RESEND_API_KEY                            set by hand in Edge Function secrets
//
// THE EMAIL TEMPLATE IS INLINED BELOW, not read from a file. Supabase bundles
// only the JS entrypoint and its imports on deploy — a sibling email.html is
// NOT uploaded, and Deno.readTextFile on it fails at runtime with ENOENT.
// This is the single source of truth for the email; edit EMAIL_TEMPLATE and
// redeploy. (email.html in this folder is a stub pointing here.)
//
// IDEMPOTENCY lives in one place: email_sent_at. It is stamped only after
// Resend returns 2xx. A send that succeeds and then fails to stamp will resend
// next run — a duplicate is a smaller failure than silence.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SITE = 'https://gunforma.com';
const FROM = 'Gunforma <build@gunforma.com>';
const BATCH = 50;

const EMAIL_TEMPLATE = `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#0e0f11;opacity:0;">It&#39;s public now &mdash; here&#39;s the link to share. &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0f11;padding:40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr>
    <td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
        <tr>
          <td align="center" style="padding:0 0 32px;">
            <a href="https://gunforma.com" style="text-decoration:none;">
              <img src="https://gunforma.com/assets/email-logo.png" width="220" height="40" alt="GUNFORMA" style="display:block;width:220px;height:40px;border:0;outline:none;text-decoration:none;color:#e8e6e1;font-size:18px;font-weight:600;letter-spacing:0.12em;"/>
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-radius:8px;padding:36px 32px;border:1px solid #e5e5e5;">
            <p style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#4a9edd;margin:0 0 8px;">Approved</p>
            <p style="font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 16px;letter-spacing:-0.01em;">{{BUILD_NAME}} is live</p>
            <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 28px;">We went through it part by part and it&#39;s on the site. Anyone can see it now, and the link below is yours to share wherever you want.</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td align="center" style="background:#4a9edd;border-radius:6px;">
                  <a href="{{BUILD_URL}}" target="_blank" style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.02em;">See your build &rarr;</a>
                </td>
              </tr>
            </table>
            <p style="font-size:12px;color:#999;line-height:1.6;margin:0 0 20px;">If the button doesn&#39;t work, copy and paste this link into your browser:</p>
            <p style="font-size:11px;color:#4a9edd;word-break:break-all;line-height:1.5;margin:0 0 24px;">{{BUILD_URL}}</p>
            <div style="border-top:1px solid #e5e5e5;padding-top:20px;">
              <p style="font-size:11px;color:#999;line-height:1.6;margin:0;">Spotted something wrong with how we listed a part? Just reply &mdash; this address reaches a person. Reply &quot;unsubscribe&quot; and we&#39;ll stop sending these.</p>
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:28px 0 0;">
            <p style="font-size:10px;color:#555;letter-spacing:0.06em;margin:0;">&copy; 2026 Gunforma &middot; Your pistol. Your loadout.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

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
  return token === envKey || roleOf(token) === 'service_role';
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isServiceRole(req)) {
    return json({ error: 'Forbidden: this endpoint requires the service role key' }, 403);
  }

  const dryRun = new URL(req.url).searchParams.get('dry_run') === '1';

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey   = Deno.env.get('RESEND_API_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'SUPABASE_URL or SERVICE_ROLE_KEY missing' }, 500);
  if (!resendKey && !dryRun)       return json({ error: 'RESEND_API_KEY missing' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error: readErr } = await supabase
    .from('notifications')
    .select('id,user_id,build_id,builds(name),profiles!notifications_user_id_fkey(email_notifications)')
    .eq('kind', 'approved')
    .is('email_sent_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (readErr) return json({ error: 'read failed: ' + readErr.message }, 500);
  if (!rows || rows.length === 0) return json({ ok: true, pending: 0, sent: 0, skipped: 0 });

  let sent = 0, skipped = 0;
  const failures: Array<{ id: number; reason: string }> = [];

  for (const row of rows as any[]) {
    if (row.profiles && row.profiles.email_notifications === false) {
      if (!dryRun) await supabase.from('notifications').update({ email_sent_at: new Date().toISOString() }).eq('id', row.id);
      skipped++;
      continue;
    }

    const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(row.user_id);
    const email = userRes?.user?.email;
    if (userErr || !email) { failures.push({ id: row.id, reason: 'no email for user' }); continue; }

    const buildName = (row.builds && row.builds.name) || 'Your build';
    const buildUrl  = `${SITE}/b/${row.build_id}`;
    const html = EMAIL_TEMPLATE
      .replaceAll('{{BUILD_NAME}}', esc(buildName))
      .replaceAll('{{BUILD_URL}}', buildUrl);

    if (dryRun) { sent++; continue; }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: email,
        subject: `Your ${buildName} build is live on Gunforma`,
        html,
        headers: { 'List-Unsubscribe': '<mailto:build@gunforma.com?subject=unsubscribe>' },
      }),
    });

    if (!res.ok) {
      failures.push({ id: row.id, reason: `resend ${res.status}: ${(await res.text()).slice(0, 200)}` });
      continue;
    }

    const { error: stampErr } = await supabase
      .from('notifications').update({ email_sent_at: new Date().toISOString() }).eq('id', row.id);
    if (stampErr) failures.push({ id: row.id, reason: 'SENT BUT NOT STAMPED: ' + stampErr.message });
    sent++;
  }

  return json({ ok: failures.length === 0, dry_run: dryRun, considered: rows.length, sent, skipped, failures });
});
