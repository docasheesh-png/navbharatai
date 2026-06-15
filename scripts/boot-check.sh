#!/usr/bin/env bash
# Boot smoke-check: bundle server.ts and confirm it starts cleanly (reaches the
# listen log) without a startup ReferenceError/resolve crash. This catches the
# class of bug where an undefined name inside a route registrar crashes the
# server on boot — which type-checking alone can miss for legacy `any` code.
set -uo pipefail

OUT_FILE="$(mktemp)"
# Bundle INSIDE the repo so `--packages=external` deps resolve from ./node_modules.
BUNDLE=".boot-check.cjs"
trap 'rm -f "$BUNDLE"' EXIT

echo "[boot-check] bundling server.ts ..."
npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile="$BUNDLE"

echo "[boot-check] booting (max 25s) ..."
# Run detached; the server listens and never exits, so we time-box it.
timeout 25 node "$BUNDLE" > "$OUT_FILE" 2>&1 &
PID=$!

ok=1
for _ in $(seq 1 25); do
  if grep -qE "Server running" "$OUT_FILE"; then ok=0; break; fi
  if grep -qE "ReferenceError|Could not resolve|is not defined|FATAL: Server failed" "$OUT_FILE"; then ok=2; break; fi
  sleep 1
done

kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true

echo "----- boot output (tail) -----"
tail -15 "$OUT_FILE" || true
echo "------------------------------"
rm -f "$BUNDLE"

if [ "$ok" -eq 0 ]; then
  echo "[boot-check] PASS — server reached 'Server running'."
  rm -f "$OUT_FILE"; exit 0
elif [ "$ok" -eq 2 ]; then
  echo "[boot-check] FAIL — startup crash detected."
  rm -f "$OUT_FILE"; exit 1
else
  echo "[boot-check] FAIL — server did not reach 'Server running' within timeout."
  rm -f "$OUT_FILE"; exit 1
fi
