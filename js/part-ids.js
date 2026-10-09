// js/part-ids.js — which part a reviewer's correction belongs to.
//
// A correction in builds.edit_history used to name its part by POSITION
// (part_index) in parts_snapshot. A builder who removed an earlier part
// shifted the list under it, and the build page then laid "name corrected
// to X" over a different part, with no error anywhere. So the editor pinned
// every part up to the last corrected one, which locked a builder out of
// removing a wrong part from a build that had been corrected and rejected.
//
// Now every part carries its own id (`partId` in parts_snapshot), and a
// correction names the part by that (`part_id` in edit_history). A part
// that is removed takes its corrections with it; nothing shifts; nothing
// needs pinning.
//
// ONE RULE, HERE ONLY. Four pages need it — the review queue writes
// corrections, the build page and the queue read them, and the editor
// decides what is pinned — so it lives once, as a plain <script> global
// (window.PartIds), the same as js/build-categories.js and for the same
// reason: the page nobody is looking at keeps the old behaviour.
//
// Where ids come from:
//   ensure(parts)  — the two builder pages, just before every save
//   trg_assign_part_ids — the database, for anything that writes a part
//                    without one (supabase/part_ids.sql)
// Both only ever ADD an id to a part that has none (or a duplicate). An id
// is never changed, and a re-link keeps it: relink_build_part() and
// create_product() both merge into the existing part (`v_part || …`).
//
// Entries written before this carry only part_index. They still resolve by
// position — that is all they know — and the editor still pins the parts
// they cover. None existed when this shipped (2026-10-08), so that path is
// for safety, not for data.
(function (global) {
  'use strict';

  var ID_RE = /^[0-9a-f]{12}$/;

  function randomHex12() {
    var c = global.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      var b = new Uint8Array(6);
      c.getRandomValues(b);
      var s = '';
      for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
      return s;
    }
    // No crypto (very old browser): the trigger would assign one anyway, and
    // uniqueness only has to hold within one build's dozen parts.
    var out = '';
    while (out.length < 12) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  function isId(v) { return typeof v === 'string' && ID_RE.test(v); }

  // Give every part that has no valid id — or one already used by an earlier
  // part in the same list — a fresh one. Mutates the parts in place (they are
  // the page's state, so the id stays put across later saves) and returns
  // the same array.
  function ensure(parts) {
    var list = Array.isArray(parts) ? parts : [];
    var taken = {};
    list.forEach(function (p) { if (p && isId(p.partId)) taken[p.partId] = (taken[p.partId] || 0) + 1; });
    var seen = {};
    list.forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      if (isId(p.partId) && !seen[p.partId]) { seen[p.partId] = true; return; }
      var id;
      do { id = randomHex12(); } while (taken[id] || seen[id]);
      p.partId = id;
      seen[id] = true;
      taken[id] = 1;
    });
    return list;
  }

  // A correction, as opposed to the 'resubmit' marker and anything else that
  // lands in edit_history: it names a part, one way or the other.
  function isCorrection(e) {
    return !!e && (isId(e.part_id) || (Number.isInteger(e.part_index) && e.part_index >= 0));
  }

  // Does entry e belong to `part`, which sits at `idx`? By id when the entry
  // has one — and then ONLY by id: an entry whose part was removed matches
  // nothing, rather than falling back to whatever now sits at its old
  // position, which is the exact bug this replaces.
  function belongsTo(e, part, idx) {
    if (!isCorrection(e)) return false;
    if (isId(e.part_id)) return !!part && part.partId === e.part_id;
    return e.part_index === idx;
  }

  // The corrections for the part at `idx` of build.parts_snapshot, in the
  // order they were recorded (edit_history is append-only).
  function entriesFor(build, idx) {
    var parts = (build && Array.isArray(build.parts_snapshot)) ? build.parts_snapshot : [];
    var history = (build && Array.isArray(build.edit_history)) ? build.edit_history : [];
    var part = parts[idx];
    return history.filter(function (e) { return belongsTo(e, part, idx); });
  }

  // How many of the build's current parts carry at least one correction.
  function correctedPartCount(build) {
    var parts = (build && Array.isArray(build.parts_snapshot)) ? build.parts_snapshot : [];
    var n = 0;
    for (var i = 0; i < parts.length; i++) if (entriesFor(build, i).length) n++;
    return n;
  }

  // The highest position an OLD-style correction (part_index, no part_id)
  // names, or -1. The editor pins parts 0..that, because removing any of
  // them would move the part those entries mean. Entries with a part_id
  // pin nothing.
  function pinnedThrough(history) {
    var max = -1;
    (Array.isArray(history) ? history : []).forEach(function (e) {
      if (isCorrection(e) && !isId(e.part_id) && e.part_index > max) max = e.part_index;
    });
    return max;
  }

  global.PartIds = {
    ensure: ensure,
    isId: isId,
    isCorrection: isCorrection,
    belongsTo: belongsTo,
    entriesFor: entriesFor,
    correctedPartCount: correctedPartCount,
    pinnedThrough: pinnedThrough,
  };
})(typeof window !== 'undefined' ? window : globalThis);
