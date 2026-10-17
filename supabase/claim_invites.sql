-- claim_invites — durable 7-day claim tokens for launch invites
-- =============================================================================
-- Supabase caps every auth email link (invite, magic link, recovery) at the
-- single "Email OTP Expiration" setting (<= 86400s = 24h), and that one knob
-- covers ALL auth mail. A founding builder who opens the invite the next
-- morning hits a dead link. We do NOT raise that setting (it would also
-- lengthen password-recovery links).
--
-- Instead Gunforma owns its OWN durable token, good for 7 days. Clicking it
-- calls redeem-claim, which mints a FRESH Supabase magic link on the spot — so
-- the 24h Supabase expiry never faces the builder, only the server, and only
-- for the few seconds between click and redirect.
--
-- The RAW token is 32 random bytes (base64url), generated in the edge function
-- and placed only in the emailed URL. We store ONLY its sha256 hex here. A
-- read of this table never yields a working token.
--
-- RLS is ON with NO policies: deny-all to anon and authenticated. Every caller
-- is the service role (launch-invite, redeem-claim, resend-claim), which
-- bypasses RLS. Same deliberate deny-all pattern as price_history / link_clicks
-- (see claude/operations.md §6). The advisor will report one new
-- rls_enabled_no_policy INFO finding for this table — that is intended.
--
-- Apply:    supabase db execute -f supabase/claim_invites.sql  (or dashboard SQL editor)
-- Rollback: supabase/claim_invites_rollback.sql
-- =============================================================================

create table if not exists public.claim_invites (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,
  user_id              uuid references auth.users(id) on delete cascade,
  build_id             uuid references public.builds(id) on delete set null,
  name                 text,
  phone                text,
  -- sha256 hex of the raw token. UNIQUE so a lookup is a single index hit and
  -- a (vanishingly unlikely) collision is refused rather than silently shared.
  token_hash           text not null unique,
  expires_at           timestamptz not null,
  sent_at              timestamptz,
  last_sent_at         timestamptz,
  send_count           integer not null default 0,     -- lifetime sends (invite + resends)
  -- rate-limit windows, enforced in the edge functions:
  --   redeem:  max 10 per token per hour   (redeem_count within redeem_window_start)
  --   resend:  max  3 per invite per 24h   (resend_count within resend_window_start)
  redeem_count         integer not null default 0,
  redeem_window_start  timestamptz,
  resend_count         integer not null default 0,
  resend_window_start  timestamptz,
  opened_at            timestamptz,
  claimed_at           timestamptz,
  reminded_at          timestamptz,
  created_at           timestamptz not null default now()
);

comment on table public.claim_invites is
  'Durable 7-day launch claim tokens. Service-role only (RLS deny-all). Stores sha256(token) hex, never the raw token.';

alter table public.claim_invites enable row level security;

-- Belt-and-braces alongside deny-all RLS, matching price_history's explicit
-- revoke. Service role bypasses both.
revoke all on public.claim_invites from anon, authenticated;

-- token_hash already has a unique index from the constraint above.
-- Lookups by email target only the still-open invites.
create index if not exists claim_invites_email_open_idx
  on public.claim_invites (email)
  where claimed_at is null;

-- The hour-20 reminder pass scans: unclaimed, sent long enough ago, not yet
-- reminded. Partial index keeps it to exactly those rows.
create index if not exists claim_invites_remind_idx
  on public.claim_invites (sent_at)
  where claimed_at is null and reminded_at is null;

-- ============================================================================
-- claimed_at is stamped by a TRIGGER, not by the browser.
-- gunforma-claim.html finishes onboarding by setting profiles.onboarding_complete
-- = true. It CANNOT write claim_invites (deny-all RLS, and it holds only the
-- anon key). So when onboarding_complete flips true, this trigger — running as
-- the definer, which does bypass RLS — stamps the matching open invite.
-- ============================================================================
create or replace function public.mark_claim_claimed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.onboarding_complete is true
     and old.onboarding_complete is distinct from true then
    update public.claim_invites
       set claimed_at = now()
     where user_id = new.id
       and claimed_at is null;
  end if;
  return new;
end;
$$;

comment on function public.mark_claim_claimed() is
  'AFTER UPDATE OF onboarding_complete ON profiles: stamps claim_invites.claimed_at for the newly-onboarded user. SECURITY DEFINER so it can write the deny-all table; trigger-only, never an RPC.';

-- Trigger functions must not be callable over the REST RPC surface.
revoke execute on function public.mark_claim_claimed() from public, anon, authenticated;

drop trigger if exists trg_mark_claim_claimed on public.profiles;
create trigger trg_mark_claim_claimed
  after update of onboarding_complete on public.profiles
  for each row
  execute function public.mark_claim_claimed();
