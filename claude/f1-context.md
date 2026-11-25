# F1 context for Claude Code: Best P365 FUSE Slides

Put this file in the repo as `claude/f1-context.md`. It condenses the project docs Claude Code can't reach: the status overrides (2026-11-25), the F1 spec card, the SEO findings, the article template, voice rules and the pre-publish checklist. **Where an older doc disagrees, this file wins.**

---

## 1. Overrides (Alex's rulings, newest first)
- **Every photo URL Alex entered is correct** (11-24). Never touch, rate or swap product photos.
- **"Gunforma" takes a capital G** in all visible text (11-23). Lowercase only in URLs, emails, slugs and file names.
- **The Supabase catalog is the source of truth** (11-22), project `lagjjcpclvzrjlrswojt`. **No maker-page checks.** Don't re-ask Alex facts already stored. Ask True/False ONLY for values that are null, contradictory, or missing from the catalog.
- **Prompts for Claude Code are files**, never pasted text.
- **No head-to-head section** unless two products differ in enough ways to fill one.
- **Fit lists are collapsed and grouped:** one `<details>` box per group of parts sharing the same fit set, never one per part. Don't type fit lists by hand; if a block doesn't exist, spec it.
- **No typed prices or colors.** Use `::price` and `::colors` (baseline optional).
- **Builder voice:** explain why the buyer cares and what each choice decides, with interest and authority. Still no feel, performance or testing claims, and no verdicts.
- Author: **"Alex Gamboa"**. Frontmatter key `author_credential` (omit if none).

## 2. F1 card (corrected)
- **Title:** Best P365 FUSE Slides (2026): Every Aftermarket Option, Fit-Checked (≤60 visible chars; trim the tail if needed)
- **Slug:** `best-p365-fuse-slides` (no year)
- **Locked keywords (Step 1, 11-25):** primary **p365 fuse slide** 880/28. Same intent: sig p365 fuse slide 260/25, sig sauer p365 fuse slide 210/23. H2s: slide and barrel 140/25, ported/comp slide and barrel, **frame fit**. FAQ: slide length 50/24, slide assembly 30/14, slide on xl frame 30/12, on xmacro frame, on p365 frame, p365 xl slide vs fuse slide, fuse slide threaded barrel, slide compatibility. `::price` covers "for sale" 110/22.
- **Centerpiece H2 (Alex, 11-25):** "Will a P365 FUSE slide fit a P365, XL or XMacro frame?" with the fit table from `v_slide_frame_fit`. Page one doesn't answer this, and Gunforma's data does.
- **GEO fact only Gunforma has:** per slide, the barrel it takes (`v_barrel_slide_fit`, including which slides refuse threaded barrels), the recoil spring (`required_spring_weight`), the optic cut, and comp/port style.
- **Parts:** the 12 FUSE-class slides in the catalog (Arc Division Reactor 365F; Fdez Werx 365RS, ACCS, P365 FUSE slide; Norsso Barracuda EDC, Piranha C-Port, Rail EDC, Rail KP, Reptile C-Port, Reptile EDC, Reptile KP; True Precision P365 FUSE).
- **Missing from the catalog (Step 2 list):** Mischief Machine VORN 4.3" (its YouTube video ranks #8 for the primary), Raider, Icarus Precision (search demand, no FUSE slide row).
- **Gates:** (1) confirm the 10-21 fix where FUSE owners saw XMacro-size grips as "May not fit" shipped; (2) there's no SIG factory FUSE slide row, so no baseline; (3) 7 of 12 slides are Norsso, so say plainly whether it reads as a real "best" page or a Norsso catalog; (4) don't target `p365 slide` (3,600/14). That's the future P365 slides hub, which does NOT exist yet.
- **Don't take:** comp queries (F4 FUSE compensators), `p365 fuse barrel` / threaded barrel (F3, live at `/field-notes/best-p365-fuse-threaded-barrels`), grip modules (F2).

## 3. SERP for "p365 fuse slide" (11-16)
SIG parts category (DA 63) · Norsso FUSE category (DA 19) · Fdez FUSE slide (**DA 11 at #3**) · Reddit "Fuse slide compatibility" · Facebook group posts asking "has anyone installed a fuse slide on a P365?" · SIG FUSE Comp page · YouTube Mischief Machine VORN 4.3" · eBay. No multi-brand comparison, no fit or barrel/spring data. Gunforma is DA 13, so this is winnable.

## 4. Template (roundup)
1. **Answer block**, no heading, 40–60 words: names the slides and the one rule the buyer must know (4.3" slide, which barrel, threaded-barrel refusals). It's the AI-extractable answer.
2. `::picks`: 3–7 lines `<slug> | <measurable label>`. Never "best overall". The affiliate disclosure renders right after it automatically.
3. 6–10 H2s, **written as buyer questions**. Model name in at least three. H3s only inside `::rank`.
4. Ranked section: one sentence on the order (most-built, then tracked retailer today), `::compare`, then per slide `::rank <slug> best="<label>" rank=<n>` with `~` (changes from factory) and `=` (stays the same) lines, `::price`, and 2–3 sentences, each traceable to a row.
5. Fit sections from blocks, grouped and collapsed (see section 1).
6. `::colors` where finishes differ.
7. `## FAQ` → `::faq`, 5–8 literal search questions, 1–2 sentence answers naming product and model.
8. No "Overview/Introduction/Conclusion" H2s. The renderer adds the byline, method line, TOC, disclosure, schema, Latest updates, Related notes and Keep going. Don't write those.
- Length: roundup 1,800–3,000 words.
- End the draft with a fenced `registry-row` block: slug, draft: true, dates, tags (reuse `p365`, `p365-fuse`; add `slides`).

## 5. Voice
USE: fits / does not fit / needs a plate / needs an adapter · per the maker · measurements with units · lightest / heaviest / the only one with / lowest-priced today + "in the Gunforma catalog" · appears in N Gunforma builds.
NEVER: feel words (crisp, smooth, comfortable, solid, premium) · performance (reliable, accurate, reduces recoil, durable) · verdicts (best overall, top pick, worth it, we recommend) · implied testing (we tested, at the range) · vague counts (many, most, several) · pros/cons headings · "it/this one" for products.
Name each product in full (brand + product + model) at first mention in every section. One claim per sentence. Answer first.

## 6. Pre-publish checklist
1. Title ≤60 visible chars, head term first; description ≤155 promises the table.
2. Answer block stands alone when quoted.
3. Every sentence traces to a catalog row or an Alex ruling.
4. Prices are live blocks; every `::picks` slug has a `::rank`.
5. Links out: P365 FUSE hub, the F3 barrels note, product pages (via cards). Links in: hub map + "Featured in Field Notes" (automatic).
6. llms.txt line. Sitemap lastmod.
7. Reddit/SIGTalk post (lead with the frame-fit table, link at the end); a note to each featured maker asking for a link AND permission to use their product photos.
8. Request indexing; log the date. Day 14 / 30 checks. Ubersuggest project "Gunforma" already tracks these keywords and AI prompts.

## 7. Steps (stop at each)
Step 2 parts checklist (empty fields + missing slides) → Step 3 data check (null/contradictory only, no maker pages) → Step 4 outline → Step 5 draft → Step 6 True/False sheet (unstored facts only) → Step 7 ship pack (as files).
