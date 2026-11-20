// admin-field-notes — the server half of gunforma-admin-field-notes.html:
// list every field note, render an admin's unsaved text through the real
// renderer, and turn every save, publish, unpublish and new draft into a
// PULL REQUEST through the GitHub API.
// -----------------------------------------------------------------------------
// THE DESIGN DECISION (Alex, 2026-11-20): articles stay Markdown files in
// the repo. A save never writes to Supabase and never writes to main — it
// opens (or adds a commit to) a PR, so every edit still runs check-all,
// gets a Netlify deploy preview, keeps git history, and Alex still does
// every merge. Nothing in this file merges, pushes to main, or deletes a
// branch; the tests hold it to that against a mocked GitHub.
//
// AUTH, on every request. The Supabase JWT from the admin's session is
// resolved by Supabase Auth (/auth/v1/user), then get_my_profile() is
// called WITH THAT JWT — the same RPC requireAdmin() on every admin page
// calls, so "admin" means one thing on both sides. Netlify functions hold
// the anon key only; no service key is needed. Anything else is a 403.
//
// GITHUB. GITHUB_FIELD_NOTES_TOKEN (Netlify env): a fine-grained token,
// this repository only, Contents read/write + Pull requests read/write. It
// never leaves this function. Without it the page is read-only: reads use
// the public API (the repo is public), writes answer 503 with the setup
// sentence.
//
// WHAT A SAVE MAY WRITE (isWritablePath): field-notes/<slug>.md, the
// registry netlify/functions/_field-notes-meta.mjs, and field-notes.html —
// the last only on publish/unpublish, one card, because the build guard
// requires a live article's index card in the same commit that flips its
// draft flag. Every other path is refused before any request is sent. A
// registry edit rewrites one row and is re-imported and compared before
// commit (_field-notes-admin.mjs, verifyRegistryEdit).

import { SB_URL, SB_ANON } from './_pg.mjs';
import { parseFrontMatter } from './_markdown.mjs';
import { renderNote } from './field-note.mjs';
import { lintNote, TYPED_PRICE } from '../../scripts/field-notes-lint.mjs';
import * as A from './_field-notes-admin.mjs';

export const REPO = () => process.env.GITHUB_FIELD_NOTES_REPO || 'alexgamboa1/Gunforma';
const token = () => process.env.GITHUB_FIELD_NOTES_TOKEN || '';
export const TOKEN_MISSING = 'GitHub token not set — see setup';
export const FIXTURE_SLUG = 'renderer-check';
// Branches this function may create or move. Never main, never anything
// else; the prefixes also find "the open admin PR for this slug".
const BRANCH_RE = /^admin-(edit|publish|new)\/[a-z0-9-]+-\d{8}-\d{4}$/;
// The commit status Netlify posts for a deploy preview. Read off a real PR
// (#281, 2026-11-20): `netlify/<site name>/deploy-preview`, target_url the
// preview. `deploy/netlify` is the older app's context, accepted too.
const isNetlifyPreview = (ctx) => ctx === 'deploy/netlify' || /^netlify\/[^/]+\/deploy-preview$/.test(String(ctx || ''));

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
});

// ── auth ─────────────────────────────────────────────────────────────────
export async function adminUser(req) {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const jwt = m[1];
  const u = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + jwt } });
  if (!u.ok) return null;
  const user = await u.json().catch(() => null);
  if (!user || !user.id) return null;
  const p = await fetch(SB_URL + '/rest/v1/rpc/get_my_profile', {
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!p.ok) return null;
  const prof = await p.json().catch(() => null);
  const row = Array.isArray(prof) ? prof[0] : prof;
  return row && row.role === 'admin' && row.id === user.id ? { id: user.id, email: user.email || null } : null;
}

// ── GitHub ───────────────────────────────────────────────────────────────
export class GhError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function gh(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'gunforma-admin-field-notes' };
  if (token()) headers.Authorization = 'Bearer ' + token();
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch('https://api.github.com/repos/' + REPO() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new GhError(res.status, 'GitHub ' + method + ' ' + path.split('?')[0] + ': ' + ((data && data.message) || res.status));
  return data;
}
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
async function readFile(path, ref) {
  try {
    const f = await gh('/contents/' + enc(path) + '?ref=' + encodeURIComponent(ref));
    return Buffer.from(f.content || '', 'base64').toString('utf8');
  } catch (e) { if (e.status === 404) return null; throw e; }
}
async function listDir(path, ref) {
  try { return await gh('/contents/' + enc(path) + '?ref=' + encodeURIComponent(ref)); } catch (e) { if (e.status === 404) return []; throw e; }
}
const branchSha = async (branch) => (await gh('/git/ref/heads/' + enc(branch))).object.sha;

