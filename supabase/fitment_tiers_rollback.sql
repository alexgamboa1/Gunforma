-- Rollback for supabase/migrations/20261030013433_fitment_tiers.sql.
-- Run by hand only if the fitment-tier model has to come back out. The
-- deployed code probes for these columns, so dropping them returns every
-- page to the pre-tier behaviour on its next load (the Armory and catalog
-- fall back to js/frame-fit.js) — no code change needed first.
--
-- NOTE the two data restorations at the top: dropping the columns alone
-- would leave the FUSE guns on housing_class 'xmacro' (frame-fit's FUSE
-- exception would then never fire) and the two renames in place. The 365F
-- slug restoration also needs the netlify.toml 301 for the old path removed,
-- or the live product URL redirects to itself's successor; do both or
-- neither.

begin;

update public.guns
   set housing_class = 'fuse'
 where slug in ('p365-fuse', 'p365-fuse-comp') and housing_class = 'xmacro';

update public.products
   set name = 'Mischief Machine Commander G2 XMacro/Fuse Plus'
 where slug = 'mischief-machine-com-g2-fuse'
   and name = 'Mischief Machine Commander G2 Fuse Plus';

update public.product_variants v
   set slug = replace(v.slug, 'arc-division-reactor-365f-p365-fuse', 'arc-division-reactor-365f-p365-xmacro')
  from public.products p
 where p.id = v.product_id and p.slug = 'arc-division-reactor-365f-p365-fuse'
   and v.slug like 'arc-division-reactor-365f-p365-fuse%';

update public.products
   set slug = 'arc-division-reactor-365f-p365-xmacro'
 where slug = 'arc-division-reactor-365f-p365-fuse' and category = 'slide';

alter table public.guns
  drop column if exists grip_fit_tier,
  drop column if exists slide_fit_tier,
  drop column if exists slide_comp_style;
alter table public.compensator_specs
  drop column if exists fit_result;
alter table public.slide_specs
  drop column if exists fit_tier,
  drop column if exists comp_style,
  drop column if exists includes_barrel;
alter table public.frame_specs
  drop column if exists fit_tier;

drop type if exists public.comp_fit_result;
drop type if exists public.comp_style;
drop type if exists public.fit_tier;

commit;
