# What gun is a build? — the provenance rule (2026-10-12)

**This repo copy is canonical. The copy in the claude.ai project is a
mirror.** Agents cannot read the mirror, so when the two disagree, this
file is the one that has to be right — same arrangement as
`claude/loadouts-spec.md`.

**Status: decided. This rule governs every guide family, build page and fit claim built from here on.**

Raised by AG while confirming the `builds.gun_id` backfill: *"A gun can be an XMacro but use a 3.1" P365 slide and a Radian Afterburner. So is it really an XMacro, or does it belong to the 3.1" P365 slide?"*

The question has no single answer, and that is the finding. What follows is the rule that resolves it.

---

## 1. Why the question is malformed

On the P365 the serialized firearm is the **FCU**. The slide, barrel and grip module are all swappable and none of them is the gun. "P365 XMacro" is therefore not a description of an object — it is the name of a factory *combination* that arrived in one box. The moment a part is swapped, that name becomes a historical fact about the purchase, not a description of the gun.

AG's question collapses three different things into one column:

| | What it answers | Where the answer actually lives |
|---|---|---|
| **Provenance** | What box did it come in | **Only the owner knows** |
| **Current configuration** | What is it right now | The build's parts |
| **Fitment** | What else will fit it | The installed grip, slide and barrel specs |

The example build — XMacro FCU, 3.1" P365 slide, Radian Afterburner, XMacro grip — is:

- **Provenance:** P365 XMacro
- **Currently:** a 3.1" ported setup on a Macro grip, running 17-round Macro magazines
- **For fitment:** governed by the Macro grip (magazines, light rail) and the 3.1" slide (optic cut, barrel class). The word "XMacro" governs nothing.

---

## 2. The rule

> **`gun_id` is provenance only. It never answers a fitment question.**

**What `gun_id` is for:**
- Browse and filter — "show me XMacro builds"
- A provenance line on the build page — "Started as: P365 XMacro"
- Long-term segmentation of the dataset — "what do XMacro owners actually run"

**What `gun_id` must never do:**
- Decide whether a part fits a build
- Decide which guide a build appears on
- Imply the build still carries any factory part

### Why this matters more here than on most sites

Gunforma's whole promise is verified fitment. A build labeled "P365 XL" that is running an aftermarket RMR-cut slide must **never** appear under *"Red dots that fit the P365 XL"* — that guide is about the factory RMSc cut, and the model label would actively lie to the reader. One wrong fit claim makes every other claim on the site suspect. This rule exists to make that failure impossible rather than unlikely.

---

## 3. How builds-as-proof must be joined

A guide's "builds running this" section matches on **the attribute the guide is about**, read from the build's own parts — never on `gun_id`:

| Guide family | Join on the build's… |
|---|---|
| Red dots | **slide's** optic cut / footprint (factory or aftermarket) |
| Grip modules | **grip's** housing class and magazine family |
| Compensators | **barrel's** length, thread pitch and `comes_with_barrel` |
| Lights | **grip's** light rail type |
| Magwells | **grip module** the magwell is declared against |
| Slides | **grip module's** housing class and `min_slide_length_in` — the reader wants a new slide, so what constrains them is the grip they are mounting it on, not the slide they have |
| Barrels | **slide's** class and length — a barrel fits a slide, not a gun |

Note the inversion on slides: the constraining part is the **grip**. That is the kind of thing that gets coded backwards if nobody writes it down.

**Which factory parts block which family.** No factory part is written to the snapshot (see section 6), so the parts people swap *last* are the ones the best guides depend on:

| Family | Needs | Blocked when the build's… |
|---|---|---|
| Red dots | slide's optic cut | slide is factory |
| Barrels | slide's class and length | slide is factory |
| Comps | barrel's length and thread pitch | barrel is factory |
| Grip modules, lights, magwells | grip's class / rail / magazine family | grip is factory — rarest, 4 of 5 approved builds swapped the grip |

All of these specs already exist per-part in the schema. Joined this way, the example XMacro build correctly appears on the **3.1" / P365 red-dot page** rather than the XMacro one — which is more useful to the reader, not less, because it answers the question they actually asked.

---

## 4. Consequences for the nine existing builds

**Provenance is, by definition, the thing parts cannot tell you.** The low-confidence rows in the 2026-10-12 inference pass were not low-confidence because the evidence was thin — they were **unanswerable without the owner**. Builds 1 and 5 read as coin flips for exactly this reason.

Decision taken:

