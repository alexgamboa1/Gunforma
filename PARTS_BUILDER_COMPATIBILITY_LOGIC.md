# P365 Parts Builder — Compatibility Logic

## Overview

The parts builder lets users assemble a custom P365 build by selecting parts in any order. Each selection dynamically filters what's available in other categories. Compatibility is enforced through a combination of data-driven whitelists and code-level logic using flags already stored in the database.

## Part Categories

The build consists of these part categories:

- **Slide**
- **Barrel**
- **Compensator**
- **Frame**
- **Magwell**
- **Trigger**
- **Sight/Optic**
- **Light**
- **Small Parts** (mag release, basepad, slide release, safety selector, takedown lever, slide plate)

Users can select parts in any order. When a part is selected, compatible options in other categories are filtered in real time. The user is never locked into a fixed sequence.

---

## Rule 1: Barrel must match the slide's barrel_length_in

The most fundamental constraint. Every slide has a `barrel_length_in` in `slide_specs`. Only barrels with a matching `barrel_length_in` in `barrel_specs` are shown.

```sql
SELECT b.*
FROM products p
JOIN barrel_specs b ON b.product_id = p.id
WHERE b.barrel_length_in = :selected_slide_barrel_length_in
```

Current barrel lengths in the database: `3.1`, `3.7`, `4.3`

---

## Rule 2: Barrel whitelist (barrel_slide_requirements)

Some barrels only fit specific slides. The `barrel_slide_requirements` table is a **whitelist**. The logic is:

- If a barrel has **zero rows** in `barrel_slide_requirements` → it fits **any** slide with a matching `barrel_length_in` (universal fit).
- If a barrel has **one or more rows** → it **only** fits the slides listed in those rows.

```sql
SELECT p.*, bs.*
FROM products p
JOIN barrel_specs bs ON bs.product_id = p.id
WHERE bs.barrel_length_in = :selected_slide_barrel_length_in
  AND (
    -- Universal barrels (no whitelist = fits all matching slides)
    NOT EXISTS (
      SELECT 1 FROM barrel_slide_requirements bsr
      WHERE bsr.barrel_product_id = p.id
    )
    -- OR this specific slide is in the barrel's whitelist
    OR EXISTS (
      SELECT 1 FROM barrel_slide_requirements bsr
      WHERE bsr.barrel_product_id = p.id
        AND bsr.slide_product_id = :selected_slide_product_id
    )
  )
```

### Which barrels use the whitelist and why

**Ported barrels (Norsso C-Port, E-Port, Zaffiri Ported):**
Barrel ports must physically align with matching cuts in the slide. Only specific slide models have the correct port windows machined in. If the ports don't align, gas vents into the slide or gets blocked entirely. These barrels are whitelisted to their matched ported slides only.

Note: Ported slides CAN also accept standard (non-ported, non-threaded) barrels. A ported slide with a standard barrel simply means the slide's port windows are uncovered — cosmetically visible but functionally harmless. The ports only matter when a ported barrel is installed.

**Radian Ramjet barrels (threaded-and-ported, INTRA-LOK):**
The Ramjet barrel uses a proprietary INTRA-LOK mounting system with an Afterburner compensator that clamps onto the barrel muzzle. This comp physically extends beyond the slide. It is NOT compatible with:
- Slides with `integrated_comp = true` (stacking two comps)
- Slides with `internally_ported = true` (port-alignment conflict + the Afterburner extends past where ports would vent)

The Ramjet barrels are whitelisted to all standard (non-comp, non-ported) slides at their barrel length.

**All other barrels (standard, threaded):**
Zero rows in `barrel_slide_requirements`. They fit any slide with matching barrel_length_in. Universal fit.

### Displaying compatibility notes

When a barrel IS in the whitelist for the selected slide, the `compatibility_note` column on the `barrel_slide_requirements` row contains user-facing text that can be displayed as an info banner. Example: "Afterburner comp mounts to barrel via INTRA-LOK — not compatible with compensated or ported slides."

