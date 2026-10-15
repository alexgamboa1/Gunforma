-- link_clicks: tell a reader's click from a crawler's, going forward.
--
-- APPLY ONLY AFTER THE go.js THAT SENDS THESE COLUMNS IS LIVE (CLAUDE.md,
-- "Branches and PRs": code first, then migration). The edge function
-- tolerates both shapes — it sends the three fields and retries once without
-- them on PGRST204 — so the order costs nothing; the other order would cost
-- nothing either, which is not the point. The point is that it is the order.
--
-- WHY. Queried 2026-10-15: of 1,287 rows, 1,047 landed on 2026-10-12 with
-- referrer "/" on every one (a page with no /go/ links), 20–40 a minute for
-- hours, across 599 targets; 62 and 97 more on 10-09 and 10-10 were one
-- click per link, spread out — a slow sweep. Around 80 rows in the whole
-- table are plausibly people. Partnership decisions are made off this table,
-- and until now it stored nothing that could tell those apart: no user
-- agent, no fetch metadata. That is the defect; this is the fix for every
-- row from here on.
--
-- THE THREE COLUMNS, all nullable, no default, written by go.js through
-- netlify/edge-functions/_lib/go-bot.mjs:
--
--   user_agent  the User-Agent header, trimmed, at most 256 chars.
--   sec_fetch   Sec-Fetch-Mode "/" Sec-Fetch-User, e.g. navigate/?1 — what a
--               real click in a modern browser sends. Recorded, not judged.
--   is_bot      true when the user agent is missing or matches the bot
--               pattern in go-bot.mjs; false otherwise. A missing referrer
--               NEVER sets it (24 of the 36 real clicks on 2026-09-30 had
--               none; see the x-go-no-log comment in go.js).
--
-- NULL MEANS UNKNOWN, NOT HUMAN. Every row written before this file was
-- applied has all three NULL, and stays that way: nothing here rewrites or
-- deletes a row, and the known sweeps (10-09, 10-10, 10-12) are left in
-- place. Their history cannot be cleaned, and a view that pretended it could
-- would be the bug in a new place.
--
-- THE VIEW. link_clicks_real is the set of rows that can be stood behind:
-- is_bot = false (so NULL is out); not in a minute that holds clicks on
-- five or more different targets (coalesce(link_id, product_id)) — the shape
-- of the 10-12 burst, which no user-agent pattern can promise to catch next
-- time; and sec_fetch either absent or exactly navigate/?1. A Sec-Fetch
-- pair that is present but is not a user-activated top-level navigation
-- (no-cors/, same-origin/, navigate/ with no ?1) is a script, a prefetch or
-- a headless crawl wearing a browser's user agent, and is out. NULL stays
-- in: an older browser sends neither header, and its absence says nothing.
-- The slow sweeps are not caught by the minute rule and are not meant to
-- be; the pattern is what catches a tool, and before this file nothing
-- could. Report clicks from link_clicks_real, never from link_clicks.
--
-- SECURITY. link_clicks is RLS on, no policies, GRANT ALL to service_role
-- only — private by design, same as price_history. The view matches:
-- security_invoker, so a caller needs SELECT on the table itself, and every
-- grant revoked from anon and authenticated so the default ACL cannot hand
-- the public API a readable copy. It is for admins reading SQL and for the
-- service role, not for the site.

alter table public.link_clicks
  add column user_agent text,
  add column sec_fetch  text,
  add column is_bot     boolean;

comment on column public.link_clicks.user_agent is
  'The client''s User-Agent header, trimmed, at most 256 characters. NULL on rows written before 2026-10 (unknown) and when the client sent none.';
comment on column public.link_clicks.sec_fetch is
  'Sec-Fetch-Mode "/" Sec-Fetch-User as the client sent them (navigate/?1 is a real click in a modern browser). NULL when both were absent or the row predates the column.';
comment on column public.link_clicks.is_bot is
  'true: the user agent was missing or matched the bot pattern in netlify/edge-functions/_lib/go-bot.mjs. false: a reader as far as the user agent can say. NULL: written before the column existed — unknown, not human. A missing referrer never sets this.';

comment on table public.link_clicks is
  'Outbound click log. Written by the /go/ edge function as service_role. One row per click, on exactly one target: link_id for /go/<affiliate link> (a partner listing), product_id for /go/part/<product> (the part''s own products.url — a maker''s or seller''s store, unpaid). RLS on, no policies, no grants — private by design, same as price_history. No personal data: target id, timestamp, the on-site path the click came from, and since 2026-10 the client''s user agent, its Sec-Fetch pair and whether that user agent is a bot''s. Mostly bot traffic before 2026-10-15; read link_clicks_real, never this table, for a number a decision can rest on.';

create view public.link_clicks_real with (security_invoker = true) as
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
     and (c.sec_fetch is null or c.sec_fetch = 'navigate/?1');

comment on view public.link_clicks_real is
  'link_clicks rows a decision can rest on: is_bot = false (rows with is_bot NULL — everything before 2026-10 — are excluded, since their history cannot be cleaned); not in a minute holding clicks on five or more different targets, the shape of a link sweep; and sec_fetch either NULL (an older browser sends nothing, which says nothing) or exactly navigate/?1 — a Sec-Fetch pair that is present but not a user-activated navigation is a script, a prefetch or a headless crawl. Report clicks from here, never from link_clicks. security_invoker: the caller needs SELECT on link_clicks, which only service_role holds.';

revoke all on public.link_clicks_real from public, anon, authenticated;
grant select on public.link_clicks_real to service_role;

-- Read back (CLAUDE.md, "A green result is not evidence the work happened"):
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'link_clicks'
--      and column_name in ('user_agent', 'sec_fetch', 'is_bot');
--   -- three rows, all YES, all NULL default
--
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('link_clicks', 'link_clicks_real')
--    order by 1, 2;
--   -- service_role only, on both
--
--   begin; set local role anon;
--   select count(*) from public.link_clicks_real;   -- must fail: permission denied
--   rollback;
--
--   select count(*) filter (where is_bot is null) as unknown,
--          count(*) filter (where is_bot)         as bots,
--          count(*) filter (where not is_bot)     as readers
--     from public.link_clicks;
--   -- every pre-existing row under "unknown"; the first row with is_bot set
--   -- is the moment this went live: select min(ts) from public.link_clicks
--   -- where is_bot is not null.
