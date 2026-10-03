# Gunforma — working notes for Claude Code

Technical context for this repo. Read before making changes.

Two companion files, both under `claude/` (blocked from the web by netlify.toml):

- **`claude/operations.md`** — configuration that lives OUTSIDE this repo: Supabase
  dashboard settings, Resend, Cloudflare DNS and Email Routing, where each secret
  lives, and which security-advisor findings are deliberately accepted and why.
  Read it before changing anything in a dashboard, and before "fixing" an advisor
  warning — some of them are the intended design.
- **`claude/loadouts-spec.md`** — the Loadouts project, parked.

## Stack

- Static HTML + vanilla JS. **No framework, no bundler, no transpile step.** Pages are
  hand-written HTML that load `js/*.js` as plain `<script src>` tags.
- Hosted on Netlify, deployed from `main`. Serverless code lives in `netlify/functions/`
  (Node, `.mjs`) and `netlify/edge-functions/` (Deno).
- Backend is Supabase (project **Gunforma-v2**), reached over PostgREST via
  `@supabase/supabase-js` from the browser, using the public anon key in
  `js/supabase-client.js`. Row-level security is what protects data — never assume the
  client is trusted.

Because there is no build step, what is in the repo is what ships. Edit the real file;
there is nothing to compile.

## Cloning

Always use a **full clone**. Do not use `--depth`, and never create a nested clone inside
an existing working copy — the whole repo root is published, so a nested copy becomes a
duplicate live site.

## Branches and PRs

**Never commit or push to `main`.** Every change goes on a branch and merges
through a PR. The site deploys from `main`, so a commit there is a deploy —
there is no step between writing it and shipping it, and no deploy preview on
which to do the signed-in verification that **Verifying changes** below
requires.

**Several Claude sessions edit this one working tree**, which is what turns
that from a preference into a rule. The tree is not yours, and its current
state is not a fact about your task:

- **`git fetch origin` and branch from `origin/main`** — not from whatever the
  tree happens to be on. Another session may have left it on their branch
  mid-edit, and a branch cut from that silently carries their unmerged work
  into your PR. `git checkout -b <name> origin/main`.
- **`git status` before touching anything.** If the tree holds someone else's
  uncommitted changes, **stop and say so.** Do not stash them, commit them, or
  edit around them — they are the only copy.
- **Two sessions needing the tree at once is what `git worktree add` is for**,
  and it lives **outside** the repo:
  `git worktree add --detach ~/gunforma-wt-main origin/main`. Cloning above
  applies unchanged — `publish = "."` ships the whole repo root, so a worktree
  inside it is a duplicate live site exactly as a nested clone is, and that rule
  does not name worktrees. **Detached on purpose**: it claims no branch, so it
  cannot collide with whatever the other session has checked out — cut your
  branch inside it as normal. `git worktree remove` when done.
- **`bash scripts/check-all.sh` must pass before the PR opens.** See
  **Build-time guards**; the deploy runs it anyway, so a failure found here is
  the same failure found earlier.

**And a change that depends on a migration is merged and deployed BEFORE the
migration is applied, never after.** The schema is shared and the branch is
not, so these two cannot be ordered by whichever is ready first. Deploy the
code that tolerates both shapes, confirm it is live, then apply the migration.

Both halves of that have already cost something:

- **A production catalog outage.** A migration dropped a column while the
  frontend fix for it sat unmerged on a branch. The branch was finished and
  the checks were green — it simply was not on `main`, so production went on
  asking for a column that no longer existed. Nothing about the branch looked
  wrong, because nothing about it was wrong; the ordering was.
- **A diverged local `main`.** Two commits landed straight on `main` while
  origin had moved on, leaving the tree ahead 2 and behind 1. Pushing it would
  have put unreviewed work on `main` as a deploy. The commits were fine. The
  route was not, and it took a reset to undo.

Both are the same shape as the failures the rest of this file is about: the
work was correct, the browser looked normal, and nothing reported a problem.

## PostgREST embeds: the PGRST201 rule

`products` and `product_variants` reference **each other** — one foreign key in
each direction:

- `product_variants.product_id → products.id` (many-to-one — almost always the one you want)
- `products.lowest_price_variant_id → product_variants.id` (one-to-many)

Because there are two FKs between the same *pair* of tables, an embed between
them is ambiguous in **both directions**, and PostgREST rejects the **entire
query** with `PGRST201`. Both directions must name the FK — and it is the same
FK name either way:

```js
// from products → variants
products!inner(id, name, product_variants!product_variants_product_id_fkey(msrp, is_default))

// from variants → products  (same trap, easy to miss)
product_variants!inner(id, sku, products!product_variants_product_id_fkey(name, category))
```

This fails quietly: `supabase-js` returns an error object rather than throwing, so the page
renders its generic "could not load" state with nothing in the console. It has shipped
broken twice. Before pushing:

```bash
scripts/check-embeds.sh
```

The check covers both directions and runs on every deploy — see **Build-time
guards** below.

Embeds from `affiliate_links` and `variant_images` each have exactly one FK to
`product_variants`, so their bare embeds are correct — do not "fix" those.
Likewise a bare `products(...)` embed is fine from single-FK parents such as
`part_favorites` and `product_platforms`. Several spec tables
(`barrel_specs`, `optic_specs`, `slide_specs`, `trigger_specs` and others) carry
two or more FKs to `products` and are ambiguous too — `guide-page.mjs` now
embeds through `optic_specs` and names the FK
(`products!optic_specs_product_id_fkey`).

`optic_specs → footprints` is a second instance of the same trap with a
different shape: one direct FK **plus** a many-to-many through
`optic_adapter_footprints`, so a bare `footprints(...)` embed off
`optic_specs` dies the same way. Found on the wire while building
guide-page.mjs, after this file's earlier note said "nothing embeds through
them today". Name it — `footprints!optic_specs_footprint_id_fkey(...)` — and
note `check-embeds.sh` now covers this pair (its safe-parent match requires
a query form, `table?` or `.from('table')`, because the first version was
defeated by its own documentation: a comment naming the safe parent within
the scan window cleared the very embed it described).

## Server-rendered pages

Crawlers do not run JS, so anything that needs real content in the HTML is server-rendered
by a Netlify function. Two working precedents to copy from:

- `netlify/functions/profile-og.mjs` — `/u/:username`, injects OG meta into the existing
  profile page.
- `netlify/functions/product-page.mjs` — `/parts/:category/:slug`, renders a full product
  page with JSON-LD.

Both are dependency-free (plain `fetch` against PostgREST, no `supabase-js`), use the anon
key only, and return a real 404 for unknown slugs rather than a soft 404.

`netlify/functions/sitemap.mjs` is a third, `/sitemap.xml`, generated from the
database. Two things about it are load-bearing:

- It builds `/b/` URLs with `buildUrl()` from `_build-url.mjs` — the same
  module `build-og.mjs` uses for the canonical it injects into that page. **A
  sitemap that disagreed with the canonical it points at is worse than no
  sitemap**: it hands a crawler two URLs for one document and then contradicts
  itself on arrival. Sharing the builder makes that impossible by construction
  rather than by review. `scripts/check-sitemap.mjs` asserts it on the wire.
- On any query failure it returns **503, never a partial sitemap**. A crawler
  keeps the last good one on a 5xx and acts on a 200 — and a 200 that has
  quietly dropped 231 product URLs is how a catalogue gets deindexed with
  nothing having failed.

Only approved builds appear (`status=eq.approved`, redundant with RLS on
purpose, same as `build-og.mjs`), and a profile is listed only if it has one —
a `/u/` page with nothing on it is a thin page.