| Build | Action | Why |
|---|---|---|
| `9d1f3cdc` My X Macro | set **P365 XMacro Comp** | factory integrated-comp ports visible; 3.1" replacement barrel only the Comp takes |
| `358d8bf0` All Black P365 1911 | set **P365 XL** | builder's own words: "P365XL slide on the Mischief G2 XXL grip" |
| `76761d51` ECM R11 Burnt Orange | set **P365 XMacro** | builder typed "3.7 inch Macro Slide", factory XRAY3 sights |
| `2e980fc8`, `a4d60762`, `45d27452` | **leave NULL** | approved; inference only. NULL permanently unless the owner says otherwise — not "guess later" |
| `84d09757`, `792a8808` | **`fcu_only = true`, gun_id NULL** — set 2026-10-13 05:58 UTC | **the builder's answer, via AG: bare P365 FCU builds.** Not inference — the contrast with `76761d51` below, which was set from a listed factory slide. All-aftermarket slide, barrel and grip, so the parts alone could not have said |
| `22c80428` test2 | **delete** | AG's own test build; hero photo byte-identical to another build |

`fcu_only = true` already existed in the schema. That flag *is* the provenance-unknown case, and whoever added it was already circling this problem.

**`76761d51` was set by inference from a listed factory slide, not by the owner** (2026-10-13). The builder's answer had settled the other two R11 builds as bare-FCU; for this one the listed "3.7 inch Macro Slide" by SIG with factory XRAY3 sights was taken as the answer, on the reasoning that nobody buys a bare factory slide. The **signal hierarchy** that ruling rests on, for the next time a row has no owner answer: a **listed factory slide is a strong provenance signal** (not sold bare, so it came with a gun); a **factory barrel is moderate** (sold separately, but rarely bought without the slide it fits); a **factory grip module is weak** (sold separately and the most-swapped part, so it says nothing about the model — which is why `45d27452` stays NULL with `fcu_only = false`: a factory grip rules out an FCU build and rules in nothing).

---

## 4b. Build titles are never a data source

A build title is the builder's self-expression, and it is untrusted input for data purposes — the same category as a product review. Display it; never compute from it.

**The evidence is already in the data:** build `358d8bf0` is titled **"All Black P365 1911 Build."** That title names a different pistol platform entirely. Anything parsing titles for model data would classify it as a 1911. The 2026-10-12 inference pass did read titles as evidence ("My X Macro. Love this EDC."); it happened to be right, but it was reading marketing copy as fact.

**The specific hole.** Per `claude/launch-handoff.md`, a build owner can change **name, description and activity** after approval with no re-review (pistol, photos and parts are locked). So the one freely editable field is also the most visible, the most quotable, and the one feeding `og:title` and the share card. A build renamed "P365 XL Red Dot Build" on an X-Macro goes live unreviewed and gets indexed under the wrong gun. Not malice — people rename things casually.

**Rules:**
- Titles never feed `gun_id`, fitment, or which guide a build appears on.
- The structured content is authoritative. A model name must never appear *only* in the title — the provenance line and the parts list are what a reader and a crawler should weigh.
- **Later, at volume:** a tripwire that flags a build whose title names a model contradicting its provenance or its parts, into the admin queue. Not blocking, just flagging. ~20 lines, and it guards the only field a builder can change unreviewed. Not worth building at 5 builds and 1 real builder.

---

## 5. UI rules

- The build page renders **"Started as: P365 XMacro"** — a provenance line, not a title.
- When `gun_id` is NULL it renders **nothing**. No fallback to "SIG P365", no "Unknown", no placeholder.
- `fcu_only = true` renders as an FCU build, not as a model.
- No page anywhere derives a compatibility statement from the provenance line.

---

## 6. Code audit — done 2026-10-12

**No fitment claim is driven by `gun_id` anywhere today.** Nothing filters parts, verdicts or fit badges by a build's model. This rule is preventive, not a bug fix. `gun_optic_cuts.gun_id` and `light_compatibility.gun_id` share the name but key on `guns.id` as a catalog fact about a factory model — legitimate, unrelated to builds.

### Two reads that treat the model as a description

| Where | What it says | Action |
|---|---|---|
| `js/gun-model.js:218` | form hint: "What it started as — **sets the stock slide and barrel**" | drop everything after the dash |
| `js/gun-model.js:398` | `sectionNoteHtml()`: "Stock P365 XL slide (3.7") — leave this empty unless you swapped it" | see the architectural hole below |
| `gunforma-admin-queue.html:546` | "Model: P365 XL · 3.7" barrel · built-in comp" / "no stock slide" | show the model name only; drop the derived clauses |

