// The generated Compensation label (Alex, 2026-11-17): one rule, two
// copies — js/comp-label.js (browser) and _comp-label.mjs (server) — and
// this test holds them together and pins the approved wording for every
// case, rendered with the real catalog rows the approval table used.
// A wording that drifts from the approved table, a copy that drifts from
// the other, or a spring sentence that follows BARREL length instead of
// SLIDE length (the trap buyers fall into) all fail here.
//
// Run: node scripts/comp-label.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { compLabel as serverCompLabel } from '../netlify/functions/_comp-label.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(resolve(root, 'js/comp-label.js'), 'utf8'), sandbox);
const browserCompLabel = sandbox.window.CompLabel.compLabel;

let failures = 0;
function eq(name, got, want) {
  try {
    assert.deepEqual(got, want);
  } catch {
    failures++;
    console.error('FAIL ' + name + '\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want));
  }
}

// Every case runs BOTH copies: the pinned wording against the server copy,
// and byte-equality between the two.
function pin(name, input, want) {
  const s = serverCompLabel(input);
  const b = browserCompLabel(input);
  eq(name + ' (server)', s, want);
  // JSON, not deepEqual: the browser copy's arrays come from the vm
  // context's own realm, and strict deepEqual refuses cross-realm
  // prototypes even when every byte agrees.
  eq(name + ' (copies agree)', JSON.stringify(b), JSON.stringify(s));
}

// ── the approved cases, real rows ───────────────────────────────────────────

pin('internal comp — SIG Spectre Comp', {
  comp_style: 'short_barrel', port_style: null,
  slide_length_in: '3.7', barrel_length_in: '3.1',
  threaded_barrel_ok: false, ported_barrel_ok: false,
  barrel_included: false, bore_profile: 'standard', maker: 'Sig Sauer',
  locked_barrel_names: [],
}, [
  'The compensator is machined into the slide, ahead of a shorter barrel. Requires a 3.1in barrel — not ported, not threaded — and the XL (3.7in) recoil spring.',
]);

pin('internal comp + ported — Norsso N365DG XP', {
  comp_style: 'short_barrel', port_style: 'c-port',
  port_display_name: 'C-Port', port_geometry: 'Two Openings',
  port_style_is_makers_name: true, port_count: 2,
  slide_length_in: '3.7', barrel_length_in: '3.1',
  threaded_barrel_ok: false, ported_barrel_ok: true,
  barrel_included: false, bore_profile: 'standard', maker: 'Norsso',
  locked_barrel_names: ['Norsso N365 3.1" C Port Barrel'],
}, [
  'Compensator in the slide, plus C-Port (Two Openings) ports venting a matched ported barrel. Both work together.',
  'Requires the Norsso N365 3.1" C Port Barrel — and the XL (3.7in) recoil spring.',
]);

pin('ported + matched — Norsso C-Port XL', {
  comp_style: 'ported_barrel', port_style: 'c-port',
  port_display_name: 'C-Port', port_geometry: 'Two Openings',
  port_style_is_makers_name: true, port_count: 2,
  slide_length_in: '3.7', barrel_length_in: '3.7',
  threaded_barrel_ok: false, ported_barrel_ok: true,
  barrel_included: false, bore_profile: 'standard', maker: 'Norsso',
  locked_barrel_names: ['Norsso N365XL 3.7" C Port Barrel'],
}, [
  'Two ports in the slide — C-Port (Two Openings), Norsso’s name — fed by a ported barrel cut to match.',
  'Designed for the Norsso N365XL 3.7" C Port Barrel.',
  'A standard 3.7in barrel fits but gives no comp effect.',
]);

pin('no comp — Norsso Rail EDC XL', {
  comp_style: 'none', port_style: null,
  slide_length_in: '3.7', barrel_length_in: '3.7',
  threaded_barrel_ok: true, ported_barrel_ok: null,
  barrel_included: false, bore_profile: 'standard', maker: 'Norsso',
  locked_barrel_names: [],
}, [
  'Standard slide. Takes any 3.7in barrel; threaded barrels OK.',
]);

pin('package, maker names no port design — Arc Reactor 365X', {
  comp_style: 'ported_barrel', port_style: 'chunk-port',
  port_display_name: 'Chunk Port', port_geometry: 'Front Port',
  port_style_is_makers_name: false, port_count: 1,
  slide_length_in: '3.7', barrel_length_in: '3.7',
  threaded_barrel_ok: false, ported_barrel_ok: true,
  barrel_included: true, bore_profile: 'standard', maker: 'Arc Division',
  locked_barrel_names: [],
}, [
  'One port in the slide — Front Port (Arc Division names no port design for it) — fed by a ported barrel cut to match.',
  'Barrel included.',
  'A standard 3.7in barrel fits but gives no comp effect.',
]);

pin('bull set — Norsso Spec Ops Bull Barrel Ported Set', {
  comp_style: 'ported_barrel', port_style: 'geo-port',
  port_display_name: 'GEO Port', port_geometry: 'Straight Port',
  port_style_is_makers_name: true, port_count: 1,
  slide_length_in: '3.7', barrel_length_in: '3.7',
  threaded_barrel_ok: false, ported_barrel_ok: true,
  barrel_included: true, bore_profile: 'bull', maker: 'Norsso',
  locked_barrel_names: ['Norsso N365XL 3.7" GEO Port Bull Barrel'],
}, [
  'One port in the slide — GEO Port (Straight Port), Norsso’s name — fed by a ported barrel cut to match.',
  'Designed for the Norsso N365XL 3.7" GEO Port Bull Barrel.',
  'Barrel included.',
  'Sold as a set — Norsso bull-barrel slides take Norsso bull barrels only.',
]);

// MCARBO: internal comp whose maker SHIPS a ported barrel with it —
// ported_barrel_ok TRUE, so "not ported" must NOT render; the included
// barrel line must.
pin('internal comp + included barrel — MCARBO', {
  comp_style: 'short_barrel', port_style: null,
  slide_length_in: '3.7', barrel_length_in: '3.1',
  threaded_barrel_ok: false, ported_barrel_ok: true,
  barrel_included: true, bore_profile: 'standard', maker: 'MCARBO',
  locked_barrel_names: [],
}, [
  'The compensator is machined into the slide, ahead of a shorter barrel. Requires a 3.1in barrel — not threaded — and the XL (3.7in) recoil spring.',
  'Barrel included.',
]);

// The spring follows SLIDE length, not barrel length: a 3.7in slide over a
// 3.1in barrel says the XL spring, never the P365 one.
{
  const spectre = serverCompLabel({
    comp_style: 'short_barrel', slide_length_in: '3.70', barrel_length_in: '3.10',
    ported_barrel_ok: false, maker: 'Sig Sauer', locked_barrel_names: [],
  });
  eq('spring follows slide length', /XL \(3\.7in\) recoil spring/.test(spectre[0]), true);
  eq('spring never names the barrel length class', /P365 \(3\.1in\)/.test(spectre[0]), false);
}

pin('threaded fit not stated by maker', {
  comp_style: 'none', slide_length_in: '3.1', barrel_length_in: '3.1',
  threaded_barrel_ok: null, maker: 'Grey Ghost Precision', locked_barrel_names: [],
}, [
  'Standard slide. Takes any 3.1in barrel; threaded barrels not stated by maker.',
]);

pin('no spec, nothing to say', null, []);
pin('no comp_style, nothing to say', { port_style: 'c-port' }, []);

if (failures) {
  console.error('\ncomp-label: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('comp-label: all cases pass, both copies agree');
