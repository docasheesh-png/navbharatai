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

/**
 * Present while one of OUR installs is filling `node_modules` (`E2BActuator._npmInstall` writes it, and
 * removes it when the install ends).
 *
 * 🔴 AUTOPSY 120eb52f (2026-09-30). The typecheck's own `npm install` below ran while the background
 * boot's install was still filling the same tree — two npm processes into one `node_modules` — and
 * `typescript` came out with its `bin/` and without its `lib/`. Every check for the next ninety seconds
 * crashed, and the crash was read as clean. Waiting for the other install is the fix; a second
 * concurrent install is never "making sure".
 */
export const NPM_INSTALL_LOCK = '/tmp/nbai-npm-install.lock';
/** How long a check waits for our own install to finish before saying it could not check yet. */
export const INSTALL_WAIT_SECONDS = 20;
/** A lock older than this is from an install that died (the install itself is bounded at 5 min). */
export const INSTALL_LOCK_STALE_MINUTES = 6;

// `-f` first, so `find` is only asked about a file that exists; its stderr (a lock removed between the two
// tests) goes to our own log, never to the output a verdict is read from — and never to /dev/null.
export const NPM_INSTALL_LOCK_FRESH = `[ -f ${NPM_INSTALL_LOCK} ] && [ -n "$(find ${NPM_INSTALL_LOCK} -mmin -${INSTALL_LOCK_STALE_MINUTES} 2>>${TSC_ENSURE_LOG})" ]`;

/**
 * The vite-react `node_modules` the sandbox image bakes (infra/e2b/e2b.Dockerfile; `_npmInstall` Step 0).
 * Absent from an image that predates it — then the primer below does nothing.
 */
export const WARM_NODE_MODULES = '/home/user/.warm/vite-react/node_modules';

/**
 * 🔴 A FRESH STARTER PAID A FULL INSTALL ON ITS FIRST TYPECHECK (queue Q-304 / Q-257 / Q-063 class,
 * autopsies 4a1c0157, 0311186f, cf09c03c, d798ddd3 — four reports, 15–18 s each). Our starter is written
 * into an EMPTY workspace, so there is no `node_modules`; the build-start warm-up finds no compiler and
 * stands down, and the first write's check runs a cold `npm install`. The image already bakes a
 * vite-react tree for exactly this, but only `_npmInstall` used it — the typecheck's own install did not.
 *
 * Now both do, through this ONE primer: when there is no `node_modules` and the app declares React, the
 * baked tree is copied to a stage beside the workspace and RENAMED into place. The rename is atomic, so
 * two primers (the warm-up and the dev-server install) can never copy into each other: one wins, the
 * other's rename fails and its stage is removed. The install that follows is then a small delta (the
 * starter's own type packages) instead of a cold one. PURE string.
 */
export const PRIME_NODE_MODULES =
  `if [ ! -e node_modules ] && [ -d ${WARM_NODE_MODULES} ] && grep -qE '"react"[[:space:]]*:' package.json 2>>${TSC_ENSURE_LOG}; then ` +
  `_nbs=$(mktemp -u /home/user/.nbai-nm-stage.XXXXXXXX); ` +
  `cp -a ${WARM_NODE_MODULES} $_nbs 2>>${TSC_ENSURE_LOG} && mv -T $_nbs node_modules 2>>${TSC_ENSURE_LOG}; rm -rf $_nbs; fi; `;

export const TSC_ENSURE =
  // Wait (bounded) for an install already filling node_modules. Still busy ⇒ say so and stop: never run
  // a second install into the same tree, and never read a half-filled one (`exit` ends this command
  // only, so the tsc that would follow is skipped too). The wait stays under the 30 s a write-time
  // check is allowed.
  `_nbw=0; while ${NPM_INSTALL_LOCK_FRESH} && [ $_nbw -lt ${INSTALL_WAIT_SECONDS} ]; do sleep 1; _nbw=$((_nbw+1)); done; ` +
  `if ${NPM_INSTALL_LOCK_FRESH}; then echo "${TSC_UNAVAILABLE_MARKER}: the app's dependencies are still being installed, so nothing was checked yet."; exit 0; fi; ` +
  `: >${TSC_ENSURE_LOG}; ` +
  PRIME_NODE_MODULES +
  // `&& touch node_modules`: an "up to date" install leaves the directory's mtime alone, so without the
  // stamp a rewritten package.json kept this re-running `npm install` before every typecheck.
  `if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then ${INSTALL('')} && touch node_modules; fi; ` +
  // PINNED to the major our scaffolds declare (autopsy 4499741f). An unpinned install fetched a newer
  // major that REMOVES `baseUrl`, so a project without its own `typescript` failed on its tsconfig alone
  // (TS5102) — a verdict about the compiler we picked, not about the app.
  // A TORN compiler (its bin/ without its lib/ — autopsy 120eb52f) passes `-x .bin/tsc` and crashes on
  // every run. npm will not repair it by itself (the package's own package.json is still there), so it
  // is removed and installed again: from the project's own lock when it declares typescript, else by
  // the pinned install on the next line.
  `if [ -x node_modules/.bin/tsc ] && { [ ! -f node_modules/typescript/lib/tsc.js ] || [ ! -f node_modules/typescript/lib/lib.es5.d.ts ]; }; then ` +
  `rm -rf node_modules/typescript node_modules/.bin/tsc node_modules/.bin/tsserver; ` +
  `if [ -f package.json ] && grep -q '"typescript"' package.json; then ${INSTALL('')}; fi; fi; ` +
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

/** Printed when a recipe-dependency install found another install still running and stood down. */
export const RECIPE_DEPS_BUSY_MARKER = 'NBAI_RECIPE_DEPS_BUSY';

/**
 * Install packages a recipe's code needs, under the same lock the background install holds — waiting for
 * it (bounded), standing down when it is still busy, and never running two installs into one
 * `node_modules` (autopsy 120eb52f). Names and versions come from recipe declarations only. PURE.
 */
export function recipeInstallCommand(deps: ReadonlyArray<{ name: string; version: string; dev: boolean }>): string {
  const spec = (d: { name: string; version: string }) => `${d.name}@${d.version}`;
  const safe = deps.filter((d) => /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(d.name) && /^[\^~]?[0-9][0-9A-Za-z.\-]*$/.test(d.version));
  const prod = safe.filter((d) => !d.dev).map(spec);
  const dev = safe.filter((d) => d.dev).map(spec);
  if (prod.length === 0 && dev.length === 0) return '';
  const installs = [
    prod.length ? `npm install --no-audit --no-fund ${prod.join(' ')}` : '',
    dev.length ? `npm install --no-audit --no-fund -D ${dev.join(' ')}` : '',
  ].filter(Boolean).join(' && ');
  return `_nbw=0; while ${NPM_INSTALL_LOCK_FRESH} && [ $_nbw -lt ${INSTALL_WAIT_SECONDS} ]; do sleep 1; _nbw=$((_nbw+1)); done; `
    + `if ${NPM_INSTALL_LOCK_FRESH}; then echo ${RECIPE_DEPS_BUSY_MARKER}; exit 0; fi; `
    + `touch ${NPM_INSTALL_LOCK}; ${installs}; _nbs=$?; rm -f ${NPM_INSTALL_LOCK}; exit $_nbs`;
}