### The architectural hole: a factory slide has no recorded cut

`gun-model.js` was built on this design: **a stock slide is not written to the snapshot — it is "implied by the model plus the absence of a slide part."** That is the provenance rule's violation baked into the architecture, and it is not merely forbidden, it is *impossible*: nearly every P365 model ships two different cuts by SKU (RMSc by default, SIG-LOC Compact on `-SL` and `-RXSL`), and the base P365 also carries an un-milled legacy row.

Consequence: **four of the nine builds have no recorded cut** — not because of a join bug, but because nobody ever recorded what cut those slides have. Of those four, **three are permanently blocked** as red-dot proof: `2e980fc8`, `a4d60762` and `45d27452`, approved builds with no reachable owner answer. The fourth, `9d1f3cdc`, is a factory XMacro Comp slide and joins once Phase 2 collects a SKU from its owner.

### The real rule: absence is not a statement

The question *"which P365 is it?"* is **correct and stays.** It captures provenance, it frames the build for the builder, and it reads naturally in the flow (AG confirmed this building a test build on 2026-10-12). The question was never the problem. Two things downstream of it were:

1. using the answer to **silently fill in** the slide and barrel when the builder leaves those blank, and
2. using the answer to drive a fit claim.

> **A factory part's specs may be recorded only when the owner has affirmatively said that part is still factory. Absence of an entry is not that statement — it means unknown.**

`sectionNoteHtml()` says "leave this empty unless you swapped it," so a blank slide section is read as "factory slide." But a blank field could equally mean the builder didn't finish, didn't know, or didn't care. That is the bug: **the design treats an empty field as an assertion.**

### The fix: a confirmed default, not a silent one, and not a new question

The current design's UX instinct is right — making a builder hunt down and enter "P365 XL factory slide" as a part is busywork, and "leave it empty unless you swapped it" is good UX. So do not add friction. **Make the assumption visible instead of hiding it.**

When a builder picks P365 XL and leaves the slide section empty, the form shows a pre-filled chip:

> **Factory 3.7" slide** — RMSc optic cut · *not yours? swap it*

They confirm by doing nothing. Zero extra steps, same flow as today. Three things change:

- The claim is **visible**, so a builder who did swap slides sees it is wrong and fixes it. Today they would never know the site made that assumption.
- A confirmed default is a **stated fact**, so recording the cut and length as real data is legitimate.
- When the model carries two cuts, the chip carries the one question that matters: *"RMSc — or SIG-LOC if your SKU ends in -SL."* No separate question in the flow.

Same pattern for the barrel: *"Factory 3.7" barrel — not threaded."*

This is cheaper than adding a question and it kills the "implied by the model plus the absence of a part" design rather than patching around it. Result: factory-slide builds get a **confirmed** cut, or an honest blank. Someone who bought used with no box genuinely does not know their cut, and Gunforma should not pretend otherwise.

**Deadline, and it is not a date:** fix the SKU question **before the next invite wave.** At roughly one build a week the cost of waiting is one unanswerable build a week. Twenty claim messages creates twenty builds that can never be red-dot proof, and going back to ask twenty people what suffix was on their box is a conversation that will not be won.

### Builds-as-proof: what the join can and cannot do today

`fetchBuildsUsing()` at `guide-page.mjs:211` matches approved builds whose snapshot carries the id of any optic listed on the page — a **product** match, not a cut match.

A cut match is reachable for aftermarket slides: the cut is not on `slide_specs`, it is `product_variants.optic_cut`, and the snapshot stores `variantId` on every catalog part. Chain: snapshot `variantId` → `product_variants.optic_cut` → `optic_cut_footprints` → footprint → the optics the page lists. PostgREST cannot join into a jsonb array, but the function already fetches all approved builds and filters in memory, so this is one extra query. Live slide variants: `rmsc` (62 variants / 39 products), `ki-multi` (4 / 2).

Blockers, in order:
1. **Factory slides have no cut** (above). Four of nine builds.
2. **Custom-typed slides carry no reference.** Three of the five slide entries are pending custom parts with no `refId` or `variantId` — the three ECM/LWS slides. Matchable only once the review queue links them to a catalog product with the right variant.
3. The two linked aftermarket slides both read `rmsc` and would match today.

### The build page renders nothing about the model

`build-detail:653` and `build-og.mjs:710` both omit `gun_id` and `fcu_only`, so NULL and non-NULL render identically — nothing. What they do render is the **platform**, a separate fact that will keep saying "SIG P365" regardless.

