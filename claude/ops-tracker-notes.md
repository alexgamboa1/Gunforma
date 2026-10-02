# Gunforma Ops Tracker — notes (rewritten 2026-09-23, updated 2026-10-02)

**Artifact:** https://claude.ai/code/artifact/45f1e778-cee9-4154-9cbc-2df59ba65bda
Private to AG. State lives in the artifact's own database, not in this file.

**Why it exists:** a founder-level tracker for gunforma — not a dev log. It holds the
judgment calls no repo can answer. Anything the repo can answer belongs in the repo.

---

## What the artifact actually contains

Three tabs. That is the whole thing.

1. **Weekly Log** — a timeline grouped by week. Each week block shows two strips:
   *Shipped* (done tasks) and *Deploys* (weekly deploy entries). The input strip at the
   bottom of this tab writes **done tasks only**.
2. **Open Tasks** — a flat card grid sorted by priority. Click a card to mark it done.
   Lanes exist as a coloured tag on each card, **not** as columns. The four lane values
   are `dev` / `biz` / `content` / `monetization`, rendered as **Dev / BD / Content /
   Revenue**.
3. **Site Manifest** — every public surface, grouped, with an OK / Needs work toggle.

Three database collections back it: `manifest`, `tasks`, `deploys`.

### Corrections to the previous version of this file

The 2026-09-09 notes described four sections including a **Weekly Top 3** and a
**four-lane task board**. Neither has ever existed in the artifact. There is no Top 3
section, field, or collection, and Open Tasks has never had lane columns. The Deploy Log
is not a tab — it is a strip inside each week block on the Weekly Log.

**There is also no UI for adding a deploy entry.** All deploy documents have been written
by Claude through the artifact database tool. The "manual deploy log" was never manual.

This file was wrong for two weeks and nothing surfaced it. Same failure the START-HERE
doc warns about, inside the notes file for the tool built to prevent it. Re-read the
artifact before trusting any description of it, including this one.

---

## Changes made 2026-10-02 (later session, PRs #114, #115, #118) — parts step regrouped, and the build count corrected

### Correction first: there are no founding-builder builds yet

**The 09-29 entry below says five real builders' builds were posted and five claim
messages sent ("Real builds 2 → 7"). That is not the state of the business.** AG
confirmed on 2026-10-02 that the builds posted before this week were tests, and that he
deleted them. The database agrees: no build created before 2026-10-02 exists.

Live data, queried 2026-10-02:

| | |
|---|---|
| Builds | **2**, both approved and both created 10-02 — `P365 XMACRO Mischief Machine with Kentucky Mahogany Wood Grips` (owner alexg, 2 parts) and `P365 Complete Build` (a real build per AG, 7 parts, **no owner — unclaimed**). The last fixture, `TEST 2 TEST 2`, was deleted 10-02 |
| Builds claimed by a builder other than AG | **0** |
| Profiles / auth users | **4**, none created since 09-25 |
| Products | **242** live; **82 (34%)** have no buy link on any variant |
| Buy clicks recorded | **48**, after cleanup. 537 had been recorded, but 493 were a link sweep from one of our own sessions — 23:25:13–23:25:22 UTC on 10-01, one per live link, none with a referrer — and were deleted on 10-02. About 11 of the 48 are our own route checks and PR verification; real clicks are roughly 37 |
| Build photos | **92 unreferenced files** (8.9 MB) in the `build-photos` bucket, left by deleted test builds. Each `build_photos` row references two files, the photo and its thumbnail, so the orphan count is objects minus twice the rows |

Consequences for anything written earlier in this file:

- `open-send-claim-invites` is **not done**. Treat "five claim messages sent" as
  unverified; no working claim link is outstanding, because no such build exists.
- "The remaining ~15 queued builds (messages held until the first five reply or 48h)" has
  no first five to wait on.
- Every "two real builds" count in the 09-28 and 09-30 entries describes rows that are gone.

AG's stated plan, 2026-10-02: start uploading real builds this week. That upload is the
first launch, not a second wave.

### What shipped

**#114 — the parts step is four groups and eighteen sections.** "Other Parts /
Components" was five `products.category` values in one accordion (basepad 8 products,
slide_plate 3, slide_release 2, safety_selector 2, takedown_lever 2, all P365). Each is
now its own section, keyed by the `products.category` value itself. Order, agreed with AG:

- **Core build** — Grip Modules, Slides, Barrels & Compensators, Optics, Weapon Lights, Triggers
- **Controls** — Magazine Release, Slide Releases, Takedown Levers, Safety Selectors, Slide Plates
- **Magazine** — Magwells, Magazines, Basepads
- **Carry and finish** — Holsters, Paint Job & Finish, Tactical Knife, Miscellaneous

The list lives in one file, `js/build-categories.js`, read by post-build, admin-post and
build-detail. The admin page's copy had drifted (no Magazine Release, Magwells with no
catalog backing, a Sights section nothing else had) and was deleted, not patched.
Published builds now render sections in this order and show the five under their real
names instead of "Other Parts". The Armory's `other_parts → basepad` mapping, which
relabelled every custom slide plate or safety as a basepad, is removed.

**#115 — section-progress headings and a phone layout.** Each group heading shows one
segment per section and "2 of 5": it counts **sections with a part, not parts**. Not
numbered, because the page's own steps are already 1–4 and Parts is step 4.

The phone bug was older than either PR: the page kept its 36px desktop gutters and 20px
card padding on phones, `.layout`'s column was a bare `1fr`, and an added part's row had
a min-content width wider than what was left, so the whole page scrolled sideways once a
part was added. Fixed with `minmax(0, 1fr)`, 16px gutters under 640px, and an added-part
row that restacks under 560px. Verified at 390px and 320px on both builder pages.

`P365 Complete Build` stored a basepad under `basepad`, so the new picker is confirmed
end to end through sign-in.

**#118 — clean click data and phone-sized fields.** `/go/` now accepts
`x-go-no-log: 1`, which follows the link without writing a `link_clicks` row; a browser
cannot send it on a navigation, so no real click is affected. `check-routes.mjs` uses it,
which stops the scheduled check adding one fake click per run. The same response carries
`x-go-key: ok | missing`, and the check fails on `missing`, so a broken logging key is
still noticed without writing a row. `robots.txt` disallows `/go/`. **A missing referrer
is not a bot signal** — 24 of the 36 clicks on 09-30 have none — so nothing filters on it.

Every form field on both builder pages is 16px under 560px, which is the threshold below
which iOS Safari zooms the page on focus. `scripts/find-orphan-storage.mjs` skips any
object under 24 hours old in both modes: photos upload the moment they are picked and the
`build_photos` row is only written at submit, so a build in progress looks like an orphan.

### Process, worth keeping

- **A commit went to `main` with no PR during this session** — `7ac3d6f`, the catalog
  variant picker with swatches and per-variant pricing. `main` is production.