`netlify/functions/build-og.mjs` is the fourth, and it holds to the same rule.
Two routes reach it — `/b/<slug>-<uuid>`, the share URL, and
`/gunforma-build-detail.html?id=<uuid>`, the legacy one, routed here so both
emit the same canonical instead of one declaring the id-less one until its
fetch lands. **An id that cannot be resolved gets a real 404 on both.**

It briefly had a split: hard 404 on `/b/…`, and a 200 serving the page
unadorned on the legacy URL so the client could render its own "Build not
found", on the reasoning that an old link should not start refusing. That was
wrong twice over. A 200 carrying "Build not found" is a soft 404 and Google
penalises it — and the branch never ran anyway, because it told the routes
apart with `x-nf-original-path`, which that route does not carry. See
**Netlify redirects** below; it is the second instance of the same class of
mistake.

## Netlify redirects

Rules are **first-match-wins**, and `netlify.toml` takes precedence over `_redirects`. A
broad rule shadows every more specific rule below it — so more specific `/parts/…` routes
must be ordered **above** the catch-all `/parts/*`.

Named `:placeholder` values are **not** substituted into a rewrite target's query string in
production, though `netlify dev` does substitute them — which hides the bug locally. Use
`:splat`, and have the function fall back to parsing the path and `x-nf-original-path`.

**A function receives the ORIGINAL request URL, not the rewrite target.**
Measured on a deploy preview, by having `build-og.mjs` report where it found
the id:

| request | `x-build-og-id-source` | `x-nf-original-path` |
|---|---|---|
| `/b/<slug>-<uuid>` | `path` | **absent** |
| `/gunforma-build-detail.html?id=<uuid>` | `query` | **absent** |

So `req.url` inside the function is what the reader asked for: `url.pathname`
is `/b/<slug>-<uuid>`, and `url.searchParams` is the reader's own query. **A
rewrite target does not need to carry the id** — the pre-rewrite path is
already there.

**`x-nf-original-path` was absent on both routes and has never been observed
set anywhere in this repo.** Anything reading it is insurance, not a source.
A function that branches on it to tell which rule routed a request will
silently take the same branch every time — `netlify dev` and any synthetic
`Request` supply whatever header the caller writes, so no local test can see
this. That shipped once: an `isShareRoute()` branch in `build-og.mjs` that
never executed, with two local suites green over it.

Corollary: **do not branch on which rule routed a request.** Derive what you
need from the request itself, or split into two functions.

And when behaviour depends on Netlify's plumbing, **make the plumbing
observable from outside.** `build-og.mjs` returns `x-build-og-id-source` and
`x-build-og-orig`, and `scripts/check-routes.mjs` prints them on every run, so
this table stays a measurement instead of reverting to a belief. Both of the
guesses it replaced — mine and a reviewer's — were wrong, and in different
ways.

That is twice now that a rewrite behaved differently in production than
locally, and twice that a green local test covered it. A rewrite's behaviour
is not verified until it has been observed on a deploy.

### The analytics tag: one module, sixteen literals, four deliberate absences

Cloudflare Web Analytics loads from `netlify/functions/_analytics.mjs`
(`ANALYTICS_SNIPPET`), placed immediately before `</body>`. Every function
that emits an HTML document imports it; the static pages carry it as a
literal, held byte-for-byte to the module by
`scripts/check-analytics-snippet.mjs`.

**It is absent on purpose from** `gunforma-admin-*.html`, `auth-callback.html`
and `gunforma-claim.html` (both receive an access token in the URL hash), and
`netlify/edge-functions/go.js`. **Do not add it to `build-og.mjs` or
`profile-og.mjs`'s main path:** they serve the static build and profile pages,
which already carry it, and a second copy counts every `/b/` and `/u/` view
twice. The guard fails on all of these. No host check is needed for deploy
previews: Cloudflare only accepts beacons from hostnames ending in the
registered site's.

### The nav exists in 15 places, three of which are functions

**Changing the site nav means changing fifteen files.** Every root HTML page
carries its own hardcoded copy — desktop `.nav-links` *and* the mobile
`.nav-menu`, so two links per page — and on top of those:

- `js/nav.js`, for the pages that mount it rather than hardcoding
- **`netlify/functions/product-page.mjs`** — server-renders `/parts/:category/:slug`
- **`netlify/functions/parts-index.mjs`** — server-renders `/parts`
- **`netlify/functions/guide-page.mjs`** — server-renders `/fit/p365/...`

The functions are the ones that get missed. They are Netlify functions, so they
do not turn up when you sweep `*.html`, and they cannot be checked with
`netlify dev` alone the way a static page can — but they render real nav to
real crawlers on two of the most crawled routes on the site.

Worked example: removing the Armory link (this repo's "park the Armory"
change). Every HTML page and `js/nav.js` came back clean while **production
`/parts` still served the link**, because those two functions hold their own
copy. The sweep that found it was `grep -rn` across `*.html`, `*.js` AND
`*.mjs` — not a sweep of the pages.

Verify a nav change by fetching the *served* HTML of a `/parts/...` URL on a
deploy preview, not by reading the page sources.

## Deploy previews and auth

`js/site-url.js` returns the preview origin on
`deploy-preview-<n>--velvety-stardust-4de48f.netlify.app`, so **Google sign-in works on
deploy previews**. The match is a strict anchored regex on purpose: a loose `.netlify.app`
test would also catch the production mirrors, which are deliberately redirected to the apex.

**Email/password sign-in does not work on previews.** Those paths send a Cloudflare
Turnstile token, and previews use the production site key whose hostname allowlist does not
cover preview URLs. Use Google sign-in to test signed-in features on a preview.

## Security conventions

**Every new public table needs RLS *and* an explicit revoke.** Supabase's default
ACL grants `anon` and `authenticated` full privileges on every table created in
`public`, so a table "protected by RLS alone" still has those grants sitting
underneath it. Enable RLS, then `revoke all ... from anon, authenticated`, and
add back only what a policy needs. The inverse also bites: a policy without a
matching table grant silently returns `permission denied`, which reads like a
policy bug and is not one. `price_history` and
`affiliate_links_is_primary_archive` are the worked examples.

**A `SECURITY DEFINER` function must identify the caller from the request JWT,
never from `current_user`.** Inside a `SECURITY DEFINER` function `current_user`
is the function's OWNER, not the caller — so a guard opening with
`if current_user in ('postgres','service_role') then return new; end if;` is
always true and the whole function becomes a no-op. That is exactly how
`prevent_role_self_escalation` silently stopped guarding anything, letting any
signed-in user set their own `role` to `admin`. Read the caller from
`current_setting('request.jwt.claims', true)::jsonb ->> 'role'`, which PostgREST
sets per request and which the definer context does not disturb. Pin
`search_path` on these functions too.

Guards of this shape cannot be verified by reading them — they look correct
either way. Prove them by simulating a caller (`set local role authenticated`
plus a real `sub` in `request.jwt.claims`) inside a rolled-back transaction.

### A policy's table reads are checked even when the policy doesn't apply

**Never read a table inline from an RLS policy.** Call a `SECURITY DEFINER`
function with a pinned `search_path` instead — which is exactly what
`is_admin()` is for.

Postgres permission-checks **every relation in a query plan**, at plan time,
not lazily per row. So a policy whose expression contains
`exists (select 1 from profiles ...)` needs the *caller* to hold `SELECT` on
`profiles` — and if they don't, the statement throws `42501` **even when the
policy's own predicate is false**. A leading `bucket_id = 'product-images'`
never gets the chance to short-circuit it.

