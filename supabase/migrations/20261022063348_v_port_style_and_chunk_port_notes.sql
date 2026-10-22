-- port_styles: add 'v-port' ("V-Port"), and correct chunk-port's notes.
--
-- Fdez Werx's XL 3.0 V-Ported 3.7" barrel is cut with a V-shaped port
-- pattern, which none of the existing styles describe. This adds it.
--
-- chunk-port's notes, written by 20261021183501, describe it as "paired
-- with a top-and-chunk ported barrel (Fdez Werx 365RS)". 20261022033703
-- (same PR) split top-and-chunk out as its own style, and the only part
-- that is chunk-only is Fdez's Chunk Port 4.3" barrel, so the old note now
-- describes the other style. This rewrites that one row's notes and
-- nothing else: not its display_name, not its sort_order, not any other
-- row.
--
-- Nothing in the front end lists port styles by hand. The add-a-part page
-- reads this table for its dropdown, and product-page.mjs reads
-- display_name through the port_style foreign key, so "V-Port" appears with
-- no code change. The notes are not rendered anywhere.
--
-- Same shape as 20261022033703. Fresh database: the table is empty when
-- migrations run, because supabase/seed.sql loads the vocabularies
-- afterwards and already carries both the v-port row and the new chunk-port
-- notes, so an empty table is a NOTICE in each block, not a write.
--
-- Idempotent, and refuses rather than overwrites:
--   v-port      a row already holding exactly these values is a NOTICE; one
--               holding different values raises; anything other than exactly
--               one inserted row raises.
--   chunk-port  notes already equal to the new text is a NOTICE; notes equal
--               to the old text are updated; any other notes, or no
--               chunk-port row at all, raise; anything other than exactly one
--               updated row raises.

do $$
declare
  n_table    integer;
  n_existing integer;
  n_inserted integer;
begin
  select count(*) into n_table from public.port_styles;

  if n_table = 0 then
    raise notice 'port_styles is empty (fresh database): nothing to insert, seed.sql carries v-port';
    return;
  end if;

  select count(*) into n_existing
    from public.port_styles
   where port_style = 'v-port';

  if n_existing = 1 then
    if exists (
      select 1 from public.port_styles
       where port_style   = 'v-port'
         and display_name = 'V-Port'
         and sort_order   = 60
         and notes        = 'V-shaped port pattern (Fdez Werx XL 3.0 V-Ported 3.7" barrel). Fit is set by barrel locks, not this label.'
    ) then
      raise notice 'port_styles: v-port already present with the expected values, nothing to do';
      return;
    end if;
    raise exception 'port_styles already holds a v-port row with different values; refusing to overwrite it';
  end if;

  insert into public.port_styles (port_style, display_name, sort_order, notes)
  values ('v-port', 'V-Port', 60,
          'V-shaped port pattern (Fdez Werx XL 3.0 V-Ported 3.7" barrel). Fit is set by barrel locks, not this label.');

  get diagnostics n_inserted = row_count;
  if n_inserted <> 1 then
    raise exception 'expected to insert exactly 1 port_styles row, inserted %', n_inserted;
  end if;

  raise notice 'port_styles: v-port inserted (% rows before, % after)', n_table, n_table + 1;
end $$;

do $$
declare
  old_notes  constant text := 'Large single cut at the front of the slide top, paired with a top-and-chunk ported barrel (Fdez Werx 365RS).';
  new_notes  constant text := 'Chunk port only, no top port (Fdez Werx Chunk Port 4.3" barrel).';
  n_table    integer;
  n_row      integer;
  cur_notes  text;
  n_updated  integer;
begin
  select count(*) into n_table from public.port_styles;

  if n_table = 0 then
    raise notice 'port_styles is empty (fresh database): nothing to update, seed.sql carries the new chunk-port notes';
    return;
  end if;

  select count(*), max(notes) into n_row, cur_notes
    from public.port_styles
   where port_style = 'chunk-port';

  if n_row = 0 then
    raise exception 'port_styles has no chunk-port row to update; 20261021183501 should have inserted it';
  end if;

  if cur_notes is not distinct from new_notes then
    raise notice 'port_styles: chunk-port notes already updated, nothing to do';
    return;
  end if;

  if cur_notes is distinct from old_notes then
    raise exception 'port_styles chunk-port notes are neither the original nor the new text (found: %); refusing to overwrite them', cur_notes;
  end if;

  update public.port_styles
     set notes = new_notes
   where port_style = 'chunk-port'
     and notes = old_notes;

  get diagnostics n_updated = row_count;
  if n_updated <> 1 then
    raise exception 'expected to update exactly 1 port_styles row, updated %', n_updated;
  end if;

  raise notice 'port_styles: chunk-port notes updated';
end $$;
