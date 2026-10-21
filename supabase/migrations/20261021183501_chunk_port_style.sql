-- port_styles: add 'chunk-port' ("Chunk Port").
--
-- Fdez Werx's 365RS P365 FUSE slide and its two matching barrels use a
-- chunk-port cut: one large cut at the front of the slide top, paired with
-- a top-and-chunk ported barrel. Until now the vocabulary held only c-port,
-- e-port and slide-matched, so create_product() refused the slide on
-- slide_specs_port_style_fk. Filing it as c-port would have grouped it with
-- Norsso's C-Port parts, which it is not.
--
-- One row, inserted. No other row in port_styles or anywhere else is
-- touched, and no product is added here: the slide and barrels go in
-- through create_product() once this is live.
--
-- Nothing in the front end lists port styles by hand. The add-a-part page
-- reads this table for its dropdown, and product-page.mjs reads display_name
-- through the port_style foreign key (same PR), so the new row shows as
-- "Chunk Port" with no further change.
--
-- Fresh database: the table is empty when migrations run, because
-- supabase/seed.sql loads the vocabularies afterwards and already carries
-- this row. An empty table is a NOTICE, not an insert, so the seed's plain
-- INSERT does not collide with it.
--
-- Idempotent: a chunk-port row that already holds exactly these values is
-- a NOTICE. One that holds different values raises rather than being
-- overwritten. Anything other than exactly one inserted row raises.

do $$
declare
  n_table    integer;
  n_existing integer;
  n_inserted integer;
begin
  select count(*) into n_table from public.port_styles;

  if n_table = 0 then
    raise notice 'port_styles is empty (fresh database): nothing to insert, seed.sql carries chunk-port';
    return;
  end if;

  select count(*) into n_existing
    from public.port_styles
   where port_style = 'chunk-port';

  if n_existing = 1 then
    if exists (
      select 1 from public.port_styles
       where port_style   = 'chunk-port'
         and display_name = 'Chunk Port'
         and sort_order   = 40
         and notes        = 'Large single cut at the front of the slide top, paired with a top-and-chunk ported barrel (Fdez Werx 365RS).'
    ) then
      raise notice 'port_styles: chunk-port already present with the expected values, nothing to do';
      return;
    end if;
    raise exception 'port_styles already holds a chunk-port row with different values; refusing to overwrite it';
  end if;

  insert into public.port_styles (port_style, display_name, sort_order, notes)
  values ('chunk-port', 'Chunk Port', 40,
          'Large single cut at the front of the slide top, paired with a top-and-chunk ported barrel (Fdez Werx 365RS).');

  get diagnostics n_inserted = row_count;
  if n_inserted <> 1 then
    raise exception 'expected to insert exactly 1 port_styles row, inserted %', n_inserted;
  end if;

  raise notice 'port_styles: chunk-port inserted (% rows before, % after)', n_table, n_table + 1;
end $$;
