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
- **One session per worktree. Never touch a worktree another session
  created.** Before writing, check no other claude process has it as its
  cwd; if one does, stop and report. `git worktree list` names every
  worktree, and `lsof -a -p <pid> -d cwd -Fn` on each `claude` process
  (`pgrep -f claude`) names where it is working. A worktree is a session's
  whole state — its branch, its uncommitted edits, its half-run checks —
  and two sessions in one are two writers on one file with nothing to
  tell either.
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

## Schema changes go through `supabase/migrations/`

**`MIGRATIONS.md` is the rule.** A database change is a file in
`supabase/migrations/`, tested on an empty database (`supabase db reset`
locally, or the `check-migrations` workflow on the PR, or a Supabase branch)
and applied to production with `supabase db push --linked` after merge.
Never the dashboard SQL editor, never the MCP's `apply_migration` — both are
how production came to hold 223 history rows the repo could not replay.
The loose files that used to live under `supabase/` are in
`supabase/migrations_archive/`; the baseline dump replaced them.

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

A join-type hint is not an FK name: `products!inner(...)` off
`product_variants` is exactly as ambiguous as `products(...)`. Write
`products!product_variants_product_id_fkey!inner(...)`.

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

`netlify/functions/gun-hub.mjs` is the newest, `/p365/:gun-slug` plus
`/p365/` as its index — page type #4, the page a fit guide links UP to. It
follows `guide-page.mjs` exactly: declared-registry only (`GUN_HUBS`), apex
canonical, JSON-LD, hard 404 for an undeclared gun. **Its `<title>` names
the fit question** — `hubTitle()` in `_guide-meta.mjs`, "P365 XMacro: Which
Mags, Red Dots & Parts Fit | Gunforma", under 60 characters (the two
longest names drop "& Parts"), pinned by `check-guide-content.mjs` — and
its meta description is built from the live counts the page renders (mags
that fit, red dots that fit, the cut), never typed. The H1 stays the model
name. The red-dot count walks the guide's own chain (`countFitOptics`) and
is reported as `x-gun-hub-optics`; it must equal the guide's
`x-guide-optics`.

**Its reason for existing is a defect worth remembering.** The nine `/fit/`
pages shipped in #104 and #119 were **orphaned** — a grep of every `.html`,
`.js` and `.mjs` for `/fit/` hit only the four files that produce the pages
themselves. The sitemap was the sole discovery path, so the cluster had no
internal link equity and no route a reader could follow. Shipping a page type
without its inbound links is a thing that passes every guard in this repo and
every check in a browser. The fix is links in both directions, and
`check-routes.mjs` now asserts the inbound one on the wire: an optic product
page must link into a fit guide.

`netlify/functions/sitemap.mjs` is a third, `/sitemap.xml`, generated from the
database. **Since 2026-10-20 it is a sitemap INDEX** with one typed child per
page type — `/sitemap-static.xml`, `-hubs`, `-fit`, `-builds`, `-profiles`,
`-parts` (`SITEMAP_CHILDREN`) — so Search Console reports indexing per page
type instead of "113 of 319". Same function, routed by pathname; the
`/sitemap-*` rule in `netlify.toml` sends the children to it and it 404s any
child it does not declare. The union of the children is exactly the old flat
list, and `scripts/check-sitemap.mjs` walks the index and every child, holds
each child to its own URL shape, and asserts the union against the pinned
baseline. A `/sitemap-field-notes.xml` child appears only while
`_field-notes-meta.mjs` holds a live article (`SITEMAP_CHILDREN` is
computed at module load; an empty child is a sitemap that says nothing).
**lastmod is the row's own date, never the request time**:
`products.updated_at`, `builds.updated_at`, the newest build for a profile,
the registry `updated` for a fit page or a field note, and for a hub the
latest change among the hub and its fit rows; static pages carry none. Three things about it are
load-bearing:

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

### One URL per page

Every static page declares its **`.html` form** as canonical, the sitemap
lists it and every internal link uses it — and Netlify also answered the
extensionless form (`/gunforma-legal`) at 200, so each content page had two
live addresses. Since 2026-10-20 the bare form is a **forced 301** to the
`.html` form in `netlify.toml` (forced because Netlify's implicit `.html`
lookup can satisfy the bare path before an unforced rule is consulted); the
home page goes the other way, `/index.html` → `/`, and every nav logo and
Home link says `href="/"`. The `/builds`, `/build` and `/field-notes`
aliases pointed at indexable content and are 301s too; the aliases for
noindex app screens (`/signin`, `/signup`, `/post-build`, `/admin`) are
untouched. `scripts/check-routes.mjs` ("one URL per page") asserts every
pair on the wire. Do not flip a canonical to the bare form: nothing indexed
moves this way, and flipping would.

**App screens are noindex, and `gunforma-profile.html` is one of them**
(it redirects to sign-in without a username). It is also the file
`profile-og.mjs` serves at `/u/<username>`, so that function strips the
robots tag by exact string, as it already stripped the static canonical —
`scripts/check-canonical-coupling.mjs` now holds **both** injecting
functions (`build-og.mjs` ↔ the build page, `profile-og.mjs` ↔ the profile
page) to their pages, and refuses a noindex or canonical in a page that its
function never strips.

### Edge caching: `_cache.mjs`

Measured 2026-10-20: every server-rendered page sent `s-maxage=1800`, which
the edge honoured per node and never stored durably (`Netlify Durable;
fwd=bypass`), so a "warm" second hit on a hub was still an 814 ms miss and
every cold hub, guide, part and build paid the Supabase round trips at
1.5–1.6 s. `netlify/functions/_cache.mjs` holds the three directives:
`CDN_CACHE_PAGE` (`public, durable, s-maxage=3600,
stale-while-revalidate=86400`) on every 200 from the hubs, guides, parts
pages and `/parts`; `CDN_CACHE_BUILD` (the same hour, **no**
stale-while-revalidate) on a `/b/` 200, so a reviewer's correction to a
live build reaches every reader within the hour including the first request
after it; and `CDN_CACHE_NO_STORE` on every 404, 410, 502 and 503,
`_pg.mjs`'s `unavailable()` included — a not-found cached durably keeps
saying not-found after the row appears. Browser `Cache-Control` is
unchanged. Spell none of these inline.

`netlify/functions/build-og.mjs` is the fourth, and it holds to the same rule.
Two routes reach it — `/b/<slug>-<uuid>`, the share URL, and
`/gunforma-build-detail.html?id=<uuid>`, the legacy one, routed here so both
emit the same canonical instead of one declaring the id-less one until its
fetch lands. **A uuid that resolves to no approved build gets a real 410 on
both; a request with no uuid in it gets a 404.** 410 because Search Console
kept re-crawling two deleted builds it listed as 404s (2026-10-12), and 410
is what tells it to stop. The function cannot tell deleted from pending
(anon key, `status=eq.approved`), so a pending build's share URL also says
410 until approval — the same moment it stopped saying 404 before, and a
URL Google never holds. **The id-less legacy path itself is a 301 to the
gallery** (`netlify.toml`, the rule under the `?id=` rewrite): served as a
file it was a 200 whose JS painted "Build not found", and Search Console
called it a soft 404. The `?id=` rule must stay ABOVE that 301, because a
rule with no query condition matches any query string.

It server-renders the build's **body**, not just its meta: the H1, the
builder's description, the photos, and a flat parts list whose entries link
to their `/parts/` pages, plus Article + ItemList JSON-LD. It does this by
exact-string-replacing the page's placeholder elements ("—", "Loading…", the
empty containers), which the page's own JS then hydrates over with identical
content. Every one of those literals is held to the page byte-for-byte by
`scripts/check-canonical-coupling.mjs` — editing a placeholder in
`gunforma-build-detail.html` means changing the matching literal in
`build-og.mjs` in the same commit, and the guard says so. Replacements are
arrow functions on purpose: a plain replacement string interprets `$`
sequences, and builders write "$250" in descriptions. The parts list is
deliberately flat — the section taxonomy lives in `js/build-categories.js`,
and a server copy of it is the drift `check-categories.mjs` refuses.
The title and meta description are built from the DATA (platform + most
notable parts by category priority), not from the builder's caption alone,
because nobody searches a caption. `product-page.mjs` renders the mirror
link — "Used in these builds" — so builds and parts link both ways in
served HTML. `scripts/check-routes.mjs` asserts the served /b/ body on every
scheduled run: real H1, parts links, JSON-LD.

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

### Not found means PostgREST said zero rows

**A server-rendered page answers 404 — or 410, for a build — only when
PostgREST positively returned an empty array.** A timeout, a network error,
a non-2xx, or a 2xx whose body is not the array PostgREST always sends is a
failure to read, not an answer about the row, and the function answers
**503 with `Retry-After`** (text/plain, `no-store`, the shape `sitemap.mjs`
already used) after **one retry**. A crawler keeps what it has on a 5xx and
comes back; on a 404 it starts forgetting, and on a 410 it forgets fast —
which is why #161, in making deleted builds 410, made this rule urgent.

The reader is **`netlify/functions/_pg.mjs`**: `pgRows(path)` resolves only
to an array (possibly empty — the one real not-found) and throws
`UpstreamError` on everything else, with a per-attempt timeout so a hung
connection cannot eat the retry's turn; `unavailable()` is the one 503.
`build-og.mjs`, `product-page.mjs`, `guide-page.mjs`, `gun-hub.mjs` and
`field-note.mjs` read through it. Do not add a local `pgGet` back to any of them, and do not write
`Array.isArray(rows) && rows.length ? rows[0] : null` as a way of surviving
a bad body: that line is exactly how a 2xx proxy page used to become a 404.
(`parts-index.mjs` and `profile-og.mjs` still carry their own copies, logged
for the next pass; `profile-og` has the same bad-body-to-404 shape.)

Two deliberate exceptions, both on a positive answer: a declared guide or hub
whose gun has **zero** `gun_optic_cuts` rows answers 502 without
`Retry-After` — a data regression to be fixed, not a blip to be retried —
and a request with no key in it at all (no uuid, a slug that fails the
pattern) is 404 before any read.

`scripts/upstream-failure.test.mjs` runs the four lookup handlers against a
stubbed `fetch` that fails each of those ways and requires the 503, the
header, the retry count, and that an empty array alone yields the 404/410.
`scripts/field-notes.test.mjs` does the same for `field-note.mjs`, where an
empty array is a 200 that names the missing part, not a 404 — the page is
the prose; the catalog only decorates it.

### Field Notes articles: `/field-notes/<slug>`

`netlify/functions/field-note.mjs` is the fifth server-rendered page type,
built for the article pipeline (an article is link bait first and an SEO
page second, and ships only if it would survive r/P365 the same day). It
follows `guide-page.mjs` exactly: declared-registry only, apex canonical,
Article + BreadcrumbList JSON-LD, the shared chrome, `_pg.mjs`, the cache
directives. What is new:

- **The prose is a Markdown file, `field-notes/<slug>.md`**, with title,
  description, author, `author_credential`, `type` (review / comparison /
  guide), `category` and an optional `cover` in its front matter. It is
  rendered by `_markdown.mjs`, a dependency-free subset (headings, lists,
  tables, quotes, fences, images, links, bold/italic/code). **Raw HTML is
  text, not markup, and a `javascript:` link is dropped to its text.** The
  file ships inside the function through `included_files` in
  `netlify.toml`; a declared article whose file is not in the bundle
  answers **502** with `x-field-note-source: missing`.
- **A page is a deliberate act: `_field-notes-meta.mjs` is the registry.**
  A file alone is not a page; an undeclared slug is a 404 before any read.
  **Dates live in the registry and nowhere else** (`published`, `updated`
  — the latter drives `dateModified` and the sitemap lastmod, so bump it
  when the prose changes). The guard refuses a date in the front matter.
