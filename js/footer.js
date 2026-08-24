// footer.js — renders the shared footer into <div id="footer-mount" data-footer="...">
// -----------------------------------------------------------------------------
// Variants (data-footer="..."):
//   default  — index.html canonical: copyright line + link list
//   legal    — same, but with the full legal disclaimer stacked above.
//              Used on pages where a build is displayed/submitted
//              (gunforma-build-detail, gunforma-post-build-v6) so the
//              "not legal advice" language stays visible.
//
// Pages without a mount div render nothing. That preserves the current
// design on the auth-card pages (signin, signup, complete-profile, claim,
// admin-queue), which never had a footer bar to begin with.
// -----------------------------------------------------------------------------
(function () {
  var mount = document.getElementById('footer-mount');
  if (!mount) return;

  var variant = mount.getAttribute('data-footer') || 'default';

  var LINKS_ROW =
    '<span class="footer-txt">© 2026 Gunforma · All rights reserved</span>' +
    '<span class="footer-txt">' +
      '<a href="#">Legal</a> · ' +
      '<a href="#">Affiliate disclosure</a> · ' +
      '<a href="#">Community guidelines</a> · ' +
      '<a href="#">Contact</a>' +
    '</span>';

  var LEGAL_TEXT =
    "Gunforma is for information and inspiration only and does not provide legal advice. " +
    "Firearms, magazines, optics, barrels, suppressors, and other parts shown here may be " +
    "restricted or illegal depending on your federal, state, and local laws. You are solely " +
    "responsible for knowing and following all laws that apply to you before buying, owning, " +
    "shipping, assembling, or modifying anything referenced on this site.";

  var html;
  if (variant === 'legal') {
    // Pages using this variant already ship .footer-legal + .footer-links-row CSS.
    html =
      '<div class="footer-bar">' +
        '<div class="footer-legal">' + LEGAL_TEXT + '</div>' +
        '<div class="footer-links-row">' + LINKS_ROW + '</div>' +
      '</div>';
  } else {
    // index.html canonical shape: two spans directly inside .footer-bar.
    html = '<div class="footer-bar">' + LINKS_ROW + '</div>';
  }

  mount.outerHTML = html;
})();