Additionally, `barrel_specs.requires_slide_text` contains a general compatibility warning for the barrel that can be shown regardless of which slide is selected.

---

## Rule 3: Compensator requires a threaded barrel (unless it comes with one)

The `compensator_specs` table has two key fields:

- `requires_threaded_barrel` (boolean) — if true, the user must have selected a barrel with `barrel_type = 'threaded'` or `barrel_type = 'threaded-and-ported'`
- `thread_pitch` (text) — must match the barrel's `thread_pitch` (typically `1/2x28` for P365)
- `comes_with_barrel` (boolean) — if true, the comp includes its own barrel (e.g., PMM, MCARBO bundles, Radian Ramjet). The barrel step may pre-select or bundle with this comp.

```
IF selected_barrel.barrel_type NOT IN ('threaded', 'threaded-and-ported')
  AND selected_barrel.thread_pitch IS NULL:
    → Only show comps where requires_threaded_barrel = false
    → Or show comps where comes_with_barrel = true (they bring their own)

IF selected_barrel.thread_pitch IS NOT NULL:
    → Show comps where thread_pitch matches the barrel's thread_pitch
    → Also show comps where comes_with_barrel = true
```

### Special case: Radian Ramjet comps

The Radian compensators use `mounting_type = 'intra-lok'` and `thread_pitch = 'ramjet'`. These ONLY work with Radian Ramjet barrels (`thread_pitch = 'INTRA-LOK'`). They will naturally filter out via thread_pitch mismatch with any other barrel.

---

## Rule 4: No compensator on integrated-comp slides (CODE LOGIC)

If the selected slide has `integrated_comp = true` in `slide_specs`, **hide the entire compensator category**. The slide already has a built-in compensator. Stacking a second comp is physically impossible or unsafe.

```
IF selected_slide.integrated_comp = true:
    → Skip the compensator step entirely
    → Display message: "Your slide has a built-in compensator"
```

This applies to:
- All Norsso N365DG slides (6 models)
- Factory guns with integrated comps: P365 AXG Legion, P365 XMacro Comp, P365 FUSE Comp

---

## Rule 5: No compensator on ported barrels (CODE LOGIC)

If the selected barrel has `barrel_type = 'ported'`, **hide standalone compensators**. A ported barrel already vents gas through its ports for recoil reduction — adding a muzzle comp on top would either be physically impossible (no threads) or counterproductive.

```
IF selected_barrel.barrel_type = 'ported':
    → Skip the compensator step
    → Display message: "Ported barrels already reduce muzzle flip"
```

Exception: `barrel_type = 'threaded-and-ported'` (Radian Ramjet) — these DO pair with their own comp via INTRA-LOK. The Ramjet comp will show because `thread_pitch` matches.

---

## Rule 6: Frame must match the gun/housing class

Frames are filtered by `housing_class`. The `frame_specs` table has a `housing_class` field that must match the build's target housing. Housing class is determined by which gun model the user is building for, stored in the `guns` table.

Housing classes in the database:
- `p365` — P365 base model
- `p365xl` — P365 X and XL (same grip)
- `xmacro` — P365 XMacro, XMacro Comp, AXG Legion
- `fuse` — P365 FUSE, FUSE Comp

---

## Rule 7: Trigger, sight, light, small parts — universal within platform

Triggers, optics, and lights are **platform-universal** within P365. If the product is assigned to the P365 platform via `product_platforms`, it fits any P365 build regardless of slide, barrel, or frame selection. No additional filtering needed beyond platform.

Small parts (mag release, basepad, slide release, safety selector, takedown lever, slide plate) are also platform-universal.

**Magwells are NOT platform-universal.** They are frame-specific — see Rule 8.

---

## Rule 8: Magwell whitelist (magwell_frame_requirements)

Magwells are frame-specific. Most aftermarket magwells are designed for OEM SIG grip modules and will NOT fit aftermarket metal or polymer frames (Icarus, Wilson Combat, Mischief Machine, etc.). The `magwell_frame_requirements` table is a **whitelist** — same pattern as `barrel_slide_requirements`.

