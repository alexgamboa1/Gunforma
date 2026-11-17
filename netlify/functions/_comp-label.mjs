// _comp-label.mjs — the generated Compensation label, THE SERVER COPY.
// The browser copy is js/comp-label.js — the same split, for the same
// reason, as _maker-link.mjs ↔ js/maker-link.js. Change BOTH;
// scripts/comp-label.test.mjs runs the two over the same inputs on every
// deploy and fails if they differ by a character. The input contract and
// every wording decision are documented in the browser copy.

function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? String(n) : null;
}
function classWord(sl) {
  return sl === '3.1' ? 'P365' : sl === '3.7' ? 'XL' : sl === '4.3' ? 'FUSE' : null;
}
function countWords(n) {
  return n === 1 ? 'One port' : n === 2 ? 'Two ports' : n + ' ports';
}

export function compLabel(s) {
  if (!s || !s.comp_style) return [];
  const bl = num(s.barrel_length_in);
  const sl = num(s.slide_length_in);
  const cls = classWord(sl);
  const spring = cls ? 'the ' + cls + ' (' + sl + 'in) recoil spring' : 'the ' + sl + 'in recoil spring';
  const locked = (s.locked_barrel_names || []).join(' and ');
  const out = [];

  let portPhrase = null;
  if (s.port_style) {
    portPhrase = s.port_style_is_makers_name === false
      ? (s.port_geometry || s.port_display_name || 'ports') + ' (' + s.maker + ' names no port design for it)'
      : (s.port_display_name || s.port_style) + (s.port_geometry ? ' (' + s.port_geometry + ')' : '');
  }

  if (s.comp_style === 'short_barrel') {
    if (s.port_style) {
      out.push('Compensator in the slide, plus ' + portPhrase + ' ports venting a matched ported barrel. Both work together.');
      out.push('Requires the ' + (locked || 'matched ported barrel') + ' — and ' + spring + '.');
    } else {
      const forbids = s.ported_barrel_ok === false
        ? ' — not ported, not threaded — '
        : ' — not threaded — ';
      out.push('The compensator is machined into the slide, ahead of a shorter barrel. Requires a ' +
        bl + 'in barrel' + forbids + 'and ' + spring + '.');
    }
  } else if (s.comp_style === 'ported_barrel') {
    out.push(countWords(s.port_count) + ' in the slide — ' + portPhrase +
      (s.port_style_is_makers_name === false ? '' : ', ' + s.maker + '’s name') +
      ' — fed by a ported barrel cut to match.');
    if (locked) out.push('Designed for the ' + locked + '.');
  } else {
    const thr = s.threaded_barrel_ok === true ? 'OK'
      : s.threaded_barrel_ok === false ? 'not OK' : 'not stated by maker';
    out.push('Standard slide. Takes any ' + bl + 'in barrel; threaded barrels ' + thr + '.');
  }

  if (s.barrel_included) out.push('Barrel included.');
  if (s.bore_profile === 'bull') {
    out.push('Sold as a set — Norsso bull-barrel slides take Norsso bull barrels only.');
  } else if (s.comp_style === 'ported_barrel') {
    out.push('A standard ' + bl + 'in barrel fits but gives no comp effect.');
  }
  return out;
}
