/**
 * 🧭 A NAV BAR IS NOT THE APP, AND AN ERROR MESSAGE ABOUT A PASSWORD IS NOT A LEAKED PASSWORD.
 *
 * Two rows from the older queue, both FALSE verdicts shown to a user — the class the fifth rule calls
 * out by name ("a lying analyzer is a defect — fixing the analyzer resolves it").
 *
 * ── Q-147 (PROGRESS.md L20755) ─────────────────────────────────────────────────────────────────────
 *
 * Every render verdict in `PreviewVerify.ts` is decided by the WHOLE page's visible text against a
 * five-character floor. An app whose SHELL painted and whose content did not — a bottom nav reading
 * *"Matches Leaderboard Wallet Profile"* over an empty content area — clears that floor by thirty
 * characters and is recorded as **rendered**. That verdict then earns the render proof, the green latch
 * and, under the markup rule, the user's money.
 *
 * 🔒 The check fires only where the app ITSELF declared the region (`<main>` or `role="main"`) — a
 * statement by its own author about where content goes. An app that declares neither is left exactly
 * as it is today, so this can never invent a defect out of a layout it does not understand. And it
 * needs something else on the page to have painted, so the blank-page and empty-root rules keep every
 * verdict they already owned.
 *
 * ── Q-150 (report 77bd487b, L23106) ────────────────────────────────────────────────────────────────
 *
 * `lineLogsCredential` was `console.* AND a sensitive word anywhere on the line`, so every one of
 * these was reported as a HIGH-severity `pii-in-logs` finding — the accusation that the user's app
 * writes credentials into the browser console:
 *
 *     console.error('Failed to save password', err);
 *     console.warn('OTP request failed');
 *     console.log('Invalid API key provided');
 *
 * **None of them logs a value.** The word is in the LABEL, describing what went wrong — which is what
 * a careful developer writes. And the deterministic redaction heal shares this definition, so it then
 * rewrote lines that were already correct.
 *
 * 🔑 The distinction is the ARGUMENT, not the word: a leak logs an expression whose name is sensitive.
 * So the string literals' contents are removed and the test is re-asked of the code that remains — a
 * template literal's `${…}` kept, because that is where a logged value hides. One shape is kept
 * deliberately: a literal that NAMES the field as the value about to follow (`'password=' + pw`) is
 * still a leak, so narrowing the check loses nothing it catches today.
 */
import { describe, it, expect } from 'vitest';
import { lineLogsCredential, withoutStringLiterals } from '../src/server/AgentV3/ComplianceAnalysis';
import { mainRegionText, MAIN_REGION_MIN_TEXT, analyzePreviewHtml } from '../src/server/AgentV3/PreviewVerify';

/** A browser capture of a page: the shape `analyzePreviewHtml` is given on the real path. */
const painted = (html: string) => analyzePreviewHtml(html, { source: 'browser', painted: true });

