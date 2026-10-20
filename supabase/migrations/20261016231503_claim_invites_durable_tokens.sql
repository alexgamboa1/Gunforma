-- claim_invites — durable 7-day claim tokens for launch invites (#180).
--
-- This file is the repo copy of a migration that production already lists:
-- supabase_migrations.schema_migrations holds version 20261016231503, name
-- claim_invites_durable_tokens, applied 2026-10-16 23:15:03, with no file
-- behind it in supabase/migrations/ — so `supabase db push --linked` refused
-- every later migration. The statements below are read back VERBATIM from
-- that history row (one stored statement, md5 279515db225692574731fa235b45802d,
-- 2200 bytes), not rewritten. On production this version is already marked
-- applied and the CLI will not run it again; on a fresh database it runs in
-- order like any other file.
--
-- It is NOT the same text as supabase/claim_invites.sql: what was applied
-- lacks that file's `revoke all on public.claim_invites from anon,
-- authenticated`, its `revoke execute on function public.mark_claim_claimed()
-- from public, anon, authenticated`, and its `drop trigger if exists` before
-- the create. Whether production carries those grants is a separate question
-- from recording what was applied, and is answered in the PR, not here.
--
-- What it does: the table the launch-invite / redeem-claim / resend-claim
-- Edge Functions read and write (service role only; RLS on, no policies),
-- its two partial indexes, and the trigger that stamps claimed_at when
-- gunforma-claim.html flips profiles.onboarding_complete.

create table if not exists public.claim_invites (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,
  user_id              uuid references auth.users(id) on delete cascade,
  build_id             uuid references public.builds(id) on delete set null,
  name                 text,
  phone                text,
  token_hash           text not null unique,
  expires_at           timestamptz not null,
  sent_at              timestamptz,
  last_sent_at         timestamptz,
  send_count           integer not null default 0,
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

create index if not exists claim_invites_email_open_idx
  on public.claim_invites (email)
  where claimed_at is null;

create index if not exists claim_invites_remind_idx
  on public.claim_invites (sent_at)
  where claimed_at is null and reminded_at is null;

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

create trigger trg_mark_claim_claimed
  after update of onboarding_complete on public.profiles
  for each row
  execute function public.mark_claim_claimed();
