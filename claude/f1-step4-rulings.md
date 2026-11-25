# F1 Step 4 rulings: outline changes, blocks, lint rules, then the draft

Put this file in the repo as `claude/f1-step4-rulings.md` and tell Claude Code: "Read claude/f1-step4-rulings.md and do it." It replaces every earlier Step 2/4 message about this note. `claude/f1-context.md` still applies.

---

## A. Outline (approved with these changes)

**Keep:** title "Best P365 FUSE Slides (2026): Every Option, Fit-Checked" (55 chars), the description, the answer block, 5 picks (one per fit group), frame fit as the centerpiece H2, `::colors`, and the FAQ.

**Restructure the middle by barrel configuration.** Drop sections 4–7 as written. Use:

1. **"Will a P365 FUSE slide fit a P365, XL or XMacro frame?"** `{toc="Frame fit"}`: one frame-fit box for all 12 slides (block below).
2. **"Plain or ported: which P365 FUSE slide do you need?"**: decision table of the 5 groups (port style, barrel it's built around, takes a threaded barrel, barrel included), then the `::compare` table. Say "4.3" slide, 4.3" barrel, FUSE recoil spring" once, here and in the answer block, not on every card.
3. **"Standard and threaded-barrel P365 FUSE slides"**: cards for True Precision P365 FUSE, Norsso Barracuda EDC, Rail EDC, Reptile EDC. Then ONE box: the barrels these four take. Add the line: "FUSE Comp and XF DH3 owners run a 3.7" barrel; the barrels here are 4.3", for the standard FUSE slide." Link the barrels note.
4. **"Compensated P365 FUSE slides and their matched barrels"**: sub-grouped by barrel system, cards then ONE box per system:
   - Fdez Werx 365RS, ACCS, P365 FUSE 4.3" → box
   - Norsso Piranha C, Reptile C → box
   - Norsso Rail KP, Reptile KP → box
   - Arc Division Reactor 365F (ships with its barrel) → box
   Describe each system by what it takes ("takes its matched C-port barrel or any flush FUSE barrel").
5. **"What colors do P365 FUSE slides come in?"**: `::colors`, no baseline.
6. **"What does a finished FUSE slide build look like?"**: link the Gunforma guides "FUSE Norsso x R11" and "P365 Fuse Custom Build". Use one `::build` from "FUSE Norsso x R11". Call them Gunforma guides, never owner builds. **Leave out** the two Fdez guides ("P365 Fuse Competition", "P365 FUSE turned into a 2011 GTO") until Alex fixes their optic pairing. Re-query published `guides` at draft time in case Alex adds more.
7. **FAQ**: the 8 questions, answered positively.

**Rank cards:** `~`/`=` lines only for what differs between slides. No line every card shares. Don't use `integrated_comp`; describe ported slides by port style and matched barrel.

## B. Blocks (same PR as the note)

1. **Slide-side fit block:** `::fit slide=<a,b,...> against=frame` and `::fit slide=<a,b,...> against=barrel`.
   - `against=frame` reads `v_slide_frame_fit`: one row per grip class with the grip count and the verdict.
   - `against=barrel` reads `v_barrel_slide_fit`: the barrels that fit every listed slide (fits rows only), linked.
   - **Same-set rule:** fail the build (fixture check) and refuse on the page if the listed slides don't share one fit set.
   - Closed `<details>` by default. Link color. Tests: happy path, mismatched group fails, single slide works, unknown slug fails.
2. `::compare` slide column `port_style` (display name + geometry), like the barrel column.
3. Slide rank cards: a null `weight_oz` renders "—" or drops the row, never blank.

## C. Rules for every field note (repo-wide)

1. **Fit-box placement:** a fit box goes after the last product card of its group, never directly after each card. Add a check to `check-field-notes.mjs` that **fails** when a `::fit` block is followed by a `::rank` in the same H2 section. Add the rule to CLAUDE.md.
2. **List only what fits:** no "doesn't fit", "not compatible", "won't fit", "will not work" or "refuses" lists or sentences; the Armory warns builders about bad pairs. Describe parts by what they take, and phrase FAQ answers positively. Add a voice-lint **warning** for those phrases in field-note prose, and add the rule to `field-notes/VOICE.md`.
3. **Fix the live FUSE barrels note** (`best-p365-fuse-threaded-barrels`) to pass both rules. Rewrite its "doesn't fit" sentences (the 5 slides that refuse threaded barrels, "Norsso states neither fits a SIG factory slide", and the FAQ answers that open with "No") to say what fits. Keep every fact and count. Add a changelog line: "2026-11-25: fit sections now list what fits." This note is published, so it needs its own small PR, separate from the F1 draft PR.

## D. Then
Write the Step 5 draft as `field-notes/best-p365-fuse-slides.md` (draft: true, author "Alex Gamboa"), plus the Step 6 True/False sheet (only facts not stored in the catalog). Run `check-all.sh`, open the PR with preview screenshots of the frame-fit box, one compensated group with its box, and the decision table at 1440px and 390px. Don't merge.
