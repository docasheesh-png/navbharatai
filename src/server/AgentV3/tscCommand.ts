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
export const TSC_ENSURE_LOG = '/tmp/nbai-tsc-ensure.log';

/**
 * The line printed when, after every install attempt, there is still no compiler. `looksLikeMissingTscBinary`
 * reads it, so a run that never compiled can never be scored as a clean one.
 */
export const TSC_UNAVAILABLE_MARKER = 'NBAI_TSC_UNAVAILABLE';

// 🔴 AUTOPSY 12c642ed (2026-09-30). Both installs below used to write to /dev/null. In that build the
// write-time typecheck ran four times, the compiler was never installed, every run printed
// `node_modules/.bin/tsc: No such file or directory` — and npm's own reason was thrown away, so the
// report could say nothing about WHY. The log is kept now, a peer-resolution failure gets the same
// `--legacy-peer-deps` retry the dev-server install already has (and only that failure — see
// npmInstallFallback.ts), and a compiler that is still missing is said in words with npm's last lines.
const INSTALL = (args: string) =>
  `(npm install${args ? ` ${args}` : ''} >>${TSC_ENSURE_LOG} 2>&1 || (grep -qiE 'ERESOLVE|peer dep' ${TSC_ENSURE_LOG} && npm install${args ? ` ${args}` : ''} --legacy-peer-deps >>${TSC_ENSURE_LOG} 2>&1))`;

export const TSC_ENSURE =
  `: >${TSC_ENSURE_LOG}; ` +
  // `&& touch node_modules`: an "up to date" install leaves the directory's mtime alone, so without the
  // stamp a rewritten package.json kept this re-running `npm install` before every typecheck.
  `if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then ${INSTALL('')} && touch node_modules; fi; ` +
  // PINNED to the major our scaffolds declare (autopsy 4499741f). An unpinned install fetched a newer
  // major that REMOVES `baseUrl`, so a project without its own `typescript` failed on its tsconfig alone
  // (TS5102) — a verdict about the compiler we picked, not about the app.
  `if [ ! -x node_modules/.bin/tsc ]; then ${INSTALL('typescript@5 --no-save')}; fi; ` +
  `if [ ! -x node_modules/.bin/tsc ]; then echo "${TSC_UNAVAILABLE_MARKER}: the TypeScript compiler could not be installed, so nothing was checked. npm said:"; tail -n 6 ${TSC_ENSURE_LOG}; fi`;

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
