-- products.is_approved: a PostgREST computed field, true when
-- product_data_status() says the product is approved.
--
-- Why. The barrel/slide fit sections on product pages (product-page.mjs,
-- same PR) list only approved parts, and approval exists nowhere a public
-- page can read: there is no column, and product_data_status() is not
-- executable by anon on purpose, because its `missing` and
-- `optional_blank` lists are the admin's work queue. This exposes the one
-- boolean and nothing else. Which parts are unfinished is not a secret: an
-- unapproved part's own product page is public today.
--
-- A function taking the table's row type is a computed field: PostgREST
-- lets a query select it like a column, embedded too —
-- `products!…_fkey(id,slug,is_approved)` — so the fit section stays one
-- query per page. It is not part of `select=*`.
--
-- SECURITY DEFINER with a pinned, empty search_path, because the caller
-- (anon) cannot execute product_data_status(). It identifies no caller and
-- grants nothing back: the only input is the row PostgREST already let the
-- caller read, and the only output is a boolean. STABLE, like the function
-- it wraps.
--
-- Code first: product-page.mjs names is_approved in its fit query, which
-- fails (and renders no fit section, x-fit-section: failed) until this file
-- is applied. The rest of the page does not read it.

create or replace function public.is_approved(p public.products)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.product_data_status(p.id) ->> 'approved')::boolean, false);
$$;

comment on function public.is_approved(public.products) is
  'Computed field products.is_approved: product_data_status(id)->approved, and nothing else from it. Read by the barrel/slide fit sections on product pages.';

revoke all on function public.is_approved(public.products) from public;
grant execute on function public.is_approved(public.products) to anon, authenticated, service_role;
