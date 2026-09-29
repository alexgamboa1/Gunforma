#!/usr/bin/env node
// backfill-variant-ids — write the DEFAULT variant's identity onto the parts
// of builds posted before variant selection shipped.
//
// Every part in an existing parts_snapshot names a product and no variant, so
// gunforma-build-detail.html has nothing to resolve and falls back to the
// product's default-variant photo with no label. This fills in what the
// picker would now record: variantId, variantLabel, variantColor,
// variantFinish, imageUrl.
//
// WHY THE DEFAULT IS THE RIGHT GUESS, AND WHERE IT IS STILL A GUESS.
// It is what both post pages write today for a catalog pick, so backfilled
// rows and newly-posted rows agree. But it is genuinely unknown which colour
// the builder owns — on 149 of 231 products there is more than one — so this
// is a display default, not a claim. If a builder later says their barrel is
// FDE, that is an edit, not a bug in this script.
//
// SAFETY
//   • Dry run unless --write is passed.
//   • Never touches a part that already HAS a variantId — re-running is a
//     no-op, and a hand-corrected row is not reverted.
//   • Never touches a pending (off-catalog) part: no product, no variant.
//   • Rebuilds parts_snapshot as a WHOLE ARRAY (it is a single jsonb column),
//     preserving every existing key — `finish`, `variant` and anything else.
//     The armory's whitelists are the cautionary tale; this one copies rather
//     than enumerates.
//   • Verifies each write by reading the row back and asserting the fields
//     are present, rather than trusting the response.
//
//   node scripts/backfill-variant-ids.mjs              # dry run, prints the plan
//   node scripts/backfill-variant-ids.mjs --write      # applies it
//
// Reading uses the anon key (approved builds and the catalog are public), so
// the plan can be inspected with no secret at all. Writing needs
// SUPABASE_SERVICE_ROLE_KEY: parts_snapshot belongs to the builder and RLS
// correctly refuses an anonymous update — which it would do by matching ZERO
// rows and returning no error, so the row-count assertion below is what turns
// that into a visible failure.
import { variantLabel } from '../netlify/functions/_variant-label.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lagjjcpclvzrjlrswojt.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhZ2pqY3BjbHZ6cmpscnN3b2p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzODY1MDAsImV4cCI6MjEwMDk2MjUwMH0.sxOq3pWnK2k60rE-w6in2rcuWyQOT3ngrsAzY0VcVY4';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WRITE = process.argv.includes('--write');

const key = WRITE ? SERVICE : ANON;
if (WRITE && !SERVICE) {
  console.error('--write needs SUPABASE_SERVICE_ROLE_KEY. Without it the UPDATE matches zero rows and reports success.');
  process.exit(2);
}

async function pg(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', ...(init.headers || {}),
    },
  });
  if (!res.ok) { console.error(`${init.method || 'GET'} ${path} → ${res.status}: ${await res.text()}`); process.exit(1); }
  return res.status === 204 ? null : res.json();
}

const builds = await pg('builds?select=id,name,status,parts_snapshot&order=created_at');
console.log(`${builds.length} build(s) visible\n`);

// Default variant per product, retired rows excluded — the same shape the
// post pages' catalog query uses, and the same named FK, because products
// references product_variants back and a bare embed is PGRST201.
const refIds = [...new Set(builds.flatMap((b) =>
  (b.parts_snapshot || []).map((p) => p.refId).filter(Boolean)))];
if (!refIds.length) { console.log('no catalog parts to backfill'); process.exit(0); }

const variants = await pg(
  'product_variants?select=id,product_id,is_default,color,finish,variant_label,primary_image_url' +
  `&retired_at=is.null&product_id=in.(${refIds.join(',')})`);

const defaultByProduct = new Map();
for (const v of variants) if (v.is_default) defaultByProduct.set(v.product_id, v);

let planned = 0, already = 0, pending = 0, noDefault = 0;
const plan = [];

for (const b of builds) {
  const parts = b.parts_snapshot;
  if (!Array.isArray(parts) || !parts.length) continue;
  let touched = false;

  const next = parts.map((p) => {
    if (p.variantId) { already++; return p; }
    if (!p.refId || p.pending) { pending++; return p; }
    const dv = defaultByProduct.get(p.refId);
    if (!dv) { noDefault++; console.log(`  !! ${b.name}: ${p.name} — product has no live default variant, left alone`); return p; }

    // Spread first: every existing key survives, including ones this script
    // has never heard of.
    const row = { ...p, variantId: dv.id };
    const label = variantLabel(dv);
    if (label)                row.variantLabel  = label;
    if (dv.color)             row.variantColor  = dv.color;
    if (dv.finish)            row.variantFinish = dv.finish;
    if (dv.primary_image_url) row.imageUrl      = dv.primary_image_url;

    planned++; touched = true;
    plan.push({ build: b.name, part: `${p.brand} ${p.name}`, label: label || '(none)', variantId: dv.id });
    return row;
  });

  if (touched) b.__next = next;
}

console.log(`\nplan: ${planned} part(s) to fill · ${already} already have one · ${pending} pending/off-catalog · ${noDefault} no default variant\n`);
for (const r of plan) console.log(`  ${r.build.padEnd(22)} ${r.part.padEnd(46)} ${r.label.padEnd(24)} ${r.variantId}`);

if (!planned) process.exit(0);
if (!WRITE) { console.log('\ndry run — nothing written. Re-run with --write to apply.'); process.exit(0); }

let ok = 0;
for (const b of builds) {
  if (!b.__next) continue;
  // return=representation so the row count is read, not assumed. An
  // RLS-filtered UPDATE matches zero rows and returns 200 with [].
  const rows = await pg(`builds?id=eq.${b.id}&select=id`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ parts_snapshot: b.__next }),
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    console.error(`\nFAILED: ${b.name} (${b.id}) — UPDATE matched ${Array.isArray(rows) ? rows.length : '?'} rows, expected 1.`);
    process.exit(1);
  }
  // Read it back independently. The PATCH reporting on itself is a witness
  // to its own case.
  const [check] = await pg(`builds?id=eq.${b.id}&select=parts_snapshot`);
  const filled = (check.parts_snapshot || []).filter((p) => p.variantId).length;
  const expect = b.__next.filter((p) => p.variantId).length;
  if (filled !== expect) {
    console.error(`\nFAILED: ${b.name} — read back ${filled} parts with a variantId, expected ${expect}.`);
    process.exit(1);
  }
  console.log(`  ok  ${b.name}: ${filled}/${b.__next.length} parts carry a variantId`);
  ok++;
}
console.log(`\n${ok} build(s) updated and verified by re-read.`);
