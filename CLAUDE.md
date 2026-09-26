# Gunforma — working notes for Claude Code

Technical context for this repo. Read before making changes.

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

The check covers both directions and runs as the Netlify build command.

Embeds from `affiliate_links` and `variant_images` each have exactly one FK to
`product_variants`, so their bare embeds are correct — do not "fix" those.
Likewise a bare `products(...)` embed is fine from single-FK parents such as
`part_favorites` and `product_platforms`. Several spec tables
(`barrel_specs`, `optic_specs`, `slide_specs`, `trigger_specs` and others) carry
two or more FKs to `products` and would be ambiguous too — nothing embeds
through them today, so the check does not flag them.

## Server-rendered pages

Crawlers do not run JS, so anything that needs real content in the HTML is server-rendered
by a Netlify function. Two working precedents to copy from:

- `netlify/functions/profile-og.mjs` — `/u/:username`, injects OG meta into the existing
  profile page.
- `netlify/functions/product-page.mjs` — `/parts/:category/:slug`, renders a full product
  page with JSON-LD.

Both are dependency-free (plain `fetch` against PostgREST, no `supabase-js`), use the anon
key only, and return a real 404 for unknown slugs rather than a soft 404.

## Netlify redirects

Rules are **first-match-wins**, and `netlify.toml` takes precedence over `_redirects`. A
broad rule shadows every more specific rule below it — so more specific `/parts/…` routes
must be ordered **above** the catch-all `/parts/*`.

Named `:placeholder` values are **not** substituted into a rewrite target's query string in
production, though `netlify dev` does substitute them — which hides the bug locally. Use
`:splat`, and have the function fall back to parsing the path and `x-nf-original-path`.

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

## Verifying changes

Anything that touches the database must be verified **signed in, on the deploy preview**,
before merging. RLS means a query can behave completely differently for an anonymous
visitor than for its owner, and an anon-only smoke test proves very little.

Behaviour also differs between `netlify dev` and production (see the redirect note above),
so a local pass is not sufficient evidence on its own.

## SEO invariants

Canonical tags, `og:url`, `sitemap.xml`, `robots.txt` and JSON-LD always use
`https://gunforma.com`, never the current origin. The site is reachable at several
`*.netlify.app` hostnames; `netlify/edge-functions/canonical-host.js` redirects the
production mirrors to the apex and marks previews `noindex`. Emitting a non-apex URL in any
of those places undoes that.

Auth redirects are the one exception — those correctly follow the current origin via
`js/site-url.js`.

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

Three files carry their own copy of the buy-row logic — the variant-label axes,
the stale-price rule, and the sort. Change all three, or the same listing reads
differently depending on which page you are on:

- `js/affiliate.js` — the browser module. `gunforma-parts-catalog.html` and
  `gunforma-armory.html` render through it and hold no copy of their own.
- `netlify/functions/product-page.mjs` — the server-rendered `/parts/:category/:slug`
  page. Dependency-free by design, so it cannot import the browser module.
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
