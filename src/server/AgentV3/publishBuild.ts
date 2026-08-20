// publishBuild.ts — why "Publish" showed a bare "exit status 2" for five days, and the class fix.
//
// ── THE REPORT (admin 2026-08-20) ────────────────────────────────────────────────────────────────
// "Your app did not build, so there was nothing to publish. Fix the build error and try again.
//  exit status 2" — and nothing else. The app previewed perfectly on the same screen.
//
// ── TWO ROOT CAUSES, ONE FAILURE ─────────────────────────────────────────────────────────────────
// 1. THE DIAGNOSTICS WERE LOST (the honesty bug). tsc prints every type error to STDOUT and exits 2
//    with an EMPTY stderr. The actuator's catch synthesized `stderr = err.message` ("exit status 2")
//    whenever real stderr was empty, and the route then showed `stderr || stdout` — so the synthesized
//    string DISPLACED the compiler's actual list of what to fix. Fixed in sandboxHealth.ts
//    (`thrownCommandOutput`) + `composeBuildFailureDetail` below, which reads BOTH channels because
//    compilers genuinely split across them (tsc → stdout; vite/npm → stderr).
// 2. PUBLISH WAS STRICTER THAN PREVIEW (the product bug). The scaffold's build script is
//    `tsc -p tsconfig.build.json && vite build`. The PREVIEW dev server transpiles with esbuild and
//    never typechecks — so an app can run flawlessly in the preview and still be UNPUBLISHABLE
//    because of a type-level warning that changes nothing at runtime. The user is then told their
//    working app "did not build". Publish must publish what the preview runs: when the build fails
//    and the script is a typecheck-gated bundler, `bundlerFallbackCommand` runs the bundler alone —
//    the SAME transpile the preview uses — and the publish succeeds with an HONEST warning naming the
//    type issues (never silently). The tsc gate stays untouched for the AGENT's build loop, where it
//    is what makes the model fix type errors during generation.

/** Lines kept from each output channel when composing a build-failure detail. */
const DETAIL_LINES_PER_CHANNEL = 12;

/**
 * Compose an honest build-failure detail from BOTH output channels. `stderr || stdout` is the bug
 * this replaces: whichever channel the compiler actually used was discarded whenever the other held
 * anything (even a synthesized one-liner). Order: stdout first (tsc's diagnostics), then stderr
 * (npm's lifecycle footer / vite's errors) — so the actionable part leads. PURE.
 */
export function composeBuildFailureDetail(stdout: string, stderr: string): string {
  const tail = (s: string) => s.trim().split('\n').slice(-DETAIL_LINES_PER_CHANNEL).join('\n').trim();
  const parts = [tail(stdout || ''), tail(stderr || '')].filter(Boolean);
  // Dedupe the degenerate case where both channels carry the identical single message.
  if (parts.length === 2 && parts[0] === parts[1]) parts.pop();
  return parts.join('\n');
}

/** A build-script segment that is a TYPECHECK, not a bundler: tsc / vue-tsc, optionally via npx. */
const TYPECHECK_GATE = /^(?:npx\s+(?:--no-install\s+)?)?(?:tsc|vue-tsc)(?:\s|$)/;

/**
 * When a project's `build` script is `<typecheck> && <bundler…>`, return the bundler part runnable on
 * its own (with the project's local .bin on PATH, which `npm run` normally provides), plus the gate
 * that was skipped — so the caller can retry the transpile the preview already runs and report the
 * skipped gate honestly. Returns null when the script has no such shape (then there is no safe
 * fallback and the original failure stands). PURE.
 */
export function bundlerFallbackCommand(packageJsonText: string): { command: string; gate: string } | null {
  let script = '';
  try {
    const pkg = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> };
    const s = pkg?.scripts?.build;
    script = typeof s === 'string' ? s.trim() : '';
  } catch {
    return null;
  }
  if (!script) return null;
  const parts = script.split('&&').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const gate = parts[0];
  if (!TYPECHECK_GATE.test(gate)) return null;
  const rest = parts.slice(1).join(' && ');
  // The remainder must be the bundler, not another typecheck wearing a different position.
  if (!rest || /\b(?:tsc|vue-tsc)\b/.test(rest)) return null;
  return { command: `PATH="$PWD/node_modules/.bin:$PATH" ${rest}`, gate };
}

/**
 * The honest user-facing note attached to a publish that succeeded via the bundler fallback.
 * Named here so the wording lives beside the mechanism it describes (and stays provider-anonymous).
 */
export const TYPECHECK_SKIPPED_WARNING =
  'Published exactly what your preview runs. Note: the code has type warnings that do not stop it ' +
  'from running — ask the AI to clean them up anytime.';