The consequence is the part that surprises people: the policy is scoped to one
bucket, but the failure is not. The expression is attached to
`storage.objects`, so *every* insert/update/delete against that table is
planned with it, and a policy about one bucket breaks writes to all of them.
The same holds for any table with a policy of this shape — the blast radius is
the table the policy is on, not the rows the policy selects.

Worked example: `c9ce30f` ran `revoke select on public.profiles from
authenticated` (audit #5 step 2). Three `product-images` storage policies
still read `profiles` inline and were missed. That took down **build photo
uploads, avatar uploads and photo deletion** — none of which touch the
`product-images` bucket — from 2026-09-22 to 2026-09-25. Three days, and
silently: the only symptom was a generic "Upload failed" toast, with nothing
surfacing the `42501` or naming `profiles`. See
`supabase/fix_product_image_policies.sql`.

Sweep for the shape whenever a `SELECT` grant is revoked. Check **both**
`polqual` and `polwithcheck` — the insert policy that caused the outage above
had its inline read in `with check`, which a `using`-only sweep misses:

```sql
select polrelid::regclass as on_table, polname,
       coalesce(pg_get_expr(polqual, polrelid), '') as using_expr,
       coalesce(pg_get_expr(polwithcheck, polrelid), '') as check_expr
  from pg_policy
 where coalesce(pg_get_expr(polqual, polrelid), '') ilike '%from %'
    or coalesce(pg_get_expr(polwithcheck, polrelid), '') ilike '%from %';
```

### A revoke is not permanent — default privileges re-grant

**Revoking a grant fixes the tables that exist. `ALTER DEFAULT PRIVILEGES`
fixes the ones that don't yet.** Supabase's default ACL grants `anon` and
`authenticated` full privileges on every table created in `public`, so without
the second step the next `create table` re-grants exactly what was just
revoked and the schema drifts straight back.

```sql
revoke insert, update, delete, truncate on all tables in schema public from anon;

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon;
```

**And the second step does not always take.** `ALTER DEFAULT PRIVILEGES` can
only be run by the role owning the entry, or a superuser — and this project
has two entries for `public`, one owned by `postgres` and one by
`supabase_admin`. The `supabase_admin` one cannot be altered from the SQL
editor, so **a table created by Supabase's own tooling still arrives with
write grants for `anon`**. Tables we create are covered; tables created for us
are not, which is the case nobody is watching.

So treat it as drift to sweep for, not a thing that was fixed once:

```sql
select table_name, string_agg(privilege_type, ', ' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon'
   and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
 group by table_name order by table_name;
```

Zero rows is correct. Anything returned is a table carrying grants it should
not have — revoke them, then check whether its RLS policies were ever written,
because a table that slipped past this probably slipped past that too.

Worked example: `supabase/revoke_anon_write_grants.sql`. RLS was doing the
real work the whole time — no policy admitted `anon` for a write — but the
grants are what turn one missing or mis-scoped policy into a writable table.
`builds` carried a DELETE grant for `anon` with no anon-facing DELETE policy
behind it, found while adding the admin delete.

### service_role bypasses RLS. It does not bypass triggers.

**A trigger guard that identifies the caller with `auth.uid()` will reject
server-side code.** A `service_role` request has no end user, so `auth.uid()`
is NULL, so `is_admin()` — which resolves the caller that way — is false. The
guard then treats the most trusted caller in the system as an anonymous
stranger.

This is not the same trap as the `current_user` one above. That one is about a
`SECURITY DEFINER` function mistaking its owner for its caller, and it fails
*open*. This one fails *closed*, and it bites in a different place: the
statement gets past RLS exactly as expected, and then a BEFORE trigger nobody
was thinking about raises. Reaching for the service key is the standard answer
to "RLS is in my way" and it does work — which is what makes this expensive.
Every trigger on the table still runs, with the authority it always had.

Let service_role through explicitly, reading the role from the same claim
CLAUDE.md already uses elsewhere:

```sql
declare jwt_role text;
begin
  -- current_setting(..., true) yields NULL rather than raising when absent,
  -- and the cast is wrapped as well: a direct psql session has no
  -- request.jwt.claims, and the guard must degrade to "not service_role"
  -- there rather than erroring inside a trigger.
  begin
    jwt_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  exception when others then
    jwt_role := '';
  end;

  if <the thing being guarded>
     and jwt_role <> 'service_role'
     and not public.is_admin()
  then
    raise exception '...';
  end if;
```

Worked example: `prevent_build_photo_path_tampering()` blocked any change to
`build_photos.user_id` unless `is_admin()`. That silently stopped
launch-invite's photo ownership transfer, which runs as service role. The
Edge Function reported the failure as `{ success: true, warning: ... }` and
`scripts/launch-invites.js` printed a green tick and "0 failed" — so a
half-finished invite, which cannot be retried because the function refuses any
build that already has a `user_id`, looked like a clean launch. See
`supabase/fix_build_photo_tampering_guard.sql`.

Widening a guard for service_role must not widen it for anyone else, and that
is the half worth proving. As with the guards above, simulate both callers in
a rolled-back transaction: service_role should now pass, and a non-admin
acting on a row RLS *does* let them reach should still raise.

### A green result is not evidence the work happened

**Confirm the effect independently of the call that claimed it.** Several
operations in this stack succeed while doing nothing: they return no error,
they take the success branch, and they read as done. The three sections above
are each an instance — a revoke that holds until the next `create table`
silently re-grants it, and two guards that raise correctly at the database and
then reach a person as "Upload failed" or "0 failed". Note that second shape:
the database was loud both times. It went quiet on the way up.

Four from this repo, all of which shipped:

**An RLS-filtered `DELETE` matches zero rows and returns no error.** A builder
removing a photo that was not theirs to remove got a clean result and the
photo stayed. Nothing in the response distinguishes "deleted one row" from
"matched nothing". Verify with `.select('id')` and assert a row came back:

```js
const { data: deleted, error } = await sb.from('builds')
  .delete().eq('id', id).select('id');
if (error) …
if (!Array.isArray(deleted) || deleted.length !== 1) …   // RLS refused it
```

**A public read of a deleted storage object returns 200 from the CDN.** The
smoke test's first real run reported a failed delete — the object was gone,
`storage.objects` had no matching row, and re-fetching it still answered 200.
The re-read was asking the cache, not storage. Confirm a deletion through the
list endpoint, which reads object metadata from the database.

**The Storage list API returns only immediate children**, with folders as
entries whose `id` is `null`. `build-photos` keys are
`<uid>/<draftId>/<file>`, so a flat listing of the bucket root returns folders
and no files at all. A non-recursive backup reports *"0 objects backed up"*
and exits 0 — empty, and proud of it. `scripts/backup-storage.mjs` recurses
for exactly this reason, and `scripts/find-orphan-storage.mjs` inherits it.

**A `{ success: true, warning: … }` response took the success branch** in
`scripts/launch-invites.js`, which printed a green tick and *"0 failed"* over
a half-completed invite — and one that cannot be repaired by re-running,
because the function refuses any build that already has a `user_id`. Partial
success is not success, and a field nobody branches on is a field that does
not exist.

The through-line: **status codes, exit codes and log lines are claims. Row
counts, listings and independently-read state are facts.** Prefer the fact.
A call that reports on itself is a witness to its own case — ask the row
count, the listing, or the next query what actually happened.

## Retirement, not deletion

`affiliate_links` and `product_variants` are **never hard-deleted**. They carry
`retired_at timestamptz`; null means live.

Deleting used to destroy the record silently: a link's `price_history` went with
it, and a variant reached history through its links — two hops. So both edges
now refuse:

- `price_history.link_id → affiliate_links` is `ON DELETE RESTRICT`
- `affiliate_links.variant_id → product_variants` is `ON DELETE RESTRICT`

`variant_images` keeps `CASCADE` on purpose — images are derived, not a record.

`trg_retire_links_with_variant` retires a variant's links when the variant is
retired. It only ever **sets** `retired_at`, never clears it, and never
overwrites an earlier retirement date — un-retiring is deliberate and per row, so
a variant coming back does not silently revive listings retired for their own
reasons. Un-retiring a link is a plain `update ... set retired_at = null`.

**Every reader filters retired rows**, and the filter's shape matters:

- top-level (`.is('retired_at', null)`) drops the retired row itself
- embedded (`.is('affiliate_links.retired_at', null)`) keeps the parent and drops
  the retired child

So a product whose every listing is retired still renders — with no buy row —
rather than 404ing. The nightly sync skips retired links and **reports** the
count; they are also excluded from the coverage denominator, since a retired
link is not something the feed failed to account for.

Partial indexes `idx_affiliate_links_live` and `idx_product_variants_live` cover
the `where retired_at is null` reads.

## Prices we can stand behind

A price is **stale** when **any** of these holds, and stale prices are never
stated — the buy row reads **"Check price"** and the link still works:

- `last_checked` is null
- `op_last_matched_by` is null — **no feed has ever matched this link**
- `last_checked` is older than **7 days**

The middle clause is the load-bearing one. Checking only the date would let a
hand-typed `last_checked` pass as feed-verified, which is exactly the thing the
rule exists to catch: a price nobody has confirmed, wearing a fresh date.

Stale prices are also **excluded from price ranges** (so "From $X" is never
anchored on an unconfirmed number) and their JSON-LD offer ships **without**
`price`/`priceCurrency`, keeping its URL. Absent means "not stated", which is
true; a stale number asserts something we cannot support. Same reasoning as
omitting `availability` when stock is unknown.

A stale row does **not** fall back to MSRP. A listing last seen at $233 whose
list price is $365 would otherwise advertise $365. MSRP is still shown for a
variant with **no listing at all**, where it is the only number there is.

Comparison is in **whole UTC days**, matching the SQL form
`last_checked < current_date - 7`. Comparing elapsed milliseconds makes the
boundary drift with the time of day and disagree with any SQL that counts the
same set.

## Listing order

Listings sort by: **fresh-and-priced → in stock → price ascending → partner name
→ URL**.

The first key is what keeps the hero row honest: `listings[0]` is the listing
whose price is displayed, so the number shown and the button's destination are
the same row. They used to be different rows, because `is_primary` sorted first
while the displayed price came from the cheapest fresh listing.

The last two keys are not decoration. **PostgREST returns embedded rows in
arbitrary order**, so without a deterministic final key two equally-priced
listings swap places between requests — and the hero with them.

`affiliate_links.is_primary` **no longer exists**. It was a hand-set flag with no
writer in this repo, it caused the mismatch above, and the sort has a
deterministic tiebreak now instead. See `supabase/retire_is_primary.sql`; the
values are archived in `affiliate_links_is_primary_archive`.

## Build-time guards

`publish = "."` means there is no compile step, so the Netlify build command's
only job is to **refuse to ship a broken tree**. It runs
`bash scripts/check-all.sh`, and anything that exits non-zero fails the deploy.

Registered today:

| check | catches |
|---|---|
| `scripts/check-embeds.sh` | ambiguous PostgREST embeds (PGRST201) |
| `scripts/build-url.test.mjs` | `js/build-url.js` and `_build-url.mjs` drifting apart |
| `scripts/variant-label.test.mjs` | the variant-label copies drifting apart |
| `scripts/check-script-order.mjs` | a page using a shared global without loading its definition first |
| `scripts/check-snapshot-fields.mjs` | the `parts_snapshot` field whitelists drifting apart |
| `scripts/snapshot-roundtrip.test.mjs` | a builder hydration path (edit mode, Armory handoff) dropping a `parts_snapshot` field, so the next save deletes it — runs the page's own code, load → save, and requires byte-identical rows |
| `scripts/affiliate-render.test.mjs` | `js/affiliate.js` throwing on a render |
| `scripts/variant-picker.test.mjs` | the picker's colour step throwing on a render |
| `scripts/check-buy-links.mjs` | a buy link that skips the `/go/` click layer |
| `scripts/check-analytics-snippet.mjs` | a public page or HTML-emitting function without the Cloudflare Web Analytics tag, an excluded page with it, or a `/b/` or `/u/` page that renders it twice (double-counted) — discovers pages and functions rather than listing them, and renders `build-og.mjs` / `profile-og.mjs` against a stubbed fetch |
| `scripts/check-category-labels.mjs` | a `parts_snapshot` category with no label — `.part-type` is `text-transform: uppercase`, so it reaches a reader shouted ("OTHER_PARTS"); also a section declared with no group, which renders in no group heading and so nowhere at all |
| `scripts/check-canonical-coupling.mjs` | `build-og.mjs` replacing a literal the build page no longer contains |

This table is the full registry, not a sample. It read "Registered today:"
over three rows while `check-all.sh` ran ten, which is the documentation
version of the bug that file exists to prevent — so when you add a `check`
line there, add the row here in the same commit.

Every one of those guards a failure that **renders perfectly in a browser**.
That is the entry criterion: a guard here earns its place by catching
something nobody would otherwise see until a user mentioned it.

**Adding a check is one line.** Write `scripts/check-<thing>.{sh,mjs}` or
`scripts/<thing>.test.mjs`, then add a `check` line to the registry in
`check-all.sh`. Do not chain commands in `netlify.toml` — the second failure
would hide the third, and every new guard would mean editing deploy config.

**Forgetting that line fails the build.** `check-all.sh` ends with an audit
that finds every `check-*.{sh,mjs}` and `*.test.mjs` in `scripts/` and refuses
to pass if one is neither registered nor listed under `NOT_BUILD_CHECKS` with
a reason. That audit exists because the thing it prevents already happened:
three checks were written and one ran. `scripts/build-url.test.mjs` passed on
a laptop and nowhere else for a whole PR, and a test nothing runs is a comment.

`scripts/gtin-norm.test.mjs` is the one deliberate exclusion — it imports
`csv-parse`, which nothing installs during the site build, so it runs in
`.github/workflows/refresh-affiliate-prices.yml` before the nightly sync
instead, where its dependency exists.

**All checks run, every time.** No early exit: one deploy surfaces every
problem rather than the first.

**A guard nobody has watched fail is not a guard.** Each of these was proved
by breaking the thing it protects and confirming a non-zero exit — see the PR
that introduced the runner.

### And one that cannot run at build time

`scripts/check-routes.mjs` asserts routing behaviour against a **real deployed
origin**: status codes, one canonical, the two build URL shapes agreeing, the
bare legacy path still served as a file, and a hard 404 on every unresolvable
id. It is listed under `NOT_BUILD_CHECKS` because the site is not serving
during its own build, and fetching the previous deploy would grade the wrong
artifact. `.github/workflows/check-routes.yml` runs it on a schedule against
production and on demand against a deploy-preview URL.

It exists because the registry closes a different gap than the one that bit.
The registry proves a check **exists and runs**. Nothing proved a code path was
**reachable** — and a whole branch of `build-og.mjs` shipped having never
executed, with two local suites green over it. A synthetic `Request` cannot
catch that by construction: the thing under test is what Netlify puts on the
wire. Only a request Netlify actually routed can answer it.

## Verifying changes

Anything that touches the database must be verified **signed in, on the deploy preview**,
before merging. RLS means a query can behave completely differently for an anonymous
visitor than for its owner, and an anon-only smoke test proves very little.

Behaviour also differs between `netlify dev` and production (see the redirect note above),
so a local pass is not sufficient evidence on its own.

## SEO invariants

Canonical tags, `og:url`, `sitemap.xml`, `robots.txt` and JSON-LD always use
`https://gunforma.com`, never the current origin. `sitemap.xml` is generated
by `netlify/functions/sitemap.mjs` — the static file is **deleted**, not left
in place, so nothing can shadow the route and keep serving a stale list that
looks perfectly healthy. The site is reachable at several
`*.netlify.app` hostnames; `netlify/edge-functions/canonical-host.js` redirects the
production mirrors to the apex and marks previews `noindex`. Emitting a non-apex URL in any
of those places undoes that.

Auth redirects are the one exception — those correctly follow the current origin via
`js/site-url.js`.

**A share card's layout is chosen from the image's actual pixels, not from
`twitter:card`.** Facebook, iMessage, Slack and LinkedIn give the full-width
card to roughly 1.91:1 at 600px or wider, and a ~160px thumbnail-with-text to
anything portrait or square. `twitter:card=summary_large_image` is
Twitter-only and does not move them. Build photos come off phones and are
mostly portrait, so `build-og.mjs` serves the hero through the Netlify Image
CDN at 1200x900 (`ogTransform()`), declares `og:image:width`/`height` from the
same constants, and never hands a scraper the raw object URL. The
`[images]` allowlist in `netlify.toml` is scoped to the build-photos object
path, not the Supabase host.

Two things about that are easy to get wrong later. Declaring a size the bytes
do not have is worse than declaring nothing — `scripts/check-og-image.mjs`
decodes the returned image and checks, rather than trusting the tag. And
`og:image` stays an absolute apex URL even on a preview, so a preview's own
transform is only exercised by swapping the origin, which that script does.
Testing through Facebook's Sharing Debugger instead will tell you about its
cache for days after you have fixed something.

## Adding an affiliate link (CSV import)

New `affiliate_links` rows are added **by hand**, through the Supabase dashboard's
CSV import. Nothing in this repo inserts into that table — the nightly sync only
PATCHes existing rows, and no page writes it. So the import template is the one
place a new link's columns are decided.

**The template's columns, in order:**

| Column | | Notes |
|---|---|---|
| `variant_id` | **required** | uuid, FK to `product_variants.id`. `ON DELETE RESTRICT`. |
| `partner_id` | strongly recommended | uuid, FK to `partners.id`. Nullable, but a link with no partner has no retailer name and the sync cannot route it — the feed is matched **per partner**. |
| `url` | **required** | the retailer's own product URL. Also what the sync's URL tier matches on. |
| `affiliate_url` | optional | the tracked link. Readers prefer it and fall back to `url`, so a row with only `url` earns no commission. |
| `notes` | optional | free text, not displayed. |

**Leave these out — the sync owns them.** A hand-typed value here is worse than
an empty one, because `op_last_matched_by` being null is exactly how the stale
guard knows a price was never feed-verified. Typing a `last_checked` does not
make a price fresh; it only makes it look fresh:

- `street_price`, `in_stock`, `last_checked`
- `op_last_matched_by` — written by the sync, never by hand

**`op_mpn` / `op_gtin` / `op_merchant_product_id` are the exception.** Fill one
in when you already know the identifier and want the link pinned to that exact
product from the first run; otherwise leave them empty and the sync fills them.
The sync **never overwrites** one that is already set — a disagreement is
withheld to `sync_drift_review` instead. To re-point a link, clear the stored
identifier and let the next run refill it.

**Never in the template:** `id`, `created_at`, `updated_at` (defaulted),
`retired_at` (retirement is deliberate, not an import), and `is_primary`, which
**no longer exists** — see `supabase/retire_is_primary.sql`. An import carrying
an `is_primary` column now fails.

A new row therefore looks like: a variant, a partner, a URL, its tracked URL,
and nothing else. It will show as "Check price" until the first sync matches it.

## Affiliate price sync

`scripts/refresh-affiliate-prices.mjs` runs nightly from
`.github/workflows/refresh-affiliate-prices.yml` and updates `street_price`,
`in_stock`, `last_checked` and four `op_*` audit columns on `affiliate_links`.

**It is multi-merchant.** One combined Awin feed (`AWIN_FEED_URL_V2`) carries
every joined merchant, and rows are routed by the feed's `merchant_id` to
`partners.awin_merchant_id`. Per-partner settings — the URL host a link must be
on, and the match-rate floor — live in `PARTNER_CONFIG` in that script. Adding a
merchant means adding its `awin_merchant_id` to `partners` **and** an entry to
`PARTNER_CONFIG`; a partner missing from either side is skipped with a warning.
There is no hardcoded partner name or host anywhere in the script — reintroducing
one silently discards every other merchant's rows.

**Two safety limits, guarding different failures.** The **floor** is a circuit
breaker on *coverage* — `(matched + withheld for review) / rows` — and catches a
feed that has broken, changed shape, or dropped a catalogue, i.e. links no
longer found at all. A link withheld for review *was* found, so it counts toward
coverage; folding deliberate holds into that number would make a working guard
fire for the wrong reason. The **withheld ceiling** is the opposite check: a cap
on how many links are being held back, because coverage can look perfect while
the matching quietly rots — every link found, every one contested. Either limit
**skips that partner** (the others still write) and exits non-zero so the
Actions job goes red. Both live in `PARTNER_CONFIG` with the measured numbers.

**GTINs are not always bare digits.** Olight ships them as `"<EAN-13> <digits>"`,
e.g. `6978095650162 78`. `gtinNorm` therefore splits on whitespace and keeps the
first token before stripping non-digits and leading zeros. Normalising across
the whole string concatenates them into a non-GTIN that matches nothing, which
silently cost every Olight GTIN match. `scripts/gtin-norm.test.mjs` pins this;
`node --test` runs in the workflow before the sync.

### The sync never overwrites an identifier

`op_mpn`, `op_gtin` and `op_merchant_product_id` are what pin a link to one
specific product. The sync may **fill** one that is null; it must **never**
overwrite one that is already set.

This is not a style preference. Tiers T1/T2 match on the stored identifier, so
overwriting it re-points the link at a different product *and* makes every later
run re-confirm the new, wrong mapping. Earlier versions wrote the feed's values
unconditionally and merely logged the disagreement as a "drift warning" — that
is how link `269535fb` ended up on the green Osight SE variant while carrying
the red product's MPN, price and URL.

Two things are withheld rather than written, both to `sync_drift_review`:

- **identifier drift** — the feed contradicts a stored identifier. The price and
  stock are withheld too, because a contradicted identifier makes the whole
  match suspect.
- **candidate conflict** — several feed rows resolve to the same link. The old
  code let whichever row came last in the file win silently.

Conflicts are common because **MPNs are not unique across brands** in the
OpticsPlanet feed: `69408` is both a Primos choke tube and a Streamlight
TLR-7 X, `69500` is both a Redding die kit and a TLR-1 HL-X. T1 matches on MPN
alone, so without this guard a choke tube can capture a weapon-light link.

To re-point a link deliberately, clear the stored identifier and let the next
run refill it — do not teach the sync to overwrite.

### price_history

`price_history` is written by a trigger on `affiliate_links`, not by application
code:

- **INSERT** on `affiliate_links` always appends a baseline row (`old_price` null).
- **UPDATE** appends only when `street_price` or `in_stock` actually changed.
  Touching `last_checked` or the `op_*` columns alone writes nothing.

So a bulk edit across many links produces a matching spike in `price_history`.
That is expected, but it means a careless mass update is permanently visible in
the price chart — check how many rows an update will touch before running it.

`price_history` is **private by design**: RLS is enabled, it has **no policies
and no grants at all**. Do not "fix" that by adding a public read policy. Note
that a policy without a matching table grant silently returns `permission
denied` — and conversely, Supabase's default ACL hands `anon` and
`authenticated` full privileges on every new public table, so a table protected
by RLS alone still has those grants sitting underneath it. `price_history` has
an explicit revoke for exactly that reason.

## Duplicated logic to keep in sync

Three PLACES carry their own copy of the buy-row logic — the variant-label
axes, the stale-price rule, and the sort. Change all three, or the same
listing reads differently depending on which page you are on:

- `js/affiliate.js` — the browser module. `gunforma-parts-catalog.html` and
  `gunforma-armory.html` render through it and hold no copy of their own.
- `netlify/functions/_listing-rules.mjs` — the ONE server copy, imported by
  `product-page.mjs` and `guide-page.mjs` (both plain ESM functions, so
  there is no bundler boundary between them and no excuse for two copies —
  same reasoning as `_variant-label.mjs`). Dependency-free by design, so it
  cannot import the browser module. `scripts/listing-rules.test.mjs` pins
  its behaviour to the documented rules on every deploy.
- `gunforma-build-detail.html` — inline copy for a build's parts list

The category → URL-segment mapping is duplicated for the same reason:
`netlify/functions/_category-meta.mjs` (shared by `product-page.mjs` and
`parts-index.mjs`) and `js/category-map.js` (the browser mirror, loaded as a
plain `<script>` global). A category that exists in only one of them ships links
that 404.

The axis columns they read (`reticle`, `reticle_color`, `color`, `optic_cut`,
`bundle`, `clamp`, `manual_safety_variant`) feed **labels only**. Nothing filters
on them, and the product page's spec table reads `optic_specs` instead — so a
wrong axis value shows up as a wrong label next to the buy button while the spec
table underneath still reads correctly. That split is what hid 16 Sig Sauer
Romeo variants whose `reticle` was swapped between the 3 MOA and 6 MOA rows.

`variant_label` overrides the computed label verbatim when non-empty.

### A build's URL is built in two places, on purpose

`/b/:id` is really `/b/<name-slug>-<uuid>`. **The uuid at the end is what
resolves**; the slug is decoration, so renaming a build never breaks a link
and two builds with the same name never collide. `/b/<uuid>` with no slug
keeps working forever — plenty of those are already out there.

The slug function lives in two files, the same split and for the same reason
as `js/category-map.js` ↔ `netlify/functions/_category-meta.mjs`:

- `js/build-url.js` — the browser copy, a plain `<script>` global. Loaded by
  every page that renders a build card or sends a reader to a build.
- `netlify/functions/_build-url.mjs` — the server copy, ESM, imported by
  `build-og.mjs`.

**Do not inline the slug logic anywhere else.** Call `buildPath(id, name)`
for an href and `buildUrl(id, name)` for an absolute URL.

**This pair is stricter than the category one.** A category out of sync ships
a link that 404s, and somebody notices. This pair produces the **canonical
tag** — `build-og.mjs` emits it server-side, and the page re-emits it from the
browser copy once the build data loads. If the two disagree by one character
the build declares two different canonical URLs over one page load, renders
perfectly, and quietly re-creates the duplicate-URL problem `/b/` exists to
fix. `scripts/build-url.test.mjs` runs both copies over the same inputs and
fails if they differ. It runs on every deploy — see **Build-time guards**.

Three things about that canonical are load-bearing:

- **Extraction takes the LAST 8-4-4-4-12 group**, never the whole path
  segment. Every slug contains hyphens, some contain hex, and a build can be
  named after a uuid — anchoring at the end is what keeps all of those from
  being mistaken for the id.
- **`gunforma-build-detail.html` writes nothing at parse time.** It has only
  the id then, and the slug needs the name. It must not emit `/b/<uuid>` as a
  placeholder: that is a second, different canonical for the same content. A
  canonical that is briefly absent is one a crawler falls back from; a
  canonical that is wrong is one it believes. `setCanonical()` runs from
  `renderBuild()`.
- **The static `<link rel="canonical">` on line 13 of that page is matched
  byte for byte** by `build-og.mjs`, which strips it before injecting its
  own. Change the line without changing the replace and `/b/` pages ship two
  canonicals and look completely normal in a browser.

### Neither is the photo uploader

`js/photos.js` owns the build-photo uploader — the four slots, the
validate → redact → normalize → upload pipeline, and the full-size preview
overlay. It injects its own CSS, its own grid markup and its own overlay
markup, and it is loaded by the same two pages as the redact modal.

A page mounts it once, after its auth gate has resolved:

```js
PhotoUploader.init({
  mount:    '#photo-grid-mount',   // grid, messages and file input render here
  photos:   () => state.photos,    // the page still owns the store
  ownerId:  () => currentUser.id,  // currentAdmin.id on the admin page
  draftId:  () => draftId,         // storage folder for this draft
  onChange: renderSidebar,
});
```

**Every one of those is a function, and that is not style.** A captured
value is wrong for three of them: `gunforma-admin-post.html`'s
`postAnother()` used to replace `state.photos` wholesale, `draftId` is
reassigned when `gunforma-post-build.html` loads a build to edit and again
by `postAnother()`, and `ownerId` does not exist until the auth gate
resolves. `PhotoUploader.reset()` exists for the same reason — it empties
the slots **in place** and revokes the object URLs, because `photoCount()`
and `submitBuild()` on both pages read `state.photos` directly and a fresh
object would leave them reading a detached one.

This is the third thing that had to be extracted rather than copied, and
the uploader is the worked example of what the copy costs. Thirteen
functions and about sixty CSS rules lived in both pages, and the admin
copy fell behind twice:

- it had no redact gate at all until `#62`, so there was no way to blur a
  serial when posting on someone else's behalf
- it then missed all of `#65` — the preview overlay, square slots, the
  fixed action strip, keyboard-reachable slots, and reading the result of
  a storage delete — so an admin could blur a serial and had no way to
  confirm the blur had landed

Both gaps are the same shape: the page nobody was looking at kept the old
behaviour, and nothing failed. Meanwhile `js/redact.js`, already shared,
delivered the iOS pinch-zoom fix to both pages without anyone having to
remember the second one.

### The redact modal is not on that list, and must not join it

The pre-upload photo redaction modal — markup, CSS and JS — lives in
**`js/redact.js` and nowhere else**. It is loaded as a plain `<script src>`
global by the two pages that upload a build photo:

- `gunforma-post-build.html` — a builder posting their own build
- `gunforma-admin-post.html` — an admin posting on a builder's behalf

The module injects its own markup into `document.body` and its own CSS into
`document.head` on the first call, so a page adds the script tag and nothing
else. The whole public surface is one function:

```js
const redactedFile = await openRedactModal(file);   // File | null
if (!redactedFile) return;                          // null = user cancelled
file = redactedFile;
```

Call it **after the type and size checks and before `normalizeImage`**, so
nothing unredacted ever reaches normalize, upload or preview. Both pages call
it at that exact point; their `processFile` bodies are otherwise identical
apart from `currentUser` vs `currentAdmin`.

Do not inline any part of it into a page, and do not copy it to a third
upload path — add the script tag and the four lines above. The admin page is
the worked example of what the copy would have cost: it shipped running the
same validate → normalize → upload pipeline with no redaction gate at all,
so there was no way to blur a serial when posting on someone else's
behalf — the case where it matters most, because the photo came from the
builder and the admin may never have looked closely. The fix was to extract
the one copy, not to grow a second.

### Nor is the part picker

`js/part-picker.js` owns the picker's **card layer**: `partImageHtml`,
`partCardHtml`, `selectedPartThumbHtml`, `selectedPartHtml`,
`selectedPartsHtml`, `groupHeadHtml`, `findCatalogItem`, `scrollToCategory`
and `closePickerAfterAdd`, plus the ~100 CSS rules they render into. It
injects its own CSS into `<head>` on init and is loaded by the same two pages
as the uploader and the redact modal.

`groupHeadHtml(g)` draws one of the four stage headings, and **it counts
sections, not parts** — three optics light one segment of Core build, because
a parts count would read as progress for buying the same thing twice. It is
also the shortest-lived duplication in this file's history: it shipped as a
`categoryGroupHeadHtml` in both pages in `#114` and was extracted in the next
PR, which is the right lag for a repo with this record.

```js
PartPicker.init({
  catalog:  () => CATALOG,      // reassigned wholesale by loadCatalog()
  state:    () => state,        // the page still owns the store
  render:   renderParts,
  onChange: renderSidebar,      // optional
});
```

Functions again, and for a live reason this time: `loadCatalog()` does
`CATALOG = grouped` and the admin page's `postAnother()` does `CATALOG = {}`,
so a captured reference keeps serving the previous platform's parts into the
next build. Mount it **before the first `renderParts()`** — it injects the
CSS those cards are styled by. Unlike `PhotoUploader` it needs nothing from
the auth gate, so it does not wait for one.

**The page must define two globals**, `addCatalogPart(catKey, itemId)` and
`removePart(uid)`: the emitted markup names them in inline `onclick`
attributes. `init()` throws if either is missing, because the alternative is
a card that renders perfectly and does nothing when clicked.

This is the fourth thing extracted rather than copied, and it is the one that
proves the rule costs something every time it is ignored. `#81` fixed three
defects in `gunforma-post-build.html` — the picker not closing on a pick,
product photos cropped to a 100px letterbox, added parts as text chips with
no photo to check them against. The byte-identical code in
`gunforma-admin-post.html` kept all three, plus the inline
`style="object-fit:cover"` that made the CSS fix a no-op. Same shape as the
uploader and the redact modal before it: the page nobody is looking at keeps
the old behaviour, and nothing fails.

**What is still duplicated**, and is the obvious next extraction — these live
in both pages and must be changed in both: `renderParts`,
`buildCategoryBlock`, `categoryPickerState`, `customFormFieldsHtml`,
`filterCards`, `togglePicker`, `toggleCustomForm`, `addCatalogPart`,
`addCustomPart`, `removePart` and `loadCatalog`.

The `CATEGORIES` list is **no longer on that list** — it is
`js/build-categories.js` now. See below.

**`gunforma-armory.html` is not a third copy and must not be made one.** It
renders a different card that happens to share class names — `.part-card`,
`.part-card-body`, `.part-card-brand`, `.part-card-name`, `.part-card-price`
— with its own values, its own `.part-card-photo` slot, favourites, affiliate
actions and a stretched-link overlay. It does not load `js/part-picker.js`,
and it should not: the module's injected CSS would land on those shared
selectors and restyle the armory grid. Extracting the armory card is a
separate question from extracting the picker.

### Nor is the category list — and that one has three pages, not two

`js/build-categories.js` owns the parts taxonomy: which sections exist, what
order they render in, which of the four group headings each sits under, and
what label a stored `parts_snapshot` value renders as. It is a plain
`<script src>` global (`window.BuildCategories`), loaded by **three** pages —
the two builder pages above, plus `gunforma-build-detail.html`, which has no
picker but renders the same sections on a published build.

```js
const CATEGORIES         = window.BuildCategories.CATEGORIES;         // render order
const GROUPED_CATEGORIES = window.BuildCategories.GROUPED_CATEGORIES; // + group headings
window.BuildCategories.categoryLabel(key);   // never returns a raw key
window.BuildCategories.sectionKeyFor(raw);   // stored value -> section, or null
```

**Everything is derived from `CATEGORIES`.** Labels, the
`products.category` -> section reverse map and the grouped order are computed,
not hand-listed, so a new section declares its facts once. The only
hand-written map is `LEGACY_CATEGORY_LABELS`, for keys no longer offered that
still sit in stored snapshots (`other_parts`, `sights`).

**The admin page is the worked example again, and it had drifted three ways:**
no Magazine Release section, `magwells` with its `dbCategory` hint dropped so
six seeded P365 products were unreachable from it, and a Sights section the
public page does not have. Nothing failed — same shape as the photo uploader,
the redact modal and the part picker before it.

**The two vocabularies are the thing to understand.** `parts_snapshot` holds
section keys from the builder pages (`optics`) *and* raw `products.category`
values from Armory-saved parts (`optic`), and `barrel`/`compensator` are two
values for one section. `sectionKeyFor()` collapses all of that, which is what
stops one build opening two sections with the same heading. The builder pages
send an unrecognised value to `misc` so the part stays reachable; the published
build keeps the raw key as its own trailing section so nothing is silently
relabelled.

**`renderPartCard` takes a part's ORIGINAL index in `parts_snapshot`** and
looks up its edit history by it. The published build reorders **sections**
only — never the indexes.

**A section with no group renders nowhere.** The builder pages render group by
group, so a `group:` value that matches no entry in `CATEGORY_GROUPS` drops
every section in it off the page while the page still looks perfectly normal.
`scripts/check-category-labels.mjs` evaluates this module and refuses that,
along with an unlabelled key and a group order that disagrees with
`CATEGORIES` order — which would make the builder and the published build list
the same sections differently.

**What is NOT here, on purpose:** `gunforma-parts-catalog.html` and
`gunforma-armory.html` keep their own `CATEGORY_LABELS`. Those are catalog
labels keyed by `products.category` alone ("Frame Modules", "Barrels"), a
different vocabulary from a build's sections ("Grip Modules",
"Barrels & Compensators"), and the `/parts/` URL segments in
`js/category-map.js` are a third. Do not merge them.

