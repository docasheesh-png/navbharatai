/**
 * LOOK BEHIND THE SIGN-IN PAGE — authenticated exploration (autopsy 8e124182, 2026-09-30).
 *
 * 🔴 THE MISSING SUBSYSTEM. A stock-inventory app put every screen behind `/login`. So every check that
 * proves an app works stopped at the door: five routes "redirected to /login — not counted", two form
 * journeys "unreachable", the click explorer pressed "Show password" and "Hide password", and the feature
 * probe — seeing an email box and a password box — reported the stock list MISSING and spent a repair on
 * it. The app had even pre-filled its own demo account on that form. Nothing signed in. Every app with a
 * login was verified at its front door only, which is most apps worth building.
 *
 * WHAT THIS DOES: when the running app shows a sign-in wall, it signs in ONCE, in the sandbox's own
 * browser, with credentials THE APP ITSELF SHIPS — the values already typed into its form, or a demo
 * account written in its own source — saves that browser session to a file, and hands the file to the
 * page check, the form journeys and the click explorer, so they open the app the way a signed-in user
 * sees it. It also reads a few screens behind the door for the feature probe.
 *
 * 🔒 WHAT IT WILL NEVER DO, and each is the design, not a limitation to "improve" later:
 *   - invent credentials, guess common passwords, or try more than a handful of candidates — that is
 *     brute force against somebody's app, whatever the intent;
 *   - create an account — sign-up writes a real row, and on the user's own database that is their data;
 *   - print a credential — the report says WHERE the account came from, never what it is.
 * No credentials in the app ⇒ it says so (`AUTH_EXPLORE_NOT_RUN`) and every check runs as before.
 *
 * PURE: the candidate reader, the script builder and the output parser. The route runs the script.
 */
import { playwrightImport, browserScriptRunLine } from './sandboxBrowserScript';
import { DESTRUCTIVE_LOCAL_WORDS, SPENDING_LOCAL_WORDS, DEVANAGARI_NEVER_WORDS } from './localActionWords';

/** Where the signed-in browser session is saved inside the sandbox, for the other checks to load. */
export const SIGNED_IN_STATE_PATH = '/tmp/nbai-signed-in.json';
export const SIGN_IN_TOOLS_DIR = '/home/user/.e-tools';
export const SIGN_IN_RESULT_MARKER = 'NBAI_SIGNIN ';
/** At most this many credential candidates are tried — never a list to brute-force with. */
export const MAX_SIGN_IN_CANDIDATES = 3;
/** Screens read behind the door for the feature probe. */
export const MAX_SIGNED_IN_SCREENS = 6;
export const SIGN_IN_BUDGET_MS = 45_000;

export function signInExploreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_SIGNIN_EXPLORE ?? '').trim().toLowerCase() !== 'off';
}

export interface SignInCandidate {
  identifier: string;
  password: string;
  /** Where it came from — the only thing about it a report may print. */
  source: 'demo account in the source' | 'sign-in form default' | 'demo hint on the page';
}