- If a magwell has **rows** in `magwell_frame_requirements` → it **only** fits the frames listed.
- If a magwell has **zero rows** → it fits **any** frame on the P365 platform (universal). Currently no magwells use this — all are whitelisted.

```sql
-- User picked a frame, show compatible magwells
SELECT p.*, ms.*
FROM products p
JOIN magwell_specs ms ON ms.product_id = p.id
WHERE EXISTS (
  SELECT 1 FROM magwell_frame_requirements mfr
  WHERE mfr.magwell_product_id = p.id
    AND mfr.frame_product_id = :selected_frame_product_id
)
```

### Current magwell-frame mappings

**OEM-only magwells (5 products):**
Herrington Arms, Radian Backstrap+Magwell, SIG Magazine Funnel, True Precision, and Tyrant CNC magwells are all whitelisted to OEM SIG XMacro and OEM Fuse/XMacro frames only. If a user picks any aftermarket frame (Icarus, Wilson Combat, ECM, Mischief Machine, Sharps Bros, etc.), none of these magwells will appear.

**Proprietary magwells (1 product):**
The ShaloTek FLEX Magwell only fits ShaloTek FLEX frames with 17-round capacity (XLR-17, XR-17, XXLR-17). It does NOT fit the 10-round XR-10 or 12-round XLR-12 FLEX frames.

### Displaying compatibility notes

The `compatibility_note` column on `magwell_frame_requirements` contains user-facing text for each pairing. Display this as an info banner when showing the magwell. Examples:
- "Designed for OEM SIG P365 XMacro grip module."
- "ShaloTek FLEX proprietary magwell — only fits FLEX frames."

### When no magwells are available

If the user picks a frame that no magwell whitelists (e.g., an Icarus ACE, Wilson Combat WCP365, or any aftermarket frame), the magwell step should show an empty state: "No compatible magwells found for this frame." This is accurate — do not fall back to showing all magwells.

---

## Summary: Selection flow with filtering

Parts can be selected in any order. Each selection triggers filtering on related categories:

```
WHEN A SLIDE IS SELECTED:
  → Filter barrels: barrel_length_in must match slide (Rule 1)
  → Filter barrels: barrel_slide_requirements whitelist (Rule 2)
  → IF slide.integrated_comp = true → hide compensator category entirely (Rule 4)
  → Display: "Your slide has a built-in compensator" when comp is hidden

WHEN A BARREL IS SELECTED:
  → Filter slides: barrel_length_in must match barrel (Rule 1)
  → Filter slides: barrel_slide_requirements whitelist (Rule 2)
  → IF barrel.barrel_type = 'ported' → hide compensator category entirely (Rule 5)
  → IF barrel.thread_pitch is set → filter comps by matching thread_pitch (Rule 3)
  → IF barrel has no thread_pitch → only show comps where requires_threaded_barrel = false (Rule 3)
  → Display: requires_slide_text as warning banner if present on barrel_specs
  → Display: "Ported barrels already reduce muzzle flip" when comp is hidden

WHEN A COMPENSATOR IS SELECTED:
  → Filter barrels: must have barrel_type = 'threaded' or 'threaded-and-ported' (Rule 3)
  → Filter barrels: thread_pitch must match comp's thread_pitch (Rule 3)
  → IF comp.comes_with_barrel = true → barrel may be pre-selected or bundled

WHEN A FRAME IS SELECTED:
  → Filter magwells: magwell_frame_requirements whitelist (Rule 8)
  → If no magwells match the frame → show empty state: "No compatible magwells found for this frame"
  → Display: compatibility_note from magwell_frame_requirements as info banner

WHEN A MAGWELL IS SELECTED:
  → Filter frames: magwell_frame_requirements whitelist (Rule 8)

FRAME CATEGORY ITSELF:
  → Always filtered by housing_class matching the target gun model (Rule 6)

TRIGGERS, SIGHTS, LIGHTS:
  → Always available — no dependency on other selections
  → Filter by product_platforms = P365 only (Rule 7)

SMALL PARTS (mag release, basepad, slide release, safety selector, takedown lever, slide plate):
  → Always available — no dependency on other selections
  → Filter by product_platforms = P365 only (Rule 7)
  → Can be selected at any point in the build

BIDIRECTIONAL FILTERING:
  → When a user deselects or changes a part, re-run all filters
  → Example: user picks a barrel, then changes the slide — barrel compatibility
    must be rechecked against the new slide
  → Filters always reflect the CURRENT state of all selected parts
```