### Auth emails live in the dashboard, not in this repo

The Supabase Auth email templates are configured in the Supabase dashboard
(Authentication -> Email Templates). **Editing the files below changes nothing
until someone pastes them in.** They are versioned mirrors, so the templates are
reviewable and diffable in git — they are not the thing that sends.

| Template | Fired by | Repo mirror |
|---|---|---|
| Confirm signup | `signUp()` and `resend({type:'signup'})` in `gunforma-signup.html` | `scripts/confirm-signup-email-template.html` |
| Reset Password | `resetPasswordForEmail()` in `gunforma-signin.html` | `scripts/reset-password-email-template.html` |
| Invite user | `admin.inviteUserByEmail()` in BOTH `supabase/functions/launch-invite` and `supabase/functions/invite-builder` | `scripts/invite-email-template.html` |

Magic Link, Change Email Address and Reauthentication are unreachable — nothing
calls `updateUser`, `signInWithOtp` or `verifyOtp`. If an email-change feature is
ever added to the profile page, that template goes live as Supabase's stock
default: no logo, no brand, no warning.

This mirror drifted three times in a single day. Both directions fail silently:
editing the repo file sends nothing, and editing the dashboard leaves the repo
describing an email that does not exist. `check-all.sh` does not inspect these
files and cannot — the live template is readable only through the Management
API. The only guard is changing both in the same sitting.