- **Two Claude Code sessions shared one checkout.** One session's commit landed on the
  other's branch; it took a rebase and two force-pushes to untangle. Nothing was lost.
  One worktree or clone per session.
- This session's Claude could read the repo and the database but not push (GitHub not
  linked), so both PRs were specified here and built by Claude Code from a pasted prompt.

### Open

- **Post real builds and send the claim messages.** The only item that changes the
  business. `P365 Complete Build` is live with no owner: its claim link is the first one
  to send.
- **Attribution check** (clicks vs Awin, due Friday 10-02) — the sweep rows are deleted,
  so read `link_clicks` as it stands.
- **iPhone tap test.** AG tapped the variant field on a real iPhone on 10-02: no zoom.
  The fields #118 enlarged (build name, description, pistol search, the custom-part
  form) are verified as a computed style only and still need one tap.
- **82 products with no buy link** — still the partnership problem, Norsso first.
- 92 orphaned photo files in `build-photos`. Cleanup is parked, not urgent. The script
  needs `SUPABASE_SERVICE_ROLE_KEY`, which lives only in GitHub Actions and Netlify, so it
  cannot be run from a laptop; re-count at the moment it is run.

---

## Changes made 2026-10-01/02 — database cleanup, Icarus refresh, catalog outage

### Database — schema cleanup, applied directly to Supabase

- Dropped `products.specs` (the JSONB catch-all). 81 blobs archived to
  `_archive_products_specs` first — nothing deleted without a copy.
- Replaced two free-text columns with lookup tables: `colors` (49 rows across 14
  families), FK from `product_variants.color`; and `materials` (7 families), FK from a
  new `products.material_family`. Dropped the now-redundant `frame_specs.frame_material`.
- Added `create_variant()` — an admin RPC that writes a variant, its image, and its
  affiliate link in **one atomic call**, so a half-made variant can't exist — and
  `slugify()`.
- Backfilled 644 `variant_label`s. Synced 47 optic materials from
  `optic_specs.housing_material`. Filled all 7 remaining material gaps by hand from
  vendor pages — `material_family` is now complete.
- Loaded 80 variant images from the gap audit.
- Added `magazine_families.capacity_note`; added housing classes `fuse-xl` and
  `xmacro-sub`, each with its `rail_bridge` rows.

### Icarus Precision — vendor changed stores mid-catalog

Icarus moved to a series-based Magento store, which broke every link we held. Fixed 7
dead URLs and 7 prices; renamed 7 products to the new series naming (old name preserved
in `family` + description, so search and history still resolve). Corrected fitment that
was wrong even before the move: XL EVO and Pro Elite were tagged `xmacro` but are
`p365xl` and take X/XL mags; FUSE EVO → `fuse-xl`. Added 11 new grip modules.
**Open:** Cerakote / manual-safety / brass price adders, and images for 14 new variants.
Full detail in `claude/icarus-precision-refresh-2026-10.md`.

### Frontend — on main (`d8b71ca` + `8367658` + a product-page fix)

