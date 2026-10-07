-- add_categories_enum.sql
-- APPLIED 2026-10-05 as migration add_categories_enum (20261005020804), on
-- the go in the rulings for this PR and ahead of it, because it touches no
-- row and the rest cannot be dry-run without it. Verified: the enum ends
-- … slide_plate, recoil_spring, sight, other; 243 products unchanged.
-- Three new products.category values: recoil springs, sights, and Other
-- Parts (catalog parts that fit no other category). Values only: nothing
-- here touches a row, and no page reads them until a product has one.
--
-- Its own file, applied on its own and BEFORE add_categories.sql: Postgres
-- refuses to USE an enum value in the transaction that added it, so the
-- spec tables, rules and functions that name these values cannot run (or be
-- dry-run) until this is committed.
--
-- `other` is a products.category value. It is NOT the legacy parts_snapshot
-- section key `other_parts` (retired in #114), and neither is ever used as
-- the other; see js/build-categories.js.
--
-- Appended in this order, so the enum order (which _category-meta.mjs and
-- js/category-map.js follow) ends: … slide_plate, recoil_spring, sight, other.

alter type public.product_category add value if not exists 'recoil_spring';
alter type public.product_category add value if not exists 'sight';
alter type public.product_category add value if not exists 'other';