Two things inside those templates are load-bearing and look like decoration:

- The logo is `assets/email-logo.png`, which **bakes the `#0e0f11` background
  into the image**. `assets/gunforma-logo.png` is light-on-transparent — its
  "GUN" half is cream `#f2efe8` — and vanishes on a white panel. Do not
  substitute it, and do not regenerate it at a different size.
- The hidden `<div>` on line 1 of each template is the **preheader**: the grey
  preview text beside the subject in an inbox list. It must EXTEND the subject,
  never repeat it. The trailing run of `&zwnj;&nbsp;` fills the client's preview
  buffer so Gmail stops scraping the logo alt text and headline in behind it.

**Sending and receiving are separate systems and fail independently.** Outbound
is Resend as `build@gunforma.com`, which sends whether or not anything receives
there. Inbound is Cloudflare Email Routing, which routes **per address** and
drops mail to any address with no rule. `contact@gunforma.com` is published six
times across `privacy-policy.html`, `terms-of-service.html` and
`gunforma-legal.html` and had no routing rule at all until 2026-09-30 — every
message ever sent to it was discarded, with nothing anywhere reporting a
failure. A catch-all is now enabled. There is no dashboard that says "0 emails
received"; the only way this surfaces is someone asking why you never replied.

## Replacing the builder's contents: identity, and asking first

