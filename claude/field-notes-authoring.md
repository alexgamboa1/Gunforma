# Field Notes — authoring the live-data blocks

How to write a Field Notes article's directives. The renderer is
`netlify/functions/field-note.mjs`, the parser `_markdown.mjs`, the shared
declarations `_guide-blocks.mjs`; `scripts/check-field-notes.mjs` refuses at
build time everything this file says not to do. The standing rules bind
every block: **data only, never typed numbers** (a `$` figure anywhere in
prose, args or a block body fails the build); a missing value renders "—"
or omits the line, never a guess; "likely" fit is always labelled apart
from "verified"; a slug that doesn't resolve to a live catalog product
fails the build (offline against `scripts/fixtures/product-names.json`,
live on the wire by check-routes).

The original six — `::price`, `::fit`, `::picks`, `::rank`, `::compare`,
`::faq` — are documented in CLAUDE.md ("Field Notes articles"). This file
covers the v2 additions (2026-11-19).

## Editing from the admin page (2026-11-20)

`/gunforma-admin-field-notes.html` (admins only) is the editor: every note
from `main` with its type, status and last-reviewed date; a textarea
beside the real renderer's live preview; the lint below run on every
pause in typing (FAILs red with line numbers, WARNs amber; Save is off
while a FAIL stands). **Every action opens a pull request** — Save
(`Field note edit: <slug> — <what changed>`; the required "What changed"
line is also the changelog entry; tick "This is a full review" only when
the whole note was re-reviewed, since that moves "Last reviewed"),
Publish / Unpublish (flips `draft`, adds or removes the index card), and
New draft (paste the gunforma-field-note skill's output, `registry-row`
block and all). A second save while that note's edit PR is open adds a
commit to it. Nothing goes live until the PR is merged.

## The voice, and the article type (2026-11-20)

**Read [`field-notes/VOICE.md`](../field-notes/VOICE.md) before writing a
word** — Gunforma is a reference desk, not a reviewer. The voice is a build
guard (`scripts/field-notes-voice.mjs`, run by `check-field-notes.mjs`), so
review language does not ship:

- **Fails the build:** implied testing ("we tested", "at the range",
  "after 500 rounds"), verdicts ("best overall", "top pick", "worth it",
  "we recommend"…), feel words ("crisp", "snappy", "feels"…), hype
  ("badass"), a heading "Pros" or "Cons", a `::picks` or `::rank` label
  that is exactly "Best" or starts "Best overall", and a blockquote with
  no attribution linking the public build it was copied from (a `/b/…`
  link on the quote's last line or the line after).
- **Printed as a warning:** unbacked quality words ("reliable",
  "smooth", "premium", "reduces recoil"…), "downside"/"drawback", vague
  counts ("many", "most", "several", "a lot of"), and a `::rank` card
  whose following paragraph never names its product.
- **Scanned:** prose, headings, `::picks` labels, `::rank best=` labels,
  `~`/`=` lines, `::build` names and `::faq` answers. **Not scanned:**
  blockquotes (an owner's verbatim words), code, link URLs. Every phrase
  lives in `VOICE_RULES`; a new one is a line there, not here.

**`type` is required** in the front matter, one of `fit | trap |
comparison | roundup | explainer | builds | new-part`. Each type is
checked (as warnings) for the sections its job needs — every type: one
`::faq` of 5–8 entries and a title that does not open with What / Which
/ Will / Does / Can / How; roundup: `::picks`, `::compare`, 3+ `::rank`,
an `::unlocks`, a `::build` and an H2 with " vs "; comparison: " vs " in
the title, `::compare`, 2+ `::unlocks`; fit: an H2 question with "fit",
an H2 "How fit was checked", a `::fit`; trap: an H2 with "need", a
`::build`; explainer: the first H2 opens "What is" / "What are"; builds:
an H2 with "builders" or "builds". The eyebrow reads "Comparison" for
comparison and "Guide" for every other type.

## `::rank` — changes/same, not pros/cons

A rank card's body lines are:

- `~ text` — listed under **"What it changes from the factory part"**
- `= text` — listed under **"What stays the same"**

Optional arg `baseline=<slug>` (the factory part) renders a small
"Compared with {display name}" line under the headings, linking that
product. The baseline must resolve; the aftermarket-only rule deliberately
does not apply to it — naming the factory part is its point.

```
::rank icarus-precision-air-xmacro best="Lightest metal module" rank=1 baseline=sig-sauer-p365-xmacro-gm-oem
~ Aluminum frame in place of the factory polymer
= Same MACRO 17-round magazines
::
```

**Every line under "What it changes" (and "What stays the same") must be
derivable from a spec column, a fit row, or the maker's stated wording** —
the same evidence rule the pros/cons lines carried. No "feels great", no
reliability opinions, and an authored line may never disagree with what a
live-data block on the same page renders.

`+ pro` / `- con` lines still parse (the renderer fixture keeps that path
covered) but **fail the build in any non-fixture article**: "Field Notes
don't use pros/cons — use ~ (changes from factory) and = (stays the
same)." One pre-rule article is grandfathered by slug in
check-field-notes.mjs until its lines are converted.

Each rank card also renders, from the live variant rows and never from
typed text: the product's colours as named swatches (the shared swatch
rule — the colors table carries no hex), and "Manual-safety option
available" when any live variant has `manual_safety_variant = true`.

