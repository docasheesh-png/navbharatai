// AgentV3 — ship every app with a runnable E2E net (ROADMAP #1 Phase 4.3).
//
// `generate_e2e` already existed as a TOOL the agent MAY call, which in practice meant most apps
// shipped without one. This makes the scaffold a system reflex instead of a model decision — the
// same move the vaccine made for unit tests.
//
// WHAT THIS DELIBERATELY DOES NOT DO: install `@playwright/test` into the user's project or run THEIR
// suite during the build. Writing the files costs nothing and leaves the user something real they own:
// a net that runs in their own repo and their own CI, whenever they want it.
//
// CORRECTION (2026-08-06). This comment used to justify that by saying Playwright "pulls a browser of
// roughly 300 MB … on EVERY build". That is true in general and FALSE for this engine: Playwright 1.49.1
// and Chromium are PRE-BAKED into both E2B images (`infra/e2b/e2b.Dockerfile`, `e2b-fullstack.Dockerfile`,
// into `/home/user/.e-tools`), and `_kickoffPlaywright` already warms them on every sandbox. The 300 MB is
// paid once at template-build time, not per build. A cost that does not exist is not a reason, and
// leaving it written down would keep talking the next reader out of a check that is nearly free.
//
// So the browser check DOES now run by default — as `PageRouteCheck`, which opens the app's own page
// routes in that pre-baked browser and reports whether they actually render. What stays out of the build
// is installing the user's own test RUNNER and executing THEIR suite: that is their dependency and their
// CI, and adding a package to someone's project to run a test for them is a different thing entirely.
//
// The report still says plainly that the suite was WRITTEN and not executed — a scaffold reported as a
// passing test run would be exactly the fake success the constitution forbids. The rendering evidence in
// the report comes from PageRouteCheck, which really did run.

/** What the decision needs to know. Kept tiny so the caller cannot accidentally widen it. */
export interface E2eAutoScaffoldContext {
  /** Every file in the project after the build. */
  files: Record<string, string>;
  /** Did the build actually succeed? A failed build has nothing worth testing. */
  ok: boolean;
  /** True on an import/survey turn, where the user explicitly asked us not to change their files. */
  isImportTurn: boolean;
  /** Whether the app has a live preview — proof there is a UI for a browser to load. */
  hasPreview: boolean;
}

export interface E2eAutoScaffoldDecision {
  scaffold: boolean;
  /** Why not, in words that belong in a report rather than a log. */
  reason: string;
}

const CONFIG_PATHS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];
/** Any existing E2E setup at all — including one the user wrote themselves. */
const EXISTING_E2E_RE = /(^|\/)(e2e|tests?\/e2e|cypress)\//i;

/** Where our own scaffold puts its spec, and what our own config's testDir points at. */
const OUR_TEST_DIR = 'e2e';

/**
 * Does this project already have end-to-end TESTS we must not touch?
 *
 * ⚠️ THIS USED TO ACCEPT A CONFIG FILE AS PROOF, and two findings in the same real build report
 * (2026-08-24) showed what that costs:
 *     E2E_SCAFFOLD_SKIPPED   — "this project already has an end-to-end setup, which was left alone"
 *     TEST_SUITE_UNVERIFIED  — "playwright: COULD NOT RUN — the suite matched no test files"
 * Both true, and together they describe a project with a Playwright config, zero tests, and a skip
 * rule guaranteeing it stays that way. The one project that most needed the net was the only one
 * refused it — permanently, on every subsequent build.
 *
 * A config is a statement of INTENT. It is not a test, and it proves nothing about coverage — the
 * same artifact-for-evidence substitution found four times elsewhere this month. Note that the third
 * check below always had the right shape: it required a directory AND a spec file in it.
 *
 * How a project reaches that state matters, because it makes the fix urgent rather than tidy: our own
 * scaffold writes a config AND a spec, and files DO go missing from a recycled sandbox (the File
 * Guardian restores 20+ of them on a routine build). Lose the spec, keep the config, and the old rule
 * made the loss permanent.
 */
export function hasExistingE2e(files: Record<string, string>): boolean {
  const paths = Object.keys(files ?? {});
  return paths.some((p) => EXISTING_E2E_RE.test(p) && /\.(spec|test)\.[jt]sx?$/i.test(p));
}