To add the provenance line: both selects need `gun_id, fcu_only, guns(name)`; the line renders only when a model resolves; and the server and browser copies must emit identical markup, since `check-canonical-coupling` holds the placeholders byte for byte. Keep the existing fallbacks ("Unknown pistol" at `build-detail:1024`, "Build"/"Custom" at `build-og.mjs:216`) **out** of the new slot.

**Decided:** `fcu_only = true` **renders**, and not as a model. Copy: **"FCU build — no factory slide, barrel or grip."** Hiding it loses true information, and in this community an all-aftermarket build is a flex, not a gap.

---

## 7. The plan — what happens when, and what triggers it

Nothing here is date-driven except phase 1. Each later phase has a **trigger**, because every one of them is worthless until its trigger fires.

### Phase 1 — Now: write the rule down, stop guessing

| Action | Status |
|---|---|
| CLAUDE.md rule, plus the two description strings cut | PR 162 |
| Strike the contradicting "fall back to the model's stock slide" instruction in the existing FCU section | PR 162, second commit |
| Set `gun_id` on the three high-confidence builds (`9d1f3cdc`, `358d8bf0`, `76761d51`) | done 2026-10-12 |
| Leave `2e980fc8`, `a4d60762`, `45d27452` NULL permanently unless the owner says | standing |
| Set `fcu_only = true` on `84d09757`, `792a8808`, gun_id NULL — the builder's answer, not inference | done 2026-10-13 05:58 UTC |
| Delete `22c80428` test2 | already gone when the pass ran on 2026-10-12: no builds row, no photo rows, its storage folder empty |

**Why now:** the rule is insurance. Three guide families (comps, lights, grip modules) are queued and each would inherit the flaw. Writing it costs ten minutes; a wrong fit claim on a fitment site costs trust that doesn't come back.

**What it buys today:** nothing visible. This phase is hygiene, and that is the honest framing.

### Phase 2 — Trigger: before the next invite wave. Ask the SKU.

Ship the **confirmed-default chip** described in section 6: a pre-filled factory slide and barrel the builder confirms by doing nothing, carrying the SKU question inline when the model has two cuts. Keep the "which P365 is it?" question exactly as it is. No new step in the flow.

**Why this trigger and not a date:** at roughly one build a week, waiting costs one unanswerable build a week. Twenty claim messages creates twenty builds that can never be red-dot proof, and going back to ask twenty people what suffix was on their box is a conversation that will not be won. **Fix the form before the invites, not after.**

### Phase 3 — Trigger: enough builds that a model page would look populated (~20–30)

- `"Started as: <model>"` on the build page. Both `build-detail` and `build-og.mjs` selects need `gun_id, fcu_only, guns(name)`; identical markup in both copies (`check-canonical-coupling` holds the placeholders byte for byte); nothing rendered on NULL; `fcu_only` renders "FCU build — no factory slide, barrel or grip".
- `"Builds of this model"` on each gun hub. This is the first phase where `gun_id` earns its keep — real content and internal links on the nine pages Google already knows about.

**Why wait:** with five builds, a "builds of this model" section shows one build or none. An empty section makes a page look thinner, not denser.

### Phase 4 — Trigger: the red-dot guides have builds to prove anything with

Replace the product match in `fetchBuildsUsing()` with the cut match described in section 6: snapshot `variantId` → `product_variants.optic_cut` → `optic_cut_footprints` → footprint. Factory-slide builds only join once phase 2 has been collecting SKUs.

**Why wait:** two slides would match today.

### Phase 5 — Trigger: hundreds of builds

Segment the dataset by model. "What X-Macro owners actually run" is the brand-partnership and data-intelligence story, and it is the only phase where `gun_id` is worth real money. It is also the reason not to let the column rot: **fill it as builds arrive, never backfill.**

### Never

- `gun_id` deciding whether a part fits, or which guide a build appears on.
- Guessing provenance on a build whose owner could be asked.
- A fallback value in the provenance slot — no "SIG P365", no "Unknown".

---

## 8. Why this is written down

Three new guide families (compensators, lights, grip modules) are queued behind the `/fit/` expansion research. Each one needs its own fetch, columns and verdict builder inside `guide-page.mjs`. If any of them joins builds on `gun_id`, Gunforma ships a wrong fit claim — and the recovery cost is reputational, not technical.

The one-line version: **a modular pistol has no model, only a history and a current configuration. Gunforma states the history and computes from the configuration.**