## `::unlocks` — what this part opens up

```
::unlocks frame=tyrant-cnc-p365-xmacro-gm
::unlocks slide=<slide-slug>
```

One key, `frame=` or `slide=`, whose slug must be a live product of that
category. Renders a compact list of counts from the fit views at request
time, each line linking the product page. Counts include only approved,
non-discontinued parts. A zero-row line is omitted — never "0 …" — with
one exception: a frame whose `magwell_type` is `None` with zero
`magwell_frame_requirements` rows renders "No add-on magwell on record for
this module", a real gap the reader should see.

- `frame=`: lights (`v_frame_light_fit`, split "N verified · M likely",
  plus the count that needs an adapter or key), slides
  (`v_slide_frame_fit` where `fits`), magazines (the housing class's
  family via `housing_classes` → `magazine_families`, with the count of
  magazines `magazine_housing_fit` says fit — seating verdicts are NOT
  shown here), add-on magwells on record, and distinct live variant
  colours.
- `slide=`: optics (`v_optic_slide_variant_fit`, split direct mount /
  with a plate), barrels (`v_barrel_slide_fit` `fits`), grip modules
  (`v_slide_frame_fit` `fits`), and the recoil-spring requirement the
  slide page already derives (`part_classes.display_name`) — a line, not
  a count.

Every ::unlocks block ends with "Counts from the Gunforma catalog on
{render date}."

## `::colors` — the colour table

```
::colors slugs=a,b,c baseline=sig-sauer-p365-xmacro-gm-oem
```

One row per product, the baseline row first labelled "(factory)": display
name · colour names (distinct live variant colours, in
`colors.sort_order`) · count · "Cerakote" when any variant's finish
family is Cerakote, else "—". No typed colours, ever.

## `::build` — an example configuration that is proven to fit

```
::build name="Lightweight ODG carry build"
frame=icarus-precision-air-xmacro
slide=<slide-slug>
optic=<optic-slug>
light=<light-slug>
::
```

