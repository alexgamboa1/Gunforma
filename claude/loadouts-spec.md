# Loadouts — spec

**Repo copy.** This is the canonical version for Claude Code sessions; `CLAUDE.md`
points here. A mirror lives in the Claude project for AG, but agents cannot read that,
so this file is the one that must stay current.

Written 2026-09-28. Decisions and corrections 2026-09-29.

---

## 0. Status

- All five decisions are made (§7). Ready to build.
- **The Armory is currently hidden from the site** (PR #88): no nav links, removed from
  the sitemap, `noindex`, and the Add-to-Armory control removed from the parts catalog.
  The page still exists and still works — it is parked, not abandoned. `git revert` of
  that commit restores it.
- The four published guides are dark with it, intentionally. Their rows are intact.
- Build this when there is time to build it properly. It is not a bug that the Armory
  is missing from the nav.

---

## 1. The problem

`gunforma-armory.html` writes into the **same `builds` table** as a real build, with
`status: 'draft'`. Its own comment says the row "can be picked up later in post-build
for real submission."

So the Armory has no concept of its own. Everything it makes is a build that hasn't
grown up. It reads as a second place to post a real build because that is structurally
what it is — and renaming it fixes nothing while both things are the same row.

Two concepts exist in the schema today:

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

"Loadout" is already in the brand voice — `index.html`'s title and H1 are "Your pistol.
Your loadout.", and it appears in `scripts/invite-email-template.html`.

**AG's definition, to keep:** the Armory is *"for people to make a build without actually
having the parts first."* That is the whole product in one line. Put it on the page.

---

## 3. Why a Loadout is not just a build without photos

| | Build | Loadout |
|---|---|---|
| Subject | a gun someone owns | a gun someone is speccing |
| Photos | real, uploaded, redacted | generated from catalog images |
| Lifecycle | draft → review → approved | done the moment the parts are picked |
| Costs the admin attention | **every single one** | **none** (see caveat) |
| Commercial moment | post-purchase | **pre-purchase** |

The last two rows are the argument.

Every real build costs a review, and there is one reviewer. A Loadout has no user photo
to redact and no legal confirmation to collect — every part is already a catalog product.
It can publish instantly. **That is a content type that scales past the admin's
attention, which nothing else on the board does.**

And it is where the money is. A real build is a photo of a gun bought two years ago.
Someone assembling a P365 in the Armory is deciding what to buy now.

**Caveat:** the loadout *title* is user-typed free text on a public URL, so "no
moderation" is not literally true. See §7.5.

---

## 4. Schema — new table, not a discriminator

**`loadouts`**, not a `kind` column on `builds`.

A discriminator means every existing query against `builds` becomes wrong by default
until someone remembers `.eq('kind','build')` — and a missed filter returns *wrong rows
with no error*. That is this repo's most expensive recurring failure shape: the
RLS-filtered DELETE matching zero rows, the storage listing reporting "0 objects,
exit 0", the admin page silently keeping defects the builder page had fixed, the armory
whitelist dropping `finish`. A new table turns a missed join into a loud error instead
of a silent wrong result.

Existing Armory drafts stay as draft builds. At current volume (0 drafts as of
2026-09-29) migrating them is not worth writing.

Reuse `parts_snapshot`'s shape as-is:
`{category, refId, brand, name, pending, variant?, finish?}`. Carried correctly by
post-build, admin-post and the armory as of PR #86.

---

## 5. The collage

The reference is the PCPartPicker guide card: a hero image plus a strip of component
thumbnails with a "+N" overflow, and a breakdown behind the click.

**Facts, measured against the live database on 2026-09-29 — not inferred:**

1. **`platforms.image_url` EXISTS** and is nullable. An earlier draft of this spec said
   it didn't, inferred from no page ever selecting it. That was inference-from-absence,
   the same mistake that hid the `finish` whitelist bug. Do not repeat it.
2. **It is empty for both platforms.** SIG P365 (`is_live: true`) and SIG P320
   (`is_live: false`) both have `image_url IS NULL`. The work is two photos and two
   UPDATEs, not a migration.
3. **231 of 231 products carry a default-variant image — 100%**, counting only
   non-discontinued products and non-retired variants. No image-coverage risk, no
   degraded fallback needed.
4. **`guides.hero_image_path` already exists** and is worth reusing.

**Design decision — the hero should be the PARTS, not the pistol.** If a platform photo
is the hero, every P365 loadout card looks identical, and the one image every loadout
shares is the worst possible choice for the image meant to distinguish them. The parts
are the identity. Build the collage from 2–3 large part photos plus a thumbnail strip
with "+N", and render the platform as a text label.

The platform photo still earns its place in two spots: the Armory's pistol picker (which
is two text buttons today), and as the fallback when a loadout has too few parts to make
a collage. Threshold to be decided at build time.

Note: the supplied P365 photo is a **P365-X / XMACRO**, not a base P365, while the
`platforms` row is the generic family. AG is aware and accepts it for the picker. If a
pistol hero is ever used on a public collage, use a base P365 instead.

