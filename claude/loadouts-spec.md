# Loadouts — spec (written 2026-09-28, decisions + corrections 2026-09-29)

The Armory's output is currently a draft build. This spec separates it into its own
object and says why, what it costs, and what blocks it.

**Decision taken:** build this before real traffic exists, rather than after the first
five invites. At zero traffic the migration argument wins, and the stronger point is that
the Armory as it stands duplicates post-build and hasn't earned its place.

**Status:** all five decisions are made (§7). Ready to build.

---

## 1. The problem, verified

`gunforma-armory.html` writes into the **same `builds` table** as a real build, with
`status: 'draft'`. Its own comment says the row "can be picked up later in post-build
for real submission."

So the Armory has no concept of its own. Everything it makes is a build that hasn't
grown up. It feels like a second place to post a real build because that is structurally
what it is — and no amount of renaming fixes that while both things are the same row.

Today there are two concepts in the schema:

| | |
|---|---|
| `builds` | real builds **and** Armory drafts, distinguished only by `status='draft'` |
| `guides` | curated, `is_published`, remixable |

---

## 2. The taxonomy

- **Build** — a real gun someone owns. Real photos. Reviewed. Claimed by a person.
- **Loadout** — a spec'd parts list. No photos. Publishes instantly.
- **Guide** — a Gunforma-curated Loadout. Same object, editorial byline.

**Loadout** is the chosen noun: native to the community, unambiguously about
configuration rather than ownership, with room to grow into holster / light / belt later.

Do **not** call it a Guide. That word is already spent on curated content.

Note: "loadout" is already in the brand voice — `index.html`'s title and H1 are
"Your pistol. Your loadout.", and it appears in `scripts/invite-email-template.html`.

**AG's definition, to keep:** the Armory is *"for people to make a build without actually
having the parts first."* That is the whole product in one line. Put it on the page.

---

## 3. Why a Loadout is not just a build without photos

| | Build | Loadout |
|---|---|---|
| Subject | a gun someone owns | a gun someone is speccing |
| Photos | real, uploaded, redacted | generated from catalog images |
| Lifecycle | draft → review → approved | done the moment the parts are picked |
| Costs Alex attention | **every single one** | **none** (see caveat) |
| Commercial moment | post-purchase | **pre-purchase** |

The last two rows are the whole argument.

Every real build costs a review, and there is one reviewer. A Loadout has no user photo
to redact and no legal confirmation to collect — every part is already a catalog product.
It can publish instantly. **That is a content type that scales past Alex's attention,
which nothing else on the board does.**

And it is where the money is. A real build is a photo of a gun bought two years ago.
Someone assembling a P365 in the Armory is deciding what to buy now.

**Caveat:** the loadout *title* is user-typed free text on a public URL, so "no
moderation" is not literally true. See §7.5.

---

## 4. Schema — new table, not a discriminator

**`loadouts`**, not a `kind` column on `builds`.

A discriminator means every existing query against `builds` becomes wrong by default
until someone remembers `.eq('kind','build')` — and a missed filter returns *wrong rows
with no error*. That is the exact failure class this project keeps hitting: the
RLS-filtered DELETE matching zero rows, the storage listing reporting "0 objects,
exit 0", the admin page silently keeping defects the builder page had fixed. A new table
turns a missed join into a loud error instead of a silent wrong result.

Existing Armory drafts stay as draft builds. At current volume, migrating them is not
worth writing — leave or delete.

