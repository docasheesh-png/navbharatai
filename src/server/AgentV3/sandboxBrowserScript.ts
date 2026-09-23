// AgentV3 — how the platform's OWN browser scripts are run in the sandbox, in ONE place.
//
// 🔴 WHY THIS MODULE EXISTS (autopsy e706e068 residue, 2026-09-17). Two modules wrote the same four
// shell fragments by hand — set the browser path, run the script, keep the result lines, swallow the
// exit code — and one of the two copies was missing the first fragment. `journeyScript` ran
//
//     node /tmp/nbai-journey.mjs 2>&1 | grep '^NBAI_JOURNEY ' || true
//
// with no `PLAYWRIGHT_BROWSERS_PATH`, and Chromium exists NOWHERE except `${TOOLS_DIR}/.browsers`:
// both the image build and `_kickoffPlaywright` install it with that variable set, and it is never a
// persistent ENV. So `chromium.launch()` threw "Executable doesn't exist" before the first journey,
// on every build, since the journey check shipped — the one check whose entire purpose is to prove an
// app really SAVES data rather than only rendering it. Its sibling `pageCheckScript` set the variable;
// fourteen other Playwright invocations in this repo set it; this one did not.
//
// ⚠️ AND THE SAME LINE GUARANTEED NOBODY COULD SEE IT. `2>&1` folds stderr into stdout, `grep` then
// discards every line that is not a result, and `|| true` hides the exit status. A script that died
// at line 1 and a script that ran perfectly and found nothing produce the IDENTICAL empty string. The
// header of `PageRouteCheck` had already written this down about an earlier NODE_PATH bug — "the
// trailing || true and the grep swallow the error, so the run simply produces no result lines" — and
// the pattern was copied into the sibling anyway, taking the blindness with it.
//
// So: the run line is built here, once. It carries the browser path by construction, and when a run
// produces no result lines (or exits non-zero) it prints a BOUNDED tail of whatever the script really
// said, under its own marker. The cost on a healthy run is zero — the diagnostic branch is not taken.

/**
 * How an in-sandbox browser script loads Playwright — ONE line, for every script that needs it.
 *
 * 🔴 THE NAMED IMPORT NEVER WORKED HERE (autopsy ac41a924, 2026-09-23). Both `pageCheckScript` and
 * `journeyScript` began `import { chromium } from '…/playwright/index.js'`. That file is CommonJS —
 * `module.exports = require('playwright-core')`, which in turn re-exports an object built at run
 * time — so Node's ESM loader cannot see a `chromium` export and refuses to LINK the module:
 * *"SyntaxError: Named export 'chromium' not found … CommonJS modules can always be imported via the
 * default export"*. The script died before its first line ran, on every build, and the report said
 * PAGE_RENDER_NOT_RUN and JOURNEY_NOT_RUN — the exact wording the diagnostic tail carried. The tests
 * pinned the broken line as a STRING, so they stayed green; the lock is now a test that runs this
 * line in a real Node against a package shaped like Playwright.
 *
 * The default import is what Node itself recommends, and it works on every Playwright version: a
 * CommonJS module's default export IS its `module.exports`, whatever it re-exports underneath.
 */
export function playwrightImport(toolsDir: string): string {
  return `import playwright from '${toolsDir}/node_modules/playwright/index.js';\nconst { chromium } = playwright;`;
}

/** The marker the run line prefixes its diagnostic lines with. Never a result marker. */
export const SCRIPT_DIAG_MARKER = 'NBAI_DIAG:';

/** How many lines of a failed script's real output to keep, and how wide. Bounded on purpose. */
const DIAG_MAX_LINES = 8;
const DIAG_MAX_COLS = 200;
/** Cap on the joined diagnostic a report line may carry. */
const DIAG_MAX_CHARS = 400;

export interface BrowserScriptRun {
  /** Where Playwright and its browsers live in the sandbox (`/home/user/.e-tools`). */
  toolsDir: string;
  /** The ES module to run, already written to disk by the caller's heredoc. */
  scriptPath: string;
  /** The exact prefix a RESULT line starts with, e.g. `NBAI_PAGE:` or `NBAI_JOURNEY ` (note the space). */
  marker: string;
}

/**
 * The shell line that runs one of our in-sandbox browser scripts.
 *
 * Properties that must hold, because each one is a bug this module was written to end:
 *   1. `PLAYWRIGHT_BROWSERS_PATH` points at the browsers the sandbox really installed;
 *   2. result lines reach stdout unchanged, so every existing parser is untouched;
 *   3. a run that yields NO result lines, or exits non-zero, explains itself instead of going quiet;
 *   4. the whole line still exits 0 — this is evidence, and a failed probe must never look like a
 *      failed command to the caller that runs it.
 *
 * POSIX sh only (no bashisms): the sandbox runs commands through whichever shell it has. PURE.
 */
export function browserScriptRunLine(run: BrowserScriptRun): string {
  const log = `${run.scriptPath}.log`;
  const results = `grep '^${run.marker}' ${log}`;
  // A SEPARATE quiet form, not `${results} -q`: POSIX grep does not accept an option after its
  // operands, so the option-last spelling works on GNU and silently misreads elsewhere.
  const anyResult = `grep -q '^${run.marker}' ${log}`;
  const diagnose = [
    `echo "${SCRIPT_DIAG_MARKER}the script exited with status $nbai_rc"`,
    `grep -v '^${run.marker}' ${log} | tail -n ${DIAG_MAX_LINES} | cut -c1-${DIAG_MAX_COLS} | sed 's/^/${SCRIPT_DIAG_MARKER}/'`,
  ].join('; ');
  return `PLAYWRIGHT_BROWSERS_PATH=${run.toolsDir}/.browsers node ${run.scriptPath} > ${log} 2>&1; `
    + 'nbai_rc=$?; '
    + `${results} || true; `
    + `if [ "$nbai_rc" != "0" ] || ! ${anyResult}; then ${diagnose}; fi; true`;
}

/**
 * What the script actually said, when it said nothing useful.
 *
 * Returns null when there is no diagnostic — which is the healthy case and must stay silent, so a
 * good run never carries an empty "reason" into a report. PURE; never throws.
 */
export function parseScriptDiagnostic(stdout: string | null | undefined): string | null {
  const lines: string[] = [];
  for (const line of String(stdout ?? '').split('\n')) {
    const at = line.indexOf(SCRIPT_DIAG_MARKER);
    if (at < 0) continue;
    const text = line.slice(at + SCRIPT_DIAG_MARKER.length).trim();
    if (text) lines.push(text);
  }
  if (lines.length === 0) return null;
  const joined = lines.join(' · ');
  return joined.length > DIAG_MAX_CHARS ? `${joined.slice(0, DIAG_MAX_CHARS - 1)}…` : joined;
}

/**
 * The sentence a report appends when a browser script produced nothing.
 *
 * The common cause gets named in plain words BEFORE the raw text, because "Executable doesn't exist at
 * /root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome" is the single most likely thing to see
 * here and the least likely to be recognised at a glance. The raw text still follows — a translation
 * that replaced the evidence would be the next reader's dead end. PURE.
 */
export function browserScriptFailureNote(diagnostic: string | null | undefined): string {
  if (!diagnostic) return '';
  const missingBrowser = /Executable doesn.?t exist|Please run the following command to download|browserType\.launch/i.test(diagnostic);
  const lead = missingBrowser
    ? ' The sandbox browser could not be launched'
    : ' The runner did not complete';
  return `${lead}: ${diagnostic}`;
}
