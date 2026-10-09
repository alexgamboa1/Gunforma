// js/part-ids.js — which part a reviewer's correction belongs to.
//
// WHY THIS IS A BUILD CHECK
// A correction that lands on the wrong part renders perfectly: the build
// page lays "name corrected to X" over whatever part matched, with a green
// "Verified & corrected" badge on it. That is the bug js/part-ids.js exists
// to end — corrections used to be matched by position, and a removed part
// shifted every later correction onto its neighbour. Nothing would report it
// coming back. So the rule is pinned here, against the real module.
//
// Run: node --test scripts/part-ids.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = { crypto: webcrypto };
new Function('window', await readFile(join(ROOT, 'js/part-ids.js'), 'utf8'))(win);
const P = win.PartIds;

const ID = /^[0-9a-f]{12}$/;
const fix = (overrides) => Object.assign({ field: 'name', from_value: 'a', to_value: 'b', status: 'active' }, overrides);

test('ensure() gives every part a valid id, distinct within the list', () => {
  const parts = Array.from({ length: 40 }, (_, i) => ({ name: 'p' + i }));
  P.ensure(parts);
  assert.ok(parts.every((p) => ID.test(p.partId)));
  assert.equal(new Set(parts.map((p) => p.partId)).size, 40);
});

test('ensure() never changes an id a part already has', () => {
  const parts = [{ name: 'a', partId: 'aaaaaaaaaaaa' }, { name: 'b' }];
  P.ensure(parts);
  assert.equal(parts[0].partId, 'aaaaaaaaaaaa');
  P.ensure(parts);                       // and a second save keeps both
  const again = parts.map((p) => p.partId);
  P.ensure(parts);
  assert.deepEqual(parts.map((p) => p.partId), again);
});

test('ensure() re-ids a duplicate and an invalid id, and keeps the first holder', () => {
  const parts = [{ partId: 'bbbbbbbbbbbb' }, { partId: 'bbbbbbbbbbbb' }, { partId: 'NOT-AN-ID' }];
  P.ensure(parts);
  assert.equal(parts[0].partId, 'bbbbbbbbbbbb');
  assert.ok(ID.test(parts[1].partId) && parts[1].partId !== 'bbbbbbbbbbbb');
  assert.ok(ID.test(parts[2].partId));
  assert.equal(new Set(parts.map((p) => p.partId)).size, 3);
});

test('a correction follows its part when an earlier part is removed', () => {
  // The bug, end to end: three parts, the third corrected, then the first removed.
  const before = {
    parts_snapshot: [{ name: 'A', partId: 'aaaaaaaaaaaa' }, { name: 'B', partId: 'bbbbbbbbbbbb' }, { name: 'C', partId: 'cccccccccccc' }],
    edit_history: [fix({ part_id: 'cccccccccccc', part_index: 2, to_value: 'C corrected' })],
  };
  assert.equal(P.entriesFor(before, 2).length, 1);

  const after = { parts_snapshot: before.parts_snapshot.slice(1), edit_history: before.edit_history };
  assert.equal(P.entriesFor(after, 1).length, 1, 'C is now at index 1 and keeps its correction');
  assert.equal(P.entriesFor(after, 1)[0].to_value, 'C corrected');
  // ...and nothing lands at the entry's stale part_index, which now holds nothing
  // of C's — this is exactly the case that used to show C's correction on B.
  assert.equal(P.entriesFor(after, 0).length, 0);
});

test('a correction whose part was removed matches nothing, never a neighbour', () => {
  const b = {
    parts_snapshot: [{ name: 'A', partId: 'aaaaaaaaaaaa' }, { name: 'C', partId: 'cccccccccccc' }],
    edit_history: [fix({ part_id: 'bbbbbbbbbbbb', part_index: 1 })],   // B is gone
  };
  assert.equal(P.entriesFor(b, 0).length, 0);
  assert.equal(P.entriesFor(b, 1).length, 0, 'C sits at B\'s old index and must not inherit its correction');
  assert.equal(P.correctedPartCount(b), 0);
});