- **`draft: true` is served only off the apex.** On gunforma.com a draft
  is a 404; on a deploy preview, a branch deploy or `netlify dev` it is
  the page, `noindex` and `no-store`. The hostname is read off `req.url`,
  the original request URL, the same thing `canonical-host.js` branches
  on. `renderer-check` is the permanent draft fixture — every construct
  and both blocks on real catalog slugs — and `scripts/field-notes.test.mjs`
  and the preview walk-through both run over it. Keep it.
- **Two block directives, one per line, are where the live data goes.**
  `::price <slug>[, <slug>…]` renders each part's hero listing under the
  shared stale-price and sort rules (`_listing-rules.mjs`), the partner
  button through `/go/<link>` or the maker button through
  `/go/part/<id>`, and the three-way disclosure. `::fit optic=<slug>
  gun=<gun-slug>` walks the optic's footprint (and its adapter plates)
  against the gun's cuts by SKU — one verdict per `applies_to` row, with
  the *likely* marker — and `::fit magazine=<slug> gun=<gun-slug>` renders
  the maker's own `magazine_housing_fit` claim, or says there is none.
  Thread pitch and magwell rules are not block kinds yet. **A typed dollar
  figure in the prose fails the build**; so does a prose link to a
  retailer, which would bypass `/go/`.
- **The rewrite is forced.** `publish = "."` would otherwise serve
  `field-notes/<slug>.md` as a static file at the same prefix. The
  function 404s anything that is not a declared slug (a `.md` suffix fails
  its slug test), so forcing the rule never exposes the source. Article
  images therefore cannot live under `/field-notes/`; put them under
  `/assets/field-notes/` (the guard refuses the other path). `/field-notes`
  and `/field-notes/` still 301 to `/field-notes.html`, the index, which
  is a static page whose `STATIC_POSTS` list still points at two mockups
  that do not exist on the site — wiring the index to the registry is the
  change that ships with the first live article.
- **Observable from outside**: `x-field-note`, `-draft`, `-source`,
  `-blocks`, `-products` (found/asked) and `-fits` (resolved/asked).
  `scripts/check-routes.mjs` asserts on the wire that the raw `.md` is not
  served, that the bundle carries the file, that every slug a block names
  is in the catalog, and that a draft is a 404 on the apex and a page off
  it. `scripts/check-field-notes.mjs` holds registry and files in step
  and sweeps the prose on every deploy.

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

### The nav exists in 16 places, three of which are functions

**Changing the site nav means changing sixteen files.** Every root HTML page
carries its own hardcoded copy — desktop `.nav-links` *and* the mobile
`.nav-menu`, so two links per page — and on top of those:

- `js/nav.js`, for the pages that mount it rather than hardcoding
- **`netlify/functions/product-page.mjs`** — server-renders `/parts/:category/:slug`
- **`netlify/functions/parts-index.mjs`** — server-renders `/parts`
- **`netlify/functions/_page-chrome.mjs`** — the nav for `guide-page.mjs`
  (`/fit/p365/...`), `gun-hub.mjs` (`/p365/...`) and `field-note.mjs`
  (`/field-notes/<slug>`), which share one copy rather than holding three

That last one is the direction to keep going. `_page-chrome.mjs` exists
because `gun-hub.mjs` would otherwise have been the sixteenth copy: it owns
the nav, the footer, the hamburger script and the chrome CSS for both guide
pages and gun hubs, so adding a tenth fit page or a twelfth hub costs nothing
here. **`product-page.mjs` and `parts-index.mjs` have NOT been folded in** —
that is a separate change with its own blast radius on the two most crawled
routes on the site, and it should be its own PR with its own served-HTML
diff.

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

Second worked example: adding "Your P365" (`/p365/`, between Builds and
Parts Catalog). Sixteen files, two insertions per static page — twelve
pages, `js/nav.js` (its shared mobile menu plus both link-bearing
variants), `_page-chrome.mjs`, `parts-index.mjs`, `product-page.mjs` — and
the insertion was scripted so each file reported its own count. The server
copies now say which item is active: `navHtml({ active: 'p365' })` on the
hubs and guides. Before that argument existed `_page-chrome.mjs` hardcoded
Parts Catalog as active, so every hub and guide page lit the wrong item,
and nothing failed. `scripts/check-routes.mjs` ("front door to /p365/")
asserts the link on the wire on a static page, a hub, a guide, a product
page and `/parts`, in both the desktop nav and the mobile menu.

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
`supabase/migrations_archive/fix_product_image_policies.sql`.

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

Worked example: `supabase/migrations_archive/revoke_anon_write_grants.sql`. RLS was doing the
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
`supabase/migrations_archive/fix_build_photo_tampering_guard.sql`.

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

### Discontinued parts

A whole **product** leaving the catalog is `products.is_discontinued = true` —
not `retired_at`, which is per variant and per link, and never a delete.
Every browse surface filters it: the catalog (and so its search), both build
pickers, the Armory, the fit guides, `sitemap.mjs` and `parts-index.mjs`.

**The product page does not.** `/parts/<category>/<slug>` still renders a
discontinued part at 200, so an existing build that lists it keeps a working
link. When a part has a successor, add an exact-path `301` in `netlify.toml`
**above** the `/parts/*` rewrite, put the old path in `RETIRED` in
`scripts/check-sitemap.mjs` (its baseline pins every URL the old static
sitemap had), and add the pair to the redirect block in
`scripts/check-routes.mjs`. Worked example: RAMM's comp and non-comp P365
Leverage kits, merged into `ramm-tactical-leverage-trigger-p365`.

**A part that moves category takes the same three steps** — the 301 above
the rewrite, the old path in `RETIRED`, the pair in `check-routes.mjs` — and
nothing else: the product is live, only its address changed. The sitemap
lists the new address on its own, since it is built from `products.category`.
Worked example: `tti-xmacro-completed-mag-w-basepad`, filed as a basepad
before the magazine category existed and moved by
`supabase/migrations_archive/magazine_category.sql`.

Nothing in the repo or the database sets `is_discontinued` back to false
(`add_variants()` only reads it to refuse), and no seed or import script
inserts products — `create_product()` is the one writer.

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
deterministic tiebreak now instead. See `supabase/migrations_archive/retire_is_primary.sql`; the
values are archived in `affiliate_links_is_primary_archive`.

## Unpaid links to a part's own store

A variant with no live partner listing is **not a dead end**. It renders a
button to the part's own `products.url` through **`/go/part/<product id>`**,
the second shape of the `go.js` edge function, which 302s to that url and
logs the click against the product. Four surfaces render it — the part page,
the guide table, the catalog detail panel (via `js/affiliate.js`) and the
build page — and partner rows always sort first. Catalog grid cards do not
carry it: `renderHero()` returns `''` for a product with no partner listing.

This **reverses** an earlier decision not to use `products.url` as a buy
link because it earns no commission. A dead end earns nothing either, and
counted clicks to a maker are what we take to that maker when we ask for a
partnership. Measured 2026-10-07: 89 of 250 live parts had no listing at all
(242 rows), 25 more had one on some options only (86 rows); 88 of the 89 had
a url.

Three rules that look like decoration:

- **The label is decided from the host, not assumed.** `products.url` is
  usually the maker's page but not always — three Olight lights point at
  illumn.com, two Grayguns modules at sigsauer.com, the RAMM trigger at
  thetriggerguyusa.com. `makerLink()` reads "Buy from <maker>" only when
  the url's host is the maker's `manufacturers.website_url` host or a
  subdomain of it (`www.` ignored), and "Buy at <host>" otherwise —
  including when the maker has no website saved, and including
  true-precision.com vs trueprecision.com, which is a different host and
  reads as one.
- **`rel="noopener nofollow"`, never `sponsored`.** Nobody pays for these.
  Partner buttons keep `noopener sponsored nofollow` unchanged, and
  `check-buy-links.mjs` now keys on `nofollow` so both kinds must go
  through `/go/`.
- **The disclosure line says what is true of the buttons above it**:
  partner-only, maker-only, both, or no line at all. `buyDisclosure()` holds
  the wording. The guide page keeps its first sentence about prices and
  applies the rule to the second.

### Every product name on a page goes through `displayProductName()`

**`products.name` is the MODEL alone, never the brand.** "507K X2", not
"Holosun 507K X2"; the brand is `manufacturers.name` through
`products.brand_id`. That is the convention since
`supabase/migrations/20261021160000_product_naming_convention.sql`
(2026-10-21), which renamed the 236 live products whose stored name
carried the brand — or something a spec column already holds: a barrel's
inch length, a magazine's model list, "Stainless Steel", Magpul's SG9
designator — and refuses to leave any live name opening with its brand.
The review behind it is `product-name-convention-2026-10-20.csv` in the
shared notes folder; the file reproduces every old and new name, so the
repo is the record. Before it the stored name carried the brand only when
the maker's own title did (204 of 277 on 2026-10-20), the helper had to
guess from the name's words whether the brand was already there, and the
guess could not fix "Herrington Arms HA Magwell …", a name that doubled
its own brand. A new part follows the convention at entry: the model in
`name`, nothing of the brand. `create_product()` does not refuse a
branded name yet; the fixture test and `check-routes.mjs` catch one.

**And every product name on a page goes through `displayProductName()`
or `displayProductParts()`.** Not `p.name`, not `brand + ' ' + name`
assembled by hand. The rule lives in two byte-for-byte-equivalent copies
— the same split, for the same reason, as `js/maker-link.js` ↔
`_maker-link.mjs`:

- `netlify/functions/_display-name.mjs` — the server copy, imported by
  `gun-hub.mjs`, `guide-page.mjs`, `field-note.mjs`, `build-og.mjs`,
  `parts-index.mjs` and `product-page.mjs`.
- `js/display-name.js` — the browser copy, a plain `<script>` global
  (`window.displayProductName`, `window.displayProductParts`), loaded by
  the two builder pages (for `js/part-picker.js`),
  `gunforma-build-detail.html`, `gunforma-parts-catalog.html` and
  `gunforma-profile.html`. `check-script-order.mjs` holds the tag in
  place.

`displayProductName({ brand, name })` is the name where it stands alone —
a hub row, a guide table, a title, an alt — and for a catalog row it is
exactly `brand + ' ' + name`. `displayProductParts({ brand, name })` is
`{ brand, model }`, the two lines a card prints: the picker card, the
selected row, the colour step and the catalog-match row
(`js/part-picker.js`), the build page's part card (`.part-brand` over
`.part-model`, and its server mirror in `build-og.mjs`), the catalog card
and detail panel, and the profile's Favorite parts card. Until 2026-10-21
those cards printed the stored name under a separate brand line and read
"Icarus Precision" over "Icarus Precision 311 Series 311"; they print the
pair now.

**One rule survives from before the convention, for frozen names.**
`builds.parts_snapshot` froze each part's name and brand at the time of
the build — on 2026-10-21, 47 of the 86 parts in approved builds opened
with their brand ("Sig Sauer Romeo-X Enclosed Compact", "Radian Ramjet …"
for Radian Weapons) — and a builder typing a part may write the brand in
both fields. So `displayProductParts()` strips ONE leading form of the
brand (the full name, a shorter run of its leading words — "Timber Creek"
for Timber Creek Outdoors — its initials, or a listed alias in
`BRAND_ALIASES`; the longest that fits) when the name opens with it and a
space follows. A hyphen does not count ("True-Lock" keeps its "True-"), a
brand mid-name is left alone, a name that is only the brand keeps it, and
nothing else is edited: the helper never introduces a doubled brand, and a
frozen name that opened with two forms of its brand is printed as the
maker wrote it. For a catalog row nothing opens with the brand, so
nothing is stripped — the test asserts that over every fixture row. **Do
not extend the forms to cover a catalog name: rename the product.**

Sorting stays on the stored name everywhere (`/parts` and the sitemap
order by `name`), so those lists now order by model rather than by
brand; the catalog page's "Brand" sort orders by brand then name as it
did.

The point of the rule is what it does to the NEXT section or category: a
grip-module row, a recoil-spring card, a page that does not exist yet is
branded by default rather than by somebody remembering. Three guards hold
it:

