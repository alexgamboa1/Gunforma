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

`products` has **two** foreign-key relationships to `product_variants`:

- `product_variants.product_id → products.id` (one-to-many — almost always the one you want)
- `products.lowest_price_variant_id → product_variants.id` (many-to-one)

So a bare `product_variants(...)` embed from `products` is ambiguous and PostgREST rejects
the **entire query** with `PGRST201`. Always name the FK:

```js
products!inner(id, name, product_variants!product_variants_product_id_fkey(msrp, is_default))
```

This fails quietly: `supabase-js` returns an error object rather than throwing, so the page
renders its generic "could not load" state with nothing in the console. It has shipped
broken twice. Before pushing:

```bash
scripts/check-embeds.sh
```

Embeds from `affiliate_links` and `variant_images` each have exactly one FK to
`product_variants`, so their bare embeds are correct — do not "fix" those.

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

## Duplicated logic to keep in sync

The variant-label axis logic in `js/affiliate.js` (which axes vary across a product's
listings, and how a variant is labelled) is **mirrored** in
`netlify/functions/product-page.mjs`, because the function is dependency-free and cannot
import the browser module. **Change both**, or the product page and the rest of the site
will label the same variant differently.