test('an old-style entry (part_index only) still resolves by position', () => {
  const b = { parts_snapshot: [{ name: 'A' }, { name: 'B' }], edit_history: [fix({ part_index: 1 })] };
  assert.equal(P.entriesFor(b, 1).length, 1);
  assert.equal(P.entriesFor(b, 0).length, 0);
});

test('the resubmit marker and junk are not corrections', () => {
  const b = {
    parts_snapshot: [{ name: 'A', partId: 'aaaaaaaaaaaa' }],
    edit_history: [{ type: 'resubmit', at: 'x' }, null, { part_index: -1 }, { part_index: '0' }, { part_id: 'short' }],
  };
  assert.equal(P.entriesFor(b, 0).length, 0);
  assert.equal(P.correctedPartCount(b), 0);
  assert.equal(P.pinnedThrough(b.edit_history), -1);
});

test('correctedPartCount counts parts, not entries', () => {
  const b = {
    parts_snapshot: [{ partId: 'aaaaaaaaaaaa' }, { partId: 'bbbbbbbbbbbb' }, { partId: 'cccccccccccc' }],
    edit_history: [
      fix({ part_id: 'aaaaaaaaaaaa', part_index: 0, field: 'name' }),
      fix({ part_id: 'aaaaaaaaaaaa', part_index: 0, field: 'brand' }),
      fix({ part_id: 'cccccccccccc', part_index: 2 }),
      { type: 'resubmit' },
    ],
  };
  assert.equal(P.correctedPartCount(b), 2);
});

test('only old-style entries pin; corrections by id pin nothing', () => {
  assert.equal(P.pinnedThrough([fix({ part_id: 'cccccccccccc', part_index: 4 })]), -1);
  assert.equal(P.pinnedThrough([fix({ part_index: 2 }), fix({ part_index: 5, part_id: 'aaaaaaaaaaaa' }), fix({ part_index: 1 })]), 2);
  assert.equal(P.pinnedThrough(undefined), -1);
});

test('entriesFor keeps edit_history order (it is append-only, so chronological)', () => {
  const b = {
    parts_snapshot: [{ partId: 'aaaaaaaaaaaa' }],
    edit_history: [fix({ part_id: 'aaaaaaaaaaaa', to_value: '1' }), fix({ part_id: 'aaaaaaaaaaaa', to_value: '2' })],
  };
  assert.deepEqual(P.entriesFor(b, 0).map((e) => e.to_value), ['1', '2']);
});

test('the pages that read corrections use the module, not a copy of the rule', async () => {
  // The old rule, written inline, was `e.part_index === idx`. Any page that
  // still filters edit_history that way is matching by position again.
  for (const f of ['gunforma-admin-queue.html', 'gunforma-build-detail.html', 'gunforma-post-build.html']) {
    const src = await readFile(join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /\.part_index\s*===?\s*idx/, f + ' matches a correction by position inline');
    assert.match(src, /<script src="js\/part-ids\.js"><\/script>/, f + ' does not load js/part-ids.js');
  }
});

test('both builder pages give parts ids before every save', async () => {
  // A save without ensure() still works — trg_assign_part_ids fills them in
  // — but then the page's own copy has no ids, and a correction written
  // against a part saved this way needs a reload to find it.
  for (const [f, saves] of [['gunforma-post-build.html', 2], ['gunforma-admin-post.html', 1]]) {
    const src = await readFile(join(ROOT, f), 'utf8');
    const ensures = (src.match(/PartIds\.ensure\(state\.parts\)/g) || []).length;
    const writes = (src.match(/parts_snapshot:\s*buildPartsSnapshot\(\)/g) || []).length;
    assert.equal(writes, saves, f + ': expected ' + saves + ' payload(s) carrying parts_snapshot');
    assert.equal(ensures, writes, f + ': ' + writes + ' save(s) but ' + ensures + ' PartIds.ensure() call(s)');
  }
});