**Any action that REPLACES the builder's contents, or CHANGES which row it
writes to, must do two things:**

- **(a) clear or deliberately adopt the identity** — `STATE.buildId`,
  `STATE.buildName`, `nameTouched`, `savedSignature`, and the `?build=`
  query param. Not one of them: all five. They are what decides whether the
  next save INSERTs a new row or UPDATEs an existing one, and which one.
- **(b) ask before discarding unsaved work — BEFORE mutating anything,
  never after.** Put the prompt after the cheap validity checks so it never
  asks and then fails, and before the first assignment so declining leaves
  state byte-identical.

**Why this needs writing down: a wrong-row UPDATE is silent.** It returns no
error and touches no guard. `.eq('status', 'draft')` does not save you — it
passes, because the row it is about to corrupt really is a draft. The only
symptom `remixGuide()` produced was a header showing one build's name over
another build's parts, and nobody was looking at that.

Three instances turned up in one session, and the third is the corollary:
**after the mutation, show what happened.** The picker re-rendered a grid of
forty cards with no visible confirmation that the add had landed
(`#81`/`#83`) — no wrong row, no lost work, but the same class of silence.

### The audit, and why "keeps buildId" is not the test

Every wholesale `STATE.parts` reassignment in `gunforma-armory.html`:

| function | identity handling | verdict |
|---|---|---|
| `resetBuilderState()` | clears buildId, buildName, nameTouched, savedSignature; caller scrubs the URL | correct — a new build |
| `loadBuildById()` | sets buildId + buildName from the row, `nameTouched = false`, `markClean()` | correct — deliberately **adopts** an identity |
| `selectPlatform()` | **keeps** buildId | correct — see below |
| `removePartByRefId()` / `removePartByUid()` | single-part filters | not identity-changing |
| `remixGuide()` | none at all | **the bug** |

