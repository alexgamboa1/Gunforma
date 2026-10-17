-- Rollback for supabase/claim_invites.sql
-- =============================================================================
-- Drops the trigger, the trigger function, and the table. Safe to run only
-- before any real launch invites have been minted through the new flow — once
-- builders hold live 7-day tokens, dropping this table invalidates them all.
-- =============================================================================

drop trigger if exists trg_mark_claim_claimed on public.profiles;
drop function if exists public.mark_claim_claimed();
drop table if exists public.claim_invites;
