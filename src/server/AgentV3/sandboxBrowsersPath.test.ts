// THE BROWSER WAS ALWAYS THERE — it was just invisible to the user's own test suite.
//
// Admin 2026-08-19 ("isko bana dene se kya badlega"). Investigating the standing
// TEST_SUITE_UNVERIFIED / RUNTIME_UNCHECKED items showed they were NOT infrastructure-blocked, which
// is what had been recorded: every sandbox already downloads Chromium in the background for the
// platform's own page checks and journey runs. A user's Playwright suite simply looks somewhere else
// (Playwright's default ~/.cache/ms-playwright) and dies with "Executable doesn't exist at …".
// These tests pin the hand-off — and the shared path, so the two copies can never drift.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { withSandboxBrowsers, SANDBOX_BROWSERS_PATH } from './testRunner';
import { TOOLS_DIR, pageCheckScript } from './PageRouteCheck';
import { deriveJourneys, journeyScript } from './journeyDerivation';

describe('withSandboxBrowsers — hand the existing browser to the suite that needs one', () => {
  it('a Playwright suite is pointed at the browser the sandbox already downloaded', () => {
    const out = withSandboxBrowsers('npx playwright test', 'playwright');
    expect(out).toContain('PLAYWRIGHT_BROWSERS_PATH=');
    expect(out).toContain(SANDBOX_BROWSERS_PATH);   // still the fallback when the project has none
    expect(out).toContain('npx playwright test');
  });

  // 🔴 REGRESSION — report 697b38ee (2026-09-14). The hand-off was an OVERRIDE, so it pointed
  // Playwright AWAY from a browser the agent had just installed into the DEFAULT cache: the suite
  // passed at +636.9s and the vaccine, re-running it 145s later with the variable pinned, reported
  // "COULD NOT RUN — the browser binaries are not installed". The release gate then told the user the
  // app had no runnable test suite. The project's own cache must win when it has one.
  it('prefers the browser the PROJECT already has, and falls back to ours only when it has none', () => {
    const out = withSandboxBrowsers('npx playwright test', 'playwright');
    const varValue = out.slice(out.indexOf('=') + 1, out.indexOf(' npx'));
    expect(varValue).toContain('$HOME/.cache/ms-playwright');  // the preferred branch
    expect(varValue).toContain(SANDBOX_BROWSERS_PATH);         // the fallback branch
    // The preferred branch must be the one taken when the project's cache is populated: the test is
    // the `ls` of a chromium-* directory, not the mere existence of the folder (an empty
    // ~/.cache/ms-playwright is created by a failed install and holds no browser at all).
    expect(varValue).toMatch(/ls -d "\$HOME\/\.cache\/ms-playwright"\/chromium-\*/);
  });

  it('an opaque npm "test" script gets it too — it may well BE a browser run', () => {
    expect(withSandboxBrowsers('npm run test', 'npm-script')).toContain('PLAYWRIGHT_BROWSERS_PATH=');
  });

  it('suites that have no use for a browser are left exactly as they were', () => {
    for (const fw of ['vitest', 'jest', 'pytest', 'maven', 'gradle', 'go'] as const) {
      expect(withSandboxBrowsers('run it', fw)).toBe('run it');
    }
  });

  it('never doubles the variable when a command already carries it', () => {
    const once = withSandboxBrowsers('npx playwright test', 'playwright');
    expect(withSandboxBrowsers(once, 'playwright')).toBe(once);
  });
});

describe('the path is ONE fact, not two copies', () => {
  it('matches the tools directory the platform installs its browser into', () => {
    expect(SANDBOX_BROWSERS_PATH).toBe(`${TOOLS_DIR}/.browsers`);
  });

  it('is the same path the sandbox actually installs to (read from E2BActuator itself)', () => {
    // Reading the real source keeps this honest: if someone changes where the install goes, the
    // suite fails here instead of silently going back to "browser not found" on every user build.
    const src = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    expect(src).toContain('playwright install chromium');
    expect(src).toContain('PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers');
    expect(src).toContain("const TOOLS_DIR = '/home/user/.e-tools'");
  });
});

