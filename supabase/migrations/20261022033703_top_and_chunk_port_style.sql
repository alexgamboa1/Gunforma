-- port_styles: add 'top-and-chunk' ("Top & Chunk").
--
-- Fdez Werx's three P365 FUSE slides (365RS, FUSE, ACCS) and their "Top &
-- Chunk Ported" barrel are cut with a top port plus a chunk port. Only
-- Fdez's separate "Chunk Port" barrel is chunk-only. 20261021183501 added
-- 'chunk-port', and all five parts were saved under it, which is right for
-- one of them. This adds the style the other four need.
--
-- One row, inserted. No other row in port_styles or anywhere else is
-- touched. The four parts move to top-and-chunk through the add-part
-- workflow once this is live, not here.
--
-- Nothing in the front end lists port styles by hand. The add-a-part page
-- reads this table for its dropdown, and product-page.mjs reads
-- display_name through the port_style foreign key, so the new row shows as
-- "Top & Chunk" with no code change.
--
-- Same shape as 20261021183501. Fresh database: the table is empty when
-- migrations run, because supabase/seed.sql loads the vocabularies
-- afterwards and already carries this row, so an empty table is a NOTICE,
-- not an insert, and the seed's plain INSERT does not collide with it.
--
-- Idempotent: a top-and-chunk row that already holds exactly these values
-- is a NOTICE. One that holds different values raises rather than being
-- overwritten. Anything other than exactly one inserted row raises.

do $$
declare
  n_table    integer;
  n_existing integer;
  n_inserted integer;
begin
  select count(*) into n_table from public.port_styles;

  if n_table = 0 then
    raise notice 'port_styles is empty (fresh database): nothing to insert, seed.sql carries top-and-chunk';
    return;
  end if;

  select count(*) into n_existing
    from public.port_styles
   where port_style = 'top-and-chunk';

  if n_existing = 1 then
    if exists (
      select 1 from public.port_styles
       where port_style   = 'top-and-chunk'
         and display_name = 'Top & Chunk'
         and sort_order   = 50
         and notes        = 'Top port plus a chunk port (Fdez Werx FUSE slides and their Top & Chunk ported barrel).'
    ) then
      raise notice 'port_styles: top-and-chunk already present with the expected values, nothing to do';
      return;
    end if;
    raise exception 'port_styles already holds a top-and-chunk row with different values; refusing to overwrite it';
  end if;

  insert into public.port_styles (port_style, display_name, sort_order, notes)
  values ('top-and-chunk', 'Top & Chunk', 50,
          'Top port plus a chunk port (Fdez Werx FUSE slides and their Top & Chunk ported barrel).');

  get diagnostics n_inserted = row_count;
  if n_inserted <> 1 then
    raise exception 'expected to insert exactly 1 port_styles row, inserted %', n_inserted;
  end if;

  raise notice 'port_styles: top-and-chunk inserted (% rows before, % after)', n_table, n_table + 1;
end $$;
