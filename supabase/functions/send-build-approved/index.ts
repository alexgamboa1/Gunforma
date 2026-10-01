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
// Auth model: same as invite-builder. verify_jwt only proves the token is a
// validly signed project JWT — the anon key is one of those and is published in
// every page. The role claim is checked here.
//
// IDEMPOTENCY lives in one place: email_sent_at. It is stamped only after
// Resend returns 2xx. A send that succeeds and then fails to stamp will resend
// next run — a duplicate is a smaller failure than silence, and is the right
// way round for this to break.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SITE = 'https://gunforma.com';
const FROM = 'Gunforma <build@gunforma.com>';
const BATCH = 50;

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

  // The template is a file in this function's directory, not a dashboard
  // template. Unlike the three Supabase Auth templates, THIS repo file is the
  // source of truth — editing it and redeploying changes the live email.
  const template = await Deno.readTextFile(new URL('./email.html', import.meta.url));

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
    // Opted out: stamp it so it is not reconsidered every ten minutes forever.
    // The notification still exists in their in-app inbox.
    if (row.profiles && row.profiles.email_notifications === false) {
      if (!dryRun) await supabase.from('notifications').update({ email_sent_at: new Date().toISOString() }).eq('id', row.id);
      skipped++;
      continue;
    }

    const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(row.user_id);
    const email = userRes?.user?.email;
    if (userErr || !email) { failures.push({ id: row.id, reason: 'no email for user' }); continue; }

    const buildName = (row.builds && row.builds.name) || 'Your build';
    // /b/<uuid> resolves and self-canonicalises to the slug URL, so this is
    // NOT a third place the build URL is constructed. See CLAUDE.md.
    const buildUrl  = `${SITE}/b/${row.build_id}`;
    const html = template
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
