# Prompt — variant selection (updated 2026-09-29, post share-test)

Work from main (currently d04ff2d), not gallery-swap.
Send this to Claude Code AFTER the first five claim messages are out
(see claude/launch-handoff.md §1). Run it BEFORE posting the remaining ~15 builds.

---

Gunforma. Two things first, then the real work.

PRE-FLIGHT — one PR, under an hour, merged before anything below:

1. Alex posted test builds from alt accounts on 2026-09-29 to verify
   post → approve → claim → share. Find them (created that day, owner is not
   fireflyt40 or Alex's main account), confirm with Alex by listing them,
   then unpublish. Do not delete rows — set them unpublished so the claim
   history survives. Confirm the sitemap no longer lists them.

2. Share card photo renders in iMessage but not in Reddit chat. The og tags
   on /b/ pages are correct (1200×900, absolute URL, alt, width/height —
   verified). og:image points at /.netlify/images?url=<supabase>&w=1200&h=900
   — a live transform with no og:image:type. Test in this order and stop at
   the first that explains it:
   a. Fetch the og:image URL with a Reddit-like user agent and a 3-second
      timeout. Report status, content-type, bytes, time.
   b. If slow or wrong content-type: add og:image:type image/jpeg and make
      sure the transform response is cached at the edge so the second fetch
      is fast. Re-test.
   c. If a and b are clean, it's Reddit chat not rendering images for
      external links — say so, no code change, note it in ops-tracker-notes.
   Whatever the answer, one line in the tracker.

Do NOT shorten the /b/ URL (full UUID in the slug). Logged as a later change;
it gets expensive the day the sitemap is crawled, so it needs its own
redirect plan.

---

Builders must be able to pick the specific variant of a part — the FDE
barrel, not "barrel" — after choosing the product, so the build page shows that
variant's photo, label and price. The buy link stays product-level: affiliate
links are per product, and a viewer picks colour at the retailer. A "See other
options" panel per part on the build page lists every variant with its photo or
swatch and the retailer buttons.

Two PRs. A = what the build stores and what reads it. B = the picker and the
options panel. Do A first. Do not open a UI file until A is merged.

Read claude/ops-tracker-notes.md and claude/loadouts-spec.md in the project
first, and CLAUDE.md in the repo. Do not re-derive what is written there; do
verify every claim below against main and the live database before building on
it — every session so far has found at least one wrong.

WHY NOW: five builds were posted through gunforma-admin-post.html before this
ships (free text was fine for those). The remaining ~15 wait for this. After
this, every build stores which variant.

FIRST REPORT, before any design — three things, then stop and wait:
(a) Check the Awin feed for one product that ships in 2+ colours (pick a
    barrel). Does the feed carry one row or one per colour? If per colour,
    say so and how many products it applies to. Mapping colour SKUs to
    variants is a FOLLOW-UP PR (it touches the nightly sync) — not this one.
    But it decides whether per-variant live pricing is ever possible.
(b) Corrections to anything in WHAT EXISTS below.
(c) Three real parts from the two live builds, rendered as they read now and
    as they would read with the label formula, so Alex can approve wording.

WHAT EXISTS — verified 2026-09-29, main 4745a45, live DB:
- product_variants: 646 live rows across 229 products (2 products have none —
  say what the snapshot stores for those). Columns: color, finish, optic_cut,
  reticle, primary_image_url, msrp, is_default, variant_label, retired_at.
- gunforma-post-build.html queries product_variants (~lines 515–520), reads
  only the default variant for image and MSRP. That query already names
  product_variants_product_id_fkey and excludes retired — copy it, do not
  rewrite it.
- parts_snapshot carries optional free-text `variant` and `finish` (#84/#86),
  round-tripped by the armory.
- 148/229 products have 2+ variants; 81 have exactly one — no picker for
  those. 646/646 have color; 173/417 non-default variants (41.5%) have an
  image; 3/646 have variant_label.
- affiliate_links are per product. No per-variant links exist.

SNAPSHOT SHAPE — proposal, verify against schema:
Add to each parts_snapshot entry: variantId, variantLabel, color, finish,
imageUrl (denormalised so the row still renders if the variant is later
retired or renamed). Keep the free-text `variant`.

Rules:
- Picker and free text coexist. Free text is the escape hatch when the colour
  is not in the catalog. If a variant is picked, free text is optional and
  shown as a note. Neither affects the buy link.
- No variant picked → variantId is the product's is_default row. Off-catalog
  (pending) parts have no variantId; every reader must handle null.
- Read time: resolve variantId live for image and label; if retired or
  missing, render from the snapshot fields.
- Price on the row, three tiers, in order:
  1. A live listing mapped to that variant (only after the follow-up PR from
     report (a)) → show its live price.
  2. Otherwise, if the variant has msrp → show it labelled "MSRP", with the
     product's live retailer price beside it as "from $X at <retailer>".
  3. Otherwise → product live price only, "from" wording.
  Never show MSRP unlabelled where a viewer expects a buy price.
- Label formula, defined ONCE in a shared pure function both browser and
  server import (no fourth copy): `[color] [finish]` trimmed; variant_label
  overrides verbatim when non-empty. Alex approves wording from report (c).

PR A — storage and readers. Files, all of them:
- gunforma-post-build.html, gunforma-admin-post.html: write the new fields
  (default variant id for now — no picker yet).
- gunforma-armory.html: the snapshot mapper WHITELISTS fields. Add the new
  ones or a later armory save deletes them. This is the file that gets missed.
- gunforma-build-detail.html: render snapshot photo (object-fit: contain —
  check for the inline style that outranked the stylesheet before), label and
  the tiered price.
- netlify/functions/product-page.mjs, js/affiliate.js: import the label
  function if they render variant labels; otherwise state they are untouched
  and why. CLAUDE.md says the three buy-row copies change together — confirm
  the buy row itself does not change here.
- scripts/backfill-variant-ids.mjs: set default variantId on the two existing
  builds' parts. Run against production once, paste the before/after rows.
- Any test or guard that validates parts_snapshot shape.

PR B — UI, in js/part-picker.js (shared by post-build and admin-post; the
armory and profile have their own copies that stay untouched — say so in the
PR). Picker after product selection: colour-swatch-first, photo when
available; a swatch with the label is a complete card, a blank box is a bug.
Hidden for single-variant products. Free-text field stays visible.
"See other options" panel on gunforma-build-detail.html: all live variants
for the part with swatch/photo, label and price tier, plus the existing
retailer buttons.

DONE-CHECK for each PR, on a deploy preview, results pasted in the PR:
1. Post a build through gunforma-admin-post.html with one non-default
   variant (PR A: default variant).
2. Open the build page. Confirm photo, label and price against the variant
   and product rows in Supabase.
3. Open that build's draft in the armory, save without changes, re-query
   parts_snapshot. variantId must still be there.
4. Retire the variant in a rolled-back transaction, re-render — the row shows
   the snapshot label and image, not a blank.
5. Share the build URL into a fresh Reddit chat and a fresh iMessage thread.
   Screenshot both cards in the PR.
A green test suite is not evidence any of the five happened.
