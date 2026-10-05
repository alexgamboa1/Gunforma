# Gunforma — operations reference

Written 2026-09-30. Everything here was verified against the live service on that
date, by query or by DNS lookup, not from memory. Where something is unverified it
says so.

**What this file is.** The configuration that lives *outside* the repo — Supabase
dashboard settings, Resend, Cloudflare DNS and Email Routing, GitHub secrets — and
which advisor findings are deliberately accepted. None of it is discoverable by
reading the code, and all of it can fail silently.

**What it is not.** `CLAUDE.md` is how the code works. The ops tracker (Claude
project artifact) is business judgment and weekly state. This file is the third
thing: where the switches are and what they are set to.

**Blocked from the web** by netlify.toml's `/claude/*` → 404 rule. Do not move it
to the repo root without adding a rule; root-level `.md` files are served.

---

## 1. The map — what owns what

| Concern | Owner | Where it is configured |
|---|---|---|
| Site hosting, deploys | Netlify | `netlify.toml`, deploys `main`, no staging |
| Database, auth, storage | Supabase `lagjjcpclvzrjlrswojt` | dashboard + `supabase/*.sql` |
| Outbound email | Resend, via Supabase custom SMTP | Supabase Auth → SMTP Settings |
| Auth email content | Supabase dashboard | Auth → Email Templates (mirrors in `scripts/`) |
| Inbound email | Cloudflare Email Routing | Cloudflare → Email |
| DNS | Cloudflare | nameservers `summer` / `mustafa`.ns.cloudflare.com |
| Scheduled jobs | GitHub Actions | `.github/workflows/` |

---

## 2. Email — outbound

Custom SMTP is **on**, through **Resend**, sending as **`build@gunforma.com`**.

**Rate limit: 30 new users per hour** (Supabase's default once custom SMTP is
configured). Fine for hand-sent invites; not fine for a public announcement. It is
raised under Auth → Rate Limits, not in Resend.

Three templates are live, and all three are configured **in the Supabase dashboard**.
The files in `scripts/` are versioned mirrors — editing them sends nothing. See
CLAUDE.md, "Auth emails live in the dashboard, not in this repo," for the full rule.

| Template | Fired by |
|---|---|
| Confirm signup | `signUp()` / `resend({type:'signup'})` in `gunforma-signup.html` |
| Reset Password | `resetPasswordForEmail()` in `gunforma-signin.html` |
| Invite user | `admin.inviteUserByEmail()` in `launch-invite` AND `invite-builder` |

Magic Link, Change Email Address and Reauthentication are **unreachable** — nothing
in the codebase calls `signInWithOtp` or `verifyOtp`, and the only `updateUser` calls
set a password (`gunforma-claim.html`, and the reset form on `gunforma-signin.html`),
which sends no email. If an
email-change feature is ever added to the profile page, that template goes live as
Supabase's stock default: no logo, no brand, no warning.

There is **no build-approved notification email.** `notifications` is an in-app
inbox only — `kind in ('comment','reply','like')`, written by triggers on
`build_comments` and `build_fires`, rendered by `gunforma-notifications.html` and
the nav bell. Nothing in the system emails a user about anything except auth.

### The invite trap

An invite creates the auth user the moment it is sent, and `launch-invite` links the
build and its photo rows to that user in the same call — before the builder has
clicked anything.

**Never delete an invited user in the Supabase dashboard.** Three foreign keys cascade
from that delete, read from the live schema on 2026-10-05:

| | |
|---|---|
| `profiles.id → auth.users` | `ON DELETE CASCADE` |
| `builds.user_id → profiles` | `ON DELETE CASCADE` |
| `build_photos.user_id → auth.users` | `ON DELETE CASCADE` |