Reuse `parts_snapshot`'s shape as-is: `{category, refId, brand, name, pending, variant?,
finish?}`. Already carried correctly by both pages as of PR #86.

---

## 5. The collage — corrected 2026-09-29

The reference is the PCPartPicker guide card: a hero image plus a strip of component
thumbnails with a "+N" overflow, and a breakdown behind the click.

**Three corrections to the 2026-09-28 version of this section.** All measured against the
live database, not inferred.

1. **`platforms.image_url` EXISTS.** The original spec said there was no platform image
   column and that a schema change blocked the feature. That was wrong — inferred from no
   page ever selecting it, which is inference-from-absence, the same mistake this project
   keeps paying for. The column is there and nullable.
2. **It is empty for both platforms.** SIG P365 (`is_live: true`) and SIG P320
   (`is_live: false`) both have `image_url IS NULL`. So the real work is **two product
   photos and two UPDATEs**, not a migration. An afternoon, not a prerequisite project.
3. **231 of 231 products carry a default-variant image — 100%**, counting only
   non-discontinued products and non-retired variants. Previously an unverified claim;
   now measured. **The collage has no image-coverage risk and needs no degraded
   fallback design.**

Also available and worth reusing: **`guides.hero_image_path`** already exists.

The server-side machinery is done: `netlify/functions/build-og.mjs` renders share cards
through the Netlify Image CDN at 1200×900 (4:3), with routes and canonicals solved. A
loadout card is the same machinery with a different composition.

---

## 6. What not to do

**Do not pull `gunforma-armory.html` into `js/part-picker.js`.** The module owns
`.part-card`, `.part-card-body`, `.part-card-brand`, `.part-card-name`,
`.part-card-price` — and the armory uses those same class names with its own values, plus
`.part-card-photo`, favourites, affiliate rows and a stretched-link overlay. Loading the
module there would restyle the armory grid via its injected CSS. Already in `CLAUDE.md`.

---

## 7. Decisions

**7.1 Ownership — browse free, sign in at the FIRST action. Revised 2026-09-29.**

The earlier version of this decision was "build freely, account required to save." That
created the worst failure in the feature: signing up leaves the page via an OAuth
redirect, so an in-progress loadout had to survive the round trip or the signup wall
would destroy the very work it was asking someone to keep.

AG's call: remove the risk rather than engineer around it. Gate creation, not saving.

**But do not gate the page.** Verified on `main`: `gunforma-armory.html` has no
`requireAuth()` — it is publicly viewable today, and Guides load for everyone via
`is_published = true`. Guides are public, crawlable content and the shop window for this
whole feature. Locking them behind a login would trade the site's best non-catalog SEO
asset for a problem that a correctly-placed gate already solves.

The shape:

| | |
|---|---|
| View the Armory, browse Guides, open a public Loadout | **no sign-in** |
| Pick a pistol / add the first part / remix a guide | **sign in first** |
| Everything after that | already signed in, nothing to lose |

The per-action pattern already exists — `remixGuide()` toasts "Sign in to remix a build"
(line ~1800 on `main`). It fires too late. Move the check to the first action that starts
a loadout, so work never accumulates that cannot be kept.

Every persisted loadout therefore has a `user_id` from the first click, and RLS stays
trivial.

**7.2 Route — `/l/<slug>-<id>`.**
Mirrors `/b/`, so sitemap, canonical and OG work copy across. The UUID resolves; the slug
is decoration, per `js/build-url.js`.

**7.3 Promotion to a Build — not in v1.**
One lifecycle per object. Someone who buys the parts posts a Build normally.

**7.4 The Armory's job — Loadouts only.**
`gunforma-post-build.html` becomes the single path to a real build.

**7.5 Title moderation — report button + admin takedown, not pre-moderation.**
Cheapest thing that works. Pre-moderating titles reintroduces the reviewer bottleneck
that loadouts exist to avoid.

---

## 8. Sequencing

Independent of the five invites — those go out regardless.

1. **Two platform photos** into `platforms.image_url` (P365 first; P320 isn't live).
   Unblocks the collage and is the cheapest item on the list.
2. **`loadouts` table + RLS.** Owner writes, public reads.
3. **Armory writes loadouts instead of draft builds**; rename the UI throughout. Carry
   the title field, variant and finish from #84/#86.
4. **Move the sign-in gate to the first action** (§7.1), leaving the page and Guides
   public.
5. **Route family** `/l/<slug>-<id>` + canonical + sitemap entry.
6. **OG collage function**, modelled on `build-og.mjs`.

Steps 1–2 touch no front-end code and can run in parallel with anything else.

---

## 9. Variant selection landed first — what Loadouts inherits

Added 2026-09-29, after PRs #94 and #95.

`parts_snapshot` now carries which VARIANT a part is, not just which product:
`variantId`, `variantLabel`, `variantColor`, `variantFinish`, `imageUrl`.
Loadouts reuses `parts_snapshot`'s shape (§4), so it inherits these for free —
and it inherits one bug with them.

**Not `color` / `finish`.** Both names were already taken on a snapshot row:
`finish` is the Paint Job & Finish OBJECT from #86 (`{shop, color, stipple}`),
which carries its own nested `color`. The variant's two axes are prefixed for
that reason. Anything reading these rows must use the prefixed names.

**The armory PRESERVES the chosen colour but DISPLAYS the wrong one.**
Verified by running its own whitelist functions over a real non-default
snapshot: `variantId`, `variantLabel`, `variantColor` and `variantFinish` all
survive a save with no changes, even with `PRODUCTS_BY_ID` empty — the three
whitelists pass them through rather than recomputing from the product default.

But `selectedPartHtml()` renders `PRODUCTS_BY_ID[p.refId].image`, which is the
**default variant's** photo, and prints no colour label at all. So a build
whose barrel is Gold shows the Black photo, with nothing on screen saying
Gold. The data is right and the picture is wrong.

This is not worth fixing in the parked page — the whole point of parking it is
that it is coming back rebuilt — but **Loadouts must not copy that renderer**.
Use the chosen variant's own photo, and a colour swatch when it has none:
`js/variant-swatch.js` is the shared module for exactly this, already used by
`js/part-picker.js`'s colour step and by the build page's "See other options"
panel. 244 of 649 live variants have no photo, so the swatch is the common
case rather than the fallback, and every one of the 54 distinct colour values
in the catalogue resolves to something drawable.

**And never the default variant's photo as a stand-in.** That fallback was in
`gunforma-build-detail.html` until #95 and was removed rather than kept: it
puts a Black barrel's photo above the words "Gold / TiN", which looks like an
answer. Seven DEFAULT variants were themselves carrying another colour's photo
until 2026-09-29 — `scripts/check-variant-image-sku.mjs` now watches for that
daily.
