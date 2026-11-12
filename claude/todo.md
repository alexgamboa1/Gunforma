# Gunforma — open items

Phase 1 of the Armory design (2026-11-10/11 ship doc) is **complete and
live** as of 2026-11-11: #244 (start → model → build list → part pages,
stock parts as rows, all 18 catalog categories, `js/armory-fit.js` as the
one verdict module), #245 (product-page "Add to Armory build" + "Fits your
build" line), #246 (`/l/<share_id>` share links, anonymous saves through
the SECURITY DEFINER RPCs, the Share / Save split with the on-page share
panel), #247 (comments on `/l/`, signed in only, with `armory_comment`
notifications) and #248 (Reddit export in build-list order, rich copy).
Both migrations (`20261111120000_armory_share_links`,
`20261111150000_armory_build_comments`) are applied. CLAUDE.md's
**"The Armory: the shipped phase-1 builder"** section is the behaviour
reference; this file is what's left.

## Follow-ups, logged during phase 1

- **Turnstile via a Netlify function** (logged in #246). The anonymous
  save's caps (20/day per hashed address, 500/day global, inside
  `create_armory_build`) are the only abuse brake; a serverless verify
  step in front of the anonymous create would let the caps rise without
  inviting scripts. Until then a capped reader sees "Sharing is busy
  right now. Sign in to save your build."
- **Title moderation / the report button** (loadouts-spec §7.5 — the one
  piece of that spec still unbuilt; `gun_guides.is_removed` already
  exists). It is the gate for ever indexing Armory builds: every `/l/`
  page stays noindex (meta + header, never in the sitemap) until a
  reader-visible title can be reported.
- **`armory_comment_reports` has no admin surface.** Readers can report
  a comment (the insert is live, duplicates read as reported) but
  nothing lists the reports — an admin today would query the table by
  hand. Small admin-queue section, or a count on the existing admin
  pages.
- **Whichever-merges-second debt is paid**: #247 was rebased past #248;
  no open Armory branches remain (`armory/phase1-*` deleted 2026-11-11).

## Known data gaps (read 2026-11-11, production, read-only)

- **2 of 11 P365 guns have no `gun_stock_parts` rows**: P365 AXG Legion
  and P365 XF DH3 AXG. A magwell judged against their stock grip comes
  back unjudged until the rows exist.
- **2 live grips have no `fit_tier`**: `ecm-precision-r11-fuse-comp` and
  `ecm-precision-r11-edge-fuse-comp` (`frame_specs.fit_tier` null), so
  they read "Fit not confirmed" in the Armory and on their pages. Every
  live slide is tiered; every P365 gun has its `armory_blurb`.
- **`compensator_specs.fit_result` is null on every comp** (0 of them
  set) — makers don't publish it, so an add-on comp bridging a tier
  reads "Comp flush / partially flush" unconfirmed. Owner fit reports
  were always the plan for filling it; that feature doesn't exist.
- **480 variants carry `handedness = 'ambidextrous'`**, most meaning
  nothing (the bulk-load artifact; real only on frames and mag
  releases). Deferred to the field review — see CLAUDE.md, "Adding a
  variant to an existing part".
- The TTI X-Macro completed mag's `magazine_specs` row was created
  empty by the category move (capacity / caliber / style / fits_models
  for Alex to fill — it sits in Needs data until then).

## Older items still logged in CLAUDE.md, in place

Each of these is documented where it bites; listed here only so one file
holds the set: `parts-index.mjs` / `profile-og.mjs` still carry their own
PostgREST readers (profile-og keeps the bad-body→404 shape); folding
`product-page.mjs` / `parts-index.mjs` into `_page-chrome.mjs` (its own
PR); hiding `builds.edit_history` from the public API; `create_product()`'s
re-link writing no `variantSpecs` and not refusing corrected parts; a
report script for `link_clicks_real` that encodes the `renderer-check`
filter; a `frame_housing_fit` table to replace `MAKER_STATES_FUSE_FIT`;
copying maker photos into our own storage; the admin edit-a-part /
retire-a-variant page; the profile's Favorite parts Remove folded into
`js/favorites.js`; `restricted_states` on the catalog panel and build
page; P320's unregistered slide/barrel lengths.
