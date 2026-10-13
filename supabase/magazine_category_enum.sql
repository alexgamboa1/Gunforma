-- magazine_category_enum.sql
-- APPLIED 2026-10-13 as migration magazine_category_enum (20261013223126),
-- on its own, after #167 was merged and live (the old TTI path already
-- answered 301 on gunforma.com). Read back: eighteen values, magazine at
-- enumsortorder 9.5 — between magwell (9) and basepad (10).
--
-- One new products.category value: magazine. A value only — nothing here
-- touches a row, and no page reads it until a product has it. Ordered right
-- after magwell, which is where js/category-map.js and _category-meta.mjs
-- list it; every earlier value keeps its position.
--
-- Its own file, applied on its own, for the reason add_categories_enum.sql
-- gives: Postgres refuses to USE an enum value in the transaction that added
-- it, so magazine_specs (whose default and CHECK name the value), the
-- spec_field_rules rows and the TTI move cannot run — or be dry-run — until
-- this is committed.

alter type public.product_category add value if not exists 'magazine' after 'magwell';
