// _guide-content — the EDITORIAL half of every guide page: title, meta
// description, intro prose, static takeaways, top picks, FAQ.
// ─────────────────────────────────────────────────────────────────────────
// The other half — products, footprints, prices, fit — is queried live by
// guide-page.mjs at request time and is never written here. The split is
// the brief's ground rule: every product name, price and fitment claim
// comes from the database; prose carries only what a human reviewed.
// Consequences:
//   - NO dollar figures in this file, ever. Prices render live or not at
//     all. scripts/check-guide-content.mjs fails the build on a "$" here.
//   - No product counts in prose ("all 15") — counts are computed at
//     request time, so retiring a product can't make a sentence false.
//   - Fitment claims in FAQ answers state their basis; anything not in the
//     database says "not in our data" rather than guessing.
//
// `credential` renders in the author block when non-empty. It is empty
// until Alex supplies the line — an invented credential on a page P365
// owners will fact-check is worse than none.

export const GUIDE_CONTENT = {
  'red-dots': {
    'p365-xl': {
      // <60 chars; the year signals freshness, the promise is the list.
      title: 'Red Dots That Fit the Sig P365 XL (2026): Verified List',
      // Contains the literal question, per the brief.
      metaDescription:
        'What red dots fit the Sig P365 XL? Every optic verified against ' +
        "the XL's factory RMSc-pattern cut, with live prices and " +
        'direct-mount fitment.',
      // The FIRST sentence of the page is computed live (count + cut) by
      // guide-page.mjs; this follows it in the same opening paragraph.
      introAfter:
        'Every optic in the table mounts directly to the factory slide — ' +
        'no adapter plate, no milling. Prices are checked against retailer ' +
        'feeds daily; anything we could not verify this week says ' +
        '"Check price" instead of a number.',
      // Static takeaways (verified facts with a source); guide-page.mjs
      // appends the computed ones (counts, cheapest fresh price).
      staticTakeaways: [
        'All six current factory P365 XL SKUs ship optic-ready with the ' +
        'RMSc-pattern direct cut — no adapter plate needed (Sig Sauer spec ' +
        'sheets, verified September 2026).',
      ],
      // Top picks: slugs resolved against the live fit set at render time —
      // a pick that stops fitting or is retired silently drops off rather
      // than rendering stale. The blurb is editorial; the specs and price
      // on the card are live.
      picks: [
        { slug: 'holosun-507k-x2',
          why: 'The default pick: the K-series footprint standard-bearer, huge aftermarket support, and multi-reticle.' },
        { slug: 'holosun-eps-carry',
          why: 'The enclosed-emitter pick — the emitter is sealed against lint and rain, which matters on a carry gun.' },
        { slug: 'sig-sauer-romeo-x-compact',
          why: "Sig's own optic for this pistol, and the one the factory ships on Romeo-X XL configurations." },
      ],
      // H3s phrased as literal search queries, each answered in one
      // self-contained paragraph that makes sense quoted alone.
      faq: [
        { q: 'Does the Holosun 507K fit the Sig P365 XL?',
          a: 'Yes. Every current factory P365 XL slide is optic-ready with an ' +
             'RMSc-pattern cut, and the Holosun 507K X2 uses the Holosun ' +
             'K-series footprint (a modified RMSc), which mounts directly on ' +
             'that cut with no adapter plate.' },
        { q: 'Is the P365 XL optic-ready from the factory?',
          a: 'Yes. All six P365 XL SKUs Sig currently lists ship optic-ready ' +
             'with an RMSc-pattern direct cut under a removable cover plate ' +
             '(source: Sig Sauer P365 XL spec sheets, verified September 2026).' },
        { q: 'Does the Trijicon RMR fit the P365 XL?',
          a: 'Not directly. The full-size RMR uses a larger footprint than the ' +
             "XL's RMSc-pattern cut, and nothing in our fit data mounts an " +
             'RMR-footprint optic on the factory XL slide. The smaller RMRcc ' +
             'is a different footprint again, and it is not in our fit data ' +
             'for the factory slide either.' },
        { q: 'Do P365 XL slides use the SIG-LOC cut?',
          a: 'The XL pistol SKUs Sig currently lists all carry the classic ' +
             'RMSc-pattern cut. Sig’s newer SIG-LOC Compact cut appears on ' +
             'other P365 models (the FUSE defaults to it) and on standalone ' +
             'XL slide assemblies sold as upgrade parts — and per Sig, ' +
             'SIG-LOC slides still accept traditional RMSc-pattern optics, so ' +
             'the optics in the table mount either way.' },
        { q: 'What footprint is the Holosun EPS Carry?',
          a: 'The Holosun K-series footprint, a modified RMSc pattern. It ' +
             'mounts directly on the P365 XL’s factory cut, no plate needed.' },
        { q: 'Do I need an adapter plate to mount a red dot on the P365 XL?',
          a: 'Not for anything on this page: every optic listed is a direct ' +
             'mount on the factory RMSc-pattern cut. If an optic needs a ' +
             'plate, it is not in this list.' },
      ],
      author: { name: 'Alex Gamboa', credential: '' },
    },

    // ── P365 (base) ───────────────────────────────────────────────────────
    // The only model in the family whose answer starts with "does your gun
    // have a cut at all" — gun_optic_cuts carries a `none` row for the
    // legacy non-optic-ready SKUs, which no other P365 has.
    'p365': {
      title: 'Red Dots That Fit the Sig P365 (2026): Verified List',
      metaDescription:
        'What red dots fit the Sig P365? Every optic verified against the ' +
        "P365's factory cut — and how to tell whether your P365 has one, " +
        'since the early non-optic-ready slides do not.',
      introAfter:
        'The P365 is the one model in the family where the first question is ' +
        'whether your slide is cut at all: the early non-optic-ready SKUs have ' +
        'no pocket and need milling or a replacement slide, and nothing on this ' +
        'page mounts to them. Current guns are cut, and the SKUs ending in -SL ' +
        'carry Sig’s newer SIG-LOC Compact cut instead of the classic RMSc ' +
        'pattern. Check your slide before you buy an optic.',
      staticTakeaways: [
        'The P365 shipped for years without an optic cut. Those slides are not ' +
        'optic-ready and cannot take any of these optics directly — they need ' +
        'milling or a replacement slide (Sig Sauer P365 spec sheets, verified ' +
        'September 2026).',
        'Current P365 SKUs are cut; the ones ending in -SL (for example ' +
        '365-9-BXR3P-MS-SL-CA) use the SIG-LOC Compact cut rather than the ' +
        'RMSc pattern.',
      ],
      picks: [
        { slug: 'holosun-507k-x2',
          why: 'The default for a cut P365: K-series footprint, the largest aftermarket of anything here, and multi-reticle.' },
        { slug: 'holosun-eps-carry',
          why: 'The enclosed-emitter choice for a pocket-carried gun — the P365 is the one most likely to live in a pocket, and lint is what kills open emitters.' },
        { slug: 'sig-sauer-romeo-x-sigloc-compact',
          why: 'The pick if your slide is an -SL SKU: it is built for the SIG-LOC Compact cut those guns carry, where RMSc-pattern optics are not the native fit.' },
      ],
      faq: [
        { q: 'Does my Sig P365 have an optic cut?',
          a: 'Not necessarily. The P365 launched without one, and those slides have ' +
             'a solid top with no optic pocket. Look for a removable cover plate ' +
             'behind the ejection port — if the top of your slide is solid, it is a ' +
             'non-optic-ready SKU and needs milling or a replacement slide before ' +
             'any optic on this page will mount.' },
        { q: 'Does the Holosun 507K fit the Sig P365?',
          a: 'Yes, on an optic-ready P365 with the standard RMSc-pattern cut. The ' +
             '507K X2 uses the Holosun K-series footprint, a modified RMSc, which ' +
             'mounts directly on that cut with no adapter plate. It will not mount ' +
             'on a non-optic-ready slide.' },
        { q: 'What is the difference between the P365 RMSc and SIG-LOC cuts?',
          a: 'They are two different pockets. Most current P365 SKUs carry the ' +
             'classic RMSc pattern; the SKUs ending in -SL carry Sig’s SIG-LOC ' +
             'Compact cut. Per Sig, SIG-LOC slides still accept traditional ' +
             'RMSc-pattern optics, so the table covers both — but the optic ' +
             'designed for your cut is the cleaner mount.' },
        { q: 'Can a non-optic-ready P365 slide be milled for a red dot?',
          a: 'Yes, milling is the usual route, and a factory optic-ready slide ' +
             'assembly is the other. Which pattern you end up with depends on the ' +
             'shop or the slide you buy, so decide on the optic first — our fit ' +
             'data covers factory cuts, not custom milling jobs.' },
        { q: 'Is the P365 the same optic cut as the P365 XL?',
          a: 'On current optic-ready SKUs, yes — both use the RMSc pattern, so the ' +
             'same optics mount. The difference is that the P365 also has ' +
             'non-optic-ready SKUs in circulation and the XL does not, and the ' +
             'P365 has -SL SKUs on the SIG-LOC cut.' },
      ],
      author: { name: 'Alex Gamboa', credential: '' },
    },

    // ── P365 X ────────────────────────────────────────────────────────────
    // Per-SKU split, with the -RXSL SKUs named on the gun_optic_cuts row.
    'p365-x': {
      title: 'Red Dots That Fit the Sig P365 X (2026): Verified List',
      metaDescription:
        'What red dots fit the Sig P365 X? Every optic verified against the ' +
        'X’s factory RMSc-pattern cut, plus which SKUs ship on the SIG-LOC ' +
        'Compact cut instead.',
      introAfter:
        'The P365 X carries the standard RMSc-pattern cut on its ordinary SKUs, ' +
        'with two exceptions: 365X-9-BXR3-RXSL and -RXSL-10 ship on Sig’s ' +
        'SIG-LOC Compact cut. The X runs the same short slide as the base P365 ' +
        'with the X-series grip module beneath it, so the optic that suits it is ' +
        'usually the one that clears a compact slide without overhanging the ' +
        'ejection port.',
      staticTakeaways: [
        'Standard P365 X SKUs use the RMSc-pattern cut; the two -RXSL SKUs ' +
        '(365X-9-BXR3-RXSL and -RXSL-10) use SIG-LOC Compact instead (Sig Sauer ' +
        'per-SKU spec sheets, verified September 2026).',
        'The X shares the base P365 slide length, so an optic sized for a larger ' +
        'slide will look and sit long on it even when the footprint matches.',
      ],
      picks: [
        { slug: 'holosun-507k-x2',
          why: 'The safe default on the RMSc-pattern X: K-series footprint, multi-reticle, and sized for a short slide.' },
        { slug: 'holosun-eps-core',
          why: 'An enclosed emitter on the native RMSc footprint, so there is no adapter and no overhang on the X’s short slide.' },
        { slug: 'sig-sauer-romeo-x-sigloc-compact',
          why: 'The match for the two -RXSL SKUs, which leave the factory on the SIG-LOC Compact cut rather than RMSc.' },
      ],
      faq: [
        { q: 'Is the Sig P365 X optic-ready from the factory?',
          a: 'Yes. Every current P365 X SKU ships cut for an optic under a removable ' +
             'cover plate. Which pattern depends on the SKU: the ordinary ones are ' +
             'RMSc, and the two -RXSL SKUs are SIG-LOC Compact.' },
        { q: 'Does the Holosun 507K fit the Sig P365 X?',
          a: 'Yes on the RMSc-pattern SKUs, which is most of them. The 507K X2 uses ' +
             'the Holosun K-series footprint, a modified RMSc, and mounts directly ' +
             'with no adapter plate.' },
        { q: 'Which P365 X SKUs have the SIG-LOC cut?',
          a: '365X-9-BXR3-RXSL and 365X-9-BXR3-RXSL-10, per Sig’s own per-SKU spec ' +
             'sheets as read in September 2026. Everything else in the current X ' +
             'line is the RMSc pattern.' },
        { q: 'Do the P365 X and P365 XL take the same red dots?',
          a: 'Largely yes — both are RMSc-pattern on their standard SKUs, so the ' +
             'footprints match. The X has SIG-LOC -RXSL SKUs where the XL’s current ' +
             'line does not, and the X’s shorter slide leaves less room, so a large ' +
             'window optic suits the XL better.' },
      ],
      author: { name: 'Alex Gamboa', credential: '' },
    },

    // ── P365 XMacro ───────────────────────────────────────────────────────
    // The uncertainty page: the SIG-LOC row is confidence 'likely' because
    // Sig's own spec field contradicts itself. guide-page.mjs renders a
    // "likely" note from the data; the prose explains WHY.
    'p365-xmacro': {
      title: 'Red Dots That Fit the Sig P365 XMacro (2026): Verified',
      metaDescription:
        'What red dots fit the Sig P365 XMacro? Every optic verified against ' +
        'the XMacro’s RMSc-pattern cut, and an honest note on the -RXSL SKUs ' +
        'where Sig’s own spec sheet contradicts itself.',
      introAfter:
        'Standard XMacro SKUs carry the RMSc-pattern cut and are straightforward. ' +
        'The -RXSL SKUs are the one place in this family where we will not claim ' +
        'certainty: Sig’s spec field still lists RMSc on guns that ship with a ' +
        'factory-mounted ROMEO-X SIG-LOC, and SIG-LOC optics need the SIG-LOC ' +
        'cut. We have marked that row as likely rather than verified and said so ' +
        'on the page instead of picking whichever answer sounded tidier.',
      staticTakeaways: [
        'Standard P365 XMacro SKUs use the RMSc-pattern cut, read per-SKU from ' +
        'Sig’s spec sheets in September 2026.',
        'On -RXSL SKUs our fit data is marked likely, not verified: Sig’s spec ' +
        'field shows RMSc while the gun ships with a factory ROMEO-X SIG-LOC, and ' +
        'per sigsauer.com/sig-loc a SIG-LOC optic requires the SIG-LOC cut. If ' +
        'you own one, confirm against your own slide before ordering.',
        'The XMacro uses the same magazine as the P365 FUSE, so a carry setup ' +
        'built around one feeds the other.',
      ],
      picks: [
        { slug: 'holosun-507k-x2',
          why: 'The default on a standard RMSc-pattern XMacro, and the footprint with the widest aftermarket if you later change slides.' },
        { slug: 'holosun-eps-carry',
          why: 'Enclosed emitter on the K-series footprint — the XMacro is a duty-size carry gun and a sealed emitter survives pocket lint and rain.' },
        { slug: 'sig-sauer-romeo-x-sigloc-compact',
          why: 'What a factory -RXSL XMacro already wears. If yours came with a ROMEO-X SIG-LOC fitted, this is the cut it is on.' },
      ],
      faq: [
        { q: 'Does the Holosun 507K fit the Sig P365 XMacro?',
          a: 'Yes on a standard RMSc-pattern XMacro. The 507K X2 uses the Holosun ' +
             'K-series footprint, a modified RMSc, and mounts directly with no ' +
             'adapter plate.' },
        { q: 'What optic cut does the P365 XMacro use?',
          a: 'The RMSc pattern on standard SKUs, read per-SKU from Sig’s spec sheets ' +
             'in September 2026. The -RXSL SKUs are the open question — see the ' +
             'note on this page about Sig’s conflicting spec field.' },
        { q: 'Do the -RXSL XMacro SKUs have the SIG-LOC cut?',
          a: 'Probably, and we have marked it likely rather than verified. Sig’s ' +
             'spec field lists RMSc for those SKUs, but they ship with a ' +
             'factory-mounted ROMEO-X SIG-LOC, and Sig states that SIG-LOC optics ' +
             'require the SIG-LOC cut. The two claims cannot both be right, so we ' +
             'are not asserting either one.' },
        { q: 'Do the P365 XMacro and P365 FUSE take the same red dots?',
          a: 'The footprints overlap, but the defaults are reversed: the XMacro is ' +
             'RMSc-pattern as standard while the FUSE defaults to SIG-LOC Compact ' +
             'and carries RMSc only on its -RS SKU. Read the page for the gun you ' +
             'actually own rather than assuming the family shares a cut.' },
        { q: 'Is the P365 XMacro optic-ready from the factory?',
          a: 'Yes. Every current XMacro SKU ships cut for an optic under a removable ' +
             'cover plate; the question is only which pattern, and that depends on ' +
             'the SKU.' },
      ],
      author: { name: 'Alex Gamboa', credential: '' },
    },

    // ── P365 AXG Legion ───────────────────────────────────────────────────
    'p365-axg': {
      title: 'Red Dots That Fit the Sig P365 AXG Legion (2026)',
      metaDescription:
        'What red dots fit the Sig P365 AXG Legion? Every optic verified ' +
        'against its factory RMSc-pattern cut, with live prices and ' +
        'direct-mount fitment.',
      introAfter:
        'The AXG Legion uses the RMSc-pattern cut on its standard SKUs, with ' +
        '365AXGCA-9-LEGION-RXSL on Sig’s SIG-LOC Compact cut instead. Two things ' +
        'about this gun change what an optic has to do rather than how it mounts: ' +
        'the alloy AXG grip module makes it the heaviest gun in the family, and ' +
        'the integrated compensator puts a shorter barrel under a full-length ' +
        'slide. Both flatten recoil, which means less work for the dot to return ' +
        'to the same place.',
      staticTakeaways: [
        'Standard P365 AXG Legion SKUs use the RMSc-pattern cut; ' +
        '365AXGCA-9-LEGION-RXSL uses SIG-LOC Compact (Sig Sauer spec sheets, ' +
        'verified September 2026).',
        'The AXG runs an integrated compensator, so its barrel is shorter than its ' +
        'slide — a gun built to be shot fast, where dot return matters more than ' +
        'absolute window size.',
      ],
      picks: [
        { slug: 'holosun-507k-x2',
          why: 'The default RMSc-pattern pick, and the multi-reticle option if you want a circle-dot for fast pickup on a gun built for speed.' },
        { slug: 'holosun-scs-carry-gr',
          why: 'Solar-backed with a green reticle and no battery tray to open — a sensible match for a heavy gun that gets shot a lot rather than carried occasionally.' },
        { slug: 'sig-sauer-romeo-x-enclosed-compact',
          why: 'Sig’s own enclosed optic on the native RMSc footprint, which keeps the Legion’s factory-matched look while sealing the emitter.' },
      ],
      faq: [
        { q: 'Is the Sig P365 AXG Legion optic-ready from the factory?',
          a: 'Yes. Current AXG Legion SKUs ship cut under a removable cover plate — ' +
             'the RMSc pattern on standard guns, and SIG-LOC Compact on the -RXSL ' +
             'SKU.' },
        { q: 'Does the Holosun 507K fit the Sig P365 AXG Legion?',
          a: 'Yes on the standard RMSc-pattern SKUs. The 507K X2 uses the Holosun ' +
             'K-series footprint, a modified RMSc, so it mounts directly with no ' +
             'adapter plate.' },
        { q: 'Does the AXG Legion’s compensator affect which red dot to choose?',
          a: 'Not which one fits — the footprint is set by the slide cut, not the ' +
             'comp. It does change what the optic has to cope with: a comp plus an ' +
             'alloy grip module means less muzzle rise, so the dot stays in the ' +
             'window more of the time and reticle size matters less than it does on ' +
             'a light gun.' },
        { q: 'Which P365 AXG Legion SKU has the SIG-LOC cut?',
          a: '365AXGCA-9-LEGION-RXSL, per Sig’s spec sheets as verified in September ' +
             '2026. The other current Legion SKUs are the RMSc pattern.' },
      ],
      author: { name: 'Alex Gamboa', credential: '' },
    },

    // ── P365 XF DH3 ───────────────────────────────────────────────────────
    'p365-xf-dh3': {
      title: 'Red Dots That Fit the Sig P365 XF DH3 (2026): Verified',
      metaDescription:
        'What red dots fit the Sig P365 XF DH3? Every optic verified against ' +
        'its factory RMSc-pattern cut, plus the -RXSL SKU that ships on ' +
        'SIG-LOC Compact.',
      introAfter:
        'The XF DH3 splits by SKU: 365XF-9-DH3 and -10 carry the RMSc-pattern ' +
        'cut, and 365XF-9-DH3-RXSL carries Sig’s SIG-LOC Compact cut. Both were ' +
        'read per-SKU from Sig’s spec sheets rather than inferred from the model ' +
        'name. This is the long end of the family — a full-length slide with a ' +
        'compensated barrel under it — so there is more slide to work with than ' +
        'on any of the compact models.',
      staticTakeaways: [
        '365XF-9-DH3 and 365XF-9-DH3-10 use the RMSc-pattern cut; ' +
        '365XF-9-DH3-RXSL uses SIG-LOC Compact. Both read per-SKU from Sig Sauer ' +
        'spec sheets in September 2026.',
        'The XF DH3 pairs a full-length slide with an integrated compensator, so ' +
        'the barrel is shorter than the slide and the sight radius is the longest ' +
        'available in the P365 line.',
      ],
      picks: [
        { slug: 'holosun-507k-x2',
          why: 'The default on the RMSc-pattern DH3 SKUs, and the footprint with the deepest aftermarket support.' },
        { slug: 'holosun-eps-carry',
          why: 'Enclosed emitter on the K-series footprint — worth it on a gun whose length means it is usually carried on the belt in all weather.' },
        { slug: 'sig-sauer-romeo-x-sigloc-compact',
          why: 'The cut-matched pick for 365XF-9-DH3-RXSL, which leaves the factory on SIG-LOC Compact rather than RMSc.' },
      ],
      faq: [
        { q: 'What optic cut does the Sig P365 XF DH3 use?',
          a: 'It depends on the SKU. 365XF-9-DH3 and -10 are the RMSc pattern, and ' +
             '365XF-9-DH3-RXSL is SIG-LOC Compact. Both were read from Sig’s ' +
             'per-SKU spec sheets in September 2026.' },
        { q: 'Does the Holosun 507K fit the Sig P365 XF DH3?',
          a: 'Yes on the RMSc-pattern SKUs. The 507K X2 uses the Holosun K-series ' +
             'footprint, a modified RMSc, and mounts directly with no adapter ' +
             'plate.' },
        { q: 'Is the P365 XF DH3 the same cut as the XF DH3 AXG?',
          a: 'Not quite, and this is the easy mistake. The XF DH3 splits by SKU ' +
             'between RMSc and SIG-LOC Compact, while every current XF DH3 AXG SKU ' +
             'is the RMSc pattern. If you are shopping across both, check which gun ' +
             'the listing is for.' },
        { q: 'Does the longer slide change which red dot I should pick?',
          a: 'It widens the options rather than narrowing them. The footprint is ' +
             'fixed by the cut, but a full-length slide carries a large-window optic ' +
             'without the optic overhanging the ejection port, which is the real ' +
             'constraint on the shorter P365 models.' },
      ],
      author: { name: 'Alex Gamboa', credential: '' },
    },

    // ── P365 XF DH3 AXG ───────────────────────────────────────────────────
    // Single-cut model: gun_optic_cuts has ONE row, applies_to
    // 'all-current-skus'. Same shape as the XL, and the contrast with its
    // non-AXG sibling is the point of the page.
    'p365-xf-dh3-axg': {
      title: 'Red Dots That Fit the Sig P365 XF DH3 AXG (2026)',
      metaDescription:
        'What red dots fit the Sig P365 XF DH3 AXG? Every current SKU uses one ' +
        'RMSc-pattern cut, so there is no SKU decoding to do — verified list ' +
        'with live prices.',
      introAfter:
        'This is the simple one. Both current XF DH3 AXG SKUs carry the same ' +
        'RMSc-pattern cut, so unlike most of the family there is no SKU suffix to ' +
        'decode and no SIG-LOC variant to watch for — if the optic is on this ' +
        'page, it mounts on your gun. The alloy AXG grip module and the ' +
        'integrated compensator make it the heaviest, flattest-shooting gun in ' +
        'the P365 line.',
      staticTakeaways: [
        'Both current P365 XF DH3 AXG SKUs use the RMSc-pattern cut — one cut ' +
        'across the whole model, read per-SKU from Sig Sauer spec sheets in ' +
        'September 2026.',
        'Its non-AXG sibling, the XF DH3, does split by SKU: the -RXSL version is ' +
        'SIG-LOC Compact. The two models are not interchangeable on this point.',
      ],
      picks: [
        { slug: 'holosun-507k-x2',
          why: 'The default pick, and with a single cut across the model there is no SKU caveat attached to it here.' },
        { slug: 'holosun-eps-carry',
          why: 'The enclosed-emitter option on the K-series footprint, sealed against weather on a gun heavy enough to be shot in volume.' },
        { slug: 'sig-sauer-romeo-x-enclosed-compact',
          why: 'Sig’s own enclosed optic on the native RMSc footprint — factory-matched, no plate, no adapter.' },
      ],
      faq: [
        { q: 'What optic cut does the Sig P365 XF DH3 AXG use?',
          a: 'The RMSc pattern, on both current SKUs. It is one of only two models ' +
             'in the P365 family where a single cut covers the whole line, so no ' +
             'SKU decoding is needed.' },
        { q: 'Does the Holosun 507K fit the Sig P365 XF DH3 AXG?',
          a: 'Yes. The 507K X2 uses the Holosun K-series footprint, a modified ' +
             'RMSc, which mounts directly on this model’s factory cut with no ' +
             'adapter plate.' },
        { q: 'Is the XF DH3 AXG the same optic cut as the XF DH3?',
          a: 'Only partly. Every XF DH3 AXG SKU is RMSc-pattern, while the plain XF ' +
             'DH3 is RMSc on 365XF-9-DH3 and -10 but SIG-LOC Compact on ' +
             '365XF-9-DH3-RXSL. Buying an optic for the wrong one of these two is ' +
             'the realistic mistake.' },
        { q: 'Do I need an adapter plate for the P365 XF DH3 AXG?',
          a: 'No, not for anything on this page. Every optic listed is a direct ' +
             'mount on the factory RMSc-pattern cut. If an optic needs a plate, it ' +
             'is not in this list.' },
      ],
      author: { name: 'Alex Gamboa', credential: '' },
    },

    // ── P365 FUSE ─────────────────────────────────────────────────────────
    // The inverted one: gun_optic_cuts has sig-loc-compact as DEFAULT and
    // rmsc only on sku-rs. The only model in the family that way round.
    'p365-fuse': {
      title: 'Red Dots That Fit the Sig P365 FUSE (2026): Verified',
      metaDescription:
        'What red dots fit the Sig P365 FUSE? The FUSE is the one P365 that ' +
        'defaults to the SIG-LOC Compact cut, not RMSc — here is what mounts, ' +
        'verified per SKU.',
      introAfter:
        'The FUSE is the exception in this family and the reason to read its own ' +
        'page rather than a sibling’s: it defaults to Sig’s SIG-LOC Compact cut, ' +
        'where every other P365 defaults to the RMSc pattern. The RMSc cut ' +
        'appears on one SKU only, 365XF-9-BFO-RS, the ROMEO-RS-equipped gun. The ' +
        'table below lists what mounts on either cut, so check which SKU you own ' +
        'before you choose — this is the model where guessing from the family ' +
        'name gets it wrong.',
      staticTakeaways: [
        'The P365 FUSE is the only model in the family that defaults to the ' +
        'SIG-LOC Compact cut. The BFO, CFO, -10, -MS and -RXSL SKUs are all ' +
        'SIG-LOC (live per-SKU read, September 2026).',
        'The RMSc pattern appears on one FUSE SKU: 365XF-9-BFO-RS, which ships ' +
        'with a ROMEO-RS fitted.',
        'The FUSE runs the longest barrel in the P365 line with no compensator, ' +
        'and shares its magazine with the XMacro.',
      ],
      picks: [
        { slug: 'sig-sauer-romeo-x-sigloc-compact',
          why: 'The native pick for a FUSE, because the FUSE’s default cut is SIG-LOC Compact — this is the optic built for it rather than tolerated by it.' },
        { slug: 'sig-sauer-romeo-rs-compact',
          why: 'The match for 365XF-9-BFO-RS, the one RMSc-pattern FUSE SKU — it is the optic that gun ships with from the factory.' },
        { slug: 'holosun-eps-carry',
          why: 'The enclosed-emitter alternative on the K-series footprint, for a FUSE whose slide carries the RMSc-pattern cut.' },
      ],
      faq: [
        { q: 'What optic cut does the Sig P365 FUSE use?',
          a: 'SIG-LOC Compact on almost every SKU — BFO, CFO, -10, -MS and -RXSL. ' +
             'That makes it the only P365 model that does not default to the RMSc ' +
             'pattern, which is the single most important thing to know before ' +
             'buying an optic for one.' },
        { q: 'Does the Holosun 507K fit the Sig P365 FUSE?',
          a: 'On the RMSc-pattern SKU, 365XF-9-BFO-RS, yes — the 507K X2 uses the ' +
             'Holosun K-series footprint, a modified RMSc. On the SIG-LOC SKUs the ' +
             'native fit is a SIG-LOC optic; per Sig, SIG-LOC slides still accept ' +
             'traditional RMSc-pattern optics, so check your own slide rather than ' +
             'assuming either way.' },
        { q: 'Which P365 FUSE SKU has the RMSc cut?',
          a: '365XF-9-BFO-RS, the ROMEO-RS-equipped gun, per a live per-SKU spec ' +
             'read in September 2026. Every other current FUSE SKU is SIG-LOC ' +
             'Compact.' },
        { q: 'Do the P365 FUSE and P365 XMacro take the same red dots?',
          a: 'They share a magazine, not a default cut. The XMacro is RMSc-pattern ' +
             'as standard while the FUSE defaults to SIG-LOC Compact, so an optic ' +
             'chosen for one is not automatically the native fit on the other.' },
        { q: 'Is the P365 FUSE Comp the same cut as the FUSE?',
          a: 'No, and it catches people out. The FUSE defaults to SIG-LOC Compact, ' +
             'but the FUSE Comp defaults to the RMSc pattern. Same housing class, ' +
             'opposite defaults — read the page for the exact gun you own.' },
      ],
      author: { name: 'Alex Gamboa', credential: '' },
    },

    // ── P365 FUSE Comp ────────────────────────────────────────────────────
    // Defaults to RMSc, unlike the plain FUSE it shares a housing class
    // with. That contrast is the page.
    'p365-fuse-comp': {
      title: 'Red Dots That Fit the Sig P365 FUSE Comp (2026)',
      metaDescription:
        'What red dots fit the Sig P365 FUSE Comp? It defaults to the ' +
        'RMSc-pattern cut — unlike the plain FUSE, which is SIG-LOC. Verified ' +
        'per-SKU fit list.',
      introAfter:
        'Read this page rather than the FUSE’s: despite the shared name, the ' +
        'FUSE Comp defaults to the RMSc-pattern cut while the plain FUSE defaults ' +
        'to SIG-LOC Compact. The exception here runs the other way — ' +
        '365XF-9-COMP-RXSL is the SIG-LOC SKU. The Comp also puts a shorter, ' +
        'compensated barrel under the FUSE’s long slide, so it recoils flatter ' +
        'than its barrel length suggests.',
      staticTakeaways: [
        'Standard P365 FUSE Comp SKUs use the RMSc-pattern cut; ' +
        '365XF-9-COMP-RXSL uses SIG-LOC Compact (Sig Sauer spec sheets, verified ' +
        'September 2026).',
        'This is the opposite default from the plain P365 FUSE, which is SIG-LOC ' +
        'Compact on almost every SKU. The two guns share a housing class and not ' +
        'a cut.',
        'The Comp’s integrated compensator shortens the barrel under a ' +
        'full-length slide, keeping the long sight radius while cutting muzzle ' +
        'rise.',
      ],
      picks: [
        { slug: 'holosun-507k-x2',
          why: 'The default on the RMSc-pattern Comp SKUs, and the footprint most likely to carry over if you change slides later.' },
        { slug: 'holosun-scs-carry-gr',
          why: 'Solar-backed, green reticle, no battery tray — suited to a compensated gun that gets shot in volume rather than carried occasionally.' },
        { slug: 'sig-sauer-romeo-x-sigloc-compact',
          why: 'The cut-matched choice for 365XF-9-COMP-RXSL, the one FUSE Comp SKU that ships on SIG-LOC Compact.' },
      ],
      faq: [
        { q: 'What optic cut does the Sig P365 FUSE Comp use?',
          a: 'The RMSc pattern on standard SKUs, with 365XF-9-COMP-RXSL on SIG-LOC ' +
             'Compact. Note that this is the reverse of the plain FUSE, which is ' +
             'SIG-LOC on almost every SKU.' },
        { q: 'Is the P365 FUSE Comp the same optic cut as the P365 FUSE?',
          a: 'No. The FUSE Comp defaults to the RMSc pattern and the plain FUSE ' +
             'defaults to SIG-LOC Compact. They share a housing class, which makes ' +
             'the difference easy to miss and expensive to get wrong.' },
        { q: 'Does the Holosun 507K fit the Sig P365 FUSE Comp?',
          a: 'Yes on the standard RMSc-pattern SKUs. The 507K X2 uses the Holosun ' +
             'K-series footprint, a modified RMSc, and mounts directly with no ' +
             'adapter plate.' },
        { q: 'Does the compensator change which red dot fits?',
          a: 'No. The footprint is set by the slide cut, and the comp sits at the ' +
             'muzzle. What it changes is how hard the optic has to work: less muzzle ' +
             'rise means the dot returns to the same place more consistently.' },
      ],
      author: { name: 'Alex Gamboa', credential: '' },
    },
  },
};