`selectPlatform()` and `remixGuide()` both kept `buildId`, and one was right.
Changing the pistol **is** an edit of the draft you have open, so its save
belongs on that row. A remix is a **different build**, so its save does not —
and leaving `buildId` set made "Remix" overwrite whatever draft happened to
be open, replacing its `parts_snapshot` *and* its `platform_id`.

So the rule is about **intent**, not a mechanical "does it clear buildId".
Ask: *after this action, is the thing on screen the same build the user was
editing?* If yes, keep the identity. If no, clear it. Either way, decide on
purpose and say which in a comment — the two cases look identical in a diff.

### Only ask when something is actually lost

Both halves matter. `selectPlatform()` silently dropped every catalog part on
a pistol switch; it now confirms — but **only when the count is non-zero**,
and it names it: *"Switching to SIG P320 will remove 3 parts that don't fit
it."* The pistol row is two buttons side by side, so an unconditional confirm
would fire on nearly every click and train people to dismiss it, at which
point it protects nothing.

**Do not reach for `confirmDiscardIfDirty()` here.** Its condition is "the
build is dirty", and that is not the same question. A freshly loaded,
perfectly clean draft still loses every catalog part to a platform switch,
and `isDirty()` is false for it — so the dirty check waves through exactly
the case where *saved* work is on the line. Key the prompt to what would
actually be destroyed.

