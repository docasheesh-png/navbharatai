#!/usr/bin/env bash
# LOCAL CI — the same steps .github/workflows/ci.yml runs, in the same order, for when GitHub's CI is not available.
# Usage: scripts/localCi.sh [report-file]      Exit 0 only if EVERY step passed. Never edits code, never pushes.
# It does not trust its own list: every `run:` line in ci.yml must be covered below or be named as skipped, else it fails.
set -u
cd "$(dirname "$0")/.."
REPORT="${1:-${TMPDIR:-/tmp}/localci-report.txt}"
LOGDIR="$(dirname "$REPORT")/localci-logs"; mkdir -p "$LOGDIR"; : > "$REPORT"

# name | command | covers (the ci.yml run: line it stands for)
STEPS=(
  "audit-gate|npm run audit:gate|npm run audit:gate"
  "license-gate|npm run license:gate|npm run license:gate"
  "typecheck|npm run typecheck|npm run typecheck"
  "unused-imports|node scripts/noUnusedImports.mjs|node scripts/noUnusedImports.mjs"
  "native-guard|npm run native:guard|npm run native:guard"
  "typecheck-server|npm run typecheck:server|npm run typecheck:server"
  "typecheck-benchmark|npm run typecheck:benchmark|npm run typecheck:benchmark"
  "oauth-check|node --experimental-strip-types scripts/failedReportOAuth.check.mjs|node --experimental-strip-types scripts/failedReportOAuth.check.mjs"
  "mitrify|npm run test:mitrify|npm run test:mitrify"
  "answer-quality|node scripts/chatAnswerQuality.check.mjs|node scripts/chatAnswerQuality.check.mjs"
  "test-coverage|npm run test:coverage|npm run test:coverage"
  "build|npm run build|npm run build"
  "bundle-budget|npm run test:bundle|npm run test:bundle"
  "boot-check|npm run boot:check|npm run boot:check"
  "server-deps-gate|npm run deps:server-gate|npm run deps:server-gate"
)
# ci.yml steps that cannot or need not run here — each is NAMED in the report, never silently dropped.
SKIPPED_OK=(
  "npm install -g npm@11.18.0|changes the machine's npm, not the code"
  "npm ci|dependencies are already installed; run it yourself first on a fresh checkout"
  "npm audit signatures|informational in CI, never blocks"
  "npm run sbom|produces an artifact, checks nothing"
)

fail=0
echo "LOCAL CI $(date -u +%FT%TZ) — commit $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)" | tee -a "$REPORT"
git diff --quiet && git diff --cached --quiet || echo "WARNING: uncommitted changes — the result describes the working tree, not the commit" | tee -a "$REPORT"

# 1. does the list still match the workflow?
mapfile -t CI_RUNS < <(grep -E '^\s+run: ' .github/workflows/ci.yml | sed -E 's/^\s+run: //' | sed -E 's/\s+$//')
for r in "${CI_RUNS[@]}"; do
  [ -z "$r" ] || [ "$r" = "|" ] && continue   # a multi-line `run: |` block belongs to another job; its lines are not single commands
  known=0
  for s in "${STEPS[@]}"; do [ "${s##*|}" = "$r" ] && known=1; done
  for s in "${SKIPPED_OK[@]}"; do [ "${s%%|*}" = "$r" ] && known=1; done
  if [ $known -eq 0 ]; then echo "DRIFT: ci.yml runs '$r' and scripts/localCi.sh does not cover it — add it" | tee -a "$REPORT"; fail=1; fi
done

# 2. run every step; keep going after a failure so one run shows ALL the problems
for s in "${STEPS[@]}"; do
  IFS='|' read -r name cmd _ <<< "$s"
  start=$(date +%s)
  bash -c "$cmd" > "$LOGDIR/$name.log" 2>&1; code=$?
  secs=$(( $(date +%s) - start ))
  if [ $code -eq 0 ]; then echo "PASS  $name (${secs}s)" | tee -a "$REPORT"
  else echo "FAIL  $name (exit $code, ${secs}s) — log: $LOGDIR/$name.log" | tee -a "$REPORT"; fail=1; fi
done
# the suite can print failures and still exit 0 — read the Tests line, as CLAUDE.md says
if grep -qE '^\s+Tests .*[0-9]+ failed' "$LOGDIR/test-coverage.log" 2>/dev/null; then echo "FAIL  test-coverage printed failed tests despite its exit code" | tee -a "$REPORT"; fail=1; fi
echo "TESTS: $(grep -E '^\s+Tests ' "$LOGDIR/test-coverage.log" 2>/dev/null | tail -1)" | tee -a "$REPORT"
for s in "${SKIPPED_OK[@]}"; do echo "SKIPPED  ${s%%|*} — ${s##*|}" | tee -a "$REPORT"; done
[ $fail -eq 0 ] && echo "LOCAL CI: ALL GREEN" | tee -a "$REPORT" || echo "LOCAL CI: RED — fix, then run again" | tee -a "$REPORT"
exit $fail
