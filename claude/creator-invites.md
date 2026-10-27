# Creator invites — claimable pages (2026-10-27)

How gunforma recruits creators: build their page first, keep it invisible,
DM one private link. They claim it or they delete it. Until they choose,
nothing about them is public anywhere — their handle 404s, their builds are
unowned drafts RLS hides, and the invite table is deny-all.

This is the creator-side sibling of the launch invite flow
(`claude/launch-handoff.md`). Different credential, different lifecycle: a
launch invite starts from an email the builder gave us and creates their
account up front; a creator invite starts from a cold DM and creates
NOTHING until the creator signs in themselves.

## The flow, end to end

1. **Post their builds** in `/gunforma-admin-post` with **Private creator
   draft** checked. Each publishes as `status='draft'`, no owner, consent
   flags FALSE (the consent is theirs to give, at claim). Copy each Build
   UUID. Edit a draft later via the queue's "Edit build →" link — the
   editor already admits an admin to any unowned build.

2. **Hold the handle and mint the link:**

   ```bash
   SUPABASE_SERVICE_ROLE_KEY='...' node scripts/creator-invites.js \
     --invite mtz_builds \
     --builds <uuid>,<uuid> \
     --name "MTZ Builds" \
     --bio "P365 carry setups, tested hard." \
     --ig https://instagram.com/mtz_builds \
     --via "IG DM"
   ```

   It prints the claim URL once — the database stores only a hash, exactly
   like launch claim tokens. Lose it: `--new-link <handle>` mints another
   (and kills the old one). Links last 30 days.

3. **DM the link from the gunforma Instagram account.** No email is sent and
   none is asked for — the DM from the account they already know IS the
   trust signal. Suggested message:

   > Hey — I run gunforma.com, a site where every pistol build is listed
   > part by part with links. I put together a page of your builds so people
   > stop asking "what light is that" — it's private, only you can see it:
   > [link]
   >
   > If you want it, it's yours in two clicks, under your @. If not, there's
   > a delete button on the page and everything I drafted is gone, no hard
   > feelings. Nothing goes live either way unless you say so.

4. **They open `gunforma-creator.html?t=…`** and see their page: handle,
   bio, links, builds with photos and parts. Three ways out:
   - **Claim** — they sign in on the page itself (Google one-click, or the
     inline email form: create an account or sign in, Turnstile-gated; the
     confirmation link lands back on the invite page, signed in) and accept
     the terms. One database transaction
     (`claim_creator_invite`) gives their profile the handle + bio + links
     (never overwriting anything they already set), stamps their consent on
     the builds, and flips the builds to `approved` under their account.
     They land on `/u/<handle>`, live.
   - **Not interested** — deletes the draft builds AND their storage files,
     wipes the drafted bio/links. No account needed to say no. The handle
     stays held so nobody can pose as them; `--revoke` releases it.
   - **Nothing** — the link expires in 30 days. Nothing was ever public.

5. **`node scripts/creator-invites.js`** with no flags is the status report:
   who opened, who claimed, who declined, whose link expired.

## What keeps it honest

- **Hidden means RLS-hidden, not UI-hidden.** The drafts are invisible
  because "Public can view approved builds" / photo policies already exclude
  them — no new read policy was added anywhere. Verified against production
  in a rolled-back transaction (see the PR), along with: anon cannot read or
  run anything in this feature, a stranger cannot take a held handle (the
  profiles trigger answers the same 23505 as a duplicate), claim is
  all-or-nothing, decline deletes.
- **A held handle reads as "Taken"** in every username checker (signup,
  complete-profile, claim) via `username_is_held()` — one exact name in,
  one boolean out, so it cannot enumerate who is being invited.
- **`/u/<handle>` stays a genuine 404 until claimed** and never says
  "reserved" — announcing reservations would reveal who we're courting.
- **The consent trail is real**: builds drafted by the admin carry NO
  consent flags; `claim_creator_invite` writes `legal_confirmed`,
  `content_license_confirmed`, `confirmed_at` and the agreement version in
  the same transaction as the ownership transfer. The guard change that
  allows this (`prevent_build_consent_tampering` now also admits
  `is_trusted_backend()`) widens nothing for browsers.

## Known behaviors, chosen on purpose

- Claiming **renames an existing account** to the invite's handle (the page
  says which account it is claiming as). For a creator with an existing
  gunforma account under another name, that is the point; `/u/<old name>`
  links stop resolving, same as any rename.
- A **declined** invite keeps the handle held forever (anti-impersonation).
  Releasing it is a deliberate act: `--revoke <handle>`.
- `--new-link` **refuses a declined invite.** They said no.
- The email-and-password path lives on the invite page itself since #214/
  #215 (the signup-page detour silently lost the founder's own claim in
  rehearsal): inline signup whose confirmation link returns to the page,
  inline sign-in for an existing account, the token in localStorage so a
  new tab still has it, and an explicit "nothing is claimed yet" state.
  An existing confirmed email that tries to sign UP is detected by the
  empty-identities fake success and routed to sign-in (#215); a stale
  "confirm your email" banner offers a sign-in exit, and the resend button
  never claims mail it cannot prove (#216). Google remains the one-click
  path.

## Deploy / config (one-time)

In order (CLAUDE.md: code first, then migration):

1. Merge the PR (pages + script ship; everything sits idle).
2. `supabase functions deploy creator-claim --project-ref lagjjcpclvzrjlrswojt`
   and the same for `creator-invite`.
3. `supabase db push --linked` (migration `20261027040000_creator_invites`).
4. Supabase dashboard → Authentication → URL Configuration → Redirect URLs:
   add `https://gunforma.com/gunforma-creator.html` (Google sign-in returns
   to the invite page; without this the OAuth round trip falls back to the
   site URL and the creator has to reopen their link). Note it in
   `claude/operations.md` alongside the other allowlisted redirect URLs.