## The Armory is parked — do not restore it by accident

`gunforma-armory.html` is **deliberately hidden and deliberately still in the
repo**. It has no nav link on any page, it is not in `sitemap.mjs`, and it
carries `<meta name="robots" content="noindex">`. It still works, and it still
answers on its own URL — no 404, no redirect, no auth gate.

**None of that is a bug.** A future session finding a working page with no way
to reach it will want to helpfully wire the nav back up. Don't.

**Why it is parked:** the page works — `#83`–`#86` fixed its picker, save,
remix and photos — but it is the wrong object. It produces *draft builds*,
which is what `gunforma-post-build.html` already owns. It is coming back
rebuilt as **Loadouts**: a distinct object with its own `loadouts` table,
rather than another producer of rows in `builds`. That is the whole reason it
is parked — not that it is broken, but that "a saved parts list" and "a posted
build" are the same row today and should not be.

**`claude/loadouts-spec.md` is the canonical spec for that rebuild** — the
taxonomy, the schema decision, the collage design, the five settled decisions
and the build sequencing. Read it before starting any Loadouts work, and keep
it current: a mirror exists outside the repo that agents cannot read, so this
copy is the one that has to be right.

**What went with it, on purpose:**

- The **four published guides** — Sig P365 Concealed Carry / Home Defense /
  Range & Competition / Duty — go dark, because the Armory's Guides tab is
  their only surface. **The rows, the `guides` table and the rendering code
  are all intact.** Verified at the time: `gunforma-armory.html` holds the
  only `from('guides')` query anywhere — no other page, no Netlify function,
  no script, and nothing in `sitemap.xml` or `_redirects`. Nothing has an FK
  to `guides` and no view is built on it. Those titles become content pieces
  later.
- **Add to Armory build** on the parts-catalog detail panel — element, handler
  and `.detail-btn.armory` CSS all removed. A control that opens nothing is
  worse than no control.
- The profile's **parts-only-draft** route (`routeForBuild()`), which sent
  those drafts to the Armory. Every draft now goes to post-build's edit mode,
  which handles one with no photos or description. `isPartsOnlyDraft()` is
  kept, uncalled, so restoring that branch is a revert and not a rewrite.

**What is untouched, because it is how this comes back:** post-build's
`ARMORY_POST_KEY` handshake, the Armory's own `?prefill=` and `?build=`
handling, the `guides` table and its four rows, everything under
`part_favorites`, and `/gunforma-armory.html` in `auth-callback.html`'s
`ALLOWED_NEXT` — that last one is a redirect allowlist, not a nav surface, and
dropping it would break sign-in return for anyone who reaches the parked page
directly.

**Favourites are NOT part of this.** `part_favorites` is a standalone
watchlist that will back price-drop emails. The heart lives on
`gunforma-parts-catalog.html` (the only write path), the catalog has a
"My Favorites" tab, and the profile has a "Favorite parts" tab — all three
read the table directly and none of them needs the Armory. The Armory only
ever *read* favourites, to sort them first in its picker. Leave all of it
alone.

**The whole change is one commit** so that restoring it is one `git revert`.
Keep it that way: if you park or unpark something else here, don't spread it
across commits.