describe('🧭 Q-147 — the shell painted and the app did not', () => {
  const SHELL_ONLY = '<html><body><div id="root"><nav>Matches Leaderboard Offers Wallet Profile</nav><main></main></div></body></html>';
  const REAL = '<html><body><div id="root"><nav>Matches Leaderboard</nav><main><h1>Tournaments</h1><p>Solo · ₹50 entry</p></main></div></body></html>';

  it('reads the region the app declared', () => {
    expect(mainRegionText(SHELL_ONLY)).toBe('');
    expect(mainRegionText(REAL)).toContain('Tournaments');
    expect(mainRegionText('<div role="main"><p>hi</p></div>')).toBe('hi');
    // No declaration ⇒ nothing to judge, and today's behaviour is kept.
    expect(mainRegionText('<div id="root"><nav>Home</nav></div>')).toBeNull();
  });

  it('refuses a page that is navigation and nothing else', () => {
    const v = painted(SHELL_ONLY);
    expect(v.rendered).toBe(false);
    expect(v.problems.join(' ')).toMatch(/only the app's shell rendered/);
    expect(v.problems.join(' ')).toMatch(/main content area is empty/);
  });

  it('passes the same app once its content is there', () => {
    expect(painted(REAL).rendered).toBe(true);
  });

  it('leaves an app that declares no main region exactly as it was', () => {
    // The precision lock: most apps do not use <main>, and a verdict must not change for them.
    const noMain = '<html><body><div id="root"><nav>Home</nav><div class="page">Dashboard · 12 orders today</div></div></body></html>';
    expect(mainRegionText(noMain)).toBeNull();
    expect(painted(noMain).rendered).toBe(true);
  });

  it('leaves the blank-page and empty-root rules owning what they already owned', () => {
    // Nothing painted anywhere: the older rules say it better, and this one stands down.
    const blank = '<html><body><div id="root"></div></body></html>';
    const v = painted(blank);
    expect(v.rendered).toBe(false);
    expect(v.problems.join(' ')).toMatch(/root element is empty/);
    expect(v.problems.join(' ')).not.toMatch(/only the app's shell/);
  });

  it('never calls a blind capture broken — it stays inconclusive', () => {
    // A curl fetch of an SPA sees no JavaScript; "we could not look" is not "it is broken".
    const v = analyzePreviewHtml('<div id="root"><nav>Home Wallet</nav><main></main></div>', { source: 'curl' });
    expect(v.rendered).toBe(false);
    expect(v.inconclusive).toBe(true);
    expect(v.problems.join(' ')).toMatch(/NOT evidence the app is broken/);
  });

  it('uses the same floor the whole-page check uses, not a second number', () => {
    expect(MAIN_REGION_MIN_TEXT).toBe(5);
  });
});

describe('🔐 Q-150 — a message about a password is not a password', () => {
  it('stops accusing the lines a careful developer writes', () => {
    for (const line of [
      "console.error('Failed to save password', err);",
      "console.warn('OTP request failed');",
      "console.log('Invalid API key provided');",
      'console.error("Could not verify your password. Try again.");',
      "console.log('secret sauce recipe loaded');",
      "console.info('Enter the OTP sent to your phone');",
      'console.error(`password reset email failed`, e);',
    ]) expect(lineLogsCredential(line), line).toBe(false);
  });

  it('still catches every real leak it caught before', () => {
    for (const line of [
      'console.log(password);',
      "console.log('pw:', password);",
      'console.log({ apiKey });',
      'console.log(`otp: ${otp}`);',
      'console.debug(user.password);',
      'console.log(JSON.stringify({ access_token }));',
      'console.warn(form.cvv, form.card_number);',
    ]) expect(lineLogsCredential(line), line).toBe(true);
  });

  it('keeps the one label shape that IS the assignment', () => {
    // 'password=' + pw names the field as the value that follows, so the label is the leak.
    expect(lineLogsCredential("console.log('password=' + pw);")).toBe(true);
    expect(lineLogsCredential('console.error("api_key: ", k);')).toBe(true);
    // …but the same words with nothing following them are still only a label.
    expect(lineLogsCredential("console.log('password=');")).toBe(false);
  });

  it('is not a console call at all ⇒ never a finding', () => {
    expect(lineLogsCredential('const password = form.password;')).toBe(false);
    expect(lineLogsCredential('')).toBe(false);
  });

  it('blanks a literal\'s text and keeps its interpolations — the whole mechanism', () => {
    expect(withoutStringLiterals("log('password', x)")).toBe("log('', x)");
    expect(withoutStringLiterals('log("api key")')).toBe('log("")');
    expect(withoutStringLiterals('log(`otp: ${otp}`)')).toContain('${otp}');
    expect(withoutStringLiterals('log(`otp: ${otp}`)')).not.toMatch(/otp:/);
    // An escaped quote does not end the literal.
    expect(withoutStringLiterals("log('it\\'s a password', y)")).toBe("log('', y)");
    // Nested braces inside an interpolation are kept whole.
    expect(withoutStringLiterals('log(`${ {a:{b:1}} } password`)')).toContain('{b:1}');
  });
});