- `scripts/display-name.test.mjs` pins every shape of both functions,
  holds every row of `scripts/fixtures/product-names.json` to the
  convention (the model alone, display name = brand + name, no doubled
  brand), and runs both copies over every pinned case, every fixture row
  and a seeded fuzz, failing if they differ by a character. The fixture is
  the catalog as read with the public key once the naming migration is
  applied — `node scripts/display-name.test.mjs --refresh-fixture`
  rewrites it; run it after `db push` and expect no diff.
- `scripts/check-display-name.mjs` fails the build when a render file
  (root `*.html`, `js/*.js`, `netlify/functions/*.mjs`, the edge
  functions) prints a raw product name — `p.name`, `product.name`,
  `item.name`, `part.name`, `r.name`, `pr.name`, `prod.name` on a line
  that emits HTML or DOM text — outside its allowlist. A read inside a
  `displayProductName(...)` or `displayProductParts(...)` call is the
  correct use. Every allowlist entry names its line and its reason, and a
  stale entry fails the build too. It does not see a name read into a
  variable on one line and printed on another; the rule above does.
- `scripts/check-routes.mjs` asserts the convention on production on
  every scheduled run — every live product's name is the model alone,
  every one has a brand, both copies agree, none doubles — and on the
  wire: every `/parts` row is served under its display name with no
  trailing "— Brand" span, a one-word-brand and a multi-word-brand
  product page's `<title>`, `og:title`, H1 and JSON-LD `name` are the
  display name with no "by <maker>" line under the H1, and every hub
  magazine row opens with a brand from `manufacturers` and doubles none.
  Between this change's merge and its `db push` the first of those is
  red, which is the correct reading of "the migration is not applied
  yet".

**What is still excused by name, and why** (the allowlist, in short):

- **Admin screens** (`gunforma-admin-queue.html`, `-part.html`,
  `-data.html`) print brand and name as two fields for the admin matching
  a typed part to a catalog row; no reader sees them.
- **The parked Armory** (see **The Armory is parked**).
- **Lines where `p` is a platform or a partner**, not a product.

Decided 2026-10-21 and still true: the product page's H1 is the display
name and the "by <maker>" line under it is gone — with the brand in the
H1 the line said the same maker twice. `check-routes.mjs` asserts the H1
on the wire, and that no product page carries a `brand-line`. The maker's
own site is still reachable from the buy row (`makerLink()`) when a part
has no partner listing.

**Not in the JSON-LD.** A maker link with a hand-typed MSRP is not an offer
we can stand behind in rich results; `product-page.mjs` filters maker rows
out of `offers` explicitly.

**`link_clicks.product_id` is what stores these clicks** —
`supabase/migrations_archive/link_clicks_product_id.sql`, applied 2026-10-07 (migration
`20261007055811`), after #149 was live; the record at the bottom of that
file is what was read back. A row carries exactly one of `link_id` /
`product_id`, enforced by a check constraint. The function was written to
tolerate the column's absence — a failed insert reports as `x-go-debug`'s
`PGRST204` and the redirect still goes out — and still is, which is the
shape to keep: logging must never be able to break buying. The legacy
`/go/<link id>` shape is the money path and is unchanged by a byte.
`scripts/check-routes.mjs` exercises both shapes on the wire, always with
`x-go-no-log: 1`.

### Which clicks are real

**Report clicks from `link_clicks_real`, never from `link_clicks`.** The
table is mostly bot traffic, and partnership decisions are made off it.

Queried 2026-10-15: 1,047 of its rows landed on 2026-10-12 with referrer
"/" on every one — a page that has no `/go/` links — at 20–40 a minute for
hours across 599 targets; 62 and 97 more on 10-09 and 10-10 were exactly
one click per link, spread out, a slow sweep. Around 80 rows in the whole
table are plausibly people. **The known sweeps are 2026-10-09, 10 and 12**,
and before the migration below was applied the table cannot tell a reader
from a bot at all: it stored no user agent and no fetch metadata. Those rows
stay as they are — nothing deletes or rewrites them — and the first row
with `is_bot` set marks the cutover exactly
(`select min(ts) from link_clicks where is_bot is not null`; the target is
2026-10-15).

**Three columns, written by `go.js` on the logged path only** (a request
with `x-go-no-log` never reaches them), through
`netlify/edge-functions/_lib/go-bot.mjs` — a pure module in a subdirectory
so Netlify bundles it into the function instead of deploying it as one:

- `user_agent` — the User-Agent header, trimmed, at most 256 characters,
  null if absent. The evidence, kept so a verdict can be re-run later.
- `sec_fetch` — Sec-Fetch-Mode "/" Sec-Fetch-User, e.g. `navigate/?1`,
  which is what a real click in a modern browser sends; null if both are
  absent. Recorded, not judged — an older browser sends neither.
- `is_bot` — true when the user agent is **missing** or matches the bot
  pattern (`BOT_PATTERNS` in that module: bot, crawl, spider, headless,
  lighthouse, preview, curl, python, wget, the HTTP client libraries, the
  SEO crawlers, the link-preview fetchers), false otherwise.
  **A missing referrer never sets it** — the rule above `x-go-no-log` in
  `go.js` still holds, and the test asserts it. **Null means unknown, not
  human**: every row before the migration, and nothing after it.

Until `supabase/migrations/*_link_clicks_bot_columns.sql` is applied the
full insert is refused with PGRST204 and `go.js` retries once in the old
shape, so no click is lost to the gap; `x-go-debug: 1` answers
`x-go-insert-shape: full | legacy` so the plumbing is observable rather than
assumed. `scripts/go-bot.test.mjs` runs the classifier over real user
agents on every deploy.

**`link_clicks_real`** (`security_invoker`, every grant revoked from `anon`
and `authenticated`, `service_role` only — the same privacy as the table) is
the rows a number can rest on, three conditions and all of them:

- `is_bot = false`, so null is out;
- not in a minute that holds clicks on five or more different targets
  (`coalesce(link_id, product_id)`) — the shape of the 10-12 burst, which
  no pattern can promise to catch next time;
- `sec_fetch` is **null**, or **exactly `navigate/?1`**, or **`navigate/` on
  a WebKit user agent** (`AppleWebKit` present, no `Chrome/` token). Null
  stays in: an older browser sends neither header, and its absence says
  nothing — the same reasoning as the referrer. `navigate/?1` is a
  user-activated navigation in Chrome, Edge, Firefox and Samsung Internet.
  The WebKit clause exists because **WebKit never sends `Sec-Fetch-User`**:
  the first real iPhone click (row 1869, Chrome on iOS, which says `CriOS/`
  and is WebKit like everything on iOS) arrived as `navigate/` and the
  first version of the view excluded it — and with it every iPhone, iPad,
  desktop Safari and iOS in-app browser. `navigate/` on a **Chrome** user
  agent stays out: that is a scripted Chrome (Puppeteer, Playwright, a
  headless run wearing a real user agent) navigating without user
  activation, which is exactly the sweep being filtered. Any other mode
  (`no-cors/`, `same-origin/`, `cors/`) is a script or a subresource fetch
  and is out.

The slow sweeps are not caught by the minute rule and are not meant to be;
the pattern is what catches a tool. Bots still get their 302 — nothing here
blocks a crawler from following a link, it only stops counting it.

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
| `scripts/part-ids.test.mjs` | a reviewer's correction landing on the wrong part — matched by position again, falling back to a neighbour when its part was removed, or a page reading corrections without `js/part-ids.js`; a builder page saving without `PartIds.ensure()`; an added or removed part being read as a correction; a page laying corrections over the stored part again |
| `scripts/part-match.test.mjs` | the catalog-match prompt offering noise ("my trigger job" → three triggers), going silent on a real match ("holosun 407k"), claiming a model the catalog does not have, or swapping a catalog part into the wrong position — run against real catalog names |
| `scripts/check-buy-links.mjs` | a buy link that skips the `/go/` click layer |
| `scripts/check-analytics-snippet.mjs` | a public page or HTML-emitting function without the Cloudflare Web Analytics tag, an excluded page with it, or a `/b/` or `/u/` page that renders it twice (double-counted) — discovers pages and functions rather than listing them, and renders `build-og.mjs` / `profile-og.mjs` against a stubbed fetch |
| `scripts/check-category-labels.mjs` | a `parts_snapshot` category with no label — `.part-type` is `text-transform: uppercase`, so it reaches a reader shouted ("OTHER_PARTS"); also a section declared with no group, which renders in no group heading and so nowhere at all |
| `scripts/check-categories.mjs` | the browser and server category lists differing; a category in no build section; a page carrying its own category list; a spec sheet the product page never renders |
| `scripts/check-canonical-coupling.mjs` | `build-og.mjs` or `profile-og.mjs` replacing a literal its page no longer contains, or a page carrying a noindex or canonical its function never strips |
| `scripts/listing-rules.test.mjs` | `_listing-rules.mjs` drifting from the documented stale-price and sort rules |
| `scripts/maker-link.test.mjs` | `js/maker-link.js` and `_maker-link.mjs` drifting apart — the same unpaid buy button labelled, or disclosed, differently on the catalog panel and the part page |
| `scripts/display-name.test.mjs` | a fixture row of the catalog whose stored name opens with its brand (the naming convention broken at entry), `js/display-name.js` and `_display-name.mjs` drifting apart, or either copy doubling a brand or stripping one from a catalog name — runs both over every pinned shape, every fixture row and a seeded fuzz |
| `scripts/check-display-name.mjs` | a render file printing a raw product name (`p.name`, `item.name`, `part.name`, … on a line that emits HTML or DOM text) instead of `displayProductName()` or `displayProductParts()`, so a new section or category ships "AMAG 15 SG9" with nothing saying Magpul; also an allowlist entry whose line is gone |
| `scripts/check-guide-content.mjs` | a guide page declared without content or vice versa; typed prices or counts in guide prose; a hub `<title>` at 60 characters or over, or off the "`<model>`: Which Mags … Fit \| Gunforma" shape |
| `scripts/check-home-picker.mjs` | the homepage's "What fits your P365?" picker drifting from `GUN_HUBS` — a hub with no button, a dead button for a gun with no hub, a wrong order or name, the index link not last, or a typed count in its copy |
| `scripts/upstream-failure.test.mjs` | a server-rendered page answering 404 or 410 when PostgREST failed rather than said zero rows — runs the four lookup functions against a fetch that rejects, times out, answers 5xx or answers 2xx with the wrong body, and requires 503 + Retry-After after one retry |
| `scripts/go-bot.test.mjs` | the `/go/` click classifier calling a reader's browser a bot or a tool a reader — runs `_lib/go-bot.mjs` over real user agents (Chrome, Safari iOS, Firefox, Edge, Samsung Internet → reader; curl, python-requests, Googlebot, Screaming Frog, HeadlessChrome, facebookexternalhit, none at all → bot) and holds that nothing but the user agent decides |
| `scripts/check-field-notes.mjs` | a Field Notes slug declared without a file or a file nothing declares; a date in the front matter (they live in the registry); a typed dollar figure or a retailer link in the prose; a directive that does not parse or names an unknown gun; an image under `/field-notes/`, which the forced rewrite swallows |
| `scripts/field-notes.test.mjs` | `field-note.mjs` answering 404 when PostgREST failed, serving a draft on the apex, serving raw HTML or a `javascript:` link as markup, stating a stale price, or getting a fit verdict wrong — runs the handler over the `renderer-check` fixture against a stubbed catalog and pins every verdict shape |

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
bare legacy path 301ing to the gallery, a hard 410 on every unresolvable
uuid and a 404 on a request with none. It is listed under `NOT_BUILD_CHECKS`
because the site is not serving
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

**Removing or restructuring a visible UI element requires asking first.** A
brand sub-line, a badge, a column, a button: if a reader could see it before
and not after, or in a different place, that is a decision for Alex, not a
side effect of the change you were asked for. Open the PR with the element
intact and the question stated, or stop and ask — never remove it and
report it afterwards. (#187 removed the brand sub-lines under guide and
Field Notes rows while prefixing brands; the prefix was asked for, the
removal was not.)

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

