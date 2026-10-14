# Schema changes

**Every change to the database is a file in `supabase/migrations/`, tested
on a fresh database before it is merged, and applied to production by the
Supabase CLI after it is merged. Nothing is run by hand on production.**

That is the whole rule. The rest of this file is how to follow it and why it
exists.

## How a change ships

1. **Branch** (from `origin/main`, as CLAUDE.md says) and create the file:

   ```bash
   supabase migration new <short_name>
   ```

   That writes `supabase/migrations/<timestamp>_<short_name>.sql`. Put the
   SQL in it. One change per file; a header comment saying what it does and
   why, in the style of the files in `supabase/migrations_archive/`.

2. **Test it on an empty database.** Two ways, use either:

   - Locally, with Docker Desktop installed:

     ```bash
     supabase db reset --local
     ```

     builds the database from every file in `supabase/migrations/` and then
     `supabase/seed.sql`, and stops on the first error.

   - Or push the branch and open the PR: `.github/workflows/check-migrations.yml`
     does the same on a GitHub runner and goes red if a file refuses to apply
     or the result is missing something the site needs.

   For anything that touches data shape, functions or policies, also build a
   Supabase branch from the PR and exercise the change there, signed in. A
   branch is a real Supabase project built from this folder plus the seed.

3. **Merge**, then apply to production:

   ```bash
   supabase db push --linked
   ```

   The CLI applies only the files production's history does not already
   list, in order, and records each one. **Code first, then migration**: the
   frontend that tolerates both shapes is deployed before this runs
   (CLAUDE.md, "Branches and PRs").

4. Confirm the history and the folder agree:

   ```bash
   supabase migration list --linked
   ```

   Every version should show in both the Local and Remote columns. A version
   in one column only is drift, and the next `db push` will refuse until it
   is repaired.

## What is not allowed any more

- **The dashboard SQL editor for DDL.** It records nothing, so the next
  person cannot tell what production looks like from the repo. Reads are
  fine; CLAUDE.md's dry runs in a rolled-back transaction are fine. Anything
  that commits a schema change is a migration file.
- **`apply_migration` through the Supabase MCP.** It records a history row
  with no file behind it. That is how production reached 223 history rows
  the repo could not replay, which is what this file exists to end.
- **Hand-typed `supabase migration repair`** outside of the one-time
  baseline below. If `db push` complains about history, find out why the
  folder and the table disagree before repairing either.

## Reference data: `supabase/seed.sql`

A fresh database has the schema and nothing else, and `create_product()`
refuses to run without its lookup tables. `supabase/seed.sql` loads the
tables that define **rules and categories** — nothing a user or an admin
typed in: platforms, guns, the lookup vocabularies, spec_field_rules,
partners. It is applied after the migrations by `db reset` and by a
Supabase branch, never by `db push` (production already has the rows).

When a reference row changes on production (a new colour, a new rule), the
seed is out of date until someone regenerates it. The header of the file
says how.

## The baseline, and why it is one file

`supabase/migrations/20261014065009_baseline_production_schema.sql` is a dump of
production's schema taken on 2026-10-14, with the Supabase CLI's recipe
(`supabase db dump --schema public`), plus the three things that recipe does
not reach because they live outside the `public` schema: the three storage
buckets, the eleven policies on `storage.objects`, and the trigger on
`auth.users` that creates a profile.

It replaced everything before it. The files that used to sit loose under
`supabase/` are in `supabase/migrations_archive/` with a README mapping
them to the history rows they produced. Production's history table was
repaired in the same change so that it lists exactly one version, the
baseline, marked applied without being run — production already had the
schema.

**Never apply the baseline to production.** It is marked applied there. On
any new branch or local database it runs first, as the floor everything
after it stands on.

## Re-baselining

Not needed in the normal course of things: migrations accumulate, and that
is fine. If the folder ever has to be squashed again, use
`scripts/dump-schema.sh` (the CLI's recipe without Docker) against
production, append the storage and auth section by hand from the same
queries that built the first one, archive the superseded files, and repair
the history the same way. Write it all into the PR.
