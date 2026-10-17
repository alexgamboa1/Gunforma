// _shared/token.ts — claim-token generation and hashing, in one place.
// -----------------------------------------------------------------------------
// The raw token goes ONLY in the emailed URL. The database stores only its
// sha256 hex (claim_invites.token_hash). launch-invite, redeem-claim and
// resend-claim all go through here so the security-critical bytes have exactly
// one implementation.
// -----------------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// sha256 hex of an arbitrary string.
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A fresh token: 32 random bytes as base64url (the raw, for the URL) plus its
// sha256 hex (for storage). Never store or log `raw`.
export async function newToken(): Promise<{ raw: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = base64url(bytes);
  const hash = await sha256Hex(raw);
  return { raw, hash };
}
