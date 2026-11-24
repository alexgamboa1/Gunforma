#!/usr/bin/env node
// check-brand-case — the brand is written "Gunforma", capital G, everywhere a
// person reads it (Alex, 2026-11-23). A lowercase "gunforma" in visible text
// fails the build.
//
// What counts as visible text, and is scanned:
//   - every root *.html page and the auth email mirrors
//     (scripts/*-email-template.html): text nodes, <title>, the alt / title /
//     aria-label / placeholder attributes, and the content of the
//     description, og:title, og:description, twitter:title and
//     twitter:description meta tags. <script>, <style> and HTML comments are
//     skipped (the JS sources below are scanned on their own terms).
//   - field-notes/*.md: front-matter title and description, and the body,
//     with fenced code, inline code and link targets removed.
//   - js/*.js, netlify/functions/*.mjs and netlify/edge-functions/**/*.js:
//     every non-comment line, which is where server-rendered and
//     browser-rendered strings live.
//
// What is NEVER a brand mention, and so is never flagged — the match is the
// standalone word only:
//   - a URL, domain, path or file name: gunforma.com, /how-gunforma-checks-
//     parts.html, gunforma-legal.html (a ".", "-", "/", "_" or "\" touching
//     the word, on either side, means it is an address or an identifier)
//   - an email address (an "@" touching it)
//   - anything inside an http(s) URL, even in visible text
// A sentence ending "…on gunforma." IS flagged: a "." followed by a space or
// the end of the text is punctuation, not a domain.
//
// Not scanned, on purpose: package.json's npm "name" (npm requires
// lowercase), supabase/migrations (applied history, never edited), the
// logo image, and database values (the build cannot see the database).
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The standalone word: not part of an identifier, address or path.
const LOWER = /(?<![A-Za-z0-9_.\/@:\\-])gunforma(?![A-Za-z0-9_\/@\\-]|\.[A-Za-z0-9])/g;
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

const hits = [];

function scanText(file, line, text, where) {
  const clean = text.replace(URL_RE, ' ');
  for (const m of clean.matchAll(LOWER)) {
    const s = Math.max(0, m.index - 30);
    hits.push(`${file}:${line} (${where}): "…${clean.slice(s, m.index + 38).replace(/\s+/g, ' ').trim()}…"`);
  }
}

const lineAt = (src, idx) => src.slice(0, idx).split('\n').length;

// Blank out a region but keep its newlines, so line numbers stay true.
const blank = (s) => s.replace(/[^\n]/g, ' ');

function scanHtml(file, src) {
  let body = src
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<script\b[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[\s\S]*?<\/style>/gi, blank);

  // Attributes a person reads, and meta tags whose content is shown.
  for (const tag of body.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const t = tag[0];
    const line = lineAt(body, tag.index);
    for (const a of t.matchAll(/\b(alt|title|aria-label|placeholder)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      scanText(file, line, a[3] ?? a[4], `${a[1]}=`);
    }
    if (/^<meta\b/i.test(t) && /\b(name|property)\s*=\s*["'](description|og:title|og:description|twitter:title|twitter:description)["']/i.test(t)) {
      const c = t.match(/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i);
      if (c) scanText(file, line, c[2] ?? c[3], 'meta content');
    }
  }
  // Text nodes: everything between tags.
  const text = body.replace(/<[^>]*>/g, blank);
  text.split('\n').forEach((l, i) => scanText(file, i + 1, l, 'text'));
}

function scanMarkdown(file, src) {
  let s = src;
  const fm = s.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    fm[1].split('\n').forEach((l, i) => {
      const m = l.match(/^(title|description):\s*(.*)$/);
      if (m) scanText(file, i + 2, m[2], `front matter ${m[1]}`);
    });
    s = blank(fm[0]) + s.slice(fm[0].length);
  }
  s = s.replace(/```[\s\S]*?```/g, blank)
       .replace(/`[^`\n]*`/g, blank)
       .replace(/\]\(([^)\n]*)\)/g, (m) => ']' + blank(m.slice(1)));
  s.split('\n').forEach((l, i) => scanText(file, i + 1, l, 'prose'));
}

function scanSource(file, src) {
  // Remove block and line comments (keeping newlines), then scan the code:
  // string literals that reach a page live here.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
  code.split('\n').forEach((l, i) => scanText(file, i + 1, l, 'string'));
}

async function files(dir, test, recurse = false) {
  const out = [];
  let ents;
  try { ents = await readdir(join(ROOT, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory() && recurse) out.push(...await files(p, test, recurse));
    else if (e.isFile() && test(e.name)) out.push(p);
  }
  return out;
}

const html = [
  ...await files('.', (n) => n.endsWith('.html')),
  ...await files('scripts', (n) => /-email-template\.html$/.test(n)),
];
const md = await files('field-notes', (n) => n.endsWith('.md'));
const src = [
  ...await files('js', (n) => n.endsWith('.js')),
  ...await files('netlify/functions', (n) => n.endsWith('.mjs')),
  ...await files('netlify/edge-functions', (n) => /\.(m?js)$/.test(n), true),
];

for (const f of html) scanHtml(f, await readFile(join(ROOT, f), 'utf8'));
for (const f of md) scanMarkdown(f, await readFile(join(ROOT, f), 'utf8'));
for (const f of src) scanSource(f, await readFile(join(ROOT, f), 'utf8'));

const scanned = html.length + md.length + src.length;
if (hits.length) {
  console.error(`✗ lowercase "gunforma" in visible text — the brand is written "Gunforma":`);
  for (const h of hits) console.error('  ' + relative('.', h));
  console.error(`  (URLs, emails, paths and file names are never flagged; see the header of scripts/check-brand-case.mjs)`);
  process.exit(1);
}
console.log(`✓ "Gunforma" capitalized in visible text (${scanned} files: ${html.length} HTML, ${md.length} field notes, ${src.length} JS/functions)`);
