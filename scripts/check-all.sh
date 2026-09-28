#!/usr/bin/env bash
# check-all.sh — every build-time guard, run on every deploy.
#
# This is the Netlify build command. publish = "." means there is no compile
# step, so the build's only job is to refuse to ship a broken tree. Anything
# here that exits non-zero fails the deploy.
#
# WHY A RUNNER AND NOT A LONGER BUILD COMMAND
# Three checks existed and one ran. check-embeds.sh was the build command, so
# it was the only guard with any teeth; build-url.test.mjs passed on a laptop
# and nowhere else, and the canonical coupling had no check at all. Chaining
# commands with && in netlify.toml would have made the second failure hide the
# third, and every new guard would mean editing deploy config.
#
# ADDING A CHECK IS ONE LINE. Write scripts/check-<thing>.{sh,mjs} or
# scripts/<thing>.test.mjs, then add one `check` line below. If you forget
# that line, the audit at the bottom fails the build and tells you — a check
# file that exists and does not run is the exact bug this script was written
# to end, and it is not allowed to happen again quietly.
#
# ALL CHECKS RUN, ALWAYS. No early exit: one deploy should surface every
# problem, not the first one.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

FAILED=()
PASSED=()

# check <label> <file> [args…]
check() {
  local label="$1"; shift
  local file="$1"; shift
  RUN_FILES+=("$file")
  printf '\n\033[1m── %s\033[0m  (%s)\n' "$label" "$file"
  if [ ! -f "$file" ]; then
    echo "error: $file does not exist"
    FAILED+=("$label (missing: $file)")
    return
  fi
  case "$file" in
    # node --test, not `node file`: the runner flag is what makes a failing
    # assertion set a non-zero exit code. Running the file plainly reports
    # failures to stdout and can still exit 0, which would let this script
    # pass a broken check — the exact shape it exists to catch.
    *.test.mjs) node --test "$file" "$@" ;;
    *.sh)       bash "$file" "$@" ;;
    *.mjs)      node "$file" "$@" ;;
    *)          echo "error: don't know how to run $file"; FAILED+=("$label (unrunnable)"); return ;;
  esac
  if [ $? -eq 0 ]; then PASSED+=("$label"); else FAILED+=("$label"); fi
}

RUN_FILES=()

# ── the registry ───────────────────────────────────────────────────────────
check "PostgREST embed ambiguity"  scripts/check-embeds.sh
check "build URL copies agree"     scripts/build-url.test.mjs
check "build-og page literals"     scripts/check-canonical-coupling.mjs

# ── files that look like checks but deliberately are not build checks ──────
# Each needs a reason. Anything discovered below that is in neither this list
# nor the registry above fails the build.
NOT_BUILD_CHECKS=(
  # This runner. It is what does the running.
  scripts/check-all.sh

  # Needs a live origin to fetch. The site is not serving during its own
  # build, and fetching the previous deploy would grade the wrong artifact.
  # It runs from .github/workflows/check-routes.yml — on a schedule against
  # production, and on demand against a deploy-preview URL before merging.
  scripts/check-routes.mjs
  # Imports refresh-affiliate-prices.mjs, which needs csv-parse from
  # scripts/package.json. Nothing installs that during the site build, so it
  # would fail for the wrong reason. It runs in
  # .github/workflows/refresh-affiliate-prices.yml before the nightly sync,
  # which is where its dependency actually exists.
  scripts/gtin-norm.test.mjs
)

# ── the audit: a check file that is not registered fails the build ─────────
UNREGISTERED=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  for known in "${RUN_FILES[@]}" "${NOT_BUILD_CHECKS[@]}"; do
    [ "$f" = "$known" ] && continue 2
  done
  UNREGISTERED+=("$f")
done < <(find scripts -maxdepth 1 \( -name 'check-*.sh' -o -name 'check-*.mjs' -o -name '*.test.mjs' \) | sort)

printf '\n\033[1m── registry audit\033[0m\n'
if [ ${#UNREGISTERED[@]} -gt 0 ]; then
  echo "error: these look like checks but nothing runs them:"
  printf '         %s\n' "${UNREGISTERED[@]}"
  echo
  echo "       Add a \`check\` line for each in scripts/check-all.sh, or list it"
  echo "       under NOT_BUILD_CHECKS with the reason it is excluded."
  FAILED+=("registry audit")
else
  echo "ok: every check-*.{sh,mjs} and *.test.mjs in scripts/ is either registered or explicitly excluded"
fi

# ── summary ────────────────────────────────────────────────────────────────
printf '\n\033[1m── summary\033[0m\n'
for p in ${PASSED+"${PASSED[@]}"}; do echo "  pass  $p"; done
for f in ${FAILED+"${FAILED[@]}"}; do echo "  FAIL  $f"; done

if [ ${#FAILED[@]} -gt 0 ]; then
  printf '\n%s check(s) failed — deploy refused.\n' "${#FAILED[@]}"
  exit 1
fi
printf '\nall %s checks passed.\n' "${#PASSED[@]}"