So deleting the user deletes their build and its photo rows. This section used to give
exactly that as the recovery for an expired invite ("delete the unconfirmed user,
re-run the invite"). It was written when an invite carried no build, and nobody came
back for it when `launch-invite` started linking one.

What to do instead, by case. Every command looks the build up in
`scripts/builders.json`, so the email must be in that file:

| What happened | Do this |
|---|---|
| The link expired, or they lost the email, and they have **not** claimed | `node scripts/launch-invites.js --resend <email>` — a fresh link to the same account. Nothing else changes. |
| The address was typed wrong, or the invite should not have gone out | `node scripts/launch-invites.js --release <email>` — the build goes back to having no owner, its photo rows go back to the admin, the unclaimed account is deleted. Then correct `builders.json` and run normally. |
| They clicked the link but never finished, or cannot get back in | Nothing for you to run. **Forgot password?** on the sign-in page emails a link that opens a "choose a new password" form; from there they are sent on to pick a username. |
| Who has not claimed yet? | Run `node scripts/launch-invites.js` again. A plain run never emails anyone already invited; it prints each builder as claimed or not. |

`--resend` and `--release` refuse a builder who has already claimed, with a 409 that
says why. `--release` moves everything off the account and reads it back before it
deletes the account, so a step that silently did nothing stops the delete.

`--resend` rests on one fact about Supabase that the tests cannot prove:
`inviteUserByEmail` re-sends to an existing **unconfirmed** address instead of refusing
it. That is how `supabase/auth` reads (`internal/api/invite.go`: an existing user is
refused only `if isConfirmed`). Until it has been watched once on a real address, treat
it as read, not verified.

`invite-builder` (the one-off function behind `batch-invite.js`) has neither action and
still refuses any address that exists.

### Invited builders set a password when they claim

`gunforma-claim.html` asks for a username **and a password**. Until the change that
added this section (written 2026-10-05) it asked for a username only, and nothing on
the site could set a password at all — the
reset email's link signed the person in and redirected, with no form. An invited
builder therefore had one session, in one browser, and no way back in from anywhere
else.

Both halves are fixed: the claim page saves a password before it marks the claim
complete, and the reset link now lands on a "choose a new password" form on
`gunforma-signin.html`. A builder who claimed before this has no password; **Forgot
password?** gives them one.

---

## 3. Email — inbound

Cloudflare Email Routing. MX records point at
`route1/2/3.mx.cloudflare.net`.

**Routing is per address.** Mail to an address with no rule is rejected, and nothing
anywhere reports it. Rules existed for neither `build@` nor `contact@` until
2026-09-30 — meaning every message ever sent to `contact@gunforma.com`, the address
published six times across `privacy-policy.html`, `terms-of-service.html` and
`gunforma-legal.html`, was silently discarded.

| Address | Purpose |
|---|---|
| `contact@gunforma.com` | published in the legal pages; data requests, disputes |
| `build@gunforma.com` | the From on every auth email; builder replies |
| catch-all | **status unverified — confirm this is enabled** |

Destination is a single external mailbox, verified by Cloudflare. A destination
cannot be at `gunforma.com` — that is a mail loop and Cloudflare blocks it.

**Sending and receiving are separate systems and fail independently.** Resend will
send as `build@gunforma.com` whether or not anything receives there. There is no
dashboard that reads "0 emails received." The only symptom is someone asking why you
never replied.

---

## 4. DNS — verified 2026-09-30

Queried through public resolvers and, for DMARC, against Cloudflare's own
nameserver.

| Record | Value | For |
|---|---|---|
| MX | `route1/2/3.mx.cloudflare.net` | inbound via Cloudflare |
| TXT `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | Cloudflare's, for **receiving** |
| TXT `send` | `v=spf1 include:amazonses.com ~all` | Resend's return path (Resend runs on SES) |
| TXT `resend._domainkey` | DKIM public key | signs as `gunforma.com` — this is what carries deliverability |
| TXT `_dmarc` | `v=DMARC1; p=none;` | monitor-only; added 2026-09-30 |

The root SPF record does **not** list Resend, and that is correct. Resend's envelope
sender is on `send.gunforma.com`, so SPF is evaluated there. DKIM is what aligns on
the root domain.

Google's public resolver caches negative answers for up to an hour. To check a
just-added record, ask the authoritative nameserver:

    dig TXT _dmarc.gunforma.com @summer.ns.cloudflare.com +short

---

## 5. Supabase auth settings

| Setting | Value | Note |
|---|---|---|
| Email OTP Expiration | **86400** (24h) | was 3600; raised 2026-09-30 |
| Custom SMTP | on, Resend | |
| Auth email rate limit | 30/hour | |
| Leaked Password Protection | **off** | see below |
| CAPTCHA | Turnstile | required by signup/signin; without the secret set, every signup fails |

**Why 86400.** At 3600 every invite link died within an hour. Hand-sent invites get
opened the next morning, so all five would have been dead on arrival. The cost is
that password-reset links now also live 24 hours, because it appears to be a single
setting — whether Supabase exposes a separate recovery expiry was **not** confirmed.
Revisit after launch; if it is separable, put recovery back to 3600.

All three templates state the expiry in their copy. **Change the setting, change the
copy** — and the copy is in four more places than the templates: the "Reset link sent"
note on `gunforma-signin.html` (it read "1 hour" for five days after the setting was
raised), the expired screen on `gunforma-claim.html`, and the `--resend` messages in
`scripts/launch-invites.js` and `supabase/functions/launch-invite`.

---

## 6. Advisor findings — accepted, with reasons

Run `get_advisors` (security) periodically. These are the current findings and the
standing decision on each. A finding listed here as accepted should not be "fixed"
by a later session without reading the reason.

**`security_definer_view` on `build_comments_public` — ERROR, accepted.**
This is the intended design, not a defect. Verified 2026-09-30:

- `build_comments` has RLS on, **no grant to `anon` at all**, and an authenticated
  SELECT policy of `user_id = auth.uid() OR is_admin()`.
- `build_comments_public` is granted `r` to both `anon` and `authenticated` and has
  no `security_invoker`, so it reads as definer.
- The view does the access control itself: `WHERE EXISTS (... b.status='approved')`,
  body nulled when `deleted_at` is set, only `username` and `avatar_url` taken from
  `profiles`, and `my_vote` keyed to `auth.uid()` so it stays per-caller.

Setting `security_invoker = true` **would break comments for every logged-out
visitor**, because anon has no grant on the base table.

The real risk is different from the one the linter names: **that view is the entire
access-control boundary for comments, with no RLS policy behind it to catch a
mistake.** Add a column to its SELECT and it is public immediately, with nothing
failing. Treat any edit to that view as a security change.

**`auth_otp_long_expiry` — WARN, accepted for now.** Direct consequence of the
86400 decision above. Revisit after launch.

**`auth_leaked_password_protection` — WARN, declined 2026-09-30.** One toggle under
Auth → Passwords; checks new passwords against HaveIBeenPwned. AG's call is that it
is not needed at current scale. Recorded as a decision, not an oversight — do not
re-raise it as a finding. Revisit if signups open beyond hand-invited builders, or
if any account is ever compromised.

**`rls_enabled_no_policy` ×4** — `price_history`, `link_clicks`, `sync_drift_review`,
`affiliate_links_is_primary_archive`. RLS on with no policy is deny-all, which is
the intent for internal tables. `price_history` also carries an explicit revoke; see
CLAUDE.md. Accepted.

**SECURITY DEFINER functions callable by `anon` / `authenticated`** — `is_admin()`,
`get_my_profile()`, `contest_build_part()`, `restrict_owner_edits_on_approved_build()`.
Not reviewed in depth as of 2026-09-30. `restrict_owner_edits_on_approved_build` is
a trigger function and probably should not be callable over RPC at all. **Open.**

---

## 6b. Scheduled workflows — the cron is not when they run

Measured 2026-09-30 from `gh run list`. GitHub's scheduler both **delays and
drops** firings, consistently and by a lot. Do not reason about freshness from
the cron expression.

| Workflow | Cron (UTC) | Observed |
|---|---|---|
| Refresh affiliate prices | `23 7 * * *` | 12:15–15:34 every day — **5 to 8 hours late**, never once near 07:23 |
| Price freshness | `41 2,8,14,20 * * *` (4/day) | 2–3 runs/day, delays from 17 minutes to 5 hours |

Both succeed. Nothing is broken. But an alert threshold tuned to "four freshness
checks a day" is tuned to a cadence that does not happen, and anything that
assumes prices refresh at 07:23 is about six hours wrong.

The corollary: a workflow that has not run *yet today* is not evidence it is
broken. On 2026-09-30 an incomplete `gh run list` paste was read as proof the
sync had never run on a schedule; the full history showed it running daily, and
succeeding on schedule the two days after its fix landed. Pull the full history
for the specific workflow before concluding anything:

    gh run list --workflow="<name>" --limit 50 --json event,conclusion,createdAt \
      --jq '.[] | "\(.createdAt[0:16])  \(.event)  \(.conclusion)"'

---

## 7. Secrets — where each one lives

There is no single store. Each of these is a separate hand-typed copy, and a
workflow that passes locally proves nothing about the scheduled run.

| Secret | Lives in | Used by |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions secrets | scheduled workflows |
| `SUPABASE_SERVICE_ROLE_KEY` | Netlify env (Functions + Builds, all contexts) | `/go/` click logging |
| Resend SMTP credentials | Supabase Auth → SMTP Settings | all auth email |
| Turnstile secret | Supabase Auth → Attack Protection | signup/signin CAPTCHA |
| Awin feed credentials | as configured for the price sync | `refresh-affiliate-prices.mjs` |

**Netlify env changes do not reach an existing deploy.** Trigger a new one. This has
already cost an hour once.

**A Supabase Edge Function is deployed separately from the site.** Merging a PR does
not deploy it. `supabase functions deploy <name> --project-ref lagjjcpclvzrjlrswojt`.

---

## 8. Things that fail silently, specific to this layer

The repo's doctrine — a green result is not evidence the work happened — applies
here with its own list:

- An email template edited in the repo and never pasted into the dashboard.
- An inbound address with no routing rule: rejected, no report, no bounce you'll see.
- An unverified Cloudflare destination: every rule pointing at it drops mail.
- A DNS record that resolves from the authoritative server but not yet from a cache.
- A Netlify env var set but not deployed.
- An Edge Function fixed in a merged PR but never deployed.
- A GitHub Actions secret that exists locally and not in the repo settings.
- A scheduled workflow that has only ever been run by hand, so its
  `github.event_name == 'schedule'` branch has never executed.

Each of these produces a success message somewhere.
