-- The new Armory's reference data (phase 1, Alex's 2026-11-10/11 sign-off):
--
--   1. guns.armory_blurb — the approved one-paragraph description on each
--      "What are you starting with?" card. Copy is Alex's, verbatim; the
--      facts line beside it is rendered from the row's own columns.
--   2. gun_stock_parts — the factory part each model ships with, WHERE that
--      part exists as a catalog product. One row per (gun, category).
--      Seeded only with what is certain today: the four SIG OEM grip
--      modules, looked up by slug. The AXG models get no row (their alloy
--      module is not a catalog product), and no slides or barrels are
--      seeded (none are catalog products). The Armory's magwell check runs
--      against these rows for a stock grip; a model with no row renders
--      magwell fit as "unconfirmed", never a guess.
--
-- The page deploys BEFORE this is applied and tolerates both shapes: no
-- armory_blurb column -> facts line only; no gun_stock_parts -> stock-grip
-- magwell checks read unconfirmed. (House rule: code first, migration after
-- it is live.)

alter table public.guns add column if not exists armory_blurb text;

update public.guns set armory_blurb = v.blurb
from (values
  ('p365',             'The original micro-compact. 3.1" slide and 3.1" barrel on the short P365 grip module, with 10-round magazines.'),
  ('p365-x',           'The short 3.1" slide and 3.1" barrel on the longer X/XL grip module, with 12-round magazines.'),
  ('p365-xl',          '3.7" slide and 3.7" barrel on the X/XL grip module, with 12-round magazines. No comp.'),
  ('p365-xl-rose-comp', '3.7" slide with an integrated, internally ported comp over a 3.1" barrel, on the X/XL grip module with 12-round magazines. Matte rose gold colored controls.'),
  ('p365-xmacro',      '3.7" slide and 3.7" barrel on the XMacro grip module. Takes 17-round magazines.'),
  ('p365-xmacro-comp', '3.7" slide with an integrated comp over a 3.1" barrel, on the XMacro grip module with 17-round magazines.'),
  ('p365-axg',         '3.7" slide with an integrated comp over a 3.1" barrel, on an alloy AXG grip module (XMacro size), with 17-round magazines.'),
  ('p365-xf-dh3',      'Full-length 4.3" slide with an integrated comp over a 3.7" barrel, on a coyote polymer XMacro grip module, with 17-round magazines.'),
  ('p365-xf-dh3-axg',  'The XF DH3''s 4.3" comp slide and 3.7" barrel on an alloy AXG grip module (XMacro size), with 17-round magazines.'),
  ('p365-fuse',        'The longest slide and barrel in the family: 4.3" and 4.3", no comp. XMacro-length factory grip module. Comes with a 21-round magazine, and also fits 17-round magazines.'),
  ('p365-fuse-comp',   '4.3" slide with an integrated comp over a 3.7" barrel, on an XMacro-length factory grip module. Comes with a 21-round magazine, and also fits 17-round magazines.')
) as v(slug, blurb)
where guns.slug = v.slug;

-- ── gun_stock_parts ────────────────────────────────────────────────────────
create table if not exists public.gun_stock_parts (
  gun_id     uuid not null references public.guns(id) on delete cascade,
  category   public.product_category not null,
  product_id uuid not null references public.products(id),
  primary key (gun_id, category)
);

-- RLS on, every default grant revoked, then exactly what the policy needs
-- added back (CLAUDE.md, "Every new public table needs RLS AND an explicit
-- revoke" — Supabase's default ACL grants anon and authenticated full
-- privileges on every new public table).
alter table public.gun_stock_parts enable row level security;
revoke all on public.gun_stock_parts from anon, authenticated;
grant select on public.gun_stock_parts to anon, authenticated;

drop policy if exists "Stock parts are public reference data" on public.gun_stock_parts;
create policy "Stock parts are public reference data"
  on public.gun_stock_parts for select
  to anon, authenticated
  using (true);

-- Seed: the factory grip module per model, by slug. A missing product slug
-- inserts nothing for that model (strict join), which is the tolerant shape:
-- the page reads an absent row as "unconfirmed".
insert into public.gun_stock_parts (gun_id, category, product_id)
select g.id, 'frame'::public.product_category, p.id
from (values
  ('p365',              'sig-sauer-p365-gm-oem'),
  ('p365-x',            'sig-sauer-p365-xl-gm-oem'),
  ('p365-xl',           'sig-sauer-p365-xl-gm-oem'),
  ('p365-xl-rose-comp', 'sig-sauer-p365-xl-gm-oem'),
  ('p365-xmacro',       'sig-sauer-p365-xmacro-gm-oem'),
  ('p365-xmacro-comp',  'sig-sauer-p365-xmacro-gm-oem'),
  ('p365-xf-dh3',       'sig-sauer-p365-xmacro-gm-oem'),
  ('p365-fuse',         'sig-sauer-p365-fuse-xmacro-gm-oem'),
  ('p365-fuse-comp',    'sig-sauer-p365-fuse-xmacro-gm-oem')
) as v(gun_slug, product_slug)
join public.guns g on g.slug = v.gun_slug
join public.products p on p.slug = v.product_slug
on conflict (gun_id, category) do nothing;