/**
 * An end-to-end CONFIG with no tests beside it — and where it looks for them.
 *
 * Returns the config's `testDir` (or the tool's default) when a config exists, else null. The caller
 * needs the directory, not just the fact: writing our spec into `e2e/` when someone's config reads
 * `./tests` produces a file nothing ever runs, which is worse than an honest skip because it looks
 * like coverage.
 */
export function e2eConfigTestDir(files: Record<string, string>): string | null {
  const entries = Object.entries(files ?? {});
  const cypress = entries.find(([p]) => /cypress\.config\.(ts|js|mjs)$/i.test(p));
  if (cypress) return 'cypress';                     // its own convention; never ours to write into
  const pw = entries.find(([p]) => CONFIG_PATHS.includes(p));
  if (!pw) return null;
  const m = /testDir\s*:\s*['"`]\.?\/?([^'"`]+)['"`]/.exec(pw[1] || '');
  // Playwright's own default when the key is absent is the config's directory — i.e. the project
  // root. Reported as '' so the caller can tell "not specified" from a named directory.
  return m ? m[1].replace(/\/+$/, '') : '';
}

/**
 * Does this project have a user interface at all?
 *
 * An API-only service has nothing for a browser to load, so scaffolding a Playwright suite there
 * produces a test that can only ever fail — the worst possible thing to hand someone alongside a
 * working app.
 */
export function hasUserInterface(files: Record<string, string>): boolean {
  const paths = Object.keys(files ?? {});
  if (paths.some((p) => /(^|\/)index\.html$/i.test(p))) return true;
  return paths.some((p) => /\.(tsx|jsx|vue|svelte)$/i.test(p));
}

/**
 * Decide whether to write the E2E net.
 *
 * Every "no" carries a reason, because the build report says what it did and did not do. A silent
 * skip is indistinguishable from a bug in the skip logic.
 */
export function shouldAutoScaffoldE2e(ctx: E2eAutoScaffoldContext): E2eAutoScaffoldDecision {
  if (!ctx?.ok) return { scaffold: false, reason: 'the build did not succeed, so there is nothing worth testing yet' };
  if (ctx.isImportTurn) return { scaffold: false, reason: 'this was an import/survey turn — your files were left untouched, as asked' };
  const files = ctx.files ?? {};
  if (hasExistingE2e(files)) return { scaffold: false, reason: 'this project already has end-to-end tests, which were left alone' };
  // A CONFIG WITH NO TESTS IS THE CASE WORTH WRITING FOR, not the case to skip — see hasExistingE2e.
  // The only question left is whether our spec would land where that config actually looks. When it
  // would not, say so with the directory named, so the user can act on it; a spec nothing runs is
  // worse than an honest skip, because it looks like coverage.
  const configDir = e2eConfigTestDir(files);
  if (configDir === 'cypress') {
    return { scaffold: false, reason: 'this project uses Cypress, which has its own conventions — its suite was left alone' };
  }
  // '' means the config named no testDir. Playwright then scans from the config's own directory, so a
  // spec in `e2e/` IS found — writing one is useful, not dead. Only a config pointing somewhere ELSE
  // makes our spec unreachable, and that is the one case worth declining, with the directory named so
  // the user can act on it.
  if (configDir !== null && configDir !== '' && configDir !== OUR_TEST_DIR) {
    return {
      scaffold: false,
      reason: `this project's end-to-end config looks for tests in \`${configDir}/\`, not \`${OUR_TEST_DIR}/\`, `
        + 'so a test written here would never be run — add one there instead',
    };
  }
  if (!hasUserInterface(files)) return { scaffold: false, reason: 'this project has no user interface for a browser to load' };
  if (!ctx.hasPreview) return { scaffold: false, reason: 'no live preview was available to point the tests at' };
  return { scaffold: true, reason: '' };
}

/**
 * The line the user reads.
 *
 * Says WRITTEN, never "passed". The suite has not been executed — claiming otherwise would be a
 * fake verdict, and the whole point of Phase 4 is that "it built" stops standing in for "it works".
 */
export function e2eAutoScaffoldNote(added: string[]): string {
  return `An end-to-end test suite was written into your project (${added.join(', ')}). `
    + 'It has not been run here — run it yourself with `npm run test:e2e` after `npm i -D @playwright/test '
    + '&& npx playwright install chromium`. It loads your app in a real browser and fails on a blank '
    + 'screen, an error overlay, or a console error.';
}
