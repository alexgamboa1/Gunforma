#!/usr/bin/env bash
# check-embeds.sh — fail on PostgREST embeds that will error at runtime.
#
# THE BUG THIS CATCHES
# `products` and `product_variants` reference EACH OTHER — one FK in each
# direction:
#   product_variants.product_id      -> products.id           (many-to-one)
#   products.lowest_price_variant_id -> product_variants.id   (one-to-many)
#
# Because there are two FKs between the same PAIR of tables, an embed between
# them is ambiguous in BOTH directions, and PostgREST rejects the ENTIRE query
# with PGRST201 — not just that column. Both directions must name the FK:
#
#   from products:          product_variants!product_variants_product_id_fkey(...)
#   from product_variants:  products!product_variants_product_id_fkey(...)
#
# This has shipped broken twice, both times silently: supabase-js returns an
# error object rather than throwing, so the page renders its generic
# "could not load" state and nothing surfaces as a hard failure.
#   - /parts/* product pages        (PR #9,  fixed in df1a6d6)
#   - profile Favorite Parts tab    (PR #16)
#
# WHAT IS DELIBERATELY NOT FLAGGED
# Direction 1 (bare `product_variants(...)`): only embeds off `products` are
# ambiguous. These parents have exactly one FK to product_variants, so their
# bare embeds are correct — naming a non-existent FK would break working
# queries:
#   affiliate_links  -> affiliate_links_variant_id_fkey
#   variant_images   -> variant_images_variant_id_fkey
#
# Direction 2 (bare `products(...)`): only embeds off `product_variants` are
# flagged. A bare `products(...)` embed is FINE from single-FK parents such as
# part_favorites and product_platforms. Note that several spec tables
# (barrel_specs, compensator_specs, frame_specs, light_specs, optic_specs,
# slide_specs, trigger_specs, magwell_frame_requirements) carry TWO OR MORE FKs
# to products and are ambiguous too — out of scope here because nothing embeds
# through them today. Re-check against the live schema with:
#   select src.relname, tgt.relname, c.conname from pg_constraint c
#   join pg_class src on src.oid = c.conrelid
#   join pg_class tgt on tgt.oid = c.confrelid
#   where c.contype = 'f' and tgt.relname in ('products','product_variants')
#   order by tgt.relname, src.relname;
#
# HOW THE PARENT IS DETERMINED — AND WHY THE TWO DIRECTIONS DIFFER
# Queries are commonly built across several lines, so the parent table name
# often sits on an earlier line than the embed.
#
#   Direction 1 scans a small window of preceding lines for a KNOWN-SAFE parent
#   and flags anything it cannot positively clear. Unknown parent => flag. A
#   false alarm is cheap; a silent 400 in production is not.
#
#   Direction 2 cannot use that default: `products(` is common and mostly
#   legitimate, so "flag unless cleared" would fire constantly. It instead
#   resolves the NEAREST preceding parent declaration — the supabase-js
#   .from('table') form, or the REST `table?col=` form used by the
#   dependency-free Netlify functions and scripts — and flags only when that
#   parent is positively product_variants, within the window. Unknown or stale
#   parent => allow.
#
# Usage: scripts/check-embeds.sh    exit 0 = clean, 1 = problems found
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

WINDOW=6
SAFE_PARENTS='affiliate_links|variant_images'
AMBIGUOUS_PARENT='product_variants'

files=$(find . \
  \( -name '*.html' -o -name '*.js' -o -name '*.mjs' \) \
  -not -path './_scratch/*' \
  -not -path './.netlify/*' \
  -not -path './node_modules/*' \
  -not -path './.git/*' \
  -type f)

# ── Direction 1: bare product_variants(...) hanging off products ────────────
matches_pv=$(printf '%s\n' "$files" | while IFS= read -r f; do
  [ -n "$f" ] || continue
  awk -v FNAME="$f" -v W="$WINDOW" -v SAFE="$SAFE_PARENTS" '
    {
      line[NR] = $0
      if ($0 ~ /[^!_]product_variants\(/) {
        if ($0 ~ /^[[:space:]]*(\/\/|\*|<!--)/) next
        safe = 0
        start = NR - W; if (start < 1) start = 1
        for (i = start; i <= NR; i++) if (line[i] ~ SAFE) safe = 1
        if (!safe) printf "%s:%d:%s\n", FNAME, NR, $0
      }
    }
  ' "$f"
done)

# ── Direction 2: bare products(...) hanging off product_variants ────────────
# \047 = single quote, \042 = double quote — written as octal escapes so this
# awk program contains no literal quote characters of its own.
matches_p=$(printf '%s\n' "$files" | while IFS= read -r f; do
  [ -n "$f" ] || continue
  awk -v FNAME="$f" -v W="$WINDOW" -v AMBIG="$AMBIGUOUS_PARENT" '
    {
      # nearest parent, supabase-js form:  .from(table)
      s = $0
      while (match(s, "from\\([\047\042][a-z_]+[\047\042]\\)")) {
        tok = substr(s, RSTART, RLENGTH)
        lastParent = substr(tok, 7, length(tok) - 8)
        lastParentLine = NR
        s = substr(s, RSTART + RLENGTH)
      }
      # nearest parent, REST form:  table?col=
      s = $0
      while (match(s, "[/\047\042][a-z_]+\\?[a-z_]+=")) {
        tok = substr(s, RSTART, RLENGTH)
        q = index(tok, "?")
        lastParent = substr(tok, 2, q - 2)
        lastParentLine = NR
        s = substr(s, RSTART + RLENGTH)
      }

      if ($0 ~ /[^!_a-zA-Z]products\(/) {
        if ($0 ~ /^[[:space:]]*(\/\/|\*|<!--)/) next
        if (lastParent == AMBIG && lastParentLine > 0 && (NR - lastParentLine) <= W)
          printf "%s:%d:%s\n", FNAME, NR, $0
      }
    }
  ' "$f"
done)

status=0

if [ -n "$matches_pv" ]; then
  echo "error: bare product_variants(...) embed — PostgREST rejects the whole query with PGRST201."
  echo "       Use product_variants!product_variants_product_id_fkey(...) instead."
  echo
  echo "$matches_pv" | sed 's/^/  /'
  echo
  status=1
fi

if [ -n "$matches_p" ]; then
  echo "error: bare products(...) embed off product_variants — same PGRST201, other direction."
  echo "       Use products!product_variants_product_id_fkey(...) instead."
  echo
  echo "$matches_p" | sed 's/^/  /'
  echo
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "ok: no ambiguous products <-> product_variants embeds (both directions checked)"
fi

exit "$status"