## Adding a product

**One product is added with one call: `create_product()`**
(`supabase/migrations_archive/create_product.sql`). It writes the brand (found or created), the
product, its platforms, its spec sheet, every variant with its photos and
retailer links, and its fits-with rules in one transaction. It can also swap a
build's pending custom part for the new product. It is `SECURITY DEFINER`, and
its guard is `is_admin() or is_trusted_backend()`. `anon` cannot execute it.
Before it, products arrived only in bulk loads, and `create_variant()` could
only add to a product that already existed. **New variants on an existing
part go through `add_variants()`** — see **Adding a variant to an existing
part** below. Both share one copy of the variant logic.

**What a category needs lives in a table, not in code:
`spec_field_rules`** (`supabase/migrations_archive/spec_field_rules.sql`).

- It holds one row per (category, field), and each row is `required` or
  `optional`.
- A row can be scoped by `only_when_field` / `only_when_values`. Example: a
  barrel's `thread_pitch` applies only when `barrel_type` is threaded.
- Three readers use the same rows:
  - `create_product()` accepts a spec key only if it has a row.
  - `product_data_status()` decides what makes a part approved.
  - `gunforma-admin-part.html` decides what to ask and how to label it.
- To change what a category needs, change a row. Do not add a list anywhere
  else.

**Saving and approval are separate on purpose.**

- **To save, a part needs:** brand, name, category, at least one platform,
  the source `url`, one variant, and a photo and an MSRP on the default
  variant.
- **To be approved, it needs** everything
  `product_data_status(product_id)` checks, which returns
  `{approved, missing[], optional_blank[], platforms[]}`.
- `create_product()` always returns that status, so an unapproved save is
  never silent.
- Only an approved part may carry a `fitment_confidence` other than
  `unverified`.
  - This applies to `create_product()` only. Existing products were not
    re-graded.
- `products_needing_data` lists every unapproved product with what it is
  missing. Only admins and the service role see rows.

**Five things that look like omissions and are not:**

- **Platform is explicit.** Nothing defaults to P365, and a part with no
  platform is refused.
  - A slide or barrel belongs to **exactly one** platform. Its spec row's
    platform is that platform, and a `platform` spec key that disagrees is
    refused.
  - A platform that is not live yet is accepted, with a warning.
  - A slide or barrel length the platform has not registered in
    `platform_part_lengths` is refused with a readable sentence, not the
    class trigger's raw error.
  - **P320 has no registered lengths yet.** The `slide_length_valid` and
    `barrel_length_valid` CHECKs allow only 3.1/3.7/4.3, so registering them
    takes both changes.
- **Retailer links are optional:** zero, one or several per variant. A
  missing link shows in `optional_blank` as "retailer link" and never blocks
  approval.
  - There is no "direct from maker" partner, and do not add one. A partner
    without an Awin id is never matched by the sync, so its price is stale
    forever and the buy row reads "Check price" with no MSRP.
- **`products.url` is required, and it is a reference.** It is the page the
  data came from.
  - A product without one is not approved: `product_data_status()` reports a
    blank `url` in `missing`, not `optional_blank`
    (`supabase/migrations_archive/fix_product_data_status_url.sql`).
  - No public page renders it: the catalog and the Armory map it to a
    `buy_url` that nothing reads.
  - Do not start rendering it, and do not drop it.
- **Defaulted spec columns pass silently.** Several required fields have a
  column default: `caliber '9mm'`, `capacity_change 0`, `drop_in true`,
  `is_combo false`, and others.
  - A spec sheet that omits one is saved holding the default, and
    `product_data_status()` then calls it approved.
  - The function does not refuse them, by decision. The page does: see
    **The add-a-part page** below.
- **Material is one fact.**
  - `optic_specs.housing_material` and `mag_release_specs.material` are
    filled from `products.material`.
  - A spec value that disagrees with it is refused.
- **Material family is required for approval; the material's wording is
  not** (`supabase/migrations_archive/material_optional.sql`).
  - `'Unspecified'` is a valid family. It approves, and `optional_blank`
    carries "material family unspecified" so those parts can be found later.
  - A blank `material` sits in `optional_blank`, not `missing`.
  - Except for optics: the optic rule row `housing_material` is required and
    is filled from `material`, so an optic with no material still reads
    missing "spec.housing_material". That is the rule as it stands, not an
    accident; changing it is one row in `spec_field_rules`.

**Never entered by `create_product()`:**

- the sync's columns: `street_price`, `in_stock`, `last_checked` and
  `op_last_matched_by`
- `slide_class` and `barrel_class`, which are owned by triggers
- any spec column with no rule row
- `installation_difficulty` and `best_for`, which are refused by name.
  Existing values stay, and the product page still reads them.

**Try a part with `p_dry_run => true`.** The function does everything, then
raises errcode `P0DRY` with the would-be result JSON in the error's DETAIL, so
nothing is written.

- Through PostgREST it arrives as an error body that carries the result.
- **It is the only safe way to test against production.** `affiliate_links`
  and `price_history` are `ON DELETE RESTRICT`, so a real test product that
  got a link can never be removed.
- For a multi-case test, use one `DO` block that ends in `RAISE EXCEPTION`.
  - Run any case that relies on the direct session's NULL
    `request.jwt.claims` **before** any case that sets the claims. Once a
    connection has set it, a rolled-back or reset value reads `''`, not NULL.
  - **Known defect, logged and not yet fixed:**
    `restrict_owner_edits_on_approved_build` tests `claims is null`, so it
    treats `''` as an API caller. A direct session on such a connection is
    refused an edit to an approved build. The fix is
    `nullif(current_setting('request.jwt.claims', true), '')`, which is what
    `is_trusted_backend()` already does.

**Tracked links are built, not typed.**

- For a partner with an `awin_merchant_id`, the Awin URL is built with the
  clickref `build-detail_<product slug>`.
- A supplied Awin link whose merchant id disagrees with the partner's is
  refused.

### The add-a-part page

`gunforma-admin-part.html` is the form over `create_product()`. Like the
other admin pages it carries its own Admin bar, not the site nav, so it is
not a sixteenth nav copy; it has no analytics tag (the guard exempts
`gunforma-admin-*`) and is `noindex`.

- **The gate is `requireAdmin()` from `gunforma-admin-post.html`.** Nothing
  renders until it passes. A signed-in non-admin gets "Admins only"; anyone
  signed out goes to sign-in.
- **Platform first, then category, then everything else.** Slide and barrel
  lengths come from `platform_part_lengths`; when the chosen platform has
  none, the page prints the same sentence the function would and offers no
  Check or Save.
- **The form is rendered from `spec_field_rules`.** What the page holds
  itself is only how to draw a field (`BOOL_FIELDS`, `NUMBER_FIELDS`,
  `LOOKUP_FIELDS`): column types are not readable through PostgREST. Check
  runs the real function, so a wrong entry there is refused, not saved.
- **Lookup tables and enums are strict dropdowns. Free-text fields suggest
  only values already used by two or more products**, which is what keeps
  the typos in `mount_system` ("Rail climp", "1914 clamp") from spreading.
  `mag_release.caliber` stays free text: its live value `9mm/.380` is not in
  `calibers`.
- **Required yes/no and number fields start empty.** When one is left blank
  and the dry run says nothing is missing, the column's default would be
  stored silently, so Save waits until it is answered. That is the page
  honouring the defaults rule above.
- **Check, then Save.** Check calls `create_product(…, p_dry_run => true)`,
  which answers **HTTP 500 with `error.code === 'P0DRY'`** and the result in
  `error.details`. The page branches on the code and never on the status.
  Save is enabled only while the form is byte-for-byte what was last checked.
- **`p_specs` and `p_fits` are omitted when empty, never sent as `null`.** A
  JSON null that reaches the function as the jsonb value `'null'` made
  `jsonb_strip_blank()` throw "cannot call jsonb_each on a non-object".
  `supabase/migrations_archive/fix_strip_blank_and_link_result.sql` makes it read any
  non-object as empty; the page keeps omitting them anyway.
- **The page suggests a short slug and always sends it.** `create_product()`
  falls back to brand + full name, which produced a 70-character address
  (Springer's "+3 Magazine Extension for Sig Sauer X Macro 17rd Mags").
  The suggestion is brand, then the name with filler dropped ("for", "sig",
  "sauer", "the", "with", "and", "all", "of", "a", "an"; "magazine"/"mags" →
  "mag") and leading brand words removed, then the model it fits, found in
  the name against the chosen platform's guns ("X Macro" on P365 →
  `p365xmacro`), else the platform. Over 50 characters it drops words from
  the middle, keeping the first word and the last two (the noun). It warns
  over 60, refuses anything but lowercase letters, digits and single
  hyphens, and says "already taken" as the admin types — from the catalog
  loaded with the page, then `products.slug` live.
  - Run over all 243 live products: average 30 characters, longest 52, none
    over 60. Trimming can make two near-identical names collide (the two
    ECM mag releases); the "already taken" check is what catches that.
  - A slug can be changed afterwards in the database (Springer's was), but
    it is the shared address: the old one 404s at once.
- **A retailer row is a retailer and a URL, nothing else.** The page never
  sends `op_merchant_product_id`, `op_mpn` or `op_gtin`: they are the
  retailer feed's own identifiers, which an admin cannot see on the
  retailer's page, and the nightly sync fills them on its first match.
- **After Check, every retailer link says whether a tracked link was
  built.** A partner with no `awin_merchant_id` gets none, and the page says
  so plainly: "untracked: no commission". This matters because `partners`
  lists `optics-planet` (no Awin id) beside `awin-optics-planet`, and the two
  read almost the same in the dropdown. The answer comes from
  `variants[].retailers[].tracked_url` in the function's result (same fix
  file); before that file is applied the page says tracking is not reported.
- **Product photos are pasted https URLs, not uploads, for now.** The page
  previews each one; a photo that does not load is flagged and counts as no
  photo (it is not sent). Nothing writes to the `product-images` bucket, and
  a maker changing their site breaks the photo — copying them into our own
  storage is logged for later.
- **The label preview runs `variantLabel()` over what `create_variant()`
  stores.** `create_variant()` always writes `variant_label` as
  `coalesce(p_variant_label, color || ' · ' || finish)`, and `variantLabel()`
  returns a stored label verbatim — so 650 of 779 live variants read
  "Colour · Finish", not the formula's "Colour / Finish". The page mirrors
  that one coalesce, and every Check compares it with the labels the server
  returns.
- **Adding a colour** inserts into `colors` and needs
  `supabase/migrations_archive/colors_admin_insert.sql`. Without it the database refuses and
  the page says so.
