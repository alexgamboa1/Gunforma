#!/usr/bin/env node
// check-finish-data — the finish-family invariants, asserted against the
// LIVE database (2026-11-19, 20261120001514_finish_families.sql).
//
// WHY IT IS NOT A BUILD CHECK: these are facts about production rows, and
// the build cannot see the database — the same reasoning, and the same
// shape, as check-fitment-data.mjs. It runs from
// .github/workflows/check-routes.yml beside it, on the schedule and on
// demand. The database enforces the first two at write time (the
// product_variants.finish foreign key, and set_finish_family() raising on
// a finish with no row); this is the second witness, and the only one for
// the derived column staying in step.
//
//   1. every non-null product_variants.finish has a finishes row
//   2. every non-null product_variants.finish_family has a finish_families row
//   3. every finishes.finish_family has a finish_families row
//   4. finish_family is exactly the family finishes files that finish under
//      (NULL finish ⇔ NULL family) — the derivation has not gone stale
//
// Before the migration is applied (code deploys first — CLAUDE.md,
// "Branches and PRs"), finishes does not exist and finish_family is not a
// column: the run says so and passes. A finishes table WITHOUT the column,
// or the column without the table, is a half-applied schema and fails.

const SB_URL  = 'https://lagjjcpclvzrjlrswojt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';
const HEADERS = { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON };

// One read, or null when PostgREST says the relation/column is not there.
async function read(path) {
  const res = await fetch(SB_URL + '/rest/v1/' + path, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    // PGRST205: table not in the schema cache. 42703: column does not exist.
    if (/PGRST205|42703/.test(body)) return null;
    throw new Error('PostgREST ' + res.status + ' for ' + path + ': ' + body.slice(0, 200));
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('non-array body for ' + path);
  return rows;
}

// Every row, a page at a time — PostgREST caps a response (1000 by
// default), and product_variants is already close to that.
async function readAll(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await read(path + '&order=id&limit=1000&offset=' + offset);
    if (page === null) return offset === 0 ? null : out;
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const failures = [];
const fail = (msg) => failures.push(msg);

const [families, finishes, variants] = await Promise.all([
  read('finish_families?select=finish_family'),
  read('finishes?select=finish,finish_family'),
  readAll('product_variants?select=id,slug,finish,finish_family'),
]);

if (finishes === null && families === null && variants === null) {
  console.log('finishes / finish_families / product_variants.finish_family are not in the schema yet —');
  console.log('20261120001514_finish_families.sql is not applied. Nothing to check.');
  process.exit(0);
}
if (finishes === null || families === null || variants === null) {
  console.error('FAIL  half-applied schema: finishes ' + (finishes ? 'present' : 'MISSING') +
    ', finish_families ' + (families ? 'present' : 'MISSING') +
    ', product_variants.finish_family ' + (variants ? 'present' : 'MISSING'));
  process.exit(1);
}

if (finishes.length === 0) fail('finishes returned zero rows — the read itself is wrong');
if (variants.length === 0) fail('product_variants returned zero rows — the read itself is wrong');

const familySet = new Set(families.map((f) => f.finish_family));
const familyOf = new Map(finishes.map((f) => [f.finish, f.finish_family]));

// Guard 3
for (const f of finishes) {
  if (!familySet.has(f.finish_family)) {
    fail('finishes: "' + f.finish + '" is filed under "' + f.finish_family + '", which has no finish_families row');
  }
}

for (const v of variants) {
  const name = v.slug || v.id;
  if (v.finish == null) {
    // Guard 4, null half
    if (v.finish_family != null) fail(name + ': no finish but finish_family "' + v.finish_family + '"');
    continue;
  }
  // Guard 1
  if (!familyOf.has(v.finish)) {
    fail(name + ': finish "' + v.finish + '" has no finishes row');
    continue;
  }
  // Guard 2
  if (v.finish_family != null && !familySet.has(v.finish_family)) {
    fail(name + ': finish_family "' + v.finish_family + '" has no finish_families row');
  }
  // Guard 4
  if (v.finish_family !== familyOf.get(v.finish)) {
    fail(name + ': finish "' + v.finish + '" is filed under "' + familyOf.get(v.finish) +
      '" but the variant says "' + (v.finish_family ?? 'NULL') + '" — the derivation is stale');
  }
}

const withFinish = variants.filter((v) => v.finish != null).length;
console.log('finish families: ' + families.length + ', finishes: ' + finishes.length +
  ', variants: ' + variants.length + ' (' + withFinish + ' with a finish)');

if (failures.length) {
  for (const f of failures) console.error('FAIL  ' + f);
  console.error('\n' + failures.length + ' finish-data invariant(s) broken.');
  process.exit(1);
}
console.log('ok    every finish is listed, every family exists, every derived family is current');
