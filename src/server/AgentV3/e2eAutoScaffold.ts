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

/** Does this project already have an end-to-end setup we must not touch? */
export function hasExistingE2e(files: Record<string, string>): boolean {
  const paths = Object.keys(files ?? {});
  if (paths.some((p) => CONFIG_PATHS.includes(p))) return true;
  if (paths.some((p) => /cypress\.config\.(ts|js|mjs)$/i.test(p))) return true;
  return paths.some((p) => EXISTING_E2E_RE.test(p) && /\.(spec|test)\.[jt]sx?$/i.test(p));
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
  if (hasExistingE2e(files)) return { scaffold: false, reason: 'this project already has an end-to-end setup, which was left alone' };
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
