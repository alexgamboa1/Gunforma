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
  },
};
