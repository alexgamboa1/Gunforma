#!/usr/bin/env node
// check-price-freshness.mjs — is the catalogue actually carrying fresh prices?
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
// refresh-affiliate-prices failed on every run from 2026-09-25 to 2026-09-29 and
// nobody noticed for four days. The sync never executed — it died in a unit-test
// step over a secret belonging to a different workflow (see #89). Prices simply
// stopped moving.
//
// The workflow's own comment claimed this was covered: "if this workflow fails,
// the account owner gets an email; no separate alerting to wire up." That is a
// belief, not a measurement, and it is the same class of mistake as
// `x-nf-original-path` — an assumption about someone else's plumbing that nobody
// watched work. GitHub sends that mail ONCE per workflow and then goes quiet
// until it succeeds again, and it defaults to not mailing at all for runs you
// did not trigger — which is every `schedule` run. So runs 2, 3 and 4 were
// silent by design.
//
// THIS CHECK DOES NOT ASK THE SYNC HOW IT WENT
// Per CLAUDE.md: status codes, exit codes and log lines are claims; row counts
// are facts. This reads affiliate_links directly and asks what the catalogue
// actually carries. A sync that exits 0 having written nothing fails this check.
//
// IT TAKES NO SECRETS, DELIBERATELY
// It uses the public anon key — the same one every page uses to read this table
// — so it has no credential that can be missing, mis-scoped or hand-mistyped.
// A monitor that can fail for the same reason as the thing it monitors is not a
// monitor. This is the single most important property of this file: do not
// "improve" it by switching to the service-role key.
//
// WHY A COUNT AND NOT max(last_checked)
// max() reports on the healthiest row in the set, so it is a survivorship
// check. Measured on production on 2026-09-29, immediately after a fully
// successful run: max(last_checked) was today, and 64 of 493 live links were
// still older than 48h, the oldest dating to 2026-07-23. A max-based check
// would have reported perfect health over 13% of the catalogue carrying prices
// up to two months old — and a run that updated ten links and exited green
// would have passed it too.
//
// Env (all optional):
//   STALE_PCT_THRESHOLD  override the threshold below, e.g. "18"
//   DRILL                "true" forces a failure so the alert path can be
//                        watched end to end without waiting for a real one
// -----------------------------------------------------------------------------

const SUPABASE_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';

// How old is "stale" for this check. Deliberately 48h and not the 7 days of the
// site's own stale-price rule: those are different questions. Seven days is when
// we stop STATING a price to a reader. Forty-eight hours is when a DAILY sync
// has demonstrably missed at least one run — which is what we want to hear about,
// while there is still time to fix it before readers see "Check price".
const STALE_DAYS = 2;

// ── the threshold ──────────────────────────────────────────────────────────
// Measured, not chosen round. Reconstructed from the last four healthy runs'
// logs (unmatched + withheld, which is exactly the set that stays stale):
//
//   2026-09-23   61/493   12.37%
//   2026-09-24   62/493   12.58%
//   2026-09-25   63/493   12.78%
//   2026-09-29   64/493   12.98%   <- confirmed against the DB the same day
//
// A 0.61pp band across four runs, creeping up ~0.2pp per run as feed conflicts
// accumulate. So the floor is 12.98%, today's worst healthy reading.
//
// The CEILING is the part worth writing down, because it is not obvious and
// someone will want to raise this number later. If the Olight partner were
// skipped entirely — its own coverage floor tripping in the sync — its 25 links
// would go stale and the total would be 79/493 = 16.0%. Anything at or above
// 16% therefore CANNOT SEE a whole partner dropping out, which is one of the
// exact failures this is here to catch.
//
// 15% sits above the measured band with ~2pp of headroom (about ten runs of the
// observed creep) and below the 16.0% detection floor. If you raise it, raise
// it knowing you are trading away partner-skip detection.
const DEFAULT_STALE_PCT_THRESHOLD = 15;

// `??` is NOT enough here and this is not hypothetical — the first drill run
// caught it. A workflow_dispatch input left blank, and any `${{ inputs.x }}`
// on a SCHEDULED run, arrives as an empty string rather than unset. The env
// var is therefore set-but-empty, `??` does not fall back, and `Number('')`
// is 0 — so every scheduled run would have compared against a 0% threshold,
// failed, and opened an alert every six hours until someone muted it. Treat
// blank and unparseable as "not supplied".
const rawThreshold = (process.env.STALE_PCT_THRESHOLD ?? '').trim();
const parsed       = rawThreshold === '' ? NaN : Number(rawThreshold);
const THRESHOLD    = Number.isFinite(parsed) ? parsed : DEFAULT_STALE_PCT_THRESHOLD;
const DRILL        = process.env.DRILL === 'true';