- **`?build=<uuid>&part=<index>`** prefills brand, name, category and the
  build's platform from a pending custom part and passes both through, so
  Save re-links the part. A section with two categories ("Barrels &
  Compensators") makes the admin pick; a section with none says so.

### Adding a variant to an existing part

`gunforma-admin-part.html?product=<slug>` is the add-a-part page in
**add-a-variant mode**, over `add_variants(p_product_slug, p_variants,
p_dry_run)` (`supabase/migrations_archive/add_variants.sql`). Every part listed under "Already
in the catalog?" links to it.

- **The part is read-only:** name, brand, category, platforms, and every
  live variant with its photo, MSRP and option values. Only new variants are
  entered, in the same variant table, then Check → warnings → Save as
  before. Save links to the part's `/parts` page.
- **The variant logic exists once.** `create_variants_for_product()` turns a
  variant object into a variant — unknown keys, colour vocabulary, the
  option columns folded into the slug, gallery, retailer links with the Awin
  link built. `create_product()` and `add_variants()` both call it. EXECUTE
  is revoked from public, anon and authenticated, so a signed-in user reaches
  it only through those two SECURITY DEFINER callers; `service_role` keeps
  EXECUTE. Change variant rules there, not in either caller.
- **`add_variants()` never changes an existing variant**, except that a new
  variant marked `is_default` takes the default from the old one in the same
  transaction (`variants_one_default_per_product` holds exactly one). Two new
  defaults are refused. Unmarked, the current default stays.
- **Every new variant needs a photo and an MSRP**, refused in the function:
  adding a variant must never unapprove a part.
- **Duplicates are refused against every live variant, discontinued ones
  included, and against the other new ones**, and the message names the
  match. `variant_identity()` is what "the same" means: all 13 option
  columns, trimmed, case-folded, blank = null, `optic_cut 'none'` = none,
  manual safety missing = false. The same rule now applies in
  `create_product()`, which used to compare raw values and saved "Anodized"
  beside "anodized ".
- **`handedness 'ambidextrous'` is NOT normalised away.** The bulk load set
  it on nearly every slide, barrel, light and trigger, and the form has no
  handedness field outside frames and mag releases — but on frames it is a
  real option (Icarus's "Ambi thumb ledge" beside "No thumb ledge", which is
  null). So the PAGE closes the gap instead: a column the form does not show
  that holds one value on every live variant of the part is carried onto
  the new variants and stated on the form. Without that, a page-added copy
  of an existing variant differs from it only by a column nobody can see,
  and the duplicate rule lets it through.
  - **This inheritance exists only on the page.** A direct call to
    `add_variants()` (SQL, a script, the service role) gets no inherited
    columns, and a copy that leaves out `handedness` passes the duplicate
    rule against a sibling that says `ambidextrous`.
  - **The real fix is data, deferred to the field review:** clear
    `handedness 'ambidextrous'` where it means nothing. On 2026-10-05, 477
    variants carried it: 122 frames and 19 mag releases, where it is a real
    option (beside "no thumb ledge", and beside 1 left and 1 right mag
    release), and **336** across the other categories, where it means
    nothing. Those 336 are the rows to clear.
- **Option fields suggest this part's values first, then its category's**,
  unlike add-a-part mode's "used by two or more products". A new value can
  still be typed.
- **A discontinued part is refused.** (`products` has no `retired_at`; it
  has `is_discontinued`.)

Logged for later, not built:

- **Editing an existing part or variant** (photo, price, a spec fix) and
  **retiring a variant**. This page only adds.
- **`sig-sauer-manual-safety-kit-p365` has two live variants identical on
  every option**: "Rose Gold", `…-matte-rose` (SKU 8901340) and
  `…-rose-gold` (SKU 8901337). Left alone by ruling; they are for the edit
  path. Until then nothing more can be added identical to either.
- `create_product()`'s "already exists" refusals still say "use
  create_variant"; the page's "Add a variant" link is the real answer.

### Recoil Springs, Sights and Other Parts

Three categories added together (`supabase/migrations_archive/add_categories_enum.sql`, then
`supabase/migrations_archive/add_categories.sql`), on every surface: catalog tab, `/parts/`
address and index, build section, add-a-part with its rules, Needs data and
the sitemap.

**An enum value is its own migration, applied first.** Postgres refuses to
USE a value in the transaction that added it, so `add_categories_enum.sql`
holds only the three `add value` lines and was applied before anything that
names them could even be dry-run. It touches no row, and no page reads a
value until a product has it. The pages tolerate both states: categories and
names live in code, a Check on a new category before its rules exist says
"not available yet", and nothing reads `products.part_type` except for an
`other` product — a column named in a main query before it exists fails the
whole query (every product page, the whole catalog).

| category | segment | build section | group | spec sheet |
|---|---|---|---|---|
| `recoil_spring` | `recoil-springs` | Recoil Springs | Core build, after Barrels & Compensators | `recoil_spring_specs` |
| `sight` | `sights` | Sights | Core build, after Optics | `sight_specs` |
| `other` | `other-parts` | Other Parts (`misc`) | Carry and finish, last | none |

- **Recoil springs:** slide length (required, one of the slide lengths
  registered for the part's platforms — refused in words otherwise), spring
  weight (required, free text: makers write "13 lb" or "Reduced (Soft)"),
  captured (required), spring type and guide rod material (optional; the guide
  rod material is filled from the product's material, "material is one fact").
  **A different weight or length is a different product, not a variant**: neither
  is an option column, so `variant_identity()` would refuse two weights as
  identical.
- **Sights:** front / rear / set, standard / suppressor height, and night /
  fiber / night + fiber / plain — all required, strict dropdowns, and CHECKs on
  `sight_specs`. **The three lists live in three places** — those CHECKs,
  `create_product()` (which refuses a value outside them in words naming the
  allowed ones, `supabase/migrations_archive/sight_values_in_words.sql`, instead of the raw
  constraint error) and `SIGHT_CHOICES` in `gunforma-admin-part.html`.
  Change all three together. Dovetail and rear notch optional: a required free-text field
  an admin cannot answer gets filled with guesses. **The front dot colour is a
  variant option** reusing `reticle_color`; add-a-part labels it "Front dot
  colour" for sights through `axisLabel()`, the one place a variant column is
  named per category.
- **Other Parts:** catalog parts that fit no other category. No spec sheet;
  one extra fact, **`products.part_type`** — two or three words ("thumb
  ledge"), suggested from the values already entered in the category. The
  table rule `products_part_type_other` ties it to the category both ways (an
  Other Part must have one; nothing else may), comparing the category as text
  so it does not depend on the enum at plan time; `create_product()` refuses
  either case in words first. anon reads `products` through COLUMN grants, so
  the column is granted explicitly. Pages show the part type in place of the
  category name in a sentence ("Thumb ledge for the Sig Sauer P365").
- Both new spec tables arrive with RLS on, every grant revoked, and SELECT
  only, for anon and authenticated, behind a read policy.

Logged for later, not built:

- **Spring weight as a variant option** (one product, several weights).
- **The older spec tables carry broad grants** — `authenticated` holds
  INSERT/UPDATE/DELETE/TRUNCATE on `slide_release_specs` and its siblings,
  behind a read-only policy. RLS refuses the writes; the grants are the drift
  pattern under **A revoke is not permanent**.
- **Catalog backing for magazines, holsters and knives**, and **optic adapter
  plates, fire control parts and grip weights** as categories once builds show
  them.
- `create_product()` refuses a spec sheet sent for a category without one as
  "a other has no spec sheet" — the generic "a %" sentence; the page never
  sends one.

### Magazines, and restricted states

The fourth category added after the catalog's first sixteen
(`supabase/migrations_archive/magazine_category_enum.sql`, then `supabase/migrations_archive/magazine_category.sql`,
same two-file shape as the three above and for the same reason). `magazine`,
ordered right after `magwell` in the enum and in both category lists;
segment `magazines`; "Magazines" / "Magazine"; spec sheet `magazine_specs`.
It backs the builder's existing **Magazines** section, whose key stays
`mags` because every magazine ever typed into a build was saved under it —
the section simply gained a `dbCategory`, so the catalog picker, the review
queue's "Link to existing part" and add-a-part now reach it. Before this a
magazine had nowhere to go and TTI's X-Macro completed magazine was filed as
a basepad; that one product moves with the migration (see **Discontinued
parts** for the three steps a move takes).

- **Rules:** capacity (rounds, whole number), caliber (free text, as the
  maker writes it), style (`Flush` / `Finger Extension` / `Extended`) and
  fits_models (the maker's own words) are required; not_compatible_with,
  body_material, witness_holes and included_extras are optional. **The style
  list lives in three places** — the `magazine_specs` CHECK,
  `create_product()` (refuses in words) and `MAG_CHOICES` in
  `gunforma-admin-part.html` — change all three together, as with sights.
  A capacity that is not a whole number is refused in words too.
- **A different capacity is a different product**, not a variant: capacity is
  not an option column, so `variant_identity()` would call two capacities
  identical.
- **`body_material` is deliberately not tied to `products.material`.** A
  completed magazine's product material can describe the basepad as well
  ("Aluminum Basepad, Steel Magazine Body"), so "material is one fact" does
  not hold here; the sheet's body material is its own fact.
- **A magazine may send `p_fits: {"frames": [...]}`**, exactly as a magwell
  does, written to **`magazine_frame_requirements`** (the same shape as
  `magwell_frame_requirements`, its own table because the columns are named
  for the part). Zero rows means no claim. Nothing reads it yet; it is what
  a "which mag fits my P365" question will be built on.

**`products.restricted_states`** is a product field, not a magazine one: the
two-letter codes of the states a part cannot be shipped to, `text[]`, NULL
for "no restriction". The table's CHECK holds it to the 50 states and DC,
refuses an empty list and a NULL element, and is case-sensitive;
`create_product()` accepts `restricted_states` as a product key, upper-cases,
trims and de-duplicates it, refuses anything that is not a code **by name**,
and reports the stored list in its result (so a dry run shows it). The part
page prints **"Not available in: CA, NY"** directly above the buy rows,
reading the column in a query of its own (`fetchRestrictedStates()`), never
in the product select — a column named there that does not exist yet fails
every product page, and the house order is code first. Until the migration
is applied that side read answers 400, is logged, and renders nothing. The
catalog's detail panel and the build page do **not** print it yet; that is
logged, not done. It is not in the JSON-LD either.

**Without `capacity` a magazine saves unapproved and says so** (`missing:
["spec.capacity"]`), the same as every other category's required field — the
function never refuses an unfinished spec sheet; see **Saving and approval
are separate on purpose**. Only `fitment_confidence` other than `unverified`
turns that into a refusal. The add-a-part page's own gate still waits for a
blank required number field before offering Save.

**The TTI move leaves its `basepad_specs` row in place** (nothing in the
migration deletes) and creates an **empty** `magazine_specs` row, so
`product_data_status()` reports capacity, caliber, style and fits_models as
missing for Alex to fill. None of the old values map cleanly: `completed-mag`
is what the category now says, `17rd-xmacro` is a magazine family rather
than the maker's model list, and `capacity_change 3` is a delta, not a
capacity.

### Pending build parts → the catalog, and the needs-data page

A builder's hand-typed part is stored as a **pending custom part**
(`pending: true`, no `refId`) and shows "Pending catalog review" in
`gunforma-admin-queue.html`. Beside each one the queue offers:

- **Add to catalog** → `gunforma-admin-part.html?build=<id>&part=<index>`.
  `create_product()` re-links the part when it saves.
- **Link to existing part** → pick a product (only those in the part's
  section, by `js/build-categories.js`) and a variant; the page calls
  `relink_build_part(build, index, product, variant, variant_specs)`
  (`supabase/migrations_archive/relink_build_part.sql`).
- A part whose section has **no catalog category** (mags, holsters, paintjob,
  knife) gets a reason line and neither action.
- **Other Parts (`misc`) is the catch-all.** Add to catalog pre-selects no
  category and offers all of them; Link searches the whole catalog. Linking a
  part stored under `misc` — through either `create_product()` or
  `relink_build_part()` — **rewrites its `category` to the product's own**, so
  the DMP recoil spring typed under Other Parts renders under Recoil Springs.
  Only `misc`: a part in any other section keeps the category it was saved
  under (`supabase/migrations_archive/add_categories.sql`; the dry run in that PR shows both).

**The index is the part's ORIGINAL index in `parts_snapshot`.** The queue
renders parts in stored order, so its row index is that index.

`relink_build_part()` writes what `create_product()`'s re-link writes, **plus
`variantSpecs`**, which the queue computes with `js/variant-label.js` and the
function stores only when non-empty. It refuses a part that is not pending,
a variant that is not the product's or is retired, and **a part with
corrections in `builds.edit_history`** — the build page lays those over the
entry, so a linked part would read as the correction; it says how many. It
does not check category against section: the page restricts the picker, and
a SQL copy of the taxonomy would be a third one.

`scripts/snapshot-roundtrip.test.mjs` runs post-build's two hydration paths
and `buildPartsSnapshot()` over the exact entry the function stored in its
dry run, so a re-linked part surviving an edit-and-save is checked on every
deploy. (Its keys are compared as a set: Postgres stores jsonb keys in its
own order, so a stored row never had the writer's order.)

**`gunforma-admin-data.html` ("Needs data")** lists `products_needing_data`
by how many approved builds use each part, then fewest missing; approved
parts with no buy link (the partnership pipeline, grouped by brand); and
material family "Unspecified". Read-only: editing an existing product is
the next project, and the page says so instead of linking to a dead end.
Same gate as the add-a-part page, `noindex`, no analytics tag.

Noticed here and not fixed:

- `create_product()`'s own re-link writes no `variantSpecs`, and does not
  refuse a part that has corrections. `relink_build_part()` does both.

A second item logged here — `prevent_owner_edit_history_change()` refusing
the service role and a direct session — is fixed by `supabase/migrations_archive/part_ids.sql`,
which found the same guard refusing every visitor's flag too; see **The
flag never worked**.

## Adding an affiliate link (CSV import)

New `affiliate_links` rows come from two places:

- **`create_product()`**, for a new product's links. See **Adding a
  product**. It builds the tracked URL and never sets the sync's columns.
- **The Supabase dashboard's CSV import**, for a link on a product that
  already exists. This section covers the CSV.

Nothing else inserts into the table. The nightly sync only PATCHes existing
rows, and no page writes it.

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
**no longer exists** — see `supabase/migrations_archive/retire_is_primary.sql`. An import carrying
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

**The unpaid buy button has its own pair**, split the same way as
`js/build-url.js` ↔ `_build-url.mjs`: `js/maker-link.js` (browser global,
loaded by the catalog, the Armory and the build page — `check-script-order`
enforces the order) and `netlify/functions/_maker-link.mjs` (imported by
`product-page.mjs` and `guide-page.mjs`). Both hold `makerLink()` — the
"Buy from <maker>" / "Buy at <host>" rule — and `buyDisclosure()`, the
three-way disclosure line. `scripts/maker-link.test.mjs` runs both over the
same inputs on every deploy. See **Unpaid links to a part's own store**.

### One category list, two copies

Every `products.category` value — its `/parts/` URL segment, its plural name
("Grip Modules", for headings, tabs and sections) and its singular name ("Grip
Module", for sentences, the product page's eyebrow and its JSON-LD
`category`) — lives in two files with **identical contents**:

- `js/category-map.js` — the browser copy, a plain `<script>` global
  (`categoryPlural()`, `categorySingular()`, `productPath()`,
  `CATEGORY_KEYS`).
- `netlify/functions/_category-meta.mjs` — the server copy (`CATEGORY_META`,
  `CATEGORIES_WITHOUT_SPEC_SHEET`), imported by `product-page.mjs`,
  `parts-index.mjs` and `sitemap.mjs`.

Two copies for the usual reason (no module loader on the pages). **Every other
surface derives from them**: the catalog's and Armory's tabs and labels,
add-a-part's category list and sentences, Needs data, and the build sections
in `js/build-categories.js` (a one-category section takes that category's
plural). **One name per category, everywhere; the builder's names won**:
"Grip Modules" not "Frame Modules", "Basepads" not "Base plate", "Magazine
Releases" (plural, like the rest). "Barrels & Compensators" is one build
section over two catalog categories: layout, not a second name.

`scripts/check-categories.mjs` (every deploy) fails when the two copies differ
by a character, when a category sits in no build section or in two, when any
other file maps three or more categories to strings itself, when
`product-page.mjs`'s `SPEC_TABLES` misses a category that has a spec sheet,
and when a page reads the globals without loading `js/category-map.js`. The
build cannot see the database, so `scripts/check-routes.mjs` (scheduled,
against production) adds the live half: every category that has a product
must be in the lists, and one product per category must answer 200 at its
`/parts/` address. A category with no products cannot be hidden from anyone,
so it is not asserted.

**Adding a category** is therefore: the enum value (its own migration — see
**Adding a product**), one line in each copy, its build section, and — if it
has a spec sheet — its `SPEC_TABLES` entry and rules. The guard names whatever
is missing. `supabase/migrations_archive/magazine_category.sql` is the latest worked example;
note that the guard's "no hand-written copies" rule counts `<category>: '…'`
pairs, so a word that becomes a category (`magazine`) can turn an unrelated
map in a page into a false positive — quote its keys.

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
global by the pages that upload a build photo:

- `gunforma-post-build.html` — a builder posting their own build
- `gunforma-admin-post.html` — an admin posting on a builder's behalf
- `gunforma-admin-queue.html` — the queue's **+ Add a photo**, through
  `PhotoUploader.uploadOne()` (no grid; see **Editing a build** below)

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

#### The catalog match lives there too

A builder who cannot find a part types it by hand, and a typed part is a
pending custom part: no photo, no price, **no buy link**, and work for
whoever reviews the build. Often the part is in the catalog and they looked
in the wrong section. So `js/part-picker.js` searches the catalog for them,
in two places, on both builder pages:

- **while they type** — under the custom form's Brand / Part name inputs
  ("Already in the catalog?"), before a typed part exists
- **beside the submit button** — a prompt listing every typed part that looks
  like a catalog part, with "Use this" and "Keep what I typed"

**It only ever offers.** Nothing is replaced without a click and nothing
blocks submitting. Each page's share is two `oninput` attributes and a
`#cs-<key>` mount in `customFormFieldsHtml`, a `#unlinked-nudge` mount in the
sidebar, and one `PartPicker.renderUnlinkedNudge()` call at the top of
`renderSidebar()`. The matching, the markup and the CSS exist once.

Four things about it that are decisions, not accidents:

- **`matchIn()` is pure, and its judgement is pinned by a build check.** It
  scores each typed word by how few catalog parts contain it ("p365" says
  nothing, "407k" says everything), lets a typed brand outrank shared words
  (a Sig is not a Wilson Combat), and refuses one common word as a match.
  Every one of those fails silently in a browser — an empty mount is what "no
  match" looks like — so `scripts/part-match.test.mjs` runs it against real
  catalog names on every deploy. Change a threshold there, not by eye.
- **The sidebar prompt uses a stricter bar (`strong`) than the typing list.**
  The typing list is a glance; the prompt makes a claim and stays on screen.
  "Sig" + "Romeo Zero" is offered the Romeo-X while typing and is never told
  it "looks like" one: the catalog has no Zero, and that builder's optic is
  not the one we carry.
- **"Use this" replaces the typed part IN PLACE, and only when the add
  completes.** A product with colours goes through the colour step first and
  the builder can back out, so the intent is remembered (`pendingSwap`) and
  applied in `closePickerAfterAdd()` — the one function every add on both
  pages ends in. It is consumed by the next add whatever that add was, and
  forgotten by `PartPicker.cancelSwap()` when the builder backs out of the
  colour step (both pages' `cancelVariantPick()` call it) — otherwise adding
  that same product by hand later would still replace the typed part.
- **Typed-only sections get nothing.** Magazines, holsters and knives have no
  catalog parts, and searching for one finds things it is not (a typed "Sig
  17rd magazine" is a close match for a +3 basepad). The test is whether
  `CATALOG` has rows under that section for this pistol.

`PartPicker.init()` takes an optional `canSwap(uid)`. `gunforma-post-build.html`
passes it so a part pinned under an old-style (by-position) correction is
neither offered nor swapped — see **Corrections follow their part**. Since
corrections name parts by id, nothing is pinned unless such an entry exists.

**Not measured yet.** On 2026-10-07 the live builds held one typed part
between them, and it was a paint job. Every build so far was posted by an
admin picking from the catalog. Whether real builders type parts the catalog
already has is unknown until they arrive; the number to watch is typed parts
in catalog-backed sections per submitted build.

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

### Nor is the model question — and it is dark until its column exists

`js/gun-model.js` asks **"Which P365 is it?"** on the two builder pages and
stores the answer in `builds.gun_id` (a `guns.id`) and `builds.fcu_only`. It
owns the buttons, the
submit gate (`answered()`), the payload (`payload()`), the edit-mode read
(`hydrate()`), the summary name, and the **stock notes**: with a model chosen
the Slides section says "Stock P365 XL slide (3.7") — leave this empty unless
you swapped it", and the sections flagged `stockDefault` in
`js/build-categories.js` (trigger, slide release, takedown lever, safety) say
the factory part needs no entry.

That last part is the reason it exists. A build named its platform and nothing
narrower, so the only way to say XL or XMacro Comp was to type the factory
slide in as a part — and thorough builders typed the factory slide catch and
takedown lever in with it. Rows with no buy link, on the builds posted by the
people most worth having.

```js
GunModel.init({
  state:    () => state,          // reads state.platform; owns state.gun,
                                  //   state.gunFcuOnly, state.gunNotListed
  mount:    '#gun-model-mount',   // inside #card-platform, so the live-build
                                  //   lock makes it inert with the pistol
  onChange: () => { renderParts(); renderSidebar(); },
  locked:   () => editState.approvedLock,   // post-build only
});
```

Mount it **before the first `renderParts()`** — both builder pages call
`GunModel.sectionNoteHtml()` and `GunModel.answered()` from their first
render, and `check-script-order` holds the tag in place.

**A stock slide is not a part, and an absent slide is not a stock slide.**
Nothing is written to `parts_snapshot` for a factory slide, so the
whitelists, the Armory, the review queue and `part_ids` have nothing to
learn — do not "fix" that by writing a `{stock:true}` row. But to every
READER a build with no slide entry has an **unknown** slide, not the
model's. The builder pages' stock note is the one place that still reads
the absence as "still the factory one"; it is a description inferred from
`gun_id`, it is the hole named under **gun_id is provenance, never
fitment** below, and nothing else may copy it.

**Three answers, two columns:**

| the builder picked | `gun_id` | `fcu_only` |
|---|---|---|
| a factory model | `guns.id` | false |
| **P365 FCU only** | NULL | **true** |
| Not listed | NULL | false |

"Not listed" is the same row as "nobody asked" (every build before this). The
form tells those apart only while it is open (`state.gunNotListed`); a build
reopened that way is asked again. `payload()` always sends both columns
together — the check `builds_fcu_xor_gun` refuses `fcu_only` beside a model,
and sending one alone would leave the other's old value in place.

**FCU only is not a model, and must not become a row in `guns`.** It means the
build started from a bare fire control unit — the serialised internals — and
everything around it was chosen. `guns` is "factory models" to the catalog's
model picker, the optic-cut table, `platform_skus` and the gun hubs; a row
with no slide length, no barrel and no grip class would have to be
special-cased in every one of them. Two things follow, and the second is for
whoever builds a fit question over builds:

- The Slides section says the **opposite** of what it says for a model: "An
  FCU build has no stock slide — add the slide you used." The trigger, slide
  catch, takedown lever and safety keep the factory-part line, because those
  *are* the fire control unit.
- **A build with no slide part has an UNKNOWN slide.** Not the model's
  stock slide: FCU build or factory model, the rule is the same. Anything
  that fits barrels, compensators or optics by slide length, thread or cut
  takes the answer from the slide PART when there is one, and when there is
  not it has **no answer** — filter nothing, show nothing, never substitute
  the model's slide. Two reasons that are not caution: the owner of a
  factory model may have swapped the slide, and most models carry two
  optic cuts by SKU, so even a confirmed-factory slide has no single cut
  until the form asks which SKU. The form does not ask yet; until it does,
  a length-, thread- or cut-dependent question about a slide-less build is
  unanswerable, and must read that way. See **gun_id is provenance, never
  fitment** below.

**The model travels with the platform.** `builds_gun_fkey` is composite,
`(gun_id, platform_id) → guns`, so a model must belong to the build's
platform and the two columns cannot disagree. Any writer that changes
`platform_id` must clear or replace `gun_id` in the same statement — the
editor's "Change pistol" calls `GunModel.reset()`, and both columns go in one
UPDATE. On a **live** build `gun_id` is on
`restrict_owner_edits_on_approved_build`'s blocked list, beside the platform.

**It is dark until `supabase/migrations_archive/builds_gun_id.sql` is applied**, because the
house order is code first:

- `probe()` asks PostgREST for `builds.gun_id` once per page load. Any error
  means "not there": the question is never drawn, `answered()` never blocks,
  `payload()` is `{}`, `hydrate()` does nothing. The pages behave exactly as
  they did before the file existed.
- `hydrate()` reads `gun_id` in a query **of its own**. Named in the editor's
  select list, a missing column would fail the whole load.
- `gunforma-admin-queue.html` does the same with `loadGunModels()` — a side
  read whose failure shows nothing. So the model is **not in
  `reviewSignature()` yet**: `ensureUnchanged()` re-reads with `BUILD_FIELDS`,
  and a signature naming a field the re-read lacks would refuse every
  approval. Until that moves, a builder who changes only the model under a
  reviewer is not caught by the re-check.

**Once the migration is applied**, the first change after it should: put
`gun_id` in `BUILD_FIELDS` and `gun` in `reviewSignature()`, delete
`loadGunModels()`, and — in the same commit — either delete the probe or
leave every tolerant read alone. Naming the column in one select while the
probe still guards the rest is the half-state that breaks.

**Not done yet, on purpose:** the public build page and `build-og.mjs` still
say "SIG P365". They read through a select that would fail before the column
exists, and the server copy and the page are held byte-for-byte by
`check-canonical-coupling`, so that change waits for the migration and goes in
as its own PR. The model will **never** filter the picker: a 3.1" gun is
offered 3.7" barrels today, and the fact that could narrow that is the slide
PART in the build, which nothing reads for fit yet either.

### gun_id is provenance, never fitment

**`claude/gun-identity-decision.md` is the decision record** — the
reasoning, the per-family join table for builds-as-proof, the confirmed-
default chip that replaces the silent stock slide, and the phased plan with
its triggers. This section is the rule; read that file before building a
guide family or anything that renders the model.

`builds.gun_id` records what box a build came in. It never answers a
fitment question. On the P365 the FCU is the firearm; slide, barrel and grip
are swappable, so the factory model name is history, not a description.

- `gun_id` is for browse/filter and a **"Started as: <model>"** line. NULL
  renders nothing — never a fallback to "SIG P365".
- A guide's builds-as-proof section joins on **the attribute the guide is
  about, from the build's parts**: slide optic cut for red dots, grip
  housing class and magazine family for grip modules, barrel length + thread
  pitch + comes_with_barrel for comps, grip light rail type for lights.
- **Never route a build onto a guide by `gun_id`.** A build labeled
  "P365 XL" running an aftermarket RMR-cut slide must not appear under "red
  dots that fit the P365 XL".
- A factory slide is not in the snapshot and therefore has no recorded cut.
  **Do not infer it from the model** — most models have two cuts by SKU. The
  build form must ask the SKU when the model is ambiguous. Until it does,
  factory-slide builds cannot be red-dot proof.
- `fcu_only = true` renders **"FCU build — no factory slide, barrel or
  grip"**.

Two strings used to treat the model as a description and were cut back to
the name: the form hint in `js/gun-model.js` ("What it started as", nothing
after the dash) and the review queue's model line (`gunModelHtml()`, no
derived barrel length, "built-in comp" or "no stock slide"). The stock-slide
note in `sectionNoteHtml()` is the remaining instance, left in place on
purpose: it is the architectural hole above, and it needs the SKU question,
not a string edit.

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
not hand-listed, so a new section declares its facts once. A section holding
one category takes that category's plural from `js/category-map.js`, **which
must load first** (`check-script-order.mjs` enforces it; the module throws
without it). The only hand-written map is `LEGACY_SECTION_ALIASES`: retired
keys that may sit in old snapshots fold into the section that replaced them —
`other_parts` → `misc` (Other Parts), `sights` → `sight` — so they never open
a second heading with the same name.

**Other Parts is the `misc` section, renamed.** Its key stays `misc` (every
part typed there was saved under it), it is backed by the `other` catalog
category, and it keeps the typed-in form. It is the catch-all, so it carries
`anyCategory`: the review queue's link picker and add-a-part offer every
category for a pending part from it, and linking one rewrites its category to
the product's own (see **Pending build parts**). `other` is a
`products.category` value and `other_parts` a retired section key; neither is
ever used as the other, and `check-category-labels.mjs` asserts it.

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

**The catalog's names are no longer a separate vocabulary.** This section
used to say the catalog's own `CATEGORY_LABELS` ("Frame Modules") were a
different vocabulary from the build's sections and must not be merged. That
was the drift: one part had four names depending on the page. They are one
list now — see **One category list, two copies** above.

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
calls `signInWithOtp` or `verifyOtp`, and the only `updateUser` calls set a
password (the claim page, and the reset form on the sign-in page), which sends
no email. If an email-change feature is
ever added to the profile page, that template goes live as Supabase's stock
default: no logo, no brand, no warning.

This mirror drifted three times in a single day. Both directions fail silently:
editing the repo file sends nothing, and editing the dashboard leaves the repo
describing an email that does not exist. `check-all.sh` does not inspect these
files and cannot — the live template is readable only through the Management
API. The only guard is changing both in the same sitting.

**Never delete an invited user in the dashboard.** `launch-invite` links the
build and its photo rows to the account the moment the invite is sent, and
`builds.user_id → profiles`, `profiles.id → auth.users` and
`build_photos.user_id → auth.users` are all `ON DELETE CASCADE` — the build
goes with the user. `scripts/launch-invites.js --resend <email>` sends a fresh
link and `--release <email>` undoes an unclaimed invite safely; both are
actions on the `launch-invite` function. `claude/operations.md`, "The invite
trap", has the table. `scripts/launch-invite.test.mjs` runs every branch
against a fake that implements the cascade — run it before deploying the
function (it is not a build check: it needs Node 22.13).

**A reset link signs the person in, so the sign-in page must hold them.**
`gunforma-signin.html` tells a recovery arrival from any other signed-in visit
by `type=recovery` in the URL hash (and, second, by the client's
`PASSWORD_RECOVERY` event), and shows a "choose a new password" form instead
of redirecting. Before that form existed the page redirected like any sign-in:
the reset email's link worked, no password was ever chosen, and nothing
failed. The hash is read in an inline script placed BEFORE
`js/supabase-client.js`, because creating the client consumes the hash. With
supabase-js 2.117.2 a later read still sees it, so the order is a precaution
against an unpinned CDN library, not a measured failure.

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

## Editing a build after it is submitted

**One editor: `gunforma-post-build.html?id=<uuid>&mode=edit`.** Who it lets
in, and what they may change, by status:

| status | its owner | an admin, in this editor | an admin, from the review queue |
|---|---|---|---|
| draft | everything | only if the build has no owner | — |
| **pending** | **everything; it stays pending** | only if the build has no owner | correct, add and remove parts |
| rejected | everything; saving resubmits it | only if the build has no owner | — |
| approved | name, description, activity | only if the build has no owner — then everything, and it stays live | correct, add and remove parts |

**Pending was closed until 2026-10, and only by the page.** The profile card
was a dead `<div>` and the editor refused the build, so the one build a
builder most wants to fix — the one submitted a minute ago with a part
missing — could only be deleted and posted again. RLS allowed the edit all
along (`Owners can edit their own builds` has no status clause, and the
`build_photos` owner policies name `draft` and `pending`).

**An admin edits a build only when nobody owns it** (`user_id is null`):
posted from `gunforma-admin-post.html` and not claimed yet. Those had no
editor at all — the queue's per-part "Edit" writes a *correction*, and Undo
only moves a build back to pending. The queue links to the editor for them
("Edit build →"). The save sends **no `status`**, so a live build stays live
and a pending one stays pending, and it filters on `user_id is null`.

**An admin is deliberately not let into the editor for a build that has an
owner.** A rewrite from the editor would leave no record. The tool for an
owned build is the review queue's per-part **Edit / Remove / + Add a part**
(see **A reviewer's part changes** below): parts only, each change logged in
`edit_history` and shown to the builder. Name and description stay the
builder's, and so do the photos with two exceptions: the queue can **+ Add
a photo** (below the photo grid) for the builder who sends one in after
posting, and it can **reorder** them (◀ / Make hero / ▶ under each gallery
thumbnail). Removing or replacing a photo on a live build is still **Undo**
(back to pending), they edit it, approve it again.

**+ Add a photo** (2026-10) is `PhotoUploader.uploadOne()` from the queue:
the same validate → redact → normalize → upload pipeline as the two posting
pages, by construction — `uploadOne()` and the slots' `processFile()` call
the same three functions, so do not give the queue a copy of any of them.
No migration carried it: "Admins can add photos to any build" (INSERT,
`is_admin()`) already admits the row, `trg_enforce_build_photo_limit`
refuses a fifth photo (the button hides at four so that refusal is a
backstop), and the storage object goes under the **admin's** uid because
`build_photos_owner_insert` requires the first path segment to be
`auth.uid()`. The row's `user_id` is the build's **owner**, so they can
delete it like any of their photos (after an Undo, on a live build); on an
unowned build it is the admin's id, the placeholder launch-invite moves to
the builder with the rest. `ensureUnchanged()` runs twice — before the
redact modal and again right before the insert — and a refusal discards the
uploaded pair (`PhotoUploader.removeUploaded()`). Deliberately **not**
logged to `edit_history` and no notification: the builder asked for the
photo, and `notify_build_changes()` would need a new kind, the build page a
renderer, `PartIds.changeText()` a sentence. If adds start happening that a
builder did not ask for, that logging is the next change.

**Reorder / Make hero** (2026-10) is the companion: ◀ / ▶ swaps a gallery
photo with its neighbour, Make hero swaps it with the hero. Order
everywhere — the build page, the home cards, the OG image, the queue — is
"hero first, then the rest by position", so the write is just those two
columns: the build's photos are renumbered 1..n in the new order with
`is_hero` on the first, one UPDATE per row that changed (≤4), which also
normalises any legacy duplicate positions. **Demotions are written before
the promotion**, because `build_photos_one_hero_per_build` is a unique
partial index — one `is_hero` per build — and promote-first is refused
with a unique violation mid-sequence. That is exactly how this shipped
broken on its first preview: the index was invisible to a `pg_constraint`
dump, because a standalone unique index lives only in `pg_indexes` — check
both before declaring what a table enforces. "Admins can edit any build
photo" (UPDATE, `is_admin()`) admits it and the path-tampering trigger
guards other columns, so again no migration. A failure partway can leave a
half-applied order — at worst briefly no hero, never two; every reader
falls back deterministically, the error path reloads and says so, and one
more click finishes. Because the queue
now writes order, `reviewSignature()` includes `position`, so a builder
re-ordering a pending build under an open review trips `ensureUnchanged()`
like any other photo change. Same logging stance as the add: arrangement,
not content, so no `edit_history` entry and no notification.

### A build in review has two writers

That is the reason pending was closed. It is handled where each write
happens, on both sides, and none of it is a lock:

**The owner's save is conditional on `updated_at`.** It is read when the
build loads and sent as a filter; the UPDATE asks for its row back, and a
save that matches nothing is reported, not toasted as "saved". Without it,
an owner who opened the form before a reviewer re-linked a part would put
the old list back over the link. The stamp is refreshed from every save,
because "Save as draft" does not leave the page.

**Every reviewer write goes through `ensureUnchanged()`** in
`gunforma-admin-queue.html` first — Approve, Reject, Save correction and
Link to existing part. It re-reads the build and compares it with
`REVIEWED[id]`: `reviewSignature()` (words, pistol, parts, and photos by id)
of the build **as the reviewer was last shown it**. A mismatch reloads the
queue, says so, and writes nothing. Approve, Reject and Save correction are
then also conditional on the `updated_at` that re-read returned, with a row
count.

Three things about that are easy to undo by accident:

- **It compares with `REVIEWED`, not with `BUILDS`.** `loadBuilds()` runs
  after every action on the page and silently swaps fresh rows into
  `BUILDS`. Compared with that, "save a correction, then approve" would
  publish whatever the builder changed in between — fresh against fresh.
  `REVIEWED` moves only in `selectBuild()`, in `ensureUnchanged()`'s own
  refusal, and after the reviewer's own link. Do not set it in
  `loadBuilds()`.
- **Photos are compared directly, not through `updated_at`.** A photo row
  can be added or removed without touching `builds`, so the stamp alone
  would miss the one change that most needs a second look.
- **Corrections and links need it more than Approve does.** They are
  WRITTEN against a part by its **index** — the one the reviewer is looking
  at — so against a list the builder has since shortened they land on a
  different part, with no error. (A correction then follows its part by id;
  see **Corrections follow their part** below. Writing it to the right part
  in the first place is this check's job.) "Add to catalog" has the
  same exposure across a page load, so `gunforma-admin-part.html` re-reads
  the part at that index just before Save (`buildPartMoved()`) and stops if
  it is not, key for key, the one the page was opened for.

What is left is the gap between a re-check and its write: milliseconds, and
closed for anything on the `builds` row by the `updated_at` condition. A
photo swapped inside that gap is not caught, and `relink_build_part()` and
`create_product()` take no `updated_at` at all. Closing those properly means
a database-side check, not another client one.

### Corrections follow their part: every part has its own id

**Every element of `parts_snapshot` carries `partId`** — 12 lowercase hex
characters, unique within its build, assigned once and never changed. **A
correction in `builds.edit_history` names its part by that, as `part_id`**,
beside the `part_index` it was written at. One rule decides which part an
entry belongs to, and it lives in **`js/part-ids.js`** (`window.PartIds`),
loaded by the queue, the build page and both builder pages:

- an entry with a `part_id` belongs to the part with that `partId`, **and
  only to it**. If that part was removed, the entry matches nothing — it
  never falls back to whatever now sits at its old position, because that
  fallback IS the bug this replaced;
- an entry with only `part_index` (written before ids) is matched by
  position, as every entry used to be, and the editor still **pins** parts
  0..that index (`PartIds.pinnedThrough()`). None existed when ids shipped;
- anything else (the `resubmit` marker) is not a correction.

**What it replaced.** Corrections used to be matched by position. An owner
who removed an earlier part shifted the list under them, and the build page
laid "name corrected to X" over a different part — no error anywhere; the
harness reproduced exactly that, C wearing B's correction. The editor pinned
every part up to the last corrected one to stop it, which locked a builder
out of removing the very part a reviewer rejected the build for. Now a
removed part takes its corrections with it, and nothing is pinned.

**Where ids come from:**

- `PartIds.ensure(state.parts)` before every save on both builder pages
  (`scripts/part-ids.test.mjs` counts saves against calls). It keeps any
  valid id, re-ids a duplicate, and mutates the page's state so the id stays
  put across later saves without a reload.
- **`trg_assign_part_ids`** (`supabase/migrations_archive/part_ids.sql`), BEFORE INSERT OR
  UPDATE OF `parts_snapshot`, for any writer that sends a part without one —
  the parked Armory, a script, SQL by hand, a tab opened before the deploy.
  It only ever adds an id. **A part that arrives without one but is identical
  to a part already on the row (every other key equal) keeps that part's
  id**, so a page that drops the key does not re-id the list and orphan
  every correction. Each old id is claimed once; an id a part brings itself
  is reserved for it.
- Both re-link paths keep the id without changing: `relink_build_part()` and
  `create_product()` merge into the existing part (`v_part || …`).

**Carry it everywhere a part is copied.** `partId` is in all five snapshot
whitelists (`check-snapshot-fields.mjs`) and both post-build load paths
(`snapshot-roundtrip.test.mjs` has fixtures carrying one). A load path that
drops it re-ids the part on the next save — the trigger's identical-part
rule usually rescues that, but a part that also changed would lose its
corrections, on a page that renders perfectly.

**The database matches by id too.** `contest_build_part(build, index)`
keeps its signature: the page sends the position it rendered, and the
function reads the `partId` there and finds the correction by it.
`relink_build_part()` counts "this part's corrections" the same way, so a
correction left with a stale `part_index` neither blocks the wrong part nor
lets the right one through. `build_part_flags.part_id` records which part
was flagged.

#### The flag never worked

"This looks wrong — flag for review" on a corrected part calls
`contest_build_part()`, which is `SECURITY DEFINER` — but the
`edit_history` guard (`prevent_owner_edit_history_change`) identifies the
caller with `is_admin()`, and the caller is still the visitor. So every
non-admin flag was refused with "Only admins can modify edit_history", the
page said "Something went wrong", and on 2026-10-09 the database held zero
contested entries and zero flag rows. Found by the dry run of
`supabase/migrations_archive/part_ids.sql` (Claude Code, #152), not by anyone using the site.
**The definer context changes whose privileges a statement runs with; it
does not change who `auth.uid()` says the caller is**, so every trigger the
function's writes fire still sees the visitor.

(Since 2026-10 the link is offered only in the builder's own "What Gunforma
changed" list; visitors no longer see corrections at all.)

Fixed in the guard, narrowly: for anyone who is not an admin or a trusted
backend, the one change allowed to `edit_history` is marking existing
entries `contested` on a build that is live and stays live — same entries,
same order, every other key equal. Adding, removing, rewriting, reordering
and un-contesting are still refused (eleven cases, in the PR). The service
role and a direct session now pass by name, which closes the item logged
under **Pending build parts**. The page tells a signed-out visitor to sign
in, and decides what the toast says by reading the row back — the RPC
returns nothing either way, and "nothing came back" is what the broken
version returned too.

Still addressed by **index**, deliberately: the queue's "Link to existing
part" and add-a-part's re-link. They act on the list the admin is looking
at and are guarded by `ensureUnchanged()` / `buildPartMoved()` above; an id
would not make them safer, and changing `create_product()`'s signature
would.

Not done, logged: `create_product()`'s re-link still does not refuse a part
that carries corrections (`relink_build_part()` does); with ids, such a
correction would show over the linked part, as before.

### A reviewer's part changes, and who sees them

Since 2026-10 the review queue can **correct, add and remove parts on a
pending or a live build, whoever owns it** — for the builder who could not
enter a part properly, and for the live build where a commenter points out
the wrong model. It is meant to be occasional; the queue says so beside
every action ("the builder is notified and sees every change").

**Every change is written INTO `parts_snapshot`, and logged.** The log is
`builds.edit_history`, append-only:

| change | entry |
|---|---|
| correction | `{ part_id, part_index, field, from_value, to_value, edited_by, edited_at, status, reason? }` |
| added part | `{ kind: 'part_added', part: {partId, category, brand, name, …}, edited_by, edited_at, status, reason? }` |
| removed part | `{ kind: 'part_removed', part: {…}, … }` |

Corrections used to live *only* in the log: the queue laid each `to_value`
over the part, the public page never did, so a corrected build went on
showing the wrong name to every visitor and to Google. Nothing lays anything
over a part now — the stored row is the part, and the log is a record.
`supabase/migrations_archive/admin_part_changes.sql` (applied 2026-10-13 as `20261013033628`)
wrote the one correction that existed then into its build.

**Added and removed parts carry their part under `part`, never a top-level
`part_id`.** They are not corrections. Everything that matches corrections
to parts — `PartIds.isCorrection()`, `contest_build_part()`,
`relink_build_part()`'s "this part has corrections" refusal, the editor's
pin — would otherwise read "added by a reviewer" as "corrected", and refuse
to link the very part a reviewer just added. `PartIds.changes()` is the list
of a reviewer's changes (both kinds), `PartIds.changeText()` the sentence
for one; the queue and the build page both use them.

**Catalog parts:** brand and name are read-only in the queue's Edit — they
are the product the row links to. The fix for a wrong catalog part is
Remove, then + Add a part. A part with corrections still cannot be linked
("Link to existing part"; `relink_build_part()` refuses it); Remove + Add is
the way round that too.

**+ Add a part** offers the builder's own sections, grouped and ordered
(`js/build-categories.js`), and the builder's own catalog query: live,
not discontinued, fits the build's pistol. A section with no catalog
(Magazines, Holsters, Tactical Knife) or a part the catalog lacks is typed —
pending, like a part a builder types, so Add to catalog / Link still apply.
The row is built by `snapshotRow()`, which is on
`check-snapshot-fields.mjs`'s list.

All three go through `writeParts()`: `ensureUnchanged()` first, then one
UPDATE of `parts_snapshot`, `edit_history` and `tier`, conditional on status
and `updated_at`, counted, then `markReviewed()` from the row the UPDATE
returned (not from the reload — a builder edit landing in between must still
trip the next check). There is no database function: RLS already lets an
admin update any build, and `restrict_owner_edits_on_approved_build()`
admits admins.

**Who sees the log: the builder and admins.** The public build page shows
the parts and nothing else — no "corrected" badge, no before/after (there
used to be one on every corrected part, for everyone). The owner, signed in,
sees **"What Gunforma changed"** above the parts, newest first, with the
reviewer's note, a send-back link on corrections (`contest_build_part()`,
live builds only) and an email address. **This is what the page shows, not
access control:** `edit_history` is a column of a public row and readable
through the API. Hiding the column is a separate change (a column revoke
plus a function the owner reads it through), logged.

**The builder is told once, by the database.** `trg_zz_notify_build_changes`
(BEFORE UPDATE, named to run after every guard and after
`stamp_build_review`; `supabase/migrations_archive/admin_part_changes.sql`, applied 2026-10-13
as `20261013033628`, after #163 was live) keeps `builds.changes_notified_count` — how many log
entries the builder has been told about, a **position** because `edited_at`
is the reviewer's browser clock. On a live build with entries past it, it
writes ONE `kind = 'changes'` notification listing them and moves the
counter. While the build is in review it holds them, so they arrive with the
approval. Nobody owns the build, or the reviewer owns it: the counter moves,
nobody is told. Only an admin or a trusted backend moves the counter. No
email yet — the row is stamped `email_sent_at` at insert so a sender added
later starts from new rows; see the file's header.

### Only a reviewer can approve or reject

**The database enforces the review queue; the pages do not have to.**
`trg_restrict_build_status` on `builds` (BEFORE INSERT OR UPDATE,
`supabase/migrations_archive/restrict_build_status_to_reviewers.sql`, applied 2026-10-06 as
`20261006235015`): a caller who is not an admin and not a trusted backend
may insert a build only as `draft` or `pending`, and may change a status
only *to* `draft` or `pending`. Writing `approved` or `rejected` is refused
with `42501` and a sentence a person can read.

Before it, any signed-in user could `update builds set status = 'approved'`
on their own build, or insert one already approved. The owner policies check
`auth.uid() = user_id` and nothing else, and `status` is a column owners
must be able to write (draft → pending is how a build is submitted) — RLS
says which rows, never which values. The older guard,
`restrict_owner_edits_on_approved_build`, only looks at builds that are
*already* live, so it said nothing about how one becomes live. Nothing on
the site did this; the anon key is public and the browser console is one
line away. Checked before closing it: it had never been used.

Who passes: `is_admin()` (the queue's approve / reject / undo, and
`gunforma-admin-post.html`, which inserts `approved`) and
`is_trusted_backend()` (a service-role request, or a session with no request
context — the SQL editor, a migration). **A new server-side path that sets a
build's status must run as one of those**, or it is refused exactly like a
stranger; that is the "service_role bypasses RLS, not triggers" trap above,
and here the service role is let through by name.

**Do not drop it to make something work.** The rollback file reopens the
hole. If the guard refuses a caller it should admit, admit that caller in
the function.

The file's header has the measurement, and its footer the seventeen-case
dry run and the same seventeen re-run against the applied guard.

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
