-- link_clicks_real: let a WebKit tap in, keep a scripted Chrome out.
--
-- WHAT WAS WRONG. The view added by 20261015150532_link_clicks_bot_columns
-- admitted a row only when sec_fetch was NULL or exactly navigate/?1. The
-- first real click from an iPhone (row 1869, 2026-10-15, Chrome on iOS)
-- arrived as navigate/ — Sec-Fetch-Mode present, Sec-Fetch-User absent —
-- and was excluded. WebKit never sends Sec-Fetch-User, so that rule left out
-- every iPhone, iPad and desktop Safari reader, and every iOS in-app browser
-- (Instagram, Facebook), which all run on WebKit. A view that drops most of
-- mobile is not the honest number it exists to be.
--
-- THE RULE NOW, three ways in:
--   sec_fetch is null                        an older browser sends nothing,
--                                            and its absence says nothing
--   sec_fetch = 'navigate/?1'                a user-activated navigation in
--                                            Chrome, Edge, Firefox, Samsung
--   sec_fetch = 'navigate/' and the user     WebKit: AppleWebKit in the user
--     agent is WebKit and not Chrome         agent and no "Chrome/" token
--                                            (Chrome on iOS says CriOS/, so
--                                            it passes; it is WebKit too)
-- NOT navigate/ on a Chrome user agent: a scripted Chrome — Puppeteer,
-- Playwright, a headless run wearing a real user agent — navigates without
-- user activation and sends exactly navigate/ with no ?1. That is the shape
-- of the sweep this table is being cleaned of, and it stays out.
--
-- The is_bot and five-targets-a-minute conditions are unchanged. Nothing is
-- rewritten: the rows are as go.js stored them, only the view's reading of
-- sec_fetch changes, and `create or replace` keeps the column list, so
-- grants on the view are kept.

create or replace view public.link_clicks_real with (security_invoker = true) as
  with per_minute as (
    select date_trunc('minute', ts) as minute,
           count(distinct coalesce(link_id, product_id)) as targets
      from public.link_clicks
     group by 1
  )
  select c.id, c.link_id, c.product_id, c.ts, c.referrer_path,
         c.user_agent, c.sec_fetch, c.is_bot
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
  'link_clicks rows a decision can rest on: is_bot = false (rows with is_bot NULL — everything before 2026-10-15 — are excluded, since their history cannot be cleaned); not in a minute holding clicks on five or more different targets, the shape of a link sweep; and sec_fetch NULL (an older browser sends nothing), navigate/?1 (a user-activated navigation in Chrome, Edge, Firefox), or navigate/ on a WebKit user agent with no Chrome/ token (Safari and every iOS browser — WebKit never sends Sec-Fetch-User). navigate/ on a Chrome user agent is a scripted browser and stays out. Report clicks from here, never from link_clicks. security_invoker: the caller needs SELECT on link_clicks, which only service_role holds.';

-- Read back (CLAUDE.md, "A green result is not evidence the work happened"):
--
--   select id, sec_fetch, left(user_agent, 40),
--          exists (select 1 from public.link_clicks_real r where r.id = c.id) as in_view
--     from public.link_clicks c where c.id in (1868, 1869, 1870);
--   -- 1868 (Chrome, navigate/?1) in; 1869 (CriOS, navigate/) in;
--   -- 1870 in. Proved in the PR's dry run with a fixture row carrying a
--   -- Chrome user agent and navigate/, which must be out.
--
--   select has_table_privilege('anon', 'public.link_clicks_real', 'select');  -- false
