-- link_clicks: record which page and which block sent a click.
--
-- APPLY ONLY AFTER THE go.js THAT SENDS THESE COLUMNS IS LIVE (CLAUDE.md,
-- "Branches and PRs": code first, then migration) — the same order as
-- 20261015150532_link_clicks_bot_columns. The edge function tolerates both
-- states: it sends source/section only when the ?s=/&loc= params arrived,
-- and on PGRST204 retries without them, so no click is lost to the gap.
--
-- WHY. The Field Notes guide blocks (::picks, ::rank, ::compare, ::price)
-- append ?s=<article slug>&loc=<block kind> to their /go/ URLs. referrer_path
-- already says which PAGE a click came from when the browser sends a
-- referrer, but nothing says which BLOCK — and "the picks box on this guide
-- earned N clicks" is the number a maker-deal conversation runs on.
--
-- THE TWO COLUMNS, both nullable, no default, written by go.js on the
-- logged path only:
--
--   source   the ?s= value, cut to 128 characters — a field note's slug.
--            Only our own pages put the param on a link, but the value is
--            client-supplied text and is treated as such everywhere.
--   section  the ?loc= value, only when it is one of picks/rank/compare/
--            price (go.js whitelists; anything else is stored as NULL).
--
-- NULL MEANS "NOT A TRACKED BLOCK" — every product-page and build-page
-- click, and every row written before this file was applied. Nothing here
-- rewrites a row.
--
-- Report from link_clicks_real, never from link_clicks — unchanged. The
-- view is replaced to carry the two new columns through; `create or
-- replace` may only APPEND columns, which this does, and it keeps the
-- view's grants (service_role only, security_invoker).

alter table public.link_clicks
  add column source  text,
  add column section text;

comment on column public.link_clicks.source is
  'The ?s= param on the /go/ URL, cut to 128 characters by go.js: which page built the link (a Field Notes slug). NULL on every untracked click and on rows written before 2026-10-25.';
comment on column public.link_clicks.section is
  'The ?loc= param on the /go/ URL, whitelisted by go.js to picks/rank/compare/price: which Field Notes block sent the click. NULL on every untracked click and when the param was absent or not on the whitelist.';

create or replace view public.link_clicks_real with (security_invoker = true) as
  with per_minute as (
    select date_trunc('minute', ts) as minute,
           count(distinct coalesce(link_id, product_id)) as targets
      from public.link_clicks
     group by 1
  )
  select c.id, c.link_id, c.product_id, c.ts, c.referrer_path,
         c.user_agent, c.sec_fetch, c.is_bot,
         c.source, c.section
    from public.link_clicks c
    join per_minute m on m.minute = date_trunc('minute', c.ts)
   where c.is_bot = false
     and m.targets < 5
     and (
       c.sec_fetch is null
       or c.sec_fetch = 'navigate/?1'
       or (c.sec_fetch = 'navigate/'
           and c.user_agent like '%AppleWebKit%'
           and c.user_agent not like '%Chrome/%')
     );

comment on view public.link_clicks_real is
  'link_clicks rows a decision can rest on: is_bot = false (rows with is_bot NULL — everything before 2026-10-15 — are excluded, since their history cannot be cleaned); not in a minute holding clicks on five or more different targets, the shape of a link sweep; and sec_fetch NULL (an older browser sends nothing), navigate/?1 (a user-activated navigation in Chrome, Edge, Firefox), or navigate/ on a WebKit user agent with no Chrome/ token (Safari and every iOS browser — WebKit never sends Sec-Fetch-User). navigate/ on a Chrome user agent is a scripted browser and stays out. source/section identify the page and block that sent a tracked click (Field Notes guide blocks). Report clicks from here, never from link_clicks. security_invoker: the caller needs SELECT on link_clicks, which only service_role holds.';

-- Read back (CLAUDE.md, "A green result is not evidence the work happened"):
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'link_clicks'
--      and column_name in ('source', 'section');
--   -- two rows, both YES, both NULL default
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'link_clicks_real'
--    order by ordinal_position;
--   -- …, source, section as the last two
--
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'link_clicks_real';
--   -- service_role only — `create or replace` kept the grants
--
--   begin; set local role anon;
--   select count(*) from public.link_clicks_real;   -- must fail: permission denied
--   rollback;
--
--   -- then one real click from a field-note block:
--   select ts, source, section, left(user_agent, 40),
--          exists (select 1 from public.link_clicks_real r where r.id = c.id) as in_view
--     from public.link_clicks c order by ts desc limit 1;