Roles (one each): frame, slide, barrel, optic, light, magwell, comp,
trigger, magazine. Renders the build name, one row per part (the
category's singular name · display name linked · the live lowest fresh
price with its retailer, else "Check price"), a total ("$X at today's
prices", "+ N parts without a live price" when any part has none), and a
"Start this build in the Armory" button (the Armory start page — no
multi-part prefill exists yet).

**Every pair with a fit source must fit, checked on every request**:
slide×frame (`v_slide_frame_fit.fits`), optic×slide
(`v_optic_slide_variant_fit` row), light×frame (`v_frame_light_fit` row —
`adapter-separate` renders "needs a key/adapter, sold separately", no
verified row renders "fit likely, not verified"), barrel×slide (`fits`),
comp×barrel (`v_comp_barrel_fit` `fits` — both pitches stated and equal,
and never for a comp sold with its own barrel: `kit-barrel-only`), magwell×frame
(`magwell_frame_requirements` row). A pair with no fit source (trigger ×
slide) is allowed and says nothing. A pair the views refuse takes the
block down to a visible refusal naming the pair — no parts table, no
prices, no button — and `x-field-note-build` reports ok/asked pairs, so a
live regression is readable off the wire. The offline guard cannot see
fit data; it checks slugs, roles and categories, and
`scripts/field-notes-v2.test.mjs` pins the refusal against a stub.

## Page furniture you get for free (2026-11-20)

Nothing below needs per-article work; it is how the renderer lays out
every note, so write the headings and the registry row well and the rest
follows.

**Headings drive the table of contents.** Every `##` gets a stable id
(the heading slugged; a repeat gets `-2`, `-3`) and, on a note with three
or more H2s, an entry in the table of contents — a sticky "On this page"
rail at ≥1024px, a collapsed "Jump to section" under the method line
below that. H3s are never listed. "Latest updates" and "Related field
notes" close the list when the page has them. So:

- **No `# ` headings in the body** — the title is the page's one H1. The
  build fails.
- **Name each H2 for what it answers.** "Overview", "Introduction",
  "Details" and "Conclusion" fail the build: as TOC entries they tell a
  reader nothing.
- **A long H2 may carry a short TOC label:**
  `## Which magazines seat flush in each module {toc="Magazine fit"}`.
  The heading and its id keep the full text; the label (≤ 40 characters,
  no `$`) is only the TOC entry. The suffix must close the line exactly.
- **An H3 outside a ::rank card prints a warning**, not a failure: fine
  for a sub-point, but the TOC skips it — promote it to `##` if readers
  will want to jump there.

**The byline row** is author · `author_credential` · "Last reviewed
<Month YYYY>" (the registry's `updated`) — one visible date; the
published date is in the structured data only — then the method line,
then the affiliate disclosure when a block sells. No `author` means no
name at all — never a placeholder. The byline is the page's only author
credit; there is no author box at the bottom.

**Structured data** is one `@graph`, built by the renderer: Article (its
author a `Person` with the credential as description when `author` is
set, else the Organization), a BreadcrumbList Home → Field Notes →
title, one `ItemList` per ranked group, and FAQPage from `::faq`. A
ranked group is a run of `::rank` cards; **restarting at `rank=1` starts
a new group**, named by the `##` its first card sits under. There is
never a Review or an AggregateRating — we don't range-test parts.

**Related field notes** come from the registry's optional `tags` (an
array of lowercase slugs on the article's row in `_field-notes-meta.mjs`,
not the front matter): up to four other live notes sharing a tag, most
shared first, then most recently reviewed. A draft is never listed. Tag
a note by what a reader of it would want next — its category and the
gun it is about are the usual pair. Under the notes, one **"Keep going"**
line links the note's model hub (the first live hub whose
`FIELD_NOTE_LINKS` entry points at the note, else the `/p365/` index),
the Armory, the builds, and All Field Notes last (besides the breadcrumb,
an article's only path to the index). With no related notes there is no "Related
field notes" heading — the Keep going line stands alone. The page never
has two Related headings.

## The method line

Every field note renders ONE line directly under the byline and above the
affiliate disclosure — implemented once in the renderer
(`METHOD_LINE_HTML` in `_guide-blocks.mjs`), never per-article text — and
it links the standing page `/how-gunforma-checks-parts.html` (static,
sitemap-submitted, in llms.txt; the bare path 301s to the .html form).
Don't restate it in prose.
