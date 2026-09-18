# refresh-affiliate-prices

Nightly sync of OpticsPlanet product prices and stock into
`affiliate_links.street_price`, `.in_stock` and `.last_checked`.

Runs from GitHub Actions on cron (see
`.github/workflows/refresh-affiliate-prices.yml`) or from the CLI.

## What it touches

- **Reads:** OpticsPlanet's Awin product datafeed (over the internet),
  `affiliate_links` and `product_variants` (via Supabase PostgREST).
- **Writes:** three columns on `affiliate_links` rows whose partner is
  `OpticsPlanet (Awin)`: `street_price`, `in_stock`, `last_checked`.

Nothing else. Not `affiliate_url` (that carries our own placement-specific
clickref tracking, distinct from the feed's `aw_deep_link`). Not
`products.lowest_price`. Not any other partner's rows.

## Matching

- Primary key: the feed's `merchant_deep_link` is canonicalized (host
  lowercased, `_iv_*` product-selector params preserved, everything else
  dropped) and looked up against `affiliate_links.url` canonicalized the
  same way.
- When a canonical URL maps to more than one variant (a small set of
  OpticsPlanet pages sell color/finish options via an on-page selector
  rather than distinct URLs), disambiguation falls back to matching
  the feed's `merchant_product_id`/`mpn`/`product_id` against our
  `product_variants.sku`.
- Ambiguous rows that don't disambiguate are logged and skipped; nothing
  is written.

## Safety

- Failed fetch → hard exit before any DB write.
- Match rate below `MATCH_RATE_FLOOR` (default 70%) → hard exit before
  any DB write. Prevents a broken feed shape from wiping the field
  landscape with wrong data.
- Unmatched existing rows are never blanked; they keep their prior
  values and their IDs are logged.

## Running locally

```
cd scripts
npm ci
AWIN_FEED_URL='https://productdata.awin.com/datafeed/download/apikey/…' \
SUPABASE_SERVICE_ROLE_KEY='eyJhbGciOi…' \
DRY_RUN=true \
node refresh-affiliate-prices.mjs
```

Drop `DRY_RUN=true` (or set to `false`) to actually write. The GitHub
Actions manual-dispatch trigger defaults to dry-run — flip the checkbox
to write.

## Secrets

Both live in **GitHub → repo Settings → Secrets and variables → Actions**:

- `AWIN_FEED_URL` — the Create-a-Feed URL from the Awin publisher UI.
  Contains an API key in the path; treat as a credential.
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase Dashboard → Project
  Settings → API. Bypasses RLS; do NOT put this in any site-runtime
  function or client-side code.

Both are read by the workflow at run time via `${{ secrets.… }}` and
never appear in logs.

## Rerunning by hand

`Actions` tab → `Refresh affiliate prices` → `Run workflow`. Uncheck
the dry-run box to write.
