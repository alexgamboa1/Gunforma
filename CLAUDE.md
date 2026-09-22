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

The variant-label axis logic — which axes vary across a product's listings, and
how a variant is labelled — exists in **four** copies. Change all four, or the
same variant gets different labels depending on which page you are looking at:

- `js/affiliate.js` — the browser module, used across the site
- `netlify/functions/product-page.mjs` — the server-rendered `/parts/:category/:slug`
  page. Dependency-free by design, so it cannot import the browser module.
- `gunforma-parts-catalog.html` — inline copy for catalog cards
- `gunforma-build-detail.html` — inline copy for a build's parts list

The axis columns they read (`reticle`, `reticle_color`, `color`, `optic_cut`,
`bundle`, `clamp`, `manual_safety_variant`) feed **labels only**. Nothing filters
on them, and the product page's spec table reads `optic_specs` instead — so a
wrong axis value shows up as a wrong label next to the buy button while the spec
table underneath still reads correctly. That split is what hid 16 Sig Sauer
Romeo variants whose `reticle` was swapped between the 3 MOA and 6 MOA rows.

`variant_label` overrides the computed label verbatim when non-empty.
