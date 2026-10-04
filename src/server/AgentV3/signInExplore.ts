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
 *   - create an account in an app with a real backend — sign-up writes a real row, and on the user's own
 *     database (or NavBharatAI's shared `NavData` rows) that is somebody's data;
 *   - print a credential — the report says WHERE the account came from, never what it is.
 *
 * 🆕 THE ONE ACCOUNT IT MAY CREATE (queue Q-540, autopsy 68f0a486; admin decision 2026-10-04, option (b):
 * "jo bhi function banaye jaye woh real hone chahiye"). A school app kept its users in `localStorage`, shipped
 * no demo account, and so every screen behind its sign-in page — fees, attendance, uploads — went unchecked
 * while the summary said they worked. When an app's accounts live in the BROWSER ALONE
 * (`authLivesInTheBrowser`: no server, no hosted auth or database SDK, no network call that signs anyone
 * in, and accounts kept in browser storage), signing up writes only into the check's own throwaway browser
 * profile, which is discarded when the check ends. There, and only there, the check signs up ONE throwaway
 * account through the app's own sign-up form and signs in with it. Every other app keeps the rule above.
 * No way in ⇒ it says so (`AUTH_EXPLORE_NOT_RUN`) and every check runs as before.
 *
 * PURE: the candidate reader, the script builder and the output parser. The route runs the script.
 */
import { playwrightImport, browserScriptRunLine } from './sandboxBrowserScript';
import { DESTRUCTIVE_LOCAL_WORDS, SPENDING_LOCAL_WORDS, DEVANAGARI_NEVER_WORDS } from './localActionWords';
import { detectBackendPresence } from './BackendPresence';

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

/** Hosted sign-in or a hosted database: an account made there is a real row somebody owns. */
const HOSTED_AUTH_OR_DATA = /@supabase\/|\bsupabase\b|\bfirebase\b|@firebase\/|auth0|@clerk\/|next-auth|\bnextauth\b|\bappwrite\b|pocketbase|aws-amplify|amazon-cognito|@nhost\/|better-auth|\blucia\b|\bpassport\b|@kinde|stytch|magic-sdk|@okta\/|\bNavData\b|mongodb(?:\+srv)?:\/\/|\bDATABASE_URL\b/i;
/** A network call that signs someone in, or any call to an `/api/` route — a server owns the accounts. */
const NETWORK_SIGN_IN = /(?:\bfetch|\baxios(?:\.\w+)?|\.(?:post|put))\s*\(\s*[`'"][^`'"]*(?:\/api\/|auth|log-?in|sign-?in|sign-?up|register|session|token|\/users?\b)/i;
/** An app base URL read from the environment: the requests go to a server we cannot see. */
const ENV_API_BASE = /import\.meta\.env\.VITE_\w*(?:API|BACKEND|SERVER)\w*|process\.env\.(?:NEXT_PUBLIC_|REACT_APP_)\w*(?:API|BACKEND|SERVER)\w*/;
/** Browser storage — where a browser-only app keeps its accounts. */
const BROWSER_STORE = /\b(?:localStorage|sessionStorage|indexedDB)\b|from\s*['"](?:localforage|dexie|idb-keyval|idb)['"]/;

/**
 * Do this app's accounts live in the BROWSER ALONE? (Q-540.) True only with all of: no backend
 * (`detectBackendPresence`), no hosted auth or database SDK, no network call that signs anyone in, no API
 * base URL from the environment — AND positive evidence: a file that handles a password also writes
 * browser storage. Anything uncertain answers false, which keeps the old rule (no account is created).
 * PURE.
 */
export function authLivesInTheBrowser(files: Readonly<Record<string, string>>): boolean {
  const all = Object.entries(files ?? {}).filter(([, c]) => typeof c === 'string');
  if (all.length === 0) return false;
  if (detectBackendPresence(Object.fromEntries(all)).hasBackend) return false;
  // Code, configuration and env files. A server directory or a serverless function is a backend even
  // when nothing above recognised its framework.
  // (`src/api/` is often a client module over localStorage, so only a ROOT `api/` counts — Vercel's functions.)
  if (all.some(([p]) => /^(?:api|functions|netlify\/functions|supabase)\/|(?:^|\/)(?:server|backend)\/|^server\.[cm]?[jt]s$/i.test(p))) return false;
  const code = all.filter(([p]) => /\.(?:[cm]?[jt]sx?|vue|svelte|html|json)$|(?:^|\/)\.env/i.test(p) && !/(?:^|\/)(?:node_modules|dist)\//.test(p) && !/package-lock\.json$/.test(p));
  for (const [, c] of code) {
    if (HOSTED_AUTH_OR_DATA.test(c) || NETWORK_SIGN_IN.test(c) || ENV_API_BASE.test(c)) return false;
  }
  return code.some(([p, c]) => !/\.json$/i.test(p) && /password/i.test(c) && BROWSER_STORE.test(c));
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
export function signInScript(previewUrl: string, candidates: readonly SignInCandidate[], opts: { mayCreateAccount?: boolean } = {}): string {
  const cfg = {
    // Only ever true for an app whose accounts live in the browser alone (`authLivesInTheBrowser`).
    mayCreateAccount: opts.mayCreateAccount === true,
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

// A THROWAWAY ACCOUNT, only where the app keeps its accounts in the browser alone (cfg.mayCreateAccount —
// the server decides that from the app's files, never this script). It lives in this check's own browser
// profile and is gone when the browser closes. Never printed: the report says only where it came from.
const SIGN_UP = /sign ?up|register|create (an |your |new )?account|new account|join now|naya khata|khata banay|panjikaran|darj karein/i;
function throwaway() {
  const r = Math.random().toString(36).slice(2, 8);
  return { identifier: 'nbai-check-' + r + '@example.com', username: 'nbaicheck' + r, password: 'Nb-check-' + r + '-9A' };
}
async function signUpControls(page) {
  const all = page.locator('button, a[href], [role=button], [role=tab]');
  const n = Math.min(await all.count(), 60);
  const names = [];
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const name = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || '').trim();
    if (name && name.length <= 40 && SIGN_UP.test(name) && !NEVER.test(name) && !names.includes(name)) names.push(name);
  }
  return names;
}
async function fillSignUp(page, who) {
  // The LAST visible password box: a page that keeps its sign-in form beside the new sign-up form puts
  // the sign-up one second, and its "confirm password" box shares that form.
  const pws = page.locator('input[type=password]');
  let pw = null;
  for (let i = Math.min(await pws.count(), 6) - 1; i >= 0 && !pw; i--) if (await pws.nth(i).isVisible().catch(() => false)) pw = pws.nth(i);
  if (!pw) return false;
  const form = pw.locator('xpath=ancestor::form[1]');
  const scope = (await form.count()) > 0 ? form : page.locator('body');
  const inputs = scope.locator('input, select, textarea');
  const n = Math.min(await inputs.count(), 25);
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    if (!(await el.isVisible().catch(() => false)) || !(await el.isEditable().catch(() => false))) continue;
    const tag = await el.evaluate((e) => e.tagName.toLowerCase()).catch(() => '');
    const type = ((await el.getAttribute('type').catch(() => '')) || 'text').toLowerCase();
    const hint = [await el.getAttribute('name').catch(() => ''), await el.getAttribute('id').catch(() => ''), await el.getAttribute('placeholder').catch(() => ''), await el.getAttribute('autocomplete').catch(() => ''), await el.getAttribute('aria-label').catch(() => '')].join(' ').toLowerCase();
    if (tag === 'select') {
      const opts = await el.locator('option').evaluateAll((os) => os.map((o) => o.value).filter((v) => v)).catch(() => []);
      if (!(await el.inputValue().catch(() => '')) && opts.length) await el.selectOption(opts[0]).catch(() => {});
      continue;
    }
    if (type === 'checkbox') { if (await el.getAttribute('required').catch(() => null) !== null) await el.check().catch(() => {}); continue; }
    if (['radio', 'hidden', 'submit', 'button', 'file', 'range', 'color'].includes(type)) continue;
    if (await el.inputValue().catch(() => '')) continue;
    let v = 'NavBharat Check';
    if (type === 'password') v = who.password;
    else if (type === 'email' || hint.includes('email') || hint.includes('mail')) v = who.identifier;
    else if (type === 'tel' || /phone|mobile/.test(hint)) v = '9876543210';
    else if (type === 'number') v = '1';
    else if (type === 'date') v = '2000-01-01';
    else if (/user ?name|login|userid/.test(hint)) v = who.username;
    await el.fill(v).catch(() => {});
  }
  const submit = scope.locator('button[type=submit], input[type=submit]').first();
  if (await submit.count() > 0) await submit.click({ timeout: 4000 });
  else {
    const named = scope.locator('button').filter({ hasText: SIGN_UP }).first();
    if (await named.count() > 0) await named.click({ timeout: 4000 });
    else await pw.press('Enter');
  }
  await settle(page);
  return true;
}
async function attemptSignUp(page, name, who) {
  await page.goto(cfg.base, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await settle(page);
  if (!(await wallVisible(page))) return 'no-wall';
  const el = page.locator('button, a[href], [role=button], [role=tab]').filter({ hasText: name }).first();
  if (await el.count() === 0) return 'still-on-wall';
  await el.click({ timeout: 4000 });
  await settle(page);
  if (!(await fillSignUp(page, who))) return 'still-on-wall';
  if (!(await wallVisible(page))) return 'signed-in';
  // Most apps send a new account back to the sign-in page: sign in with it, like a person would.
  const back = await attempt(page, { identifier: who.identifier, password: who.password });
  if (back === 'signed-in') return back;
  return await attempt(page, { identifier: who.username, password: who.password });
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
  if (!signed && !note && cfg.mayCreateAccount) {
    let names = [];
    try { await page.goto(cfg.base, { waitUntil: 'domcontentloaded', timeout: 12000 }); await settle(page); names = await signUpControls(page); } catch (e) { names = []; }
    const who = throwaway();
    for (const name of names.slice(0, 2)) {
      if (Date.now() - started > cfg.budgetMs - 10000) { note = 'ran out of time before signing in'; break; }
      let r;
      try { r = await attemptSignUp(page, name, who); } catch (e) { r = 'error'; }
      if (r === 'signed-in') { signed = true; note = 'a throwaway account the check created — the app keeps its accounts in the browser only'; break; }
    }
    if (!signed && !note) note = names.length ? 'its sign-up form did not let a new account in' : 'the app ships no demo account, and its sign-in page has no sign-up to create one with';
  }
  if (!signed) {
    if (!note) note = cfg.candidates.length ? 'none of the demo accounts the app ships got past its sign-in page' : 'the app ships no demo account or demo button to sign in with, and the check creates its own account only in an app that keeps its accounts in the browser alone';
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
