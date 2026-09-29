# Gunforma Ops Tracker — notes (rewritten 2026-09-23, updated 2026-09-28)

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
