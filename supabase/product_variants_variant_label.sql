-- ============================================================
-- Gunforma-v2 — product_variants.variant_label
-- Applied to project lagjjcpclvzrjlrswojt as migration
-- add_product_variants_variant_label.
--
-- Free-text differentiator for variants that differ on attributes
-- outside the axis columns (reticle, MOA, dot color, threading...).
-- When non-empty the UI shows it verbatim instead of the computed
-- color/finish/optic_cut/bundle/clamp/manual_safety label.
-- ============================================================
alter table public.product_variants add column if not exists variant_label text;
comment on column public.product_variants.variant_label is 'Human-readable variant differentiator (e.g. "2 MOA Red Dot"). Overrides the computed axis label in the UI when non-empty.';
