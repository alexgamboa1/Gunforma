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

Every ::unlocks block ends with "Counts from the gunforma catalog on
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
comp×barrel (`v_comp_barrel_fit` `fits`), magwell×frame
(`magwell_frame_requirements` row). A pair with no fit source (trigger ×
slide) is allowed and says nothing. A pair the views refuse takes the
block down to a visible refusal naming the pair — no parts table, no
prices, no button — and `x-field-note-build` reports ok/asked pairs, so a
live regression is readable off the wire. The offline guard cannot see
fit data; it checks slugs, roles and categories, and
`scripts/field-notes-v2.test.mjs` pins the refusal against a stub.

## The method line

Every field note renders ONE line directly under the byline and above the
affiliate disclosure — implemented once in the renderer
(`METHOD_LINE_HTML` in `_guide-blocks.mjs`), never per-article text — and
it links the standing page `/how-gunforma-checks-parts.html` (static,
sitemap-submitted, in llms.txt; the bare path 301s to the .html form).
Don't restate it in prose.