Server-side machinery is already solved: `netlify/functions/build-og.mjs` renders share
cards through the Netlify Image CDN at 1200×900 (4:3), with routes and canonicals done.
A loadout card is the same machinery with a different composition.

**Image hosting:** all 231 catalog images are hotlinked from external hosts, spread
across **26 distinct domains**. Nothing is in Supabase storage. Counted per product,
over the default variant each page actually renders — an earlier version of this
paragraph quoted per-*variant* figures (82 / 87 / 65) against the 231-product
denominator, and they summed to 234, more than the total they were a subset of.

| host | products | share |
|---|---|---|
| `cdn11.bigcommerce.com` | 86 | **37%** |
| `www.opticsplanet.com` | 35 | 15% |
| `www.sigsauer.com` | 15 | 6.5% |
| 23 other hosts | 95 | 41% |

**BigCommerce is the concentration, but it is not one retailer.**
`cdn11.bigcommerce.com` is multi-tenant: the 86 images sit under **12 different store
paths** (`/s-<hash>/`), so they are twelve independent merchants' storefronts sharing
one CDN hostname, not one shop. The largest single store is `s-t13gqpo9l1` with 40
products (17% of the catalog); the rest tail off from 14 down to 1.

That matters for what the risk actually is. A BigCommerce outage takes 37% of the
catalog's images at once, but so does any one of those twelve merchants
re-platforming, re-slugging their product URLs, or simply closing — and each of those
is far likelier than the CDN going down. There is no single throat to choke and
nothing watching any of it.

AG's decision is to keep hotlinking for now. The cheap mitigation, when it is worth
doing, is a scheduled HEAD-check across all 231 URLs that reports breakage, rather
than a migration into Supabase storage.

---

## 6. What not to do

**Do not pull `gunforma-armory.html` into `js/part-picker.js`.** The module owns
`.part-card`, `.part-card-body`, `.part-card-brand`, `.part-card-name`,
`.part-card-price` — and the armory uses those same class names with its own values,
plus `.part-card-photo`, favourites, affiliate rows and a stretched-link overlay.
Loading the module there would restyle the armory grid via its injected CSS. Also in
`CLAUDE.md`.

---

## 7. Decisions

**7.1 Ownership — browse free, sign in at the FIRST action.**

An earlier version said "build freely, account required to save." That created the worst
failure in the feature: signing up leaves the page via an OAuth redirect, so an
in-progress loadout had to survive the round trip or the signup wall would destroy the
work it was asking someone to keep. AG's call: remove the risk rather than engineer
around it. Gate creation, not saving.

**But do not gate the page.** `gunforma-armory.html` has no `requireAuth()` — it is
publicly viewable, and Guides load for everyone via `is_published = true`. Guides are
public, crawlable content and the shop window for this feature.

| | |
|---|---|
| View the Armory, browse Guides, open a public Loadout | **no sign-in** |
| Pick a pistol / add the first part / remix a guide | **sign in first** |
| Everything after that | already signed in, nothing to lose |

The per-action pattern already exists — `remixGuide()` toasts "Sign in to remix a build".
It fires too late. Move the check to the first action that starts a loadout.

Every persisted loadout therefore has a `user_id` from the first click, and RLS stays
trivial.

**7.2 Route — `/l/<slug>-<id>`.** Mirrors `/b/`, so sitemap, canonical and OG work copy
across. The UUID resolves; the slug is decoration, per `js/build-url.js`.

**7.3 Promotion to a Build — not in v1.** One lifecycle per object. Someone who buys the
parts posts a Build normally.

**7.4 The Armory's job — Loadouts only.** `gunforma-post-build.html` becomes the single
path to a real build.

**7.5 Title moderation — report button + admin takedown, not pre-moderation.** Cheapest
thing that works. Pre-moderating titles reintroduces the reviewer bottleneck that
loadouts exist to avoid.

---

## 8. Sequencing

1. **Two platform photos** into `platforms.image_url` (P365 first; P320 isn't live).
2. **`loadouts` table + RLS.** Owner writes, public reads. Propose the schema and
   policies before applying anything — this is the first irreversible step in the
   project. Re-run the anon write-grant sweep from `CLAUDE.md` afterwards.
3. **Armory writes loadouts instead of draft builds**; rename the UI throughout. Carry
   the title field, `variant` and `finish` from #84/#86.
4. **Move the sign-in gate to the first action** (§7.1), leaving the page and Guides
   public.
5. **Route family** `/l/<slug>-<id>` + canonical + sitemap entry.
6. **OG collage function**, modelled on `build-og.mjs`, parts-driven per §5.
7. **Un-hide the Armory** — revert the PR #88 commit, then re-verify the nav across all
   14 surfaces including `netlify/functions/product-page.mjs` and `parts-index.mjs`.

Steps 1–2 touch no front-end code.
