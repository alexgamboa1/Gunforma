-- ============================================================
-- Gunforma-v2 — a reviewer's part changes: written into the build, logged,
-- and announced to the builder once.
-- APPLIED 2026-10-13 as migration admin_part_changes (20261013033628). See
-- the record at the bottom of this file. It went in right AFTER the PR that
-- ships the page changes (#163) was merged and deployed, the house order
-- (CLAUDE.md, "Branches and PRs"): the pages work with and without this
-- file; this file is what makes the builder's notification. Nothing was
-- corrected, added or removed on a LIVE build in the window between the
-- two — step 4 counts everything logged on a live build as already told,
-- so a change made in that window would never have been announced.
-- Rollback: supabase/admin_part_changes_rollback.sql
--
-- WHAT THE PAGES NOW DO (gunforma-admin-queue.html)
-- A reviewer can correct, add and remove parts on a PENDING or a LIVE
-- build, whoever owns it. Each change is written into parts_snapshot itself
-- and appended to builds.edit_history:
--   correction  { part_id, part_index, field, from_value, to_value, edited_by, edited_at, status, reason? }
--   added       { kind: 'part_added',   part: {partId, brand, name, …}, edited_by, edited_at, status, reason? }
--   removed     { kind: 'part_removed', part: {…}, … }
-- The public build page shows the parts; only the builder (and admins)
-- see the list of changes (gunforma-build-detail.html, "What Gunforma
-- changed"). RLS already lets an admin write any build and the live-build
-- guard already admits admins, so the pages need nothing new from the
-- database to make the change itself.
--
-- WHAT THIS FILE DOES
-- 1. A fifth notification kind, 'changes', with no actor (from Gunforma,
--    like 'approved').
-- 2. builds.changes_notified_count: how many edit_history entries the
--    builder has been told about. A POSITION, not a time — edited_at is
--    the reviewer's browser clock, and comparing it with now() would lose
--    or repeat a change whenever the two disagree. edit_history is
--    append-only for every writer that adds to it (the queue appends;
--    prevent_owner_edit_history_change refuses anyone else adding,
--    removing or reordering).
-- 3. Corrections written before this lived ONLY in edit_history — the
--    queue laid them over the part, the public page did not, and showed
--    the uncorrected name. They are written into parts_snapshot here, so
--    every page agrees. Measured 2026-10-12: one entry on one pending
--    build (a variant note). An entry is applied ONLY while the part still
--    holds its from_value: a builder who has since changed the part, a
--    correction already written in by the new queue, and a part since
--    linked to the catalog are all left alone. Brand and name are never
--    written over a catalog part (they are the product it links to).
-- 4. Backfill: everything already logged on a live build, or on one nobody
--    owns, counts as told. A build in review keeps 0, so a correction made
--    while it is pending is announced when it goes live.
-- 5. notify_build_changes(), BEFORE UPDATE on builds:
--      - nobody owns the build      → nothing to tell; counter moves on
--      - not live                   → held; counter stays (told on approval)
--      - live, new entries          → ONE notification listing them, counter moves on
--      - the reviewer owns it       → counter moves on, no notification
--    Only an admin or a trusted backend moves the counter. Anyone else's
--    write keeps it where it was, so a builder cannot mark changes told
--    (an owner can UPDATE their own row, and the owner guards do not know
--    this column). On INSERT the counter starts at 0 for anyone else, so a
--    build cannot be created already "told".
--
-- WHY BEFORE, AND WHY "zz"
-- It sets a column on the row being written, so it is a BEFORE trigger.
-- Postgres fires triggers of the same timing in name order: "trg_zz_…"
-- runs after every guard (a refused write raises before it inserts
-- anything) and after stamp_build_review, which appends the 'resubmit'
-- marker this function must see and skip. The notification row is in the
-- same transaction as the update, so a write that fails later takes it
-- with it.
--
-- EMAIL: none yet. send-build-approved only reads kind = 'approved'. The
-- row is stamped email_sent_at = now() at insert, so a sender added for
-- this kind later starts from new rows instead of mailing every builder
-- about every old change — the mistake step 3 of
-- build_approved_notifications.sql exists to prevent. That sender must
-- stop stamping here.
--
-- WHAT IT DOES NOT DO
-- edit_history stays readable through the API like every other column of
-- a public row. The page no longer shows it to anyone but the builder;
-- hiding the column itself is a separate change (a column revoke plus a
-- function the owner reads it through), logged, not done.
-- ============================================================

begin;

-- 1. 'changes' ----------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('comment', 'reply', 'like', 'approved', 'changes'));

alter table public.notifications drop constraint notifications_actor_required;
alter table public.notifications add constraint notifications_actor_required
  check (kind in ('approved', 'changes') or actor_id is not null);

-- 2. the counter --------------------------------------------------------
alter table public.builds
  add column if not exists changes_notified_count integer not null default 0;

-- 3. old corrections into parts_snapshot --------------------------------
-- Same matching rule as js/part-ids.js: by part_id when the entry has one
-- (and then only by it), by part_index when it has only that.
do $$
declare
  r record; v_parts jsonb; v_e jsonb; v_i int; v_n int := 0;
begin
  for r in
    select id, parts_snapshot, edit_history from public.builds
     where jsonb_typeof(edit_history) = 'array' and jsonb_array_length(edit_history) > 0
       and jsonb_typeof(parts_snapshot) = 'array'
  loop
    v_parts := r.parts_snapshot;
    for v_e in select e from jsonb_array_elements(r.edit_history) as t(e) loop
      continue when jsonb_typeof(v_e) <> 'object'
                 or coalesce(v_e ->> 'field', '') not in ('category', 'brand', 'name', 'variant');
      v_i := null;
      if (v_e ->> 'part_id') ~ '^[0-9a-f]{12}$' then
        select (ord - 1)::int into v_i
          from jsonb_array_elements(v_parts) with ordinality as p(part, ord)
         where p.part ->> 'partId' = v_e ->> 'part_id'
         limit 1;
      elsif (v_e ->> 'part_index') ~ '^[0-9]+$' then
        v_i := (v_e ->> 'part_index')::int;
      end if;
      continue when v_i is null or v_parts -> v_i is null;
      -- Only over the value the reviewer corrected. Anything else means the
      -- part changed since (or the new queue already wrote it in).
      continue when coalesce(v_parts -> v_i ->> (v_e ->> 'field'), '') is distinct from coalesce(v_e ->> 'from_value', '');
      continue when v_e ->> 'field' in ('brand', 'name') and coalesce(v_parts -> v_i ->> 'refId', '') <> '';
      if v_e ->> 'field' = 'variant' and coalesce(v_e ->> 'to_value', '') = '' then
        v_parts := jsonb_set(v_parts, array[v_i::text], (v_parts -> v_i) - 'variant');
      else
        v_parts := jsonb_set(v_parts, array[v_i::text, v_e ->> 'field'], to_jsonb(coalesce(v_e ->> 'to_value', '')));
      end if;
    end loop;
    if v_parts is distinct from r.parts_snapshot then
      update public.builds set parts_snapshot = v_parts where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  raise notice 'corrections written into parts_snapshot on % build(s)', v_n;
end $$;

-- 4. backfill -----------------------------------------------------------
update public.builds
   set changes_notified_count = jsonb_array_length(edit_history)
 where jsonb_typeof(edit_history) = 'array'
   and (status = 'approved' or user_id is null);

-- 5. the trigger --------------------------------------------------------
-- Which entries are a reviewer's changes: the same rule as
-- PartIds.changes() in js/part-ids.js — an added or removed part, or a
-- correction (a field, and a part_id or part_index). Change both together.
create or replace function public.notify_build_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hist jsonb := coalesce(new.edit_history, '[]'::jsonb);
  v_len int;
  v_from int;
  v_e jsonb;
  v_lines text[] := '{}';
  v_text text;
  v_preview text;
begin
  if tg_op = 'INSERT' then
    if not public.is_trusted_backend() then
      new.changes_notified_count := 0;
    end if;
    return new;
  end if;
  if jsonb_typeof(v_hist) <> 'array' then
    new.changes_notified_count := old.changes_notified_count;
    return new;
  end if;
  v_len := jsonb_array_length(v_hist);

  -- Only a reviewer or the backend moves the counter.
  if not (public.is_admin() or public.is_trusted_backend()) then
    new.changes_notified_count := old.changes_notified_count;
    return new;
  end if;

  -- Nobody to tell. Moving the counter means a build claimed later does
  -- not announce changes made before its builder had it.
  if new.user_id is null then
    new.changes_notified_count := v_len;
    return new;
  end if;

  -- Held until the build is live: the builder hears once, with the
  -- approval, not once per correction during review.
  if new.status is distinct from 'approved' then
    new.changes_notified_count := least(greatest(coalesce(old.changes_notified_count, 0), 0), v_len);
    return new;
  end if;

  v_from := least(greatest(coalesce(old.changes_notified_count, 0), 0), v_len);
  new.changes_notified_count := v_len;
  if v_from >= v_len then
    return new;
  end if;

  for v_e in
    select e from jsonb_array_elements(v_hist) with ordinality as t(e, ord)
     where ord > v_from order by ord
  loop
    continue when jsonb_typeof(v_e) <> 'object';
    if v_e ->> 'kind' in ('part_added', 'part_removed') then
      v_text := case when v_e ->> 'kind' = 'part_added' then 'Added ' else 'Removed ' end
        || coalesce(nullif(btrim(concat_ws(' ', v_e -> 'part' ->> 'brand', v_e -> 'part' ->> 'name')), ''), 'a part');
    elsif v_e ? 'field' and (v_e ? 'part_id' or v_e ? 'part_index') then
      v_text := 'Corrected the '
        || case v_e ->> 'field' when 'variant' then 'variant note' when 'category' then 'section' else v_e ->> 'field' end
        || case when coalesce(v_e ->> 'to_value', '') = '' then '' else ' to “' || (v_e ->> 'to_value') || '”' end;
    else
      continue;   -- the 'resubmit' marker, a contested flag, anything else
    end if;
    v_lines := v_lines || v_text;
  end loop;

  if coalesce(array_length(v_lines, 1), 0) = 0 then
    return new;
  end if;
  -- A reviewer changing their own build has nothing to be told.
  if auth.uid() is not distinct from new.user_id then
    return new;
  end if;

  v_preview := array_to_string(v_lines, ' · ');
  if length(v_preview) > 280 then
    v_preview := left(v_preview, 279) || '…';
  end if;

  insert into public.notifications (user_id, actor_id, kind, build_id, preview, email_sent_at)
  values (new.user_id, null, 'changes', new.id, v_preview, now());   -- see EMAIL above
  return new;
end;
$function$;

-- Not an API endpoint. Postgres grants EXECUTE to PUBLIC on every new
-- function; see CLAUDE.md on default privileges re-granting.
revoke execute on function public.notify_build_changes() from public, anon, authenticated;

drop trigger if exists trg_zz_notify_build_changes on public.builds;
create trigger trg_zz_notify_build_changes
  before insert or update on public.builds
  for each row
  execute function public.notify_build_changes();

commit;

-- Verify, after committing:
--   select tgname from pg_trigger where tgrelid = 'public.builds'::regclass
--     and not tgisinternal order by tgname;            -- trg_zz_… is last
--   select id, status, jsonb_array_length(edit_history) as logged, changes_notified_count
--     from public.builds where jsonb_array_length(edit_history) > 0;
--   -- live and unowned builds: the two numbers are equal
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.notifications'::regclass and conname like 'notifications_%_check';

-- ============================================================
-- DRY RUN, 2026-10-12, before it was ever applied: a local Postgres 16 with
-- the live definitions of every trigger and guard on builds (read back
-- with pg_get_functiondef), this file applied as written, then twelve
-- callers, each as `authenticated` with a JWT sub:
--
--   1  admin adds a part to a PENDING owned build   counter held at 0, no notification
--   2  admin approves it                            'approved' + 'changes' ("Added …"), counter 1
--   3  admin corrects a name on the LIVE build      second 'changes' ("Corrected the name to …"), counter 2
--   4  owner sets the counter to 0 + edits text     text saved, counter stays 2
--   5  owner sends the correction back (contest)    entry contested, no notification, counter 2
--   6  owner changes parts on the live build        refused (restrict_owner_edits_on_approved_build)
--   7  owner appends a log entry                    refused (prevent_owner_edit_history_change)
--   8  admin changes an UNOWNED build               counter = log length, no notification
--   9  admin Undo → pending, removes a part         held, no notification
--  10  admin re-approves                            'approved' + 'changes' ("Removed …"), counter 3
--  11  an admin changes their OWN live build        counter moves, no notification
--  12  reject → builder resubmits → approve         only the resubmit marker: no 'changes' row
--  13  owner INSERTs a build with the counter at 99 counter stored as 0
--  14  legacy write-through skips a part changed since, and brand/name on a catalog part
--
-- Also: the one existing correction was written into its part (NOTICE: 1
-- build); the backfill left live/unowned builds at their log length and
-- the pending one at 0; trg_zz_notify_build_changes sorts last; anon and
-- authenticated cannot execute the function.
--
-- Then the same body was run against the real database (this project) in a
-- transaction that was rolled back, after proving the SQL tool runs a
-- multi-statement query as ONE transaction (a temp table created before
-- `rollback` was gone after it). Inside the transaction: step 3 changed 1
-- build and part 675009d76e27 on 84d09757… read variant "Custom Black Grip
-- Insert (Special Order)"; the one build with history was the pending,
-- owned one at logged 1 / notified 0; the BEFORE triggers in name order
-- ended with trg_zz_notify_build_changes; anon and authenticated could not
-- execute the function; zero 'changes' rows were written. After the
-- rollback: no column, four kinds in the constraint, no function, no
-- trigger, the part's variant null again.
-- ============================================================

-- ============================================================
-- APPLIED 2026-10-13 as migration admin_part_changes (20261013033628) to
-- project lagjjcpclvzrjlrswojt, from this file as merged in #163 (a4c1020),
-- after production was read back serving the merged queue, build page,
-- inbox and js/part-ids.js — the live /b/ page carried "What Gunforma
-- changed" and none of the old badge. The body between begin; and commit;
-- was applied as written.
--
-- Checked just before applying: the database matched the dry run's
-- starting state — no column, four kinds, no function, one build with
-- history (pending, owned, 1 entry), the part's variant null.
--
-- Verified live, read back rather than assumed:
--   step 3 .................. part 675009d76e27 on 84d09757… reads variant
--                             "Custom Black Grip Insert (Special Order)";
--                             that build's updated_at is the migration's own
--                             timestamp (2026-10-13 03:36:28)
--   builds with history ..... the pending, owned one: logged 1, notified 0
--                             (step 4 touched no row: no live or unowned
--                             build had a log; 8 builds, all counters 0)
--   notifications_kind_check  comment, reply, like, approved, changes
--   notifications_actor_required  approved or changes, else actor_id
--   builds.changes_notified_count  present
--   the function ............ SECURITY DEFINER, search_path=public
--   EXECUTE on it ........... anon no, authenticated no, service_role yes
--   trg_zz_notify_build_changes  present, enabled ('O')
--   triggers on builds, name order: builds_updated_at, trg_assign_part_ids,
--     trg_cascade_builder_agreement, trg_notify_build_approved,
--     trg_prevent_build_consent_tampering,
--     trg_prevent_owner_edit_history_change, trg_restrict_build_status,
--     trg_restrict_owner_edits_on_approved, trg_stamp_build_consent,
--     trg_stamp_build_review, trg_zz_notify_build_changes — last
--   'changes' notifications . 0, as expected: nothing live had a log
--
-- NOT DONE: a change on the wire. No reviewer has yet corrected, added or
-- removed a part through the deployed queue, so no 'changes' notification
-- has been written by a real request; the fourteen cases above ran on a
-- local Postgres and the rolled-back dry run wrote none. The first live
-- edit on an approved, owned build is that test, and the builder's inbox
-- is where it shows.
-- ============================================================