// Whole UTC days, matching the SQL form `last_checked < current_date - N`.
// Comparing elapsed milliseconds makes the boundary drift with the time of day
// and disagree with any SQL that counts the same set — same reasoning as the
// site's own stale rule in CLAUDE.md.
function utcCutoff(days) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - days))
    .toISOString().slice(0, 10);
}

// PostgREST returns the count in Content-Range as `0-n/TOTAL`. Ask for zero
// rows and read the header — we never need the bodies.
async function count(filter) {
  const url = `${SUPABASE_URL}/rest/v1/affiliate_links?select=id&retired_at=is.null&${filter}`;
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} ${res.statusText} for ${filter}`);
  }
  const range = res.headers.get('content-range');
  const total = range && range.split('/')[1];
  if (!total || Number.isNaN(Number(total))) {
    throw new Error(`could not read a count from content-range: ${range}`);
  }
  return Number(total);
}

async function oldestStale(staleFilter) {
  const url = `${SUPABASE_URL}/rest/v1/affiliate_links`
    + `?select=last_checked&retired_at=is.null&${staleFilter}`
    + `&last_checked=not.is.null&order=last_checked.asc&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.last_checked ?? null;
}

const cutoff = utcCutoff(STALE_DAYS);
const staleF = `or=(last_checked.is.null,last_checked.lt.${cutoff})`;

console.log(`price freshness — ${new Date().toISOString()}`);
console.log(`  stale means last_checked is null or < ${cutoff} (${STALE_DAYS} whole UTC days)`);
console.log('');

let live, stale, neverMatched, neverChecked, oldest;
try {
  [live, stale, neverMatched, neverChecked] = await Promise.all([
    count('id=not.is.null'),
    count(staleF),
    count(`${staleF}&op_last_matched_by=is.null`),
    count('last_checked=is.null'),
  ]);
  oldest = await oldestStale(staleF);
} catch (err) {
  // A read failure is NOT a pass. We know nothing about freshness, and
  // "we could not tell" must be as loud as "it is bad" — the whole point of
  // this file is that silence is the failure mode we are fixing.
  console.error(`\n✗ could not read affiliate_links: ${err.message}`);
  console.error('  Treating an unreadable catalogue as a failure, not a pass.');
  process.exit(1);
}

const pct = live === 0 ? 0 : (100 * stale) / live;
// Previously matched by a feed and now stale: the feed reached this link once
// and no longer resolves it. Distinct from a link no feed has ever matched,
// which is a catalogue-identifier gap rather than a sync regression.
const previouslyMatched = stale - neverMatched;

console.log(`  live links:                    ${live}`);
console.log(`  stale (> ${STALE_DAYS}d or never checked): ${stale}   (${pct.toFixed(2)}%)`);
console.log(`  threshold:                     ${THRESHOLD}%`);
console.log('');
console.log('  composition of the stale set:');
console.log(`    never matched by any feed:   ${neverMatched}   (identifier/catalogue gap, not a sync regression)`);
console.log(`    matched before, now stale:   ${previouslyMatched}   (withheld for review, or dropped out of the feed)`);
console.log(`    never checked at all:        ${neverChecked}`);
console.log(`    oldest last_checked:         ${oldest ?? 'n/a'}`);
console.log('');

if (DRILL) {
  console.error('✗ DRILL — this is a deliberate failure, triggered by hand, to prove the');
  console.error('  alert path actually delivers. Nothing is wrong with price freshness.');
  console.error(`  Real reading right now: ${stale}/${live} stale (${pct.toFixed(2)}%), threshold ${THRESHOLD}%.`);
  process.exit(1);
}

if (pct > THRESHOLD) {
  console.error(`✗ ${pct.toFixed(2)}% of live links are stale, over the ${THRESHOLD}% threshold.`);
  console.error('');
  console.error('  Check, in this order:');
  console.error('    1. Did refresh-affiliate-prices run? Its last run, not its last SUCCESS —');
  console.error('       a green run that wrote nothing looks identical from the outside.');
  console.error('         gh run list --workflow=refresh-affiliate-prices.yml --limit 5');
  console.error('       A run of 10-15s died before the sync; a real one takes about a minute.');
  console.error('    2. Was a partner skipped by its coverage floor? The sync exits non-zero');
  console.error('       but the OTHER partners still write, so the job is red while most of');
  console.error('       the catalogue looks fine.');
  console.error('    3. Did "matched before, now stale" jump? That is the feed losing links');
  console.error('       it used to resolve. A jump in "never matched" is not this outage —');
  console.error('       that set is a catalogue-identifier gap and moves slowly.');
  process.exit(1);
}

console.log(`✓ ${pct.toFixed(2)}% stale, within the ${THRESHOLD}% threshold.`);
