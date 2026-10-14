# supabase/migrations_archive

The SQL files that were applied to production before the baseline existed.
**Nothing here runs.** The Supabase CLI applies `supabase/migrations/` only;
this folder is history, kept so every decision those files explain is still
findable (CLAUDE.md links into it).

Until 2026-10-14 the repo had no `supabase/migrations/` folder. Each change
was a loose file under `supabase/`, applied through the Supabase MCP's
`apply_migration` (which records a row in
`supabase_migrations.schema_migrations`) or pasted into the dashboard's SQL
editor (which records nothing). Production's history table therefore held
223 rows, most of them one-off data loads with no file anywhere, and the
rows that did have files were named after the file, not timestamped. The
folder could not replay — a Supabase branch stopped at the ninth row — so the
baseline migration replaced all of it. See `MIGRATIONS.md` at the repo root.

## Files here that match a row in production's old history

Matched on the history row's `name`. The version is the row's timestamp.

| history version | name | file |
|---|---|---|
| 20261005024538 | `add_categories` | `add_categories.sql` |
| 20261005020804 | `add_categories_enum` | `add_categories_enum.sql` |
| 20261005005427 | `add_variants` | `add_variants.sql` |
| 20261013033628 | `admin_part_changes` | `admin_part_changes.sql` |
| 20260925203335 | `build_comments` | `build_comments.sql` |
| 20261010213545 | `builds_gun_id` | `builds_gun_id.sql` |
| 20261004032655 | `colors_admin_insert` | `colors_admin_insert.sql` |
| 20261003223355 | `create_product` | `create_product.sql` |
| 20260922195829 | `fix_prevent_role_self_escalation` | `fix_prevent_role_self_escalation.sql` |
| 20261003225703 | `fix_product_data_status_url` | `fix_product_data_status_url.sql` |
| 20261004032834 | `fix_strip_blank_and_link_result` | `fix_strip_blank_and_link_result.sql` |
| 20260930051121 | `gun_optic_cuts` | `gun_optic_cuts.sql` |
| 20261007055811 | `link_clicks_product_id` | `link_clicks_product_id.sql` |
| 20261013223718 | `magazine_category` | `magazine_category.sql` |
| 20261013223126 | `magazine_category_enum` | `magazine_category_enum.sql` |
| 20261004032852 | `material_optional` | `material_optional.sql` |
| 20260925203352 | `notifications` | `notifications.sql` |
| 20261009053247 | `part_ids` | `part_ids.sql` |
| 20260922031941 | `price_history` | `price_history.sql` |
| 20260922174215 | `profiles_revoke_hidden_columns` | `profiles_revoke_hidden_columns.sql` |
| 20261004224459 | `relink_build_part` | `relink_build_part.sql` |
| 20261006235015 | `restrict_build_status_to_reviewers` | `restrict_build_status_to_reviewers.sql` |
| 20261006160738 | `revoke_truncate_grants` | `revoke_truncate_grants.sql` |
| 20260922073421 | `security_audit_4_6_7_9` | `security_audit_4_6_7_9.sql` |
| 20261005033214 | `sight_values_in_words` | `sight_values_in_words.sql` |
| 20261003223210 | `spec_field_rules` | `spec_field_rules.sql` |
| 20260922061220 | `sync_drift_review` | `sync_drift_review.sql` |

## Files here applied under a different history name, or by hand

Matched by reading the file against the history row's name and date. Where
no row exists the file was applied in the dashboard's SQL editor, which
leaves no record — the schema carries the change (the baseline dump proves
it) but the history never did.

| file | history row | note |
|---|---|---|
| `builder_agreement_moved_to_build_submission.sql` | `20260730225351 move_builder_agreement_consent_to_build_submission` | same change, different name |
| `profiles_builder_agreement_and_hardening.sql` | `20260730224014 add_builder_agreement_fields_to_profiles` | same change, different name |
| `product_variants_variant_label.sql` | `20260916173007 add_product_variants_variant_label` | same change, different name |
| `get_my_profile.sql` | `20260922170455 get_my_profile_rpc` | same change, different name |
| `retired_at_2a.sql` | `20260923175255 retired_at_2a_schema_and_sync_filter` | same change, different name |
| `retire_is_primary.sql` | `20260924031526 retire_affiliate_links_is_primary` | same change, different name |
| `create_variant_backend_callable.sql` | `20261002060332 004_create_variant_backend_callable` | same change, different name |
| `build_part_flags.sql` | none found | applied by hand (the table exists) |
| `build_approved_notifications.sql` | none found | applied by hand |
| `admin_insert_build_photos.sql` | none found | applied by hand |
| `fix_product_image_policies.sql` | none found | applied by hand, 2026-09-25 (the outage fix) |
| `fix_build_photo_tampering_guard.sql` | none found | applied by hand |
| `owner_edits_and_deletes_on_approved_builds.sql` | none found | applied by hand |
| `platform_is_live.sql` | none found | applied by hand (`platforms.is_live` exists) |
| `profiles_builds_rls.sql` | none found | applied by hand |
| `revoke_anon_write_grants.sql` | none found | applied by hand |
| `*_rollback.sql` (13 files) | — | never applied; each undoes its sibling |

## History rows with no file at all

198 of the 223 rows. Nearly all are the catalogue loads of August and
September 2026 (`p365_slides_insert_products`, `optics_stage4_variants`,
`lights_stage6a_compat_inserts`, …) and the early schema (`product_spine`,
`category_spec_tables`, `fit_rule_views`, …). Their SQL survives only in the
`statements` column of the rows that were removed by the repair; the
schema they produced is what the baseline dump captures, and the data they
loaded is production data, which no migration carries.
