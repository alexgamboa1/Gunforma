#!/usr/bin/env bash
# check-embeds.sh — fail on PostgREST embeds that will error at runtime.
#
# THE BUG THIS CATCHES
# `products` has two relationships to `product_variants`:
#   product_variants.product_id      -> products.id           (one-to-many)
#   products.lowest_price_variant_id -> product_variants.id   (many-to-one)
#
# A bare `product_variants(...)` embed hanging off `products` is therefore
# ambiguous, and PostgREST rejects the ENTIRE query with PGRST201 — not just
# that column. Always name the FK:
#
#   product_variants!product_variants_product_id_fkey(...)
#
# This has shipped broken twice, both times silently: supabase-js returns an
# error object rather than throwing, so the page renders its generic
# "could not load" state and nothing surfaces as a hard failure.
#   - /parts/* product pages        (PR #9,  fixed in df1a6d6)
#   - profile Favorite Parts tab    (this fix)
#
# WHAT IS DELIBERATELY NOT FLAGGED
# Only embeds off `products` are ambiguous. These parents have exactly one FK
# to product_variants, so their bare embeds are correct — naming a
# non-existent FK would break working queries:
#   affiliate_links  -> affiliate_links_variant_id_fkey
#   variant_images   -> variant_images_variant_id_fkey
# Re-check against the live schema with:
#   select src.relname, c.conname from pg_constraint c
#   join pg_class src on src.oid = c.conrelid
#   join pg_class tgt on tgt.oid = c.confrelid
#   where c.contype = 'f' and tgt.relname = 'product_variants';
#
# HOW THE PARENT IS DETERMINED
# Queries are commonly built across several lines, so the parent table name
# often sits on an earlier line than the embed (this is exactly the case in
# scripts/refresh-affiliate-prices.mjs). The check therefore looks back over
# a small window of preceding lines for a known-safe parent. Anything it
# cannot positively identify as safe is flagged — a false alarm is cheap, a
# silent 400 in production is not.
#
# Usage: scripts/check-embeds.sh    exit 0 = clean, 1 = problems found
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

WINDOW=6
SAFE_PARENTS='affiliate_links|variant_images'

files=$(find . \
  \( -name '*.html' -o -name '*.js' -o -name '*.mjs' \) \
  -not -path './_scratch/*' \
  -not -path './.netlify/*' \
  -not -path './node_modules/*' \
  -not -path './.git/*' \
  -type f)

matches=$(printf '%s\n' "$files" | while IFS= read -r f; do
  [ -n "$f" ] || continue
  awk -v FNAME="$f" -v W="$WINDOW" -v SAFE="$SAFE_PARENTS" '
    {
      line[NR] = $0
      if ($0 ~ /[^!_]product_variants\(/) {
        # Skip comment lines (// , * , <!--).
        if ($0 ~ /^[[:space:]]*(\/\/|\*|<!--)/) next
        # Look back over the window for a known-safe parent table.
        safe = 0
        start = NR - W; if (start < 1) start = 1
        for (i = start; i <= NR; i++) if (line[i] ~ SAFE) safe = 1
        if (!safe) printf "%s:%d:%s\n", FNAME, NR, $0
      }
    }
  ' "$f"
done)

if [ -n "$matches" ]; then
  echo "error: bare product_variants(...) embed — PostgREST rejects the whole query with PGRST201."
  echo "       Use product_variants!product_variants_product_id_fkey(...) instead."
  echo
  echo "$matches" | sed 's/^/  /'
  exit 1
fi

echo "ok: no bare product_variants(...) embeds off products"
exit 0
