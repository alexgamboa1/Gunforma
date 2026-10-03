// _page-chrome — the nav, the footer, the hamburger script and the chrome
// CSS that every SERVER-RENDERED page shares.
// ─────────────────────────────────────────────────────────────────────────
// This exists because of CLAUDE.md's nav count. The nav was already in
// fifteen places, three of them Netlify functions, and the note there says
// the function copies are the ones that get missed because a sweep of
// *.html does not see them. gun-hub.mjs would have been the sixteenth.
//
// So the server copies live here instead: guide-page.mjs and gun-hub.mjs
// both call navHtml(), and a nav change touches this file once rather than
// both of them. product-page.mjs and parts-index.mjs still hold their own —
// folding those in is a separate change with its own blast radius, and this
// one is already load-bearing for two pages.
//
// What is NOT here: page-specific CSS. Each page keeps its own rules for
// its own components; only the shared chrome moved.

export function navHtml() {
  return (
'<nav class="nav">' +
  '<a class="nav-logo" href="index.html"><img class="nav-logo-full" src="assets/gunforma-logo.png" alt="Gunforma"><img class="nav-logo-mark" src="assets/gunforma-mark.png" alt="Gunforma"></a>' +
  '<div class="nav-links">' +
    '<a class="nav-link" href="index.html">Home</a>' +
    '<a class="nav-link" href="gunforma-builds.html">Builds</a>' +
    '<a class="nav-link active" href="gunforma-parts-catalog.html">Parts Catalog</a>' +
  '</div>' +
  '<div class="nav-right">' +
    '<a class="nav-btn nav-signin-inline" href="gunforma-signin.html">Sign in</a>' +
    '<a class="nav-btn cta" href="gunforma-post-build.html">+ Post your build</a>' +
    '<a class="nav-profile" href="gunforma-signin.html" aria-label="Account"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke-linecap="round"/></svg></a>' +
    '<button class="nav-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav-menu"><span></span><span></span><span></span></button>' +
  '</div>' +
'<div class="nav-menu" id="nav-menu">' +
  '<a href="gunforma-builds.html">Builds</a>' +
  '<a href="gunforma-parts-catalog.html">Parts Catalog</a>' +
'</div>' +
'</nav>'
  );
}

export function footerHtml() {
  return (
    '<div class="footer-bar">' +
      '<span>&copy; 2026 Gunforma &middot; All rights reserved</span>' +
      '<span><a href="gunforma-legal.html#legal">Legal</a> &middot; ' +
      '<a href="gunforma-legal.html#affiliate">Affiliate disclosure</a> &middot; ' +
      '<a href="gunforma-legal.html#contact">Contact</a></span>' +
    '</div>'
  );
}

// Dependency-free hamburger. These pages ship no other client JS, so
// without it the nav is unreachable below 820px.
export function navScript() {
  return (
    '<script>(function(){' +
      'var t=document.querySelector(".nav-toggle"),m=document.querySelector(".nav-menu");' +
      'if(!t||!m)return;' +
      'function c(){m.classList.remove("open");t.setAttribute("aria-expanded","false");}' +
      't.addEventListener("click",function(){' +
        'var o=m.classList.toggle("open");t.setAttribute("aria-expanded",o?"true":"false");' +
      '});' +
      'm.addEventListener("click",function(e){if(e.target.closest("a"))c();});' +
      'window.addEventListener("resize",function(){if(window.innerWidth>820)c();});' +
    '})();</script>'
  );
}

