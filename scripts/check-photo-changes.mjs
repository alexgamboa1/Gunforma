// check-photo-changes.mjs — no product photo has changed outside Alex's flow.
// ─────────────────────────────────────────────────────────────────────────
// Every product photo is Alex's, chosen by hand (the 2026-11-24 ruling).
// public.photo_changes (supabase/migrations/*_photo_changes_audit.sql)
// records every change to product_variants.primary_image_url and to
// variant_images, and marks it approved only when it came through Alex's
// flow — an admin's own request (the add-part page), or a transaction that
// declared itself with `set local gunforma.photo_edit = '<reason>'`. This
// fails, listing each variant, while any UNAPPROVED change has not been
// reviewed, so a photo changed by anything else — the sync, a script, an
// undeclared SQL session — is heard about the same day.
//
// Runs in .github/workflows/check-routes.yml (twice a day), with the service
// role key: the table is private. Under NOT_BUILD_CHECKS in check-all.sh —
// it reads production rows, and a data event must not fail a deploy.
//
// Clearing a row once it is understood (a direct SQL session, which the
// check-routes job then reads as reviewed):
//   update public.photo_changes set reviewed_at = now(), review_note = '<why>'
//    where id in (…);
// A row is never deleted: the log is the record.
//
//   no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   warns, passes
//   the table does not exist yet                  passes with a notice
//   a failed read                                 fails
//   unreviewed unapproved rows                    fails, listing them
//
// Run: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-photo-changes.mjs

export const LIMIT = 500;

export async function checkPhotoChanges({ env = process.env, fetchImpl = fetch } = {}) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { status: 'skipped', lines: ['WARNING: photo changes NOT checked — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set here. check-routes.yml checks them twice a day.'] };
  }
  const path = 'photo_changes?approved=is.false&reviewed_at=is.null' +
    '&select=id,product_slug,variant_slug,field,old_value,new_value,changed_at,changed_by_role,session_user_name' +
    '&order=changed_at.asc,id.asc&limit=' + LIMIT;
  let res;
  try {
    res = await fetchImpl(url.replace(/\/+$/, '') + '/rest/v1/' + path, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { status: 'error', lines: ['could not read photo_changes: ' + ((e && e.cause && e.cause.code) || (e && e.message))] };
  }
  if (!res.ok) {
    let code = '';
    try { code = (await res.json()).code || ''; } catch { /* not json */ }
    // Before the migration is applied: the code ships first (CLAUDE.md).
    if (res.status === 404 && code === 'PGRST205') {
      return { status: 'pending', lines: ['photo_changes does not exist yet (the audit migration is not applied) — nothing to check'] };
    }
    return { status: 'error', lines: ['could not read photo_changes: PostgREST ' + res.status + (code ? ' ' + code : '')] };
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) return { status: 'error', lines: ['could not read photo_changes: not an array'] };
  if (!rows.length) return { status: 'clean', lines: ['no unreviewed photo change outside Alex\'s flow'] };

  const variants = [...new Set(rows.map((r) => (r.product_slug || '?') + ' / ' + (r.variant_slug || '?')))];
  const lines = [
    rows.length + (rows.length === LIMIT ? '+' : '') + ' product photo change(s) not made through Alex\'s flow, on ' +
      variants.length + ' variant(s). Review each, then set reviewed_at (see this script\'s header).',
  ];
  for (const r of rows) {
    lines.push('  #' + r.id + ' ' + String(r.changed_at).slice(0, 16).replace('T', ' ') + ' ' +
      (r.product_slug || '?') + ' / ' + (r.variant_slug || '?') + ' — ' + r.field + ': ' +
      (r.old_value ?? '(none)') + ' → ' + (r.new_value ?? '(none)') +
      ' [by ' + r.changed_by_role + (r.changed_by_role === 'session' ? ' ' + r.session_user_name : '') + ']');
  }
  return { status: 'flagged', lines };
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const r = await checkPhotoChanges();
  const pass = r.status === 'clean' || r.status === 'skipped' || r.status === 'pending';
  for (const l of r.lines) (pass ? console.log : console.error)(l);
  process.exit(pass ? 0 : 1);
}