const EMAIL = String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`;
const Q = String.raw`['"\x60]`;

/** A value that is a placeholder or a key, never a demo password. */
function plausiblePassword(p: string): boolean {
  const v = String(p ?? '');
  if (v.length < 3 || v.length > 64) return false;
  if (/^(?:your|enter|type|\*+|•+|x+|placeholder|password here)/i.test(v)) return false;
  if (/^(?:sk|pk|rk)_|^AIza|^eyJ|^[A-Za-z0-9+/]{40,}={0,2}$/.test(v)) return false; // an API key or token, not a login
  return true;
}

/**
 * The demo accounts an app's OWN files carry. Three shapes, strongest first:
 *   1. an object literal `{ email: 'a@b.c', …, password: 'x' }` (seed users, a demo-accounts list);
 *   2. a sign-in component whose state starts filled — `useState('a@b.c')` beside a password state that
 *      starts as a literal (exactly the report's Login page);
 *   3. a demo hint written for people — "Demo: admin@x.com / password: admin123".
 * De-duplicated, capped at MAX_SIGN_IN_CANDIDATES. PURE.
 */
export function signInCandidates(files: Readonly<Record<string, string>>): SignInCandidate[] {
  const out: SignInCandidate[] = [];
  const seen = new Set<string>();
  const add = (identifier: string, password: string, source: SignInCandidate['source']) => {
    const key = `${identifier}\u0000${password}`;
    if (!identifier || !plausiblePassword(password) || seen.has(key)) return;
    seen.add(key);
    out.push({ identifier, password, source });
  };
  const sources = Object.entries(files ?? {})
    .filter(([p, c]) => typeof c === 'string' && /\.(?:[cm]?[jt]sx?|vue|svelte|html)$/i.test(p) && !/(?:^|\/)(?:node_modules|dist)\//.test(p) && !/\.(?:test|spec)\./.test(p))
    .slice(0, 400);

  // 🔴 A demo password may sit behind a hash call or under a `passwordHash` key (autopsy 70e030bb):
  // `const DEMO_USER = { username: "student", passwordHash: hashPassword("demo123") }`. The plaintext
  // is still the literal the app compares against, so it is the password a person types.
  const pair = new RegExp(String.raw`\b(?:email|username|user(?:name)?|login)\s*:\s*${Q}(${EMAIL}|[\w.-]{3,40})${Q}[^{}]{0,160}?\b(?:password|pass(?:word)?(?:Hash|Digest)?)\s*:\s*(?:[\w$.]+\(\s*)?${Q}([^'"\x60\n]{3,64})${Q}`, 'gi');
  for (const [, c] of sources) for (const m of c.matchAll(pair)) add(m[1], m[2], 'demo account in the source');

  for (const [, c] of sources) {
    if (!/type=["']password["']/.test(c)) continue;
    const id = c.match(new RegExp(String.raw`useState(?:<[^>]*>)?\(\s*${Q}(${EMAIL})${Q}\s*\)`));
    const pw = c.match(new RegExp(String.raw`\[\s*\w*pass\w*\s*,\s*\w+\s*\]\s*=\s*useState(?:<[^>]*>)?\(\s*${Q}([^'"\x60\n]{3,64})${Q}\s*\)`, 'i'));
    if (id && pw) add(id[1], pw[1], 'sign-in form default');
  }

  // A demo map keyed by email whose password is a constant in the same file — the report's own shape:
  // `const commonPassword = '…'; export const passwordMap = { 'admin@x.ai': commonPassword, … }`.
  for (const [, c] of sources) {
    if (!/password/i.test(c)) continue;
    const consts = new Map<string, string>();
    for (const m of c.matchAll(new RegExp(String.raw`\bconst\s+(\w*pass\w*)\s*(?::\s*string)?\s*=\s*${Q}([^'"\x60\n]{3,64})${Q}`, 'gi'))) consts.set(m[1], m[2]);
    for (const m of c.matchAll(new RegExp(String.raw`${Q}(${EMAIL})${Q}\s*:\s*(?:${Q}([^'"\x60\n]{3,64})${Q}|(\w+))`, 'g'))) {
      const pwv = m[2] ?? (m[3] ? consts.get(m[3]) : undefined);
      if (pwv) add(m[1], pwv, 'demo account in the source');
    }
  }

  const hint = new RegExp(String.raw`\b(?:demo|test|sample)\b[^\n<]{0,40}?(${EMAIL})[^\n<]{0,40}?\b(?:password|pass|pwd)\b\s*[:=]?\s*${Q}?([^\s'"\x60<,)]{3,40})`, 'gi');
  for (const [, c] of sources) for (const m of c.matchAll(hint)) add(m[1], m[2], 'demo hint on the page');

  return out.slice(0, MAX_SIGN_IN_CANDIDATES);
}

export interface SignedInScreen { path: string; html: string }
export interface SignInRun {
  /** False when the script never reported (it could not run) — "we do not know", not "no wall". */
  ran: boolean;
  signedIn: boolean;
  /** Why it did not sign in, in plain words — or which candidate source worked. */
  note: string;
  screens: SignedInScreen[];
}

/** Parse the script's one result line. PURE. */
export function parseSignInOutput(stdout: string | null | undefined): SignInRun {
  const line = String(stdout ?? '').split('\n').find((l) => l.startsWith(SIGN_IN_RESULT_MARKER));
  if (!line) return { ran: false, signedIn: false, note: 'the sign-in check did not run', screens: [] };
  try {
    const o = JSON.parse(line.slice(SIGN_IN_RESULT_MARKER.length)) as Partial<SignInRun> & { screens?: unknown };
    const screens = Array.isArray(o.screens)
      ? (o.screens as SignedInScreen[]).filter((s) => s && typeof s.html === 'string').slice(0, MAX_SIGNED_IN_SCREENS)
      : [];
    return { ran: true, signedIn: o.signedIn === true, note: String(o.note ?? ''), screens };
  } catch {
    return { ran: false, signedIn: false, note: 'the sign-in check produced output we could not read', screens: [] };
  }
}

/**
 * The in-sandbox script. Tries the form AS THE APP FILLED IT first (no typing at all), then each
 * candidate; succeeds only when the password field is gone afterwards — a failed sign-in that stays on
 * the page is never read as success. On success it saves the session and reads a few screens behind the
 * door by following the app's own same-origin links (never one whose name deletes, pays or signs out).
 */
export function signInScript(previewUrl: string, candidates: readonly SignInCandidate[]): string {
  const cfg = {
    base: String(previewUrl ?? '').trim(),
    marker: SIGN_IN_RESULT_MARKER,
    state: SIGNED_IN_STATE_PATH,
    maxScreens: MAX_SIGNED_IN_SCREENS,
    budgetMs: SIGN_IN_BUDGET_MS,
    candidates: candidates.slice(0, MAX_SIGN_IN_CANDIDATES).map((c) => ({ identifier: c.identifier, password: c.password, source: c.source })),
  };
  return `cat > /tmp/nbai-signin.mjs <<'NBAI_EOF'
${signInModule(cfg)}
NBAI_EOF
${browserScriptRunLine({ toolsDir: SIGN_IN_TOOLS_DIR, scriptPath: '/tmp/nbai-signin.mjs', marker: SIGN_IN_RESULT_MARKER })}`;
}

/**
 * Links the signed-in explorer never follows. English as before, plus the Hindi / Hinglish words for the same
 * actions (autopsy de3bb2bb: the click explorer's English-only list pressed "Itihaas saaf karein") — this
 * module had its own English-only copy, the sibling that fix had to reach too.
 */
export const SIGN_IN_NEVER = new RegExp(
  `(delete|remove|log ?out|sign ?out|pay|checkout|buy|reset|clear|${DESTRUCTIVE_LOCAL_WORDS}|${SPENDING_LOCAL_WORDS})|${DEVANAGARI_NEVER_WORDS}`,
  'i',
);

/** The ES module itself, split out so a test can run it in a real browser. */
export function signInModule(cfg: Record<string, unknown>, importLine: string = playwrightImport(SIGN_IN_TOOLS_DIR)): string {
  return `${importLine}
const cfg = ${JSON.stringify(cfg)};
const started = Date.now();
const say = (o) => console.log(cfg.marker + JSON.stringify(o));
const NEVER = new RegExp(${JSON.stringify(SIGN_IN_NEVER.source)}, 'i');

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}
async function wallVisible(page) {
  const pw = page.locator('input[type=password]');
  if (await pw.count() === 0) return false;
  return await pw.first().isVisible().catch(() => false);
}
async function attempt(page, cand) {
  await page.goto(cfg.base, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await settle(page);
  if (!(await wallVisible(page))) return 'no-wall';
  const pw = page.locator('input[type=password]').first();
  const form = pw.locator('xpath=ancestor::form[1]');
  const scope = (await form.count()) > 0 ? form : page.locator('body');
  const ident = scope.locator('input[type=email], input[type=text], input[autocomplete=username], input:not([type])').first();
  if (cand) {
    if (await ident.count() > 0) await ident.fill(cand.identifier);
    await pw.fill(cand.password);
  } else {
    const idVal = (await ident.count()) > 0 ? await ident.inputValue().catch(() => '') : 'none';
    const pwVal = await pw.inputValue().catch(() => '');
    if (!idVal || !pwVal) return 'not-prefilled';
  }
  const submit = scope.locator('button[type=submit], input[type=submit]').first();
  if (await submit.count() > 0) await submit.click({ timeout: 4000 });
  else await pw.press('Enter');
  await settle(page);
  return (await wallVisible(page)) ? 'still-on-wall' : 'signed-in';
}

// A ONE-TAP demo sign-in ("Demo Student", "Try the demo", "Continue as guest"): no password involved.
// No backslashes here on purpose — this module is a TS template, where one would be swallowed.
const DEMO = /(^|[^a-z])(demo|guest)([^a-z]|$)|try (it|the app) free/i;
async function demoButtons(page) {
  const all = page.locator('button, a[href], [role=button]');
  const n = Math.min(await all.count(), 40);
  const names = [];
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const name = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || '').trim();
    if (name && name.length <= 40 && DEMO.test(name) && !NEVER.test(name)) names.push(name);
  }
  return names;
}
async function attemptDemo(page, name) {
  await page.goto(cfg.base, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await settle(page);
  if (!(await wallVisible(page))) return 'no-wall';
  const el = page.locator('button, a[href], [role=button]').filter({ hasText: name }).first();
  if (await el.count() === 0) return 'still-on-wall';
  await el.click({ timeout: 4000 });
  await settle(page);
  if (!(await wallVisible(page))) return 'signed-in';
  // Many demo buttons only FILL the form: submit it when the password box now holds a value.
  const pw = page.locator('input[type=password]').first();
  if (!(await pw.inputValue().catch(() => ''))) return 'still-on-wall';
  const form = pw.locator('xpath=ancestor::form[1]');
  const scope = (await form.count()) > 0 ? form : page.locator('body');
  const submit = scope.locator('button[type=submit], input[type=submit]').first();
  if (await submit.count() > 0) await submit.click({ timeout: 4000 });
  else await pw.press('Enter');
  await settle(page);
  return (await wallVisible(page)) ? 'still-on-wall' : 'signed-in';
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext(${JSON.stringify(BROWSER_PAGE_OPTIONS)});
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  let signed = false;
  let note = '';
  const tries = [null, ...cfg.candidates];
  for (const cand of tries) {
    if (Date.now() - started > cfg.budgetMs - 10000) { note = 'ran out of time before signing in'; break; }
    let r;
    try { r = await attempt(page, cand); } catch (e) { r = 'error'; }
    if (r === 'no-wall') { note = 'the app did not show a sign-in page'; break; }
    if (r === 'signed-in') { signed = true; note = cand ? cand.source : 'sign-in form default'; break; }
  }
  if (!signed && !note) {
    let names = [];
    try { await page.goto(cfg.base, { waitUntil: 'domcontentloaded', timeout: 12000 }); await settle(page); names = await demoButtons(page); } catch (e) { names = []; }
    for (const name of names.slice(0, 3)) {
      if (Date.now() - started > cfg.budgetMs - 10000) { note = 'ran out of time before signing in'; break; }
      let r;
      try { r = await attemptDemo(page, name); } catch (e) { r = 'error'; }
      if (r === 'signed-in') { signed = true; note = 'one-tap demo button on the sign-in page'; break; }
    }
  }
  if (!signed) {
    if (!note) note = cfg.candidates.length ? 'none of the demo accounts the app ships got past its sign-in page' : 'the app ships no demo account or demo button to sign in with';
    say({ signedIn: false, note, screens: [] });
  } else {
    await ctx.storageState({ path: cfg.state });
    const screens = [];
    const origin = new URL(page.url()).origin;
    screens.push({ path: new URL(page.url()).pathname, html: (await page.content()).slice(0, 60000) });
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim() })));
    const seen = new Set(screens.map((s) => s.path));
    for (const l of links) {
      if (screens.length >= cfg.maxScreens || Date.now() - started > cfg.budgetMs - 5000) break;
      let u; try { u = new URL(l.href); } catch (e) { continue; }
      if (u.origin !== origin || seen.has(u.pathname) || NEVER.test(l.text) || NEVER.test(u.pathname)) continue;
      seen.add(u.pathname);
      try {
        await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await settle(page);
        if (await wallVisible(page)) continue;
        screens.push({ path: u.pathname, html: (await page.content()).slice(0, 60000) });
      } catch (e) { /* one screen that would not open is not the app's verdict */ }
    }
    say({ signedIn: true, note, screens });
  }
} finally {
  await browser.close().catch(() => {});
}
`;
}

/**
 * How another in-sandbox script opens a page: with the saved session when there is one. The other
 * scripts interpolate this so the session is used the same way everywhere. PURE.
 */
export function newPageOptionsExpr(storageState: string | null | undefined): string {
  return JSON.stringify(storageState ? { ...BROWSER_PAGE_OPTIONS, storageState } : BROWSER_PAGE_OPTIONS);
}

/**
 * Every page our in-sandbox browsers open asks for REDUCED MOTION (autopsy 0bb437b4, 2026-09-30).
 * The design kit's game button pulses for ever (`.nb-game-btn` → `nb-pulse … infinite`), and
 * Playwright presses only an element that has stopped moving — so "Start Race" timed out after four
 * seconds on every attempt and the explorer reported the app as having "nothing safe to press". The
 * kit already honours `prefers-reduced-motion` (animations end after one 0.01ms run), so asking for it
 * settles the page without changing what the app shows or does. One definition, every lane.
 */
export const BROWSER_PAGE_OPTIONS: Readonly<{ reducedMotion: 'reduce' }> = Object.freeze({ reducedMotion: 'reduce' });

/** A route that IS the sign-in page — a signed-in session would only be redirected away from it. */
export function isSignInRoute(route: string): boolean {
  return /(?:^|\/)(?:login|log-in|signin|sign-in|auth|register|signup|sign-up)(?:\/|$)/i.test(String(route ?? ''));
}

/** The admin line for a sign-in attempt. Never carries a credential. PURE. */
export function signInReportLine(run: SignInRun): { code: 'AUTH_EXPLORE_SIGNED_IN' | 'AUTH_EXPLORE_NOT_RUN'; message: string } {
  if (run.signedIn) {
    return {
      code: 'AUTH_EXPLORE_SIGNED_IN',
      message: `Signed in behind the app's sign-in page (${run.note}) and checked ${run.screens.length} screen(s) there; the page check, the form journeys and the click explorer used the same session.`,
    };
  }
  return { code: 'AUTH_EXPLORE_NOT_RUN', message: `The app's screens are behind a sign-in page and were not checked from inside: ${run.note || 'the sign-in check did not run'}.` };
}