// 🔴 THE HALF THIS FILE ASSERTED FOR A MONTH WITHOUT ASSERTING (2026-09-17).
//
// Everything above pins the CONSTANT and the hand-off to the USER's suite. Nothing pinned the scripts
// the PLATFORM itself runs — and this very file's header names "journey runs" as one of them. The
// journey runner's command was
//
//     node /tmp/nbai-journey.mjs 2>&1 | grep '^NBAI_JOURNEY ' || true
//
// with no PLAYWRIGHT_BROWSERS_PATH at all, so chromium.launch() threw on every build since the check
// shipped, and the `grep … || true` on the same line guaranteed the error never reached a report. It
// is the same shape as the complexity flag fixed in #3043: the decision was tested, the chain was not.
// These assertions read the REAL generated command, so a third script added later cannot repeat it.
describe('every browser script the PLATFORM runs carries the path too', () => {
  const journeys = deriveJourneys({
    files: { 'src/pages/Todo.tsx': '<form onSubmit={add}><input name="title" placeholder="Task" /><button type="submit">Add</button></form>' },
    routes: ['/'],
    marker: 'nbai-test',
  });

  it('the journey runner — the check that proves an app really SAVES data', () => {
    expect(journeys.length).toBeGreaterThan(0);   // guarding the guard: an empty list proves nothing
    const script = journeyScript('https://x.e2b.app/', journeys, 'nbai-test');
    const runLine = script.split('NBAI_EOF').pop() as string;
    expect(runLine).toContain(`PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers`);
  });

  it('the page-render check', () => {
    const runLine = pageCheckScript('https://x.e2b.app/', ['/a']).split('NBAI_EOF').pop() as string;
    expect(runLine).toContain(`PLAYWRIGHT_BROWSERS_PATH=${TOOLS_DIR}/.browsers`);
  });

  it('neither module builds its own run line any more — one helper, so they cannot drift again', () => {
    for (const f of ['src/server/AgentV3/journeyDerivation.ts', 'src/server/AgentV3/PageRouteCheck.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} builds its own node run line`).not.toMatch(/node \/tmp\/nbai-[\w.-]+\.mjs\s/);
      expect(src, `${f} does not use the shared builder`).toContain('browserScriptRunLine(');
    }
  });

  it('a failed script can no longer go quiet — the run line asks it what happened', () => {
    const runLine = pageCheckScript('https://x.e2b.app/', ['/a']).split('NBAI_EOF').pop() as string;
    expect(runLine).toContain('NBAI_DIAG:');
  });
});

// 🔎 THE SIBLING SWEEP the admin asked for (2026-09-17): "PLAYWRIGHT_BROWSERS_PATH wala fix screenshot
// script me bhi check karo".
//
// Answer, verified rather than assumed: the PATH was already correct in every screenshot, daemon,
// browser-action and browse invocation — the journey runner was the only one that ever lacked it, and
// these assertions keep it that way. What the screenshot family DID share was the second half of that
// bug: `2>/dev/null` on the command plus `.catch(() => null)` on the promise, which together destroy
// the reason twice over. The E2B SDK rejects on a non-zero exit and carries the command's real
// stdout/stderr ON THE ERROR, so those two lines discarded a diagnosis that was free to keep —
// `commandFailureResult` had already been centralised for exactly this class (sandboxCommandError.ts)
// and applied to the npm-install call sites, never to the browser ones.
describe('the screenshot / browse family — same class, swept', () => {
  const ACTUATORS = [
    'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts',
    'src/server/EngineerAI/actuators/E2BActuator.ts',
  ];

  it('every browser invocation carries the path — none of them was missing it, and none may start', () => {
    for (const f of ACTUATORS) {
      const src = readFileSync(f, 'utf8');
      const runs = src.split('\n').filter((l) => /node \$\{(TOOLS_DIR|browsePath|shotPath)\}/.test(l) && !l.trim().startsWith('//'));
      expect(runs.length, `${f}: found no browser invocations to check`).toBeGreaterThan(0);
      for (const line of runs) {
        expect(line, `${f}: a browser invocation without the path — ${line.trim()}`)
          .toContain('PLAYWRIGHT_BROWSERS_PATH=');
      }
    }
  });

  it('no browser invocation throws its error output away at the shell', () => {
    for (const f of ACTUATORS) {
      const src = readFileSync(f, 'utf8');
      for (const line of src.split('\n')) {
        if (!line.includes('PLAYWRIGHT_BROWSERS_PATH=')) continue;
        expect(line, `${f}: 2>/dev/null on a browser command destroys the only explanation — ${line.trim()}`)
          .not.toContain('2>/dev/null');
      }
    }
  });

  /**
   * 🔴 THE HALF THIS FILE WAS MISSING, AND IT IS WHY THE CLASS SURVIVED (report 31dc61fd, 2026-09-19).
   *
   * The sweep above proves every browser invocation carries `PLAYWRIGHT_BROWSERS_PATH`. Both of the
   * broken scripts DID carry it, so that sweep passed for weeks while `browseUrl` failed 100% of the
   * time. The env var says where the BROWSER BINARY is; it says nothing about where the playwright
   * MODULE is found — and that is decided by the script's own directory, because Node resolves
   * `require()` upward from the file, never from `cwd`.
   *
   * Playwright installs into `${TOOLS_DIR}/node_modules`. A generated script written to `/tmp`
   * therefore searches `/tmp/node_modules` and `/node_modules`, exits non-zero, and falls back to
   * curl — silently, since a curl snapshot is a legitimate outcome. In build 31dc61fd that produced
   * `IN_BUILD_GREEN_UNCHECKED` thirteen times across 912 seconds, while in the SAME sandbox the
   * agent's own `screenshot` and `browser_action` succeeded: those run scripts that live in TOOLS_DIR.
   *
   * ⚠️ Two properties, because either alone is satisfiable by the bug: a script may not sit in /tmp
   * if it requires playwright, AND the path helper must produce a TOOLS_DIR path.
   */
  it('🔴 a generated script that requires playwright lives in TOOLS_DIR, never /tmp', () => {
    for (const f of ACTUATORS) {
      const src = readFileSync(f, 'utf8');
      // Read the REAL relationship: `sandbox.files.write(<path>, <body>)`. A body that pulls in the
      // playwright module may only be written to a TOOLS_DIR path — that is the whole invariant, and
      // it is checked on the write itself rather than on a naming convention that can drift.
      const writes = [...src.matchAll(/files\.write\(\s*([^,]+?),\s*(\w+)\s*\)/g)];
      expect(writes.length, `${f}: found no script writes to check`).toBeGreaterThan(0);
      let checked = 0;
      for (const [, pathExpr, bodyVar] of writes) {
        // Does THIS body require the playwright module?
        const decl = new RegExp(`(const|let)\\s+${bodyVar}\\s*=\\s*\`[\\s\\S]{0,400}?require\\('playwright'\\)`);
        const isConstant = new RegExp(`^const ${bodyVar} = \`[\\s\\S]{0,400}?require\\('playwright'\\)`, 'm');
        if (!decl.test(src) && !isConstant.test(src)) continue;
        checked++;
        expect(pathExpr, `${f}: a playwright script written to /tmp cannot resolve its own module — ${pathExpr.trim()}`)
          .not.toMatch(/\/tmp\//);
        expect(pathExpr, `${f}: a playwright script must be written under TOOLS_DIR — ${pathExpr.trim()}`)
          .toMatch(/TOOLS_DIR|toolsScriptPath|Path$/);
      }
      expect(checked, `${f}: no playwright script write was actually examined — the matcher has drifted`).toBeGreaterThan(0);
    }
  });

  it('the shared path helper puts scripts in TOOLS_DIR and still gives each run its own name', () => {
    const src = readFileSync(ACTUATORS[0], 'utf8');
    const helper = src.slice(src.indexOf('function toolsScriptPath('), src.indexOf('function toolsScriptPath(') + 260);
    expect(helper).toContain('${TOOLS_DIR}/');
    expect(helper).not.toContain('/tmp');
    // The unique suffix is why these left a fixed path originally — it must survive the move.
    expect(helper).toMatch(/Date\.now\(\)|Math\.random\(\)/);
  });

  it('both browser scripts go through the ONE helper, so a third cannot drift back to /tmp', () => {
    const src = readFileSync(ACTUATORS[0], 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src).toContain("toolsScriptPath('browse')");
    expect(src).toContain("toolsScriptPath('shot')");
  });

  /**
   * The honest negative. `downloadDistFiles` also generates a /tmp script — and it requires only
   * `fs` and `path`, Node built-ins that resolve from anywhere. It is NOT affected and is NOT moved:
   * a sweep that dragged it along would be a change nobody could justify from evidence.
   */
  it('a generated script that needs no installed module may stay where it is', () => {
    const src = readFileSync(ACTUATORS[0], 'utf8');
    const reader = src.slice(src.indexOf('const readerPath'), src.indexOf('const readerPath') + 400);
    expect(reader).toContain('/tmp/nb_read_dist_');
    expect(reader).not.toContain("require('playwright')");
  });

  it('a failed browser command keeps what it said, via the shared helper', () => {
    // Comments are stripped first: the fix's own comment NAMES the lossy spelling it replaced, and a
    // needle that reads prose would be satisfied — or, as here, defeated — by a sentence about code.
    const src = readFileSync(ACTUATORS[0], 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const browserBlock = src.slice(src.indexOf('async browseUrl('), src.indexOf('async getPortUrl('));
    expect(browserBlock).toContain('commandFailureResult(err)');
    // `.catch(() => null)` on a browser RUN drops the CommandExitError that carries stderr.
    expect(browserBlock).not.toContain('.catch(() => null)');
  });
});