---

## Key database tables for compatibility

| Table | Purpose |
|---|---|
| `slide_specs` | `barrel_length_in`, `integrated_comp`, `internally_ported`, `port_style` |
| `barrel_specs` | `barrel_length_in`, `barrel_type`, `thread_pitch`, `port_style`, `requires_slide_text` |
| `barrel_slide_requirements` | Whitelist: which slides a barrel fits. Columns: `barrel_product_id`, `slide_product_id`, `source`, `compatibility_note` |
| `compensator_specs` | `mounting_type`, `requires_threaded_barrel`, `thread_pitch`, `comes_with_barrel`, `barrel_length_in` |
| `frame_specs` | `housing_class` |
| `magwell_frame_requirements` | Whitelist: which frames a magwell fits. Columns: `magwell_product_id`, `frame_product_id`, `source`, `compatibility_note` |
| `product_platforms` | Links products to platforms (P365, P320) |
| `guns` | `housing_class`, `integrated_comp`, `barrel_length_in`, `slide_length_in` |
| `products` | `slug`, `name`, `category`, `url`, `description` |
| `product_variants` | `slug`, `color`, `finish`, `msrp`, `is_default` — use `WHERE is_default = true` for display price |
| `affiliate_links` | `street_price`, `url`, `affiliate_url` — the "better deal" price with buy link |

---

## Pricing display logic

- **MSRP (manufacturer price):** `product_variants.msrp` from the `is_default = true` variant. This is the authoritative display price on product cards, build totals, and comparisons. When the user selects a specific color/finish, show that variant's `msrp` instead of the default's.
- There is no `base_price` column — it was removed. Always pull pricing from variants.

### Affiliate link display

Affiliate links are purchase buttons that drive users to retail partners. The `street_price` is an estimate — not a live-checked value. Display logic depends on how `street_price` compares to `msrp`:

```
IF affiliate_link exists AND street_price < msrp:
  → Show: "Est. from $[street_price] at [partner_name]" with affiliate_url
  → This suggests potential savings but is not a guaranteed price

IF affiliate_link exists AND street_price >= msrp:
  → Show: "Available at [partner_name]" with affiliate_url, NO price shown
  → Still a buy button, but don't display a price that isn't a deal

IF no affiliate_link exists:
  → Show msrp only
  → Link to the manufacturer URL from products.url
```

### Key tables for pricing

| Table | Field | Purpose |
|---|---|---|
| `product_variants` | `msrp` | Authoritative price per SKU |
| `product_variants` | `is_default` | Which variant's msrp to show before user picks a color |
| `affiliate_links` | `street_price` | Estimated retail price (not live-checked) |
| `affiliate_links` | `affiliate_url` | The purchase link (earns affiliate revenue) |
| `affiliate_links` | `url` | Direct product page URL at the retailer |
| `products` | `url` | Manufacturer product page (fallback when no affiliate link) |
| `partners` | `name` | Retailer display name (e.g., "Optics Planet") |

### Build summary pricing

When the build is complete:
- Total build cost = sum of all selected variant msrps
- Show affiliate links per part where available using the display logic above
- Do NOT sum street_prices into the total — msrp is the consistent baseline

---

## Build post display

When the build is complete, the build post should show:
- Each selected part with its name, selected variant (color/finish), and msrp
- Total build cost (sum of all selected variant msrps)
- Affiliate links per part using the display logic above (est. savings or "Available at" buy button)
- Any compatibility notes from barrel_slide_requirements or magwell_frame_requirements
- The target gun model from the guns table