The catalog query no longer selects `specs` (it's gone). It now embeds `optic_specs`
(with the disambiguated `footprints!optic_specs_footprint_id_fkey` embed) and
`frame_specs → housing_classes → magazine_families`. The grip-module detail rows were
rewritten — the old rows referenced columns that no longer exist and had been rendering
**blank**. The product page now shows Housing Class and Magazines rows and
`material_family`.

### Incident — the catalog returned 400 for ~a day

Production catalog 400'd for roughly a day. Cause: the frontend fix that stops selecting
`specs` was committed to branch `contest-flags` **while the column was dropped in prod**
— so live code was selecting a column that no longer existed. Resolved by cherry-picking
the fix to `main`.

**New rule, and it is the real output of this session:** no column drop or rename until
the matching frontend commit is on `main` and published. Schema and the code that reads
it ship together, schema **second**. Same family as every other failure in this file — a
change correct in isolation, broken in the gap between two systems that were updated out
of order.

Also learned: the Supabase MCP **holds `DROP` and WHERE-less `UPDATE` statements waiting
for a confirmation that never arrives** — they look hung but are blocked, and nothing
says so. Run DROPs in the dashboard SQL editor instead.

### Repo hygiene

Deleted 45 merged local branches and pruned 4 remote. Remaining non-main branches:
`feat/parts-index`, `fix/field-notes-star-rating`.

### Gap audit — unchanged, still the headline

71 products (31%) have zero affiliate links, concentrated in the direct-to-consumer
brands: **Norsso 24**, ECM, Grayguns, Mischief Machine, Zaffiri, Armory Craft. These
sell direct, not through the networks we are on, so it is a **partnership** problem, not
a matching one. Outreach still pending — the single highest-leverage non-code move on
the board.

---

## Changes made 2026-09-30 — email, a lost-folder scare, and two notification systems

Began on "fix the email logo." Ended four PRs deep in an email backend. One long session.

### The email system, end to end

The brand's auth emails rendered GUNFORMA as a **text wordmark** because the site
logo is light-on-transparent — "GUN" is cream #f2efe8, invisible on a white panel.
Built `assets/email-logo.png` (440×80, #0e0f11 header background baked in so no
client's dark mode can strand it) and put it on all three live auth templates:
Confirm signup, Reset Password, Invite user.

**Two of those three had no source in the repo at all** — they lived only in the
Supabase dashboard, unversioned. Now mirrored at `scripts/*-email-template.html`, with
the rule in CLAUDE.md: the dashboard is the source of truth, editing the repo file
sends nothing, both fail silently. That mirror drifted **three separate times in one
day**; the discipline is "change both in the same sitting."

Inbox-row fix: the invite preview read "build is live / claim your account" five times
over (subject, preheader, logo alt, eyebrow, headline all scraped into one line).
Preheaders rewritten to *extend* the subject, with a `&zwnj;&nbsp;` spacer run that
fills the client's preview buffer so it stops scraping body text.

### contact@ had never received a single email

Outbound was fine (Resend custom SMTP as `build@gunforma.com`, 30/hr). Inbound is
Cloudflare Email Routing, which routes **per address** — and there was **no rule for
`contact@gunforma.com`**, the address published six times across the privacy policy,
terms, and legal pages. Every message ever sent there was silently discarded, no
bounce. A compliance gap, not a UX one. Added rules for `contact@`, `build@`, and a
catch-all. Sending and receiving are separate systems that fail independently; nothing
reads "0 received."

DNS verified on the wire: DKIM signs as the apex, SPF on `send.` points at amazonses
(Resend's path), DMARC added (`p=none`). OTP expiry raised 3600→86400 so invite links
survive overnight — trips `auth_otp_long_expiry` (accepted) and lengthens reset-link
life to 24h too (one knob; revisit if separable). All three templates' copy now says
24 hours.

### operations.md — the config that lives outside the repo

New doc `claude/operations.md`: the Supabase / Resend / Cloudflare / GitHub settings no
code can show, which advisor findings are **accepted** vs unfixed, and §6b on the
scheduler. Blocked from the web by the existing `/claude/*` rule.

### The scheduler false alarm — my error, recorded

I read an incomplete `gh run list` paste — from a terminal AG had **just said** was
truncating — and concluded the price sync had *never* run on a schedule and that
scheduling was dead repo-wide. Both false. The full history showed it running daily and
succeeding on schedule the two days after its fix. Inference-from-absence, again, by the
coach — the same failure this file keeps logging. What *is* true, now in operations.md
§6b: GitHub's scheduler delays and drops firings badly — the 07:23 sync lands
12:00–15:30 every day; the 4×/day freshness check gets 2–3 runs. The crons succeed, just
nowhere near on time. **A workflow that hasn't run yet today is not evidence it's
broken.**

### The two-clone scare, and an accusation I got wrong

This morning I told AG that Claude Code had fabricated a whole verification report — byte
counts, greps, a passing suite — for files that didn't exist. **That was wrong, and it
belongs on the record.** Claude Code was working in `~/Desktop/projects/Gunforma`; my
bridge and AG's terminal were in a *second* clone, `~/code/Gunforma`. The files were
real, in the other folder. Claude Code had **refused to invent five files** to make a
task look done, and said so plainly — better discipline than I showed. The entire "work
vanished" confusion was two directories, and I diagnosed it by asserting instead of
checking. Consolidated to the one Desktop clone; deleted `~/code`. The two-clone setup
was the hazard; `git fetch && git log origin/main..HEAD` is the only honest "did it
land."

### build-approved email — a notification backend that actually reaches people

`notifications` was an in-app inbox only (`comment`/`reply`/`like`, written by triggers,
shown on a bell). **Nothing emailed anyone about anything** except auth — a builder got
silence at the one moment they're most likely to share: approval. Built the whole path:

- Migration: 4th kind `approved` (actor-less — sender is Gunforma), `email_sent_at`
  outbox column, the **backfill** that stamps existing rows sent (table was empty so
  moot, but the guard is the point), `profiles.email_notifications` opt-out, and a
  trigger on `builds` so approval through the admin UI, SQL, or anything later all fire
  it.
- Edge function `send-build-approved` (Resend, idempotent on `email_sent_at`,
  service-role gated), a 15-min workflow, and the inbox render patch.
- First deploy **500'd**: Supabase bundles only the JS entrypoint, so the sibling
  `email.html` read with `Deno.readTextFile` was never uploaded (ENOENT). Fixed by
  inlining the template into `index.ts`. Tested dry-run and real, both 200. Live — first
  real email fires on the next approval. PRs #111, #112.

### contest accountability

`contest_build_part` let any signed-in user flag any part on any approved build — no
record of who, no dedupe, no limit. First-reviewed as a hole, then correctly re-scoped:
it is a deliberate community feature (the admin queue literally says "a visitor
flagged"). Kept it open but added a `build_part_flags` table (who + when, one row per
user per part) so the signal is legible and a future "require N flags" is a one-liner.
Applied and verified live. PR #113.

### Security housekeeping

- Revoked PUBLIC `execute` on `restrict_owner_edits_on_approved_build` (a trigger fn
  Postgres had granted to everyone).
- `build_comments_public` SECURITY DEFINER view reviewed = **correct by design**;
  flipping it to invoker would break comments for every logged-out visitor. Accepted in
  operations.md, with the real risk named — it *is* the whole access boundary for
  comments, so any column added to its SELECT is public immediately.
- Leaked-password protection: AG declined for now; recorded as a decision, not an
  oversight.

### Gallery

Two more test builds (`...TEST`, `testing post builder`) deleted — down to the two real
builds.

*(Corrected 2026-10-02: per AG those two were also tests, and he has since deleted them.)*

### Open / carried forward

- **71 of 231 products (31%) still have no live affiliate link** — concentrated in
  slides / frames / triggers, the parts people brag about. It is a **partnership**
  problem, not matching: boutique brands (Norsso 29, ECM 8, Mischief Machine 6,
  Grayguns / Armory Craft / MCARBO) sell direct, not through the networks we are in.
  **Norsso alone is 41% of the gap — one relationship.** The Norsso outreach email is
  drafted-on-request, not sent.
- Loadouts still parked (`claude/loadouts-spec.md`).
- Parts-catalog content engine still unstarted — gated behind closing the monetization
  gap.
- First real build-approved email is unverified until the next approval sends one.

---

## Changes made 2026-09-29 (late session, PRs #93–#98) — the launch

> **Corrected 2026-10-02 — the paragraph below is wrong.** AG confirmed the builds
> posted here were tests and deleted them; none exist in the database. No founding
> builder's build is live and `open-send-claim-invites` is **not** done. See the
> 2026-10-02 (later session) entry at the top of this file.

**Five real builders' builds posted through admin-post and five claim
messages sent.** Real builds 2 → 7. open-send-claim-invites is done.
First session whose result is a business number, not a PR count.

Corrections to what the 09-29 prompt claimed: affiliate links are
per-VARIANT (326 of 493 on non-default variants) — the prompt asserted
per-product on Alex's description of desired display, not a query.
Inference-from-absence, by the coach. twitter:image was [object Object]
on every build page; fixed, guard added. Reddit chat still shows no
image — that's Reddit chat, not us. Seven default variants carried
another colour's photo; nulled, sync refills, daily guard added.
claude/ was publicly served ~4h after docs were committed for Claude
Code to read; #97 blocks it. Rule: strategy docs stay in the claude.ai
project; the relevant section gets pasted into the prompt.

Price rule, three tiers: variant's own live listing → MSRP labelled +
product "from" → product "from". Never MSRP unlabelled where a viewer
expects a buy price. Buy link follows the variant when it has one.

Images: 244 non-default variants had no photo. Feed fills ~160. 96 need
a human; 83 of those have no retailer link at all — the AvantLink gap
(Norsso 19, Grayguns 13, Icarus 13). Fill by demand: only variants that
appear on real builds. The swatch is the design, not a bug.

Attribution check from Friday: link_clicks vs Awin, per partner, three
days summed, watch the ratio. 0.7–0.9 healthy; 0.0 means the tracking
parameter is lost.

Carried forward: imageUrl re-sync into live builds after the 07:23 UTC
sync; remaining ~15 queued builds (messages held until the first five
reply or 48h); sync GTIN-preference; two platform photos for loadouts;
Sig P365 XL OEM Gray SKU conflict (98ddd711); gallery-swap's 29 local
commits — triage, don't delete.

### The technical record, #95–#98

**#95 — the colour picker, and the fallback that had to go.** The picker
gains a colour step between the product grid and the part being added; the
button reads "Choose color →" only when a choice follows. It renders into
`#cards-<catKey>`, the container `filterCards()` already rewrites, so neither
page's `buildCategoryBlock()` changed and the two duplicated copies could not
drift on it. Single-variant products (81 of 231) get no step at all, keyed on
LIVE variants so a product that drops to one through retirement stops offering
a choice with nobody editing a flag.

`js/variant-swatch.js` is new and browser-only — one file, no parity test,
unlike `variant-label` which the server also needs. Measured against all 54
distinct `color` values in the catalogue: 94.8% solid, 3.2% two-tone split,
1.7% iridescent (Spectrum, Rainbow), 0.3% Clear, **zero unknown**.

Two defects found by looking at the rendered output rather than the diff:
`Black/Cherry` rendered solid black, because "Cherry" was unmapped and the
second half of a two-tone value silently fell away. And the build row was
still falling back to `IMAGE_BY_PRODUCT_ID` — the product's DEFAULT variant
photo — which is the one thing this feature must not do. Removed, and the
cache deleted rather than left populated-but-unread, because a cache with no
reader is an invitation to wire the banned fallback back up.

**#96 — the drill.** `scripts/check-variant-image-sku.mjs` had only ever
passed, so its issue-raising branch had never executed. A green run proves the
SCRIPT works and says nothing about whether anyone would hear if it failed.
`DRILL=true` forces the failure exit without touching data. Fired by hand
2026-09-30: issue #99 opened, carrying the real reading. The alert path is now
observed rather than assumed — the same standard the rest of this repo's
guards are held to.

**#97 — claude/ was publicly served.** `publish = "."` serves the repo root,
so a new DIRECTORY is live the moment it is committed unless `netlify.toml`
says otherwise. `/claude/ops-tracker-notes.md`, `/claude/loadouts-spec.md` and
`/claude/prompts/variant-selection.md` all returned 200 while `/CLAUDE.md` and
`/scripts/*` returned 404, because those had rules and the new directory did
not. Narrow — nothing linked to them, they were not in `sitemap.xml` — but
`robots.txt` is `Allow: /` with no `x-robots-tag`, so nothing stopped a
crawler either. Confirmed 404 on production after deploy.

The file already carried a warning about exactly this, and it did not save us:
it is phrased about ROOT-LEVEL FILES, and this was a new directory. The new
rule's comment covers both.

**#98 — the /go/ click layer.** An EDGE function, not a serverless one,
because it sits on the money path: a Netlify serverless function cannot
respond-then-work, so the insert would sit in FRONT of the 302 and every buy
click would pay for it. `context.waitUntil()` sends the redirect first.
Measured on the preview: 0.168–0.304s, which is the destination LOOKUP, not
the logging — adding the insert did not change it.

`link_clicks` is private by design like `price_history`: RLS on, no policies,
no grants, verified after creation, with CLAUDE.md's anon-write drift sweep
returning zero rows. It records link id, timestamp and the ON-SITE path only.

EIGHT emit sites, not the seven the brief listed. The eighth was
`gunforma-armory.html` — the parked page, which is where the last four
divergences in this repo also hid. And the affiliate link `id` was not
selected anywhere, so the click layer's whole key had to be threaded through
all three queries first.

**Two failures worth keeping, both of the same family.**

The service key read 15 characters and the insert 401'd. The value in Netlify
was correct; the DEPLOY was stale. An environment change does not reach a
deploy that already exists — `netlify env:list` showed the new value while the
running function still held the old one. Rebuild after any env change, or the
thing you are testing is not the thing you changed.

And `x-go-log: queued` said the insert had been handed to `waitUntil`. It never
said the insert SUCCEEDED, and for one run it read `queued` while the table
stayed empty. That is this repo's own rule — a green result is not evidence the
work happened — reproduced inside the thing built to measure clicks. The header
was a witness to its own case. `x-go-debug: 1` now awaits the insert and
reports its real status, which is how the 401 was found at all.

**Guards went 3 → 9 across the four PRs**, each watched failing on the real bug
it protects rather than a synthetic one: variant label parity, shared globals
loaded, snapshot whitelists agree, affiliate module runs, variant picker runs,
buy links go through /go/.

---

## Changes made 2026-09-29 (variant selection, PRs #93–#94)

**Share card: it was never the transform.** The og:image URL answers a
redditbot UA in 0.18s — 200, `image/jpeg`, 124,716 bytes, edge-cached. What
was broken is that **`twitter:image` has been the literal string
`[object Object]` on every `/b/` page**, from `esc(image)` where the og:image
line correctly reads `esc(image.url)`. `buildImage()` returned a string until
og:image:width/height needed the dimensions, and one call site was missed.
iMessage reads og:image and was fine, which is why the symptom arrived as
"Reddit doesn't render it" and pointed at the wrong layer. Fixed in `#93`,
with `og:image:type` added — which needed `fm=jpg` on the transform, because
the Image CDN content-negotiates (`*/*` → jpeg, `image/webp,…` → **webp**),
so any declared type is otherwise wrong for half the callers.

`scripts/check-og-image.mjs` could not have caught it: it matched
`<meta property=` only, and `twitter:*` are `name=`. **The check written to
catch exactly this class of bug was structurally blind to the tag.** That is
the third instance of the family this file keeps recording — the guard exists,
runs, passes, and is looking slightly to the left of the problem.

**Sync check to do, not a bug.** `True Precision P365 3.1" Non-Threaded
Barrels` in Black/Nitride has been stale since **09-21** while its other six
colours matched nightly. Cause found: two feed rows share MPN `TPP365BXBL` —
the True Precision listing (`mid 2524871`, $144.99) and a **Faxon
Firearms-branded duplicate of the same barrel** (`mid 5045176`, $161.49) — so
the candidate-conflict guard correctly refused to guess and withheld the
write. `sync_drift_review` id **84**. The link had been pinned to the Faxon
row, so its last written price was $161.49 for a $144.99 barrel; the buy URL
was always the correct True Precision page.

Re-pointed by hand — one row, `op_gtin = 00719104536178` (the only identifier
that distinguishes the two; the Faxon row carries none), `op_mpn` cleared per
CLAUDE.md's re-point procedure, `op_merchant_product_id = 2524871`. Confirmed
on the next run: conflicts 11 → 10, matched 414 → 415, and `TPP365BXBL`
appears zero times in the conflict log against twice before.

**And it will come back.** T1 matches on stored `op_mpn`, the sync refills a
null identifier, and both feed rows carry the same MPN — so one good run, then
the conflict returns. A durable fix needs the sync to prefer a
gtin-confirmed row over an mpn-confirmed one, which is a sync change and was
deliberately out of scope. **There is no tier that matches on
`op_merchant_product_id` at all** — it is written for audit and never read,
which is worth knowing before anyone tries to fix a mapping by setting it.

**Two test builds became one.** The tracker's long-standing "two real builds,
two fixtures in public" is now two real builds and nothing else: the older
fixtures are gone, and `TEST MONKEY` (alt account `tjmiller`, posted 09-29 to
walk post → approve → claim → share) was set to `status = 'pending'` rather
than deleted, so the claim history survives. Sitemap 245 → 243; `/u/tjmiller`
went with it, since a profile is only listed if it has an approved build.

**The feed carries one row per colour, and the sync already maps them.** This
was the open question that decided whether per-variant pricing is ever
possible, and the answer is that it already works: `affiliate_links.variant_id`
is `NOT NULL`, **326 of 493 live links hang off a non-default variant**, and
424 of 649 live variants have a fresh feed-verified price. The brief's premise
— "affiliate links are per product, no per-variant links exist" — was wrong,
and it was load-bearing: it is why the buy link was going to stay
product-level. A TLR-7 X read "From $157.49 up to $164.49" with no way to tell
which of the two lights was on the gun.

**Three label copies had drifted, in production.** `finish` was a label axis
in `product-page.mjs` and in neither of the other two, so True Precision
P365-FUSE read `Black / DLC` and `Black / Nitride` at
`/parts/slides/true-precision-p365-fuse` and **`Black` twice — $375.25 and
$318.99, indistinguishable** — in the catalog buy row and on every build page.
Now one parity-tested pair. Also made absolute rather than differential: the
old formula showed only the axes a product's listings disagreed on, so a
label's meaning changed when a sibling variant was added or retired, and that
label is now written into `parts_snapshot`.

**Build guards 3 → 6.** `variant label copies agree`, `shared globals loaded`,
`snapshot whitelists agree`. Each was watched failing on the real bug it
guards, not a synthetic one. `shared globals loaded` caught two pages
unprompted during the work.

**The armory has three snapshot whitelists, not two** — the writer, the draft
loader, and `remixGuide()`'s own cloner. The brief said two. A field missing
from any one of them is deleted on the next save, silently, which is how
`finish` was lost before #86.

### The AvantLink gap, counted — 83 variants nobody pays us for

The image backfill surfaced a commercial number, not a technical one. Of the
244 live variants with no photo, **83 have no live retailer link at all** — so
no feed carries them, no photo can be fetched, and **no click on them can earn
anything**. They are variants of products that ARE live on the site.

Eleven brands, by variant count:

| brand | variants | products |
|---|---|---|
| Norsso | 19 | 8 |
| Grayguns | 13 | 3 |
| Icarus Precision | 13 | 5 |
| ECM Precision | 9 | 3 |
| Armory Craft | 6 | 3 |
| Zaffiri Precision | 6 | 4 |
| Tactical Development | 5 | 1 |
| True Precision | 4 | 3 |
| MCARBO | 3 | 2 |
| Sig Sauer | 3 | 2 |
| Parker Mountain Machine | 2 | 2 |

**Read it as the AvantLink case, not a backlog.** Every one of these is a
colour someone might build with and we cannot monetise, because the only
network we are on is Awin and OpticsPlanet does not stock them. Norsso alone
is 19 variants across all 8 of its products — a brand we list in full and earn
nothing from. Grayguns and Icarus Precision are 13 each, and Icarus is in one
of the two real builds on the site.

The shape of the argument for an application: *these are the products our
builders actually pick, the ones your merchants already carry, and here is the
per-variant coverage we can prove.* That is a stronger pitch than a catalogue
count, and it is now a measured list rather than an impression.

**Not being hand-filled.** Until a variant has its own photo the picker and
the build row show a colour swatch with the label — never the default
variant's photo standing in for the chosen colour. The swatch is a correct
answer; a wrong photo is not. Hand-filling 83 images to decorate variants that
earn nothing is the wrong order of work.

Regenerate the list with `node scripts/export-missing-variant-images.mjs` —
the "no live link" rows in the CSV are exactly this set.

### Three catalog data defects, and the guard that makes them findable

**Seven default variants were illustrated with another colour's photo.** Found
because the image filenames carry the variant SKU, so a variant whose URL
contains a SIBLING's SKU and not its own is provably wrong:

| brand / product | variant shown | photo actually was |
|---|---|---|
| Anarchy Outdoors Slide Plate | Black / Anodized | Purple |
| True Precision P365 3.1" Threaded | Black / Nitride | Copper |
| True Precision Fuse 4.3" NT | Black / Nitride | Gold |
| True Precision Fuse 4.3" Threaded | Black / Nitride | Copper |
| True Precision P365-FUSE | Black / DLC | Spectrum |
| True Precision P365XL 3.7" NT | Black / DLC | Gold |
| True Precision Slide Cap Plate | Stainless Steel | Gold TiN |

All seven were `is_default`, which is the set a new build records. It had been
live for as long as the rows existed and nothing could have caught it: the URL
is valid, the image loads, it is the right product, only the colour is wrong.

It surfaced through the variant work rather than by inspection — the first
admin-post test build came back with a Black / DLC barrel carrying a filename
reading `Barrel-Gold-TP-P365XLB-XG`. **That is the only reason it was
noticed**, and it is exactly why a build storing `imageUrl` raises the stakes:
`parts_snapshot` denormalises the photo, so a wrong one stops being a fixable
catalog row and becomes permanent in someone's build.

All seven nulled. They fall back to the colour swatch until the nightly sync
refills them per-colour from the feed, which it can do for all seven — each has
a live, non-withheld link with a stored `merchant_product_id`.

`scripts/check-variant-image-sku.mjs` now checks the rule, daily, from
`.github/workflows/check-variant-images.yml`. **Deliberately not a build
check**: it reads live data, so it is time-dependent, and the thing that breaks
it is a CSV import rather than a commit. Failing an unrelated deploy would put
the alert in front of whoever happens to be deploying instead of whoever
maintains the catalogue — the same reasoning that keeps
`check-price-freshness.mjs` out of the build.

**`FDEB` is not a colour.** The new guard's one remaining finding, and it is a
different defect. Streamlight TLR-1 HL has three variants: `69260` Black,
`69266` FDE, `69267` **FDEB**. The `-b-` in these filenames means *with
batteries* — the Black row has it too — so `FDEB` is "FDE plus a battery
config" typed into `color`. `product_variants.battery_type` exists and is where
that belongs. Left alone pending a decision: correcting `color` to `FDE` would
give two variants the same label, which is its own problem, so the fix is
colour **and** battery_type together, not colour alone. The guard stays red on
this one row until then, on purpose.

**Sig Sauer P365 XL OEM Gray disagrees with itself.** Link `98ddd711` has no
stored identifier, and the two records we hold do not agree on which SKU it is:
the variant row says `8900757`, while the link's own URL `_iv_code` ends
`-8900324` and the feed's Grey row is `8900324`. One of the two is wrong and
nothing in the data says which, so no identifier was set — guessing would pin
the link to a specific product permanently and the sync would re-confirm the
wrong mapping every night. Needs a human to look at the retailer page.

**Still not done, and it is the same item as the last three sessions.** The
claim walk has still not been run end to end by a second account in one
sitting. The real build count went into this session at 2 and came out at 2.

---

## Changes made 2026-09-28 (evening session, PRs #81–#85)

Five PRs, all merged: `#81` post-build picker, `#82` shared module + sizing, `#83` armory
picker, `#84` armory save/title/remix, `#85` photo fit across profile, home and grids.
`main` at `e1404f7`. **All dev again** — the real build count went in at 2 and came out
at 2, and the claim walk that would change that was not run.

### The part card existed in four copies

`#81` fixed three defects in `gunforma-post-build.html`. `gunforma-admin-post.html` held
the same code byte-for-byte, comment wording aside, and kept every one of them — the same
divergence that cost the redaction gate in `#62`. `#82` extracted the card layer into
`js/part-picker.js` (the fourth shared module after `redact`, `photos`, `affiliate`) and
deleted the admin copy rather than editing it.

Two copies were deliberately **not** pulled in, and CLAUDE.md records why:

- `gunforma-armory.html` — a different implementation that shares class names
  (`.part-card`, `.part-card-body`, `.part-card-brand`, `.part-card-name`,
  `.part-card-price`) with its own values, plus favourites and a stretched-link overlay.
  The module's injected CSS would restyle its grid. Fixed in place instead (`#83`).
- `gunforma-profile.html` — a fifth copy nobody had noticed, found only by grepping for
  `object-fit: cover` while working on something else. Fixed in `#85`.

### `cover` vs `contain` is about what the photo IS, not a global preference

The distinction that made this tractable, and the one most likely to be swept wrongly
later:

- **Catalog product photos** (a product on white, `product_variants.primary_image_url`)
  must be `contain`. Cropping one hides the part it identifies.
- **Build photos** (a user's photo of their own gun) must stay `cover`. Filling the card
  is correct for those.

Measured, 978×550 product shot: the old `100px` letterbox plus `cover` cropped 12.5% off
each end of a barrel. An **inline** `style="object-fit:cover"` in `partImageHtml()` was
silently outranking the stylesheet, so a CSS-only fix would have been a no-op — that trap
is now called out in the module.

### Square was the wrong fix; `contain` was the fix

Worth keeping, because the first attempt shipped a real regression. Once the fit is
`contain`, the box's aspect ratio no longer affects cropping at all — only how much empty
space surrounds the photo. A 1:1 box holding a 16:9 shot is 44% white bars.

`#81` shipped 1:1 **and** kept two columns on phones. Measured on the merged CSS: at a
390px viewport the columns were 116px and the photo painted **98×55**. The change meant to
let people see the part made it a postage stamp on the device most builders use. `#82`
moved to 4:3 with a one-column collapse under 560px.

Two comments in that same commit disagreed by 40% about the column width (`~165px` vs
`~116px`), and the wrong one was the one the design decision rested on.

### Four bugs of one shape in the armory, and the invariant

| | |
|---|---|
| `addPartByRefId` | never cleared `openCategory` — picker stayed open over a grid where the clicked card had flipped to "Remove" off-screen |
| `saveDraft` | `draftSaveInFlight` reset **after** the await, not in a `finally` — one dropped request wedged the button for the session, silently |
| `remixGuide` | never cleared `buildId` — open a draft, remix a guide, save, and the UPDATE fired on **that draft's id**, replacing its parts and platform. `.eq('status','draft')` is no protection: it really is a draft |
| `selectPlatform` | dropped every catalog part with no prompt — measured at 3 parts gone, silently |

The invariant is now in CLAUDE.md with the audit table as the worked example. The lesson
in that table is that `selectPlatform` and `remixGuide` **both** kept `buildId` and only
one was wrong — so the test is intent, not a mechanical check.

**A guard that would not have guarded.** The instruction for `selectPlatform` was to use
`confirmDiscardIfDirty`. That was wrong and Claude Code declined it. `isDirty()` compares
`savedSignature` to the current signature, and `markClean()` runs when a draft loads — so
a freshly opened draft with five catalog parts is **clean**. The helper would have waved
through exactly the case where saved work is lost. Keyed to the count of parts that would
actually be dropped instead. Same failure shape as everything else in this file: an
operation that succeeds while doing nothing, written into the fix for three of its own
siblings.

### Photo ratio is now one number across four surfaces

`build-og.mjs` is `OG_W 1200 × OG_H 900` — exactly 4:3. `index.html` was a fixed
`height: 110px`, which crops differently at every viewport (20.6% of the photo visible at
1280, 24.8% at 390 — a fixed height can never be consistent). `gunforma-builds.html` and
`gunforma-profile.html` were `16/10`.

All four now 4:3, showing **56.3%** of a 360×480 hero at every width, matching the share
card. Density cost quoted honestly: roughly 11.2 → 10.1 cards per screen at 1280, and
2.3 → 2.0 on a phone.

`gunforma-build-detail.html`'s `.build-hero` stays `1/1` — a deliberate `#78` choice for a
full-width hero, where square keeps 75% of a portrait photo against 4:3's 56%. **Stated as
an exception so nobody "aligns" it later.**

### The ask that did not ship

The session opened with four requests. Three shipped. The fourth — **a free-text
variant / colour field per part**, for the builder whose grip module is FDE when the
catalog only carries black — was scoped as "PR B" in the first reply and never built.
Verified absent on `main`: every occurrence of `variant` in `gunforma-post-build.html` is
the `product_variants` query.

It is the only one of the four that goes to the site's actual promise, and it affects
every build posted from here. It is a five-file change, and the trap is
`gunforma-armory.html`'s snapshot mapper, which whitelists fields — a variant saved in
post-build would be **deleted** by a later armory save.

**Do it before loadouts**, since loadouts will reuse or copy `parts_snapshot` and would
otherwise need a retrofit.

### Loadouts — decision taken, not built

The Armory writes into the **same `builds` table** with `status: 'draft'`, so its output
is a build that hasn't grown up. That is why it reads as a second place to post a real
build. Full spec, taxonomy (Build / Loadout / Guide), the new-table-not-discriminator
recommendation, and five open decisions are in `claude/loadouts-spec.md`.

AG chose to build it **before** real traffic rather than after the first five replies,
on migration cost — correct at zero traffic, and the stronger argument was that the
Armory as it stands duplicates post-build and hasn't earned its place.

Blocker recorded there: **there is no photo of a bare pistol anywhere in the system.**
`platforms` is only ever queried as `platforms(name)`. The collage cannot start without a
column and at least one photo per platform.

### Still not done, and it is the same item as last session

**The claim walk was not run.** `/gunforma-claim` → signup → complete-profile has never
been exercised end to end in one sitting by a second account. Five PRs of polish landed on
pages a builder will not open tomorrow; the page every one of them will hit is the one
still unverified.

Also unverified: the claim that all 231 products carry a default-variant image. It was
asserted, never independently checked, and the loadout collage's fallback design depends
on the real number.

---

## Changes made 2026-09-28

Thirteen PRs, **#62–#74**, merged 09-26 through 09-28. Five deploy entries added
(`photo-redaction`, `photo-uploader`, `admin-nav`, `share-links`, `build-guards`), six
done tasks, eight new open tasks, and five manifest rows refreshed. Every one of the
thirteen PRs was dev.

### The duplicate-canonical bug, found by chasing a grey square

A bad iMessage preview turned out to be the smallest symptom of the real problem.
**Every build on the site declared `gunforma-build-detail.html` as its canonical URL** —
one page, no build id — so every build was telling Google its real address was the same
address as every other build's. Ten internal links pointed at the query-string URL that
could never rank. This directly opposed START-HERE priority #3.

Builds now live at `/b/<slug>-<id>`, and the legacy `?id=` URL is server-rendered through
the same function, so both shapes return byte-identical HTML with exactly one canonical
between them. Verified on production with curl and through Facebook's own debugger.

### Extraction, because the admin page kept falling behind

`gunforma-admin-post.html` and `gunforma-post-build.html` ran the same photo pipeline from
two copies of the code. The admin page — the one used to post **other people's** guns —
had no redaction gate at all until `#62`, and then missed all of `#65`'s preview work. Two
separate silent regressions, same cause. Both the redact modal and the photo uploader are
now single shared modules (`js/redact.js`, `js/photos.js`), and CLAUDE.md carries the rule.

Two real defects fell out of that work and are worth naming: a Remove button that was
invisible at zero opacity while still clickable and keyboard-reachable, and a failed
storage delete whose result was discarded — so the site said a photo was replaced while
the old file stayed live at its public URL. For a photo someone deliberately redacted,
that is the whole point of the feature failing silently.

### Three couplings now fail the build (#71), and one branch that never ran (#74)

`scripts/check-all.sh` is the Netlify build command. Three couplings that fail invisibly —
a PGRST201 embed, the browser/server slug parity, and a canonical stripped by literal
string match — now refuse to deploy on failure, with a registry audit so a check cannot
exist but never run.

Then production contradicted the code. `#73` shipped a branch that served the page
instead of a 404 on the legacy URL; it **could never execute**, because it read
`x-nf-original-path` and Netlify does not send that header on that rule. The local test
suite passed and so did the review, because a synthetic `Request` supplies whatever header
the author writes.

Measured directly on a deploy, via a diagnostic header added for the purpose:

| route | id source | `x-nf-original-path` |
|---|---|---|
| `/b/<slug>-<id>` | `path` | absent |
| `gunforma-build-detail.html?id=` | `query` | absent |

`source: path` means the function sees the **original request URL** as `req.url`, not the
rewrite target. Two consequences nobody predicted: `?id=:splat` in the `/b/*` rewrite
target has never been consulted and is inert, and `extractId`'s header fallback has never
fired on any route.

**The rule, now in CLAUDE.md: a rewrite's behaviour is not verified until it has been
observed on a real deploy.** That is twice a rewrite behaved differently in production
than locally, and twice a green local test covered it.

### Live data, 2026-09-28

Queried against Supabase, not estimated:

| | |
|---|---|
| Profiles | **4** |
| Builds | **4 approved — but two are fixtures**: "Smoke test" and "TEST 2 TEST", both live and public |
| Real builds | **2** — "p365 Icarus build" and "P365 ALL DAY" |
| Build photos | **8** |
| Products | **231** |
| Live affiliate links | **493** |

**Two real builds.** Half the site's public content is a test artifact. The monetization
layer is built and the community is not. Every technical blocker to posting the ~20
waiting builds has now been gone for two sessions running.

### New finding: sitemap.xml contains zero build pages

241 URLs — 232 `/parts/` product pages and 9 static pages. **No builds. No `/u/` profiles.**
`robots.txt` points at it correctly; the file simply has no builds in it.

Two weeks of work went into making build pages crawler-readable with correct canonicals,
and the strongest signal available never mentions they exist. It is also a hand-maintained
static file, so at twenty builds it becomes a file nobody will ever remember to edit.
Tracked as `open-sitemap-builds`, priority critical. The fix is a fourth Netlify function
on the `product-page.mjs` pattern — shipped as **PR #75**, open at the time of writing.

### A commit reported as landed that was not — `8824d84`

The three `#74` follow-up corrections (the stale `extractId` comment, the inert
`?id=:splat`, the CLAUDE.md understatement) were written and **pushed to the
`route-behaviour-truth` branch after `#74` had already merged**. Pushing to a merged
branch's head does nothing: the PR is closed, so the commit is on the remote, on no open
PR, and not on `main`. It was reported as "landed."

The cause was a stale local clone that still believed `#74` was open. This is the
repo's own doctrine — a green result is not evidence the work happened — failing inside
a report about that doctrine. **Check `git merge-base --is-ancestor <sha> origin/main`
before believing any claim that something landed.**

### Follow-ups from the 2026-09-26 notes — status

1. **START-HERE priorities now in the tracker.** Four added: `open-send-claim-invites`
   (BD), `open-sitemap-builds` and `open-gsc-recrawl` (Google indexing), `open-field-notes`
   (content), `open-avantlink` (revenue). **Weekly Top 3 still does not exist** and was not
   built — it remains a claim this file once made about a section that never shipped.
2. **`open-seo-foundation` closed** as stale. Meta descriptions, OG tags (#36) and the
   sitemap (submitted 2026-09-19) all shipped. The one real remaining gap is narrower and
   is now its own task, `open-sitemap-builds`.
3. **The `supabase_admin` default-privilege entry is unchanged and still open.** It cannot
   be altered from the SQL editor, so any table created by Supabase's own tooling still
   arrives with write grants for `anon`. Sweep query is in CLAUDE.md and
   `supabase/revoke_anon_write_grants.sql`. Re-run after any Supabase-tooling schema change.

### Manifest

`post-build`, `admin-post`, `build-detail`, `admin-queue` and `route-build-share` all
refreshed to `2026-09-28`. `route-build-share`'s route changed from `/b/:id` to
`/b/:slug-:id  +  legacy ?id=`, because that function now serves both shapes.

`js/redact.js` and `js/photos.js` were deliberately **not** added as rows. Rows are
surfaces the public can hit, not files in a directory.

**Still flagged Needs work:** `field-notes.html` only, unchanged.

---

## Changes made 2026-09-26

Four deploy entries added for the overnight session: `founding-builder-flow`,
`monitoring-and-backups`, `owner-controls`, `security-hygiene`. Ten PRs (#50–#59) and six
database changes, every one verified against live data rather than a log line.

**`gunforma-claim.html` flipped to OK.** The 2026-09-25 note below called it the biggest
live risk. That was right to flag and wrong about the cause: the page was sound, and the
ownership transfer it appeared to be missing lives in the `launch-invite` Edge Function,
which links the build *before* the builder ever arrives. It has now been walked end to end
on production — post, invite, email, claim, own — and verified in the database. Its real
defects were elsewhere and are fixed: expired-invite copy that sent passwordless users to
a sign-in they couldn't use, an unordered build lookup, and a photo-ownership transfer
that silently failed.

**The pattern that keeps repeating, now recorded in CLAUDE.md.** Four separate failures
this session shared one shape: **an operation that succeeds while doing nothing.** An
RLS-filtered DELETE matches zero rows and returns no error. A public read returns 200 from
the CDN after the object is deleted. A flat storage listing returns only folders and
reports "0 objects backed up, exit 0". An invite script prints "0 failed" over a response
carrying a warning. Assume a green result is a lie until something independent confirms
the work happened.

**Two things that only a human can do, and both were nearly missed.** A Supabase Edge
Function is deployed separately from the site — merging a PR does not deploy it, and the
photo-transfer fix sat unshipped at version 5 while everything looked done. And CI secrets
are a second, hand-typed copy of local credentials, so a workflow that passes locally
proves nothing about the scheduled run. Dispatch every new workflow manually once.

**Still flagged Needs work:** `field-notes.html` only. It remains an empty shell, but the
two drafts are no longer at risk — they are now in a **private** repo,
`alexgamboa1/gunforma-drafts`, rather than on one laptop. Publishing them is a separate,
deliberate act; the public repo's root is served by Netlify, so committing a draft there
publishes it immediately.

---

## Changes made 2026-09-25

Two deploy entries added (`deploy-2026-09-25-upload-outage`,
`deploy-2026-09-25-post-build`) — the three-day photo upload outage and its cause, and
the Paint Job & Finish form plus the post-build rename and P320 hiding.

**A rename silently staled the manifest.** The `post-build` row still pointed at
`gunforma-post-build-v6.html` after the file was renamed to `gunforma-post-build.html`.
Nothing surfaced it; the row just quietly described a file that no longer existed. Fixed,
and worth naming as a pattern: **any `git mv` of a root HTML file leaves a wrong manifest
row behind.** Check the manifest whenever a page is renamed or retired.

`lastDeploy` was refreshed only on `post-build` and `admin-post`. The rename touched ~19
files, but the rest got a one-line href change and nothing else — updating all of them
would be churn that makes the field mean less, not more.

---

## Changes made 2026-09-23

### Site Manifest rebuilt — 12 rows → 23

Rows are **surfaces the public can hit**, not files in a directory. 19 HTML pages at repo
root plus 4 server-rendered route families with no HTML file.

Grouped as Public (6) · Builder flow (4) · Auth (3) · Admin (2) · Legal (4) ·
Server-rendered routes (4).

- `gunforma-parts-builder.html` deleted — retired in `c00d83b` (2026-09-09), replaced by
  `gunforma-armory.html`.
- Added, never previously tracked: armory, profile, admin-post, legal, privacy-policy,
  terms-of-service, builder-agreement, auth-callback.
- Route families added: `/parts/:category/:slug` (product-page.mjs), `/parts`
  (parts-index.mjs), `/b/:id` (build-og.mjs), `/u/:username` (profile-og.mjs).
  `/b/:id` shipped 2026-09-23 and is the route builder shares travel on.

**Product pages get one row, no count stored.** Not 231 rows, not a separate section. The
count changes on every CSV import; `sitemap.xml` and Supabase are authoritative. A third
stored copy is the same mistake as the 12 stale HTML files.

### Status field: three states → two

Was Built / Deployed / Needs Update. Netlify auto-deploys `main`, so every file in the
repo is deployed by definition — "Built" and "Deployed" were the same state carrying no
information, and 10 rows said "Built" while live in production.

Now **OK / Needs work**. Only "needs work" is a judgment a repo can't make.

Each row also carries `lastDeploy`, set from the file's last commit date. Refresh it with:

    for f in *.html; do echo "$f $(git log -1 --format=%ad --date=short -- $f)"; done

### Weekly Deploy Log: kept, trimmed

AG's instinct was to delete it as a second copy of `git log`. Kept instead, because the
duplication was only in one field.

Each entry's `items` array was a restatement of PR titles — that was the git duplication,
and it is gone. What remains is `date` / `page` / `summary`, where the summary carries the
**consequence in plain English**, which git structurally cannot hold:

- git: `fix(price): the displayed price and the buy button are the same listing`
- deploy log: buy buttons went to a different listing than the price shown — wrong on
  **27 of 160 products**.

Also in there and nowhere in git: the nightly sync had been re-pointing affiliate links to
the wrong products since it was built (a Primos choke tube and a Streamlight light share a
part number); 26 Olight prices wrong, some by 25%; a privilege-escalation hole that let
any signed-up user make themselves admin.

That material is the raw form of two things gunforma needs: the credibility answer for an
**AvantLink** application ("why should a network trust your price data"), and a public
changelog. One entry per deploy-week, written from `git log` at week close.

A link to the GitHub commits page was rejected as the alternative — it adds a click and no
information, and nobody scrolls 146 commits.

---

## Repo facts, verified 2026-09-28

Public repo: https://github.com/alexgamboa1/Gunforma. Netlify deploys from `main`; there
is no staging. Clone it and read `CLAUDE.md` — that is the technical source of truth.

- `main` at `e1404f7` (was `8fb167b` before the #81–#85 session).
- **One stranded commit:** `8824d84` on `route-behaviour-truth`, not on `main`, no open
  PR — see the note above.
- **PR #75 open** (`sitemap-function`): generates `sitemap.xml` and deletes the static file.
- 19 HTML files at repo root.
- `sitemap.xml` on `main` is still the static **241 URLs**: 9 static + 232 products, with
  **zero builds and zero profiles** — #75 is what changes that.
- Four function-backed route families. `build-og.mjs` now serves two URL shapes, not one.
- Build command is `bash scripts/check-all.sh`, not a no-op. Three guards run on every
  deploy and a failure refuses to ship.
- Edge function `canonical-host.js` redirects the `*.netlify.app` mirrors to the apex and
  marks previews noindex.
- **Four shared JS modules** — `js/redact.js`, `js/photos.js`, `js/affiliate.js`,
  `js/part-picker.js`. Do not copy any of them back into a page.

---

## Open, and worth saying plainly

**Tracker state as of 2026-09-28, counted from the live database:**

- **61 done** — 60 dev, 1 monetization, **zero content, zero BD**.
- **12 open** — 6 dev, 3 content, 2 monetization, **1 BD**.

That 1 is the first BD task this tracker has ever held. It is
`open-send-claim-invites`, priority critical, and it is the only task on the board whose
completion changes the business rather than the codebase.

**The ratio is the thing to look at.** Twenty-eight PRs across the 09-26 and the two 09-28
sessions, all dev, and the real build count went into every one of them at 2 and came out
at 2. The site is now genuinely launch-ready: redaction on both post paths, square slots
with a preview so a builder can confirm a blur landed, reorderable photos, admin nav, slug
URLs, working share previews with the new logo, build-time guards so a silent coupling
cannot ship broken, and — as of the evening session — a part picker that confirms what you
picked, photos that show the whole part, and an armory that cannot silently eat a draft.
**It is a finished product with two real builds in it, and two test fixtures sitting next
to them in public.**

Every technical excuse is gone, and the evening session generated five more PRs without
touching that fact. The next thing that happens is either five messages or nothing.
