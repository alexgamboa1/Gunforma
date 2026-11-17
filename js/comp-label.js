// comp-label.js — the generated Compensation label (Alex, 2026-11-17).
// Generated, never hand-written, same reasoning as displayProductName():
// the point is what it does to the NEXT slide — a new comp slide is
// described by its data, not by somebody remembering to write a paragraph.
//
// THE BROWSER COPY. The server copy is netlify/functions/_comp-label.mjs —
// the same split, for the same reason, as js/maker-link.js ↔
// _maker-link.mjs. Change BOTH; scripts/comp-label.test.mjs runs the two
// over the same inputs on every deploy and fails if they differ by a
// character.
//
// compLabel(s) -> array of sentences (joined by the page), [] when there is
// nothing to say. `s` is a plain object of spec facts:
//   comp_style                'none' | 'short_barrel' | 'ported_barrel'
//   port_style                key or null
//   port_display_name         port_styles.display_name (null when no port)
//   port_geometry             port_styles.geometry
//   port_style_is_makers_name false when the maker names no port design
//                             (the two Arc Reactor rows)
//   port_count                integer or null
//   slide_length_in           '3.7' / 3.7 / '3.70'
//   barrel_length_in          same shapes
//   threaded_barrel_ok        true | false | null (null = not stated)
//   ported_barrel_ok          true | false | null
//   barrel_included           boolean
//   bore_profile              'standard' | 'bull' (missing = standard)
//   maker                     brand name ("Norsso")
//   locked_barrel_names       display names of the slide's matched barrels
//
// The recoil-spring sentence follows SLIDE length, never barrel length —
// SIG's own wording for the Spectre Comp is "3.1in non-ported barrel, and a
// P365XL recoil spring assembly", and buyers get exactly this wrong.
(function (global) {
  'use strict';

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? String(n) : null;
  }
  function classWord(sl) {
    return sl === '3.1' ? 'P365' : sl === '3.7' ? 'XL' : sl === '4.3' ? 'FUSE' : null;
  }
  function countWords(n) {
    return n === 1 ? 'One port' : n === 2 ? 'Two ports' : n + ' ports';
  }

  function compLabel(s) {
    if (!s || !s.comp_style) return [];
    var bl = num(s.barrel_length_in);
    var sl = num(s.slide_length_in);
    var cls = classWord(sl);
    var spring = cls ? 'the ' + cls + ' (' + sl + 'in) recoil spring' : 'the ' + sl + 'in recoil spring';
    var locked = (s.locked_barrel_names || []).join(' and ');
    var out = [];

    var portPhrase = null;
    if (s.port_style) {
      portPhrase = s.port_style_is_makers_name === false
        ? (s.port_geometry || s.port_display_name || 'ports') + ' (' + s.maker + ' names no port design for it)'
        : (s.port_display_name || s.port_style) + (s.port_geometry ? ' (' + s.port_geometry + ')' : '');
    }

    if (s.comp_style === 'short_barrel') {
      if (s.port_style) {
        // "Designed for", never "Requires" (Alex, 2026-11-17): a ported
        // slide is never described as hard-requiring its matched barrel —
        // the same page lists the standard barrels as fitting.
        out.push('Compensator in the slide, plus ' + portPhrase + ' ports venting a matched ported barrel. Both work together.');
        out.push('Designed for the ' + (locked || 'matched ported barrel') + '. Needs ' + spring + '.');
      } else if (s.barrel_included) {
        // No "requires" for a part that ships in the box (Alex,
        // 2026-11-17 — the MCARBO shape). The parenthetical still states
        // what the included barrel is not.
        out.push('The compensator is machined into the slide, ahead of a shorter barrel. Comes with its ' +
          bl + 'in barrel (' + (s.ported_barrel_ok === false ? 'not ported, not threaded' : 'not threaded') +
          '). Needs ' + spring + '.');
      } else {
        var forbids = s.ported_barrel_ok === false
          ? ' — not ported, not threaded — '
          : ' — not threaded — ';
        out.push('The compensator is machined into the slide, ahead of a shorter barrel. Requires a ' +
          bl + 'in barrel' + forbids + 'and ' + spring + '.');
      }
    } else if (s.comp_style === 'ported_barrel') {
      out.push(countWords(s.port_count) + ' in the slide — ' + portPhrase +
        (s.port_style_is_makers_name === false ? '' : ', ' + s.maker + '’s name') +
        ' — fed by a ported barrel cut to match.');
      if (locked && !s.barrel_included) out.push('Designed for the ' + locked + '.');
    } else if (s.bore_profile === 'bull') {
      // No comp, bull bore (Alex, 2026-11-17 — the Rail Set shape, whose
      // openings are cosmetic per Norsso): "takes any barrel" would be
      // false twice over, and the openings are never called ports.
      out.push('Bull-barrel slide — no compensation. Takes Norsso N365XL bull barrels only; threaded and ported barrels don’t fit.');
    } else {
      var thr = s.threaded_barrel_ok === true ? 'OK'
        : s.threaded_barrel_ok === false ? 'not OK' : 'not stated by maker';
      out.push('Standard slide. Takes any ' + bl + 'in barrel; threaded barrels ' + thr + '.');
    }

    if (s.barrel_included) {
      if (s.comp_style === 'ported_barrel' && locked) {
        // The Norsso bull-set shape (Alex, 2026-11-17): the box carries a
        // barrel the buyer picks, and only the matched port option feeds
        // the slide's ports. The option is named by the slide's own
        // port_styles.display_name — never a slug. Today this gate
        // (ported slide + matched-barrel lock + barrel included) matches
        // exactly that set: the Arc kits carry no locks.
        out.push('Barrel included — choose the ' + (s.port_display_name || s.port_geometry || 'matched') +
          ' barrel option for the comp effect.');
      } else if (!(s.comp_style === 'short_barrel' && !s.port_style)) {
        // folded into "Comes with its …in barrel" for the internal-comp
        // package; a plain mention everywhere else
        out.push('Barrel included.');
      }
    }
    if (s.bore_profile === 'bull') {
      // The no-comp bull sentence above already carries the bull rule.
      if (s.comp_style === 'ported_barrel') {
        out.push('Sold as a set — Norsso bull-barrel slides take Norsso bull barrels only.');
      }
    } else if (s.comp_style === 'ported_barrel') {
      out.push('A standard ' + bl + 'in barrel fits but gives no comp effect.');
    }
    return out;
  }

  global.CompLabel = { compLabel: compLabel };
})(typeof window !== 'undefined' ? window : globalThis);
