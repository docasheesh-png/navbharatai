// Robust in-sandbox TypeScript typecheck command builder.
//
// ROOT CAUSE (build report 2026-07-21, a "border-border / tailwind color" edit turn): the engine and the
// agent both typechecked with `npx --no-install tsc`. When `typescript` is NOT locally installed, npx looks
// for a package literally named `tsc`, finds only the ANCIENT unrelated squatter `tsc@2.0.4` (which just
// prints a HELP page, does no typechecking), and — with `--no-install` — CANCELS without ever compiling.
// Even a bare `npx tsc` AFTER installing typescript can resolve to the cached `tsc@2.0.4` help page. That
// build burned 5 tool calls + a 53s install flailing ("यह अजीब है, help message दे रहा है") before it
// stumbled onto the DEFINITIVE form: the direct local binary `./node_modules/.bin/tsc`.
//
// This centralizes the robust invocation so EVERY site (health-check gate, endgame re-verify, and the
// agent's own `runTsc` tool) is immune to the footgun:
//   1. ENSURE the compiler exists — `npm install` if node_modules is missing/stale, then install
//      `typescript` (with `--no-save`, so package.json is untouched) ONLY if the local `tsc` binary is
//      genuinely absent.
//   2. RUN the LOCAL BINARY directly (`node_modules/.bin/tsc`) — never `npx tsc`, which can hit the squatter.

/** Shell prefix that guarantees a runnable local `tsc` binary exists (installs typescript if genuinely absent). */
export const TSC_ENSURE =
  'if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then npm install >/dev/null 2>&1; fi; ' +
  'if [ ! -x node_modules/.bin/tsc ]; then npm install typescript --no-save >/dev/null 2>&1; fi';

/**
 * The DEFINITIVE tsc invocation: the local binary directly. NEVER `npx tsc` — even `npx --no-install tsc`
 * fails to typecheck (it cancels) when typescript is absent, and bare `npx tsc` can run the `tsc@2.0.4`
 * squatter's help page.
 */
export const TSC_BIN = 'node_modules/.bin/tsc';

/**
 * Build a full robust typecheck command: ensure the compiler, then run the local binary with the given
 * args and optional trailing redirect/pipe. Pure — returns the shell string, runs nothing.
 *
 * @param args  extra tsc args (default `--noEmit`)
 * @param pipe  optional trailing redirect/pipe already including its operators (e.g. `2>&1 | head -80`)
 */
export function robustTscCommand(args: string = '--noEmit', pipe: string = ''): string {
  const run = `${TSC_BIN} ${args}`.trim();
  return pipe ? `${TSC_ENSURE}; ${run} ${pipe}` : `${TSC_ENSURE}; ${run}`;
}
