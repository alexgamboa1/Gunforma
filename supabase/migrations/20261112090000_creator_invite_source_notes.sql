-- creator_invites: two record-keeping columns for the admin portal's invite
-- manager (gunforma-admin-creators.html, PR "creator-invite management").
--
-- APPLY ONLY AFTER THE PR IS MERGED AND THE creator-invite EDGE FUNCTION IS
-- REDEPLOYED (CLAUDE.md, "Branches and PRs": code first, then migration).
-- The function tolerates both shapes: its status read falls back to a select
-- without these columns, and a write that names them before this is applied
-- answers a readable error instead of a raw PGRST204.
--
--   source  — WHERE the creator was found ("r/P365 top post", "IG explore",
--             "YouTube comment thread"). sent_via stays what it has always
--             been: HOW the link was delivered ("IG DM from @gunforma").
--             Two different facts; conflating them is why this column
--             exists instead of sent_via growing a second meaning.
--   notes   — free text for the admin trail (what was said, what to follow
--             up on). Capped at 4000 so a pasted transcript cannot balloon
--             the row.
--
-- The table stays DENY-ALL: RLS on, NO policies, grants revoked
-- (20261027040000_creator_invites.sql). No policy is added here and none
-- should ever be — all access remains the two Edge Functions
-- (creator-invite with the service role or an admin session it verifies
-- itself, creator-claim with the token), exactly as before. New columns on
-- a deny-all table inherit the deny-all.
--
-- Rollback: alter table public.creator_invites drop column source, drop column notes;

alter table public.creator_invites
  add column source text,
  add column notes  text check (notes is null or length(notes) <= 4000);

comment on column public.creator_invites.source is
  'Where the creator was found (e.g. "r/P365 top post"). sent_via is how the link was delivered; this is where they were discovered. Admin record-keeping, editable in every state.';
comment on column public.creator_invites.notes is
  'Free-text admin notes on the invite (<= 4000 chars). Editable in every state through the creator-invite Edge Function''s update action.';