// The open PRs this editor opened, by slug. Branch names carry the slug.
async function adminPrs() {
  const pulls = await gh('/pulls?state=open&per_page=100');
  const bySlug = {};
  for (const p of pulls || []) {
    const m = (p.head && p.head.ref || '').match(/^admin-(edit|publish|new)\/([a-z0-9-]+)-\d{8}-\d{4}$/);
    if (!m || (p.base && p.base.ref !== 'main')) continue;
    (bySlug[m[2]] = bySlug[m[2]] || []).push({ number: p.number, url: p.html_url, branch: p.head.ref, kind: m[1], sha: p.head.sha, title: p.title });
  }
  return bySlug;
}
async function previewFor(sha) {
  try {
    const st = await gh('/commits/' + sha + '/status');
    const s = (st.statuses || []).find((x) => isNetlifyPreview(x.context));
    return s ? { state: s.state, url: s.state === 'success' ? s.target_url : null } : { state: 'pending', url: null };
  } catch { return { state: 'unknown', url: null }; }
}

// THE one write path: one commit of `files` onto `branch`, created from
// main when it does not exist. Refuses any path off the allowlist and any
// branch that is not an admin branch BEFORE a request is sent.
export async function commitFiles(branch, files, message) {
  if (!BRANCH_RE.test(branch)) throw new GhError(400, 'refused: ' + branch + ' is not an admin branch');
  for (const f of files) if (!A.isWritablePath(f.path)) throw new GhError(400, 'refused: ' + f.path + ' is not a path the field-notes editor may write');
  let head, created = false;
  try { head = await branchSha(branch); }
  catch (e) {
    if (e.status !== 404) throw e;
    head = await branchSha('main');
    await gh('/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + branch, sha: head } });
    created = true;
  }
  const base = await gh('/git/commits/' + head);
  const tree = await gh('/git/trees', { method: 'POST', body: {
    base_tree: base.tree.sha,
    tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  } });
  const commit = await gh('/git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [head] } });
  await gh('/git/refs/heads/' + enc(branch), { method: 'PATCH', body: { sha: commit.sha, force: false } });
  return { sha: commit.sha, created };
}
async function openPr(branch, title, body) {
  const pr = await gh('/pulls', { method: 'POST', body: { title, head: branch, base: 'main', body } });
  return { number: pr.number, url: pr.html_url, branch };
}

// ── helpers ──────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
const stamp = () => { const d = new Date().toISOString(); return d.slice(0, 10).replace(/-/g, '') + '-' + d.slice(11, 16).replace(':', ''); };
const fails = (issues) => issues.filter((i) => i.level === 'fail');
const PR_FOOTER = '\n\nOpened from the admin field-notes editor (gunforma-admin-field-notes.html). check-all runs on this PR and Netlify builds its preview; it goes live when Alex merges it.';
const by = (user) => (user.email ? '\n\nSaved by ' + user.email + '.' : '');

async function mainState() {
  const registry = await readFile(A.REGISTRY_PATH, 'main');
  if (registry == null) throw new GhError(502, 'the registry is not on main');
  return { registry, notes: await A.loadRegistry(registry) };
}

// ── actions ──────────────────────────────────────────────────────────────
async function list() {
  const { notes } = await mainState();
  const files = (await listDir('field-notes', 'main')).filter((f) => f.type === 'file' && /\.md$/.test(f.name) && f.name !== 'VOICE.md').map((f) => f.name.replace(/\.md$/, ''));
  let prs = {};
  if (token()) { try { prs = await adminPrs(); } catch { prs = {}; } }
  const rows = [];
  const seen = new Set();
  for (const n of notes) {
    seen.add(n.slug);
    const src = files.includes(n.slug) ? await readFile(A.notePath(n.slug), 'main') : null;
    const meta = src ? parseFrontMatter(src).meta : {};
    const pr = (prs[n.slug] || [])[0] || null;
    rows.push({
      slug: n.slug, title: meta.title || null, type: meta.type || null,
      draft: !!n.draft, fixture: n.slug === FIXTURE_SLUG,
      reviewed: n.updated || n.published, published: n.published,
      changelog: (n.changelog || []).length, inRegistry: true, fileOnMain: !!src,
      pr: pr ? { ...pr, preview: await previewFor(pr.sha) } : null,
    });
  }
  // A file nothing declares is a page that does not exist — flagged red.
  for (const slug of files) if (!seen.has(slug)) rows.push({ slug, inRegistry: false, fileOnMain: true, draft: true, fixture: false, title: null, type: null, changelog: 0, pr: null });
  return { tokenSet: !!token(), repo: REPO(), notes: rows };
}

async function file(slug) {
  if (!A.SLUG_RE.test(slug || '')) return { status: 400, error: 'bad slug' };
  // An open edit PR is the newer text: the editor continues it.
  let ref = 'main', pr = null;
  if (token()) { const prs = await adminPrs(); pr = (prs[slug] || []).find((p) => p.kind === 'edit') || null; if (pr) ref = pr.branch; }
  const src = await readFile(A.notePath(slug), ref);
  if (src == null) return { status: 404, error: 'no file for ' + slug + ' on ' + ref };
  const registry = await readFile(A.REGISTRY_PATH, ref);
  const row = (await A.loadRegistry(registry)).find((n) => n.slug === slug) || null;
  return { slug, src, row, ref, pr, fixture: slug === FIXTURE_SLUG };
}

async function preview({ slug, src, row }) {
  const linted = lintNote(String(src || ''));
  const article = { slug: slug || 'preview', published: (row && row.published) || today(), updated: (row && row.updated) || null,
    changelog: (row && row.changelog) || undefined, tags: (row && row.tags) || undefined, draft: true };
  let html;
  try { html = (await renderNote(article, String(src || ''), { mode: 'admin-preview' })).page; }
  catch (e) { html = '<!DOCTYPE html><meta name="robots" content="noindex"><p style="font-family:sans-serif;padding:20px">The catalog did not answer — the preview needs live data. Try again in a moment.</p>'; }
  return { issues: linted.issues, html };
}

async function save(user, { slug, src, whatChanged, fullReview }) {
  if (!A.SLUG_RE.test(slug || '')) return { status: 400, error: 'bad slug' };
  if (slug === FIXTURE_SLUG) return { status: 400, error: 'renderer-check is the renderer’s fixture — edit it in the repo, not here' };
  const what = String(whatChanged || '').trim();
  if (!what) return { status: 400, error: '"What changed" is required — it becomes the changelog entry and the PR title' };
  if (what.length > 140 || /[\n\r]/.test(what)) return { status: 400, error: '"What changed" is one line, 140 characters at most' };
  if (TYPED_PRICE.test(what)) return { status: 400, error: '"What changed" may not carry a typed dollar figure (the registry guard refuses one in a changelog entry)' };
  const linted = lintNote(String(src || ''));
  if (fails(linted.issues).length) return { status: 422, error: 'the text has FAILs — fix them first', issues: linted.issues };

  const prs = await adminPrs();
  const existing = (prs[slug] || []).find((p) => p.kind === 'edit') || null;
  const branch = existing ? existing.branch : 'admin-edit/' + slug + '-' + stamp();
  const ref = existing ? branch : 'main';
  const before = await readFile(A.REGISTRY_PATH, ref);
  const row = (await A.loadRegistry(before)).find((n) => n.slug === slug);
  if (!row) return { status: 404, error: slug + ' is not in the registry on ' + ref };
  const entry = today() + ': ' + what.replace(/\s*\.?$/, '.');
  let after = A.addChangelog(before, slug, entry);
  const expected = { ...row, changelog: [entry, ...(row.changelog || [])] };
  if (fullReview) { after = A.setDate(after, slug, 'updated', today()); expected.updated = today(); }
  await A.verifyRegistryEdit(before, after, slug, expected);

  const message = 'Field note edit: ' + slug + ' — ' + what;
  const c = await commitFiles(branch, [
    { path: A.notePath(slug), content: String(src).replace(/\r\n?/g, '\n') },
    { path: A.REGISTRY_PATH, content: after },
  ], message);
  const pr = existing || await openPr(branch, message,
    'Edits `field-notes/' + slug + '.md` and adds its changelog entry (`' + entry + '`).' +
    (fullReview ? ' **Full review:** `updated` is bumped to ' + today() + '.' : ' Not a full review: `updated` is unchanged.') + by(user) + PR_FOOTER);
  return { pr, commit: c.sha, addedToExisting: !!existing };
}

async function publish(user, { slug, publish: on }) {
  if (!A.SLUG_RE.test(slug || '') || slug === FIXTURE_SLUG) return { status: 400, error: 'that note cannot be published from here' };
  const { registry: before, notes } = await mainState();
  const row = notes.find((n) => n.slug === slug);
  if (!row) return { status: 404, error: slug + ' is not in the registry' };
  if (!!row.draft === !on) return { status: 409, error: slug + ' is already ' + (on ? 'published' : 'a draft') };
  const src = await readFile(A.notePath(slug), 'main');
  if (src == null) return { status: 404, error: 'no file for ' + slug + ' on main' };
  const meta = parseFrontMatter(src).meta;
  if (on && fails(lintNote(src).issues).length) return { status: 422, error: slug + ' has FAILs on main — fix them before publishing' };

  let after = A.setDraft(before, slug, !on);
  const expected = { ...row };
  if (on) delete expected.draft; else expected.draft = true;
  // First publish (no changelog yet): published and reviewed become today,
  // and the house "First published." entry opens the changelog.
  const first = on && !(row.changelog && row.changelog.length);
  if (first) {
    after = A.setDate(after, slug, 'published', today());
    after = A.setDate(after, slug, 'updated', today());
    after = A.addChangelog(after, slug, today() + ': First published.');
    Object.assign(expected, { published: today(), updated: today(), changelog: [today() + ': First published.'] });
  }
  const finalRows = await A.verifyRegistryEdit(before, after, slug, expected);

  const index = await readFile(A.INDEX_PATH, 'main');
  const publishedOf = (s) => (finalRows.find((n) => n.slug === s) || {}).published;
  const indexAfter = on
    ? A.insertCard(index, A.cardHtml({ slug, meta, published: publishedOf(slug) }), slug, publishedOf(slug), publishedOf)
    : A.removeCard(index, slug);

  const verb = on ? 'publish' : 'unpublish';
  const branch = 'admin-publish/' + slug + '-' + stamp();
  const title = 'Field note ' + verb + ': ' + slug;
  await commitFiles(branch, [{ path: A.REGISTRY_PATH, content: after }, { path: A.INDEX_PATH, content: indexAfter }], title);
  const pr = await openPr(branch, title,
    (on ? 'Publishes' : 'Unpublishes') + ' `' + slug + '`: flips `draft` in its registry row' +
    (first ? ', sets `published` and `updated` to ' + today() + ' and adds "First published." (first publish)' : '') +
    ', and ' + (on ? 'adds' : 'removes') + ' its card in `field-notes.html` — the build guard requires the index card in the same commit that flips the flag. The change goes live when this is merged.' + by(user) + PR_FOOTER);
  return { pr };
}

async function newDraft(user, { text }) {
  let split;
  try { split = A.splitRegistryRow(String(text || '')); } catch (e) { return { status: 400, error: e.message }; }
  const { text: md, row: r } = split;
  const linted = lintNote(md);
  if (fails(linted.issues).length) return { status: 422, error: 'the draft has FAILs — fix them first', issues: linted.issues };
  const { registry: before, notes } = await mainState();
  if (notes.some((n) => n.slug === r.slug)) return { status: 409, error: r.slug + ' is already in the registry' };
  if ((await readFile(A.notePath(r.slug), 'main')) != null) return { status: 409, error: 'field-notes/' + r.slug + '.md already exists on main' };
  const open = await adminPrs();
  if (open[r.slug]) return { status: 409, error: 'an admin PR for ' + r.slug + ' is already open: ' + open[r.slug][0].url };
  const row = { slug: r.slug, published: r.published, updated: r.updated || r.published, draft: true, ...(r.tags && r.tags.length ? { tags: r.tags } : {}) };
  const after = A.insertRow(before, row);
  await A.verifyRegistryEdit(before, after, r.slug, row);
  const branch = 'admin-new/' + r.slug + '-' + stamp();
  const title = 'New field note (draft): ' + r.slug;
  await commitFiles(branch, [{ path: A.notePath(r.slug), content: md }, { path: A.REGISTRY_PATH, content: after }], title);
  const pr = await openPr(branch, title,
    'Adds `field-notes/' + r.slug + '.md` and its registry row with `draft: true`. A draft is a 404 on gunforma.com and renders on this PR’s preview. It never publishes from here: that is its own PR.' + by(user) + PR_FOOTER);
  return { pr, slug: r.slug };
}

async function status(n) {
  const pr = await gh('/pulls/' + Number(n));
  return { number: pr.number, state: pr.merged ? 'merged' : pr.state, url: pr.html_url, preview: await previewFor(pr.head.sha) };
}

// ── the handler ──────────────────────────────────────────────────────────
export default async (req) => {
  let user;
  try { user = await adminUser(req); } catch { user = null; }
  if (!user) return json({ error: 'Forbidden: admins only' }, 403);
  try {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const action = url.searchParams.get('action') || 'list';
      if (action === 'list') return json(await list());
      if (action === 'file') { const r = await file(url.searchParams.get('slug')); return json(r, r.status || 200); }
      if (action === 'status') { if (!token()) return json({ error: TOKEN_MISSING, readOnly: true }, 503); return json(await status(url.searchParams.get('pr'))); }
      return json({ error: 'unknown action' }, 400);
    }
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'preview') return json(await preview(body));
    if (!['save', 'publish', 'new'].includes(body.action)) return json({ error: 'unknown action' }, 400);
    if (!token()) return json({ error: TOKEN_MISSING, readOnly: true }, 503);
    const r = body.action === 'save' ? await save(user, body) : body.action === 'publish' ? await publish(user, body) : await newDraft(user, body);
    return json(r, r.status || 200);
  } catch (e) {
    console.error('[admin-field-notes]', e);
    const status = e instanceof GhError && e.status === 400 ? 400 : 502;
    return json({ error: e.message || 'failed' }, status);
  }
};
