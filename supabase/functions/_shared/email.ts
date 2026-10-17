// _shared/email.ts — Gunforma transactional email, in one place.
// -----------------------------------------------------------------------------
// send-build-approved was the first function to send branded mail, but it
// inlined everything. This module is that pattern extracted: the Resend call,
// the dark-card layout, and the launch invite + reminder bodies — so
// launch-invite, redeem-claim and resend-claim all send identical chrome from
// one source.
//
// send-build-approved is deliberately NOT migrated onto this module (it works;
// leaving it avoids touching a live path), so its inline copy of the layout is
// a KNOWN, documented duplicate of renderShell() below. If you change the
// shell here, the approved email will not follow until it is migrated too.
//
// Bundling: an IMPORTED .ts like this IS bundled by `supabase functions
// deploy`. The Oct-1 ENOENT was a NON-imported sibling .html read at runtime —
// a different failure. Importing ../_shared/email.ts is safe.
//
// Provider: Resend. The caller reads RESEND_API_KEY from the environment and
// passes it to sendEmail(); this module never reads env itself.
// -----------------------------------------------------------------------------

export const SITE = 'https://gunforma.com';
export const FROM = 'Gunforma <build@gunforma.com>';
export const LOGO = 'https://gunforma.com/assets/email-logo.png';

export function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The preheader is the grey preview line beside the subject in an inbox list.
// It must EXTEND the subject, never repeat it, and the trailing &zwnj;&nbsp;
// run fills the client's preview buffer so it stops scraping the logo alt text
// and headline in behind it. (Same technique as the committed invite template.)
function preheader(text: string): string {
  const spacer = '&zwnj;&nbsp;'.repeat(24);
  return `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#0e0f11;opacity:0;">${text} ${spacer}</div>`;
}

export interface Shell {
  preheaderText: string;
  eyebrow: string;
  heading: string;
  bodyHtml: string;        // trusted HTML (a <p> paragraph)
  ctaUrl: string;          // must be a safe absolute URL; never user input
  ctaLabel: string;
  finePrintHtml: string;   // trusted HTML
}

// The dark-card chrome shared by every Gunforma transactional email. Table
// layout + inline styles only (Gmail strips <style>, Outlook ignores flexbox).
// Design tokens match the auth pages: #0e0f11 page, #4a9edd accent.
export function renderShell(s: Shell): string {
  return `${preheader(s.preheaderText)}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0f11;padding:40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
      <tr><td align="center" style="padding:0 0 32px;">
        <a href="${SITE}" style="text-decoration:none;">
          <img src="${LOGO}" width="220" height="40" alt="GUNFORMA" style="display:block;width:220px;height:40px;border:0;outline:none;text-decoration:none;color:#e8e6e1;font-size:18px;font-weight:600;letter-spacing:0.12em;"/>
        </a>
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:8px;padding:36px 32px;border:1px solid #e5e5e5;">
        <p style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#4a9edd;margin:0 0 8px;">${s.eyebrow}</p>
        <p style="font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 16px;letter-spacing:-0.01em;">${s.heading}</p>
        ${s.bodyHtml}
        <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
          <tr><td align="center" style="background:#4a9edd;border-radius:6px;">
            <a href="${s.ctaUrl}" target="_blank" style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.02em;">${s.ctaLabel}</a>
          </td></tr>
        </table>
        <p style="font-size:12px;color:#999;line-height:1.6;margin:0 0 20px;">If the button doesn&#39;t work, copy and paste this link into your browser:</p>
        <p style="font-size:11px;color:#4a9edd;word-break:break-all;line-height:1.5;margin:0 0 24px;">${s.ctaUrl}</p>
        <div style="border-top:1px solid #e5e5e5;padding-top:20px;">
          <p style="font-size:11px;color:#999;line-height:1.6;margin:0;">${s.finePrintHtml}</p>
        </div>
      </td></tr>
      <tr><td align="center" style="padding:28px 0 0;">
        <p style="font-size:10px;color:#555;letter-spacing:0.06em;margin:0;">&copy; 2026 Gunforma &middot; Your pistol. Your loadout.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

// The 7-day fine print, shared by invite and reminder. Matches the committed
// invite-email-template.html copy.
const FINE_PRINT_7DAY =
  'This link is good for 7 days. If it expires, you can request a fresh one from the page it opens. ' +
  'If you weren&#39;t expecting this, ignore it &mdash; no account is activated until you claim it.';

// The launch invite: your build is up, come claim it.
export function inviteEmail(claimUrl: string): { subject: string; html: string } {
  return {
    subject: 'Your build is live on Gunforma',
    html: renderShell({
      preheaderText: 'Claim your account and set your username &mdash; takes about a minute.',
      eyebrow: 'Your build is live',
      heading: 'Claim your account',
      bodyHtml: '<p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 28px;">You&#39;re one of the first builders on Gunforma. Your build is already up on the site &mdash; click below to set up your profile and claim it as yours.</p>',
      ctaUrl: claimUrl,
      ctaLabel: 'Claim my account &rarr;',
      finePrintHtml: FINE_PRINT_7DAY,
    }),
  };
}

// The hour-20 reminder: still waiting on you.
export function reminderEmail(claimUrl: string): { subject: string; html: string } {
  return {
    subject: 'Your build is still waiting on Gunforma',
    html: renderShell({
      preheaderText: 'Claim it and pick your username before someone else grabs it.',
      eyebrow: 'Still waiting',
      heading: 'Your build is still waiting',
      bodyHtml: '<p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 28px;">Your build went live yesterday. Claim it and pick your username before someone else grabs it.</p>',
      ctaUrl: claimUrl,
      ctaLabel: 'Claim my account &rarr;',
      finePrintHtml: FINE_PRINT_7DAY,
    }),
  };
}

// The Resend POST, in one place. Returns a small result the caller logs.
export async function sendEmail(opts: {
  apiKey: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      headers: { 'List-Unsubscribe': '<mailto:build@gunforma.com?subject=unsubscribe>' },
    }),
  });
  const body = res.ok ? '' : (await res.text()).slice(0, 300);
  return { ok: res.ok, status: res.status, body };
}