// The chrome CSS: reset, body, the whole nav block and its 820px collapse.
export function chromeCss() {
  return (
'* { box-sizing: border-box; margin: 0; padding: 0; }' +
'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fafaf8; color: #1a1a1a; min-height: 100vh; }' +
'.nav { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; padding: 0 28px; height: 52px; border-bottom: 0.5px solid #2a2b2e; background: #0e0f11; }' +
'.nav-logo { display: flex; align-items: center; text-decoration: none; }' +
'.nav-logo img { height: 22px; width: auto; display: block; }' +
'.nav-logo img.nav-logo-mark { display: none; }' +
'@media (max-width: 600px) { .nav-logo img.nav-logo-full { display: none; } .nav-logo img.nav-logo-mark { display: block; } }' +
'.nav-links { display: flex; gap: 28px; }' +
'.nav-link { font-size: 12px; color: #ffffff; letter-spacing: 0.06em; text-transform: uppercase; text-decoration: none; }' +
'.nav-link.active { border-bottom: 2px solid #4a9edd; padding-bottom: 2px; }' +
'.nav-right { display: flex; align-items: center; gap: 14px; }' +
'.nav-btn { font-size: 11px; color: #ffffff; border: 0.5px solid #2a2b2e; padding: 5px 12px; border-radius: 4px; cursor: pointer; text-decoration: none; }' +
'.nav-btn.cta { color: #4a9edd; border-color: #4a9edd; }' +
'.nav-toggle { display: none; background: none; border: 0; padding: 8px; margin: 0 -8px 0 0; cursor: pointer; }' +
'.nav-toggle span { display: block; width: 20px; height: 2px; background: #e8e6e1; border-radius: 2px; }' +
'.nav-toggle span + span { margin-top: 4px; }' +
'.nav-profile { display: none; align-items: center; justify-content: center; width: 34px; height: 34px; border: 0.5px solid #2a2b2e; border-radius: 50%; color: #ffffff; text-decoration: none; }' +
'.nav-profile svg { width: 19px; height: 19px; }' +
'.nav-menu { display: none; }' +
'@media (max-width: 820px) {' +
'  .nav-links { display: none; }' +
'  .nav-signin-inline { display: none; }' +
'  .nav-profile { display: flex; }' +
'  .nav-toggle { display: block; }' +
'  .nav-menu { position: absolute; top: 52px; left: 0; right: 0; background: #0e0f11; border-bottom: 0.5px solid #2a2b2e; flex-direction: column; padding: 8px 0; z-index: 99; }' +
'  .nav-menu.open { display: flex; }' +
'  .nav-menu a { padding: 13px 28px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #ffffff; text-decoration: none; border-bottom: 0.5px solid #1a1b1e; }' +
'}'
  );
}

// Shared page layout: breadcrumb, the 860px column, the eyebrow, footer bar.
export function layoutCss() {
  return (
'.breadcrumb { max-width: 860px; margin: 18px auto 0; padding: 0 24px; font-size: 12px; color: #888; }' +
'.breadcrumb a { color: #888; text-decoration: none; }' +
'.page { max-width: 860px; margin: 0 auto; padding: 10px 24px 64px; }' +
'.eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #4a9edd; font-weight: 700; margin: 14px 0 6px; }'  +
'.footer-bar { max-width: 860px; margin: 0 auto; padding: 24px; display: flex; flex-wrap: wrap; gap: 6px 16px; justify-content: space-between; border-top: 0.5px solid #e5e5e5; font-size: 11px; color: #999; }' +
'.footer-bar a { color: #999; }'
  );
}

// The <head> every one of these pages emits, minus the page-specific
// <style>. Apex canonical and og:url are not optional — see CLAUDE.md
// "SEO invariants": they are always gunforma.com, never the current origin.
export function headTags({ title, description, canonical, jsonLd, ogType = 'article', ogImage }) {
  return (
    '<meta charset="UTF-8"/>' +
    '<base href="/"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
    '<link rel="icon" type="image/png" href="/assets/gunforma-mark.png" />' +
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=12026" />' +
    '<link rel="shortcut icon" href="/favicon.ico?v=12026" />' +
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=12026" />' +
    '<title>' + esc(title) + '</title>' +
    '<link rel="canonical" href="' + esc(canonical) + '" />' +
    '<meta name="description" content="' + esc(description) + '"/>' +
    '<meta property="og:type" content="' + esc(ogType) + '"/>' +
    '<meta property="og:title" content="' + esc(title) + '"/>' +
    '<meta property="og:description" content="' + esc(description) + '"/>' +
    '<meta property="og:image" content="' + esc(ogImage) + '"/>' +
    '<meta property="og:url" content="' + esc(canonical) + '"/>' +
    '<meta name="twitter:card" content="summary_large_image"/>' +
    '<meta name="twitter:title" content="' + esc(title) + '"/>' +
    '<meta name="twitter:description" content="' + esc(description) + '"/>' +
    '<script type="application/ld+json">' + JSON.stringify(jsonLd).replace(/</g, '\\u003c') + '</script>'
  );
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
