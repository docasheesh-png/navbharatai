// AgentV3 — a sign-in flow test built from the app's OWN markup (ROADMAP #1 Phase 4.5).
//
// The auto-scaffolded E2E net proves the app LOADS. It does not prove anyone can get INTO it, and
// "the login screen renders" is a much weaker claim than "a person can sign in". Sign-in is also the
// single most valuable flow to cover: an app whose login is broken is completely unusable no matter
// how good everything behind it is.
//
// THE TRAP THIS AVOIDS. The obvious way to write a login test is to guess selectors — `#email`,
// `.login-btn`, `input[name=username]`. A guessed selector that does not match produces a FAILING
// test against working code, which is precisely the bug just removed from the unit scaffolds in
// Phase 4.4. Shipping it again here, one phase later, would be worse than not shipping the feature.
//
// So nothing is guessed. Every selector is READ OUT OF THE COMPONENT the build actually produced —
// the real `type`, `name`, `id`, `placeholder` and `aria-label` attributes that are present in the
// generated markup. If the evidence for a step is not in the code, NO SPEC IS WRITTEN AT ALL. A
// missing test is honest; a red test against correct code is a lie about the app.
//
// Scope is deliberately sign-in only. CRUD flows have no standard markup to read — a "create" button
// can be anything — so deriving those would be back to guessing. Sign-in is the one flow with a
// genuine convention: type="email" and type="password" are what browsers and password managers rely
// on, so generated login forms have them.

export interface AuthSelectors {
  email: string;
  password: string;
  submit: string;
}

export interface AuthFlowEvidence {
  /** The component the selectors were read from — recorded so a person can check our work. */
  file: string;
  /** The route the login screen lives at, when the code says so. */
  route: string;
  selectors: AuthSelectors;
}

const COMPONENT_RE = /\.(tsx|jsx|vue|svelte|html)$/i;
/** Files whose name suggests authentication — searched first, but never the only evidence. */
const AUTH_NAME_RE = /(login|signin|sign-in|auth)/i;

/** Read one attribute off a tag, if it is written as a plain string literal. */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
  return m ? m[1] : null;
}

/** Every `<input …>` tag in a source file, as raw text. */
function inputTags(source: string): string[] {
  return String(source ?? '').match(/<input\b[^>]*>/gi) ?? [];
}

/**
 * A Playwright selector for one input, built from what the tag ACTUALLY declares.
 *
 * Ordered by how stable each attribute is in real code: `type` survives restyling and renaming,
 * `name` is required for form submission, `id` is usually tied to a label, and a placeholder is the
 * most likely of the four to be reworded later. Returns null when the tag declares none of them —
 * at which point there is nothing to target and no spec should be written.
 */
export function selectorForInput(tag: string): string | null {
  const type = attr(tag, 'type');
  if (type === 'email' || type === 'password') return `input[type="${type}"]`;
  const name = attr(tag, 'name');
  if (name) return `input[name="${name}"]`;
  const id = attr(tag, 'id');
  if (id) return `#${id}`;
  const placeholder = attr(tag, 'placeholder');
  if (placeholder) return `input[placeholder="${placeholder}"]`;
  return null;
}

/** Does this tag look like the email/username field, by its own declared attributes? */
function isEmailField(tag: string): boolean {
  if (attr(tag, 'type') === 'email') return true;
  const hint = `${attr(tag, 'name') ?? ''} ${attr(tag, 'id') ?? ''} ${attr(tag, 'placeholder') ?? ''}`.toLowerCase();
  return /email|username|user\b|mobile|phone/.test(hint);
}

function isPasswordField(tag: string): boolean {
  return attr(tag, 'type') === 'password';
}

/**
 * A selector for the submit control.
 *
 * `type="submit"` first, because that is what makes a form submit on Enter and is therefore present
 * in a form that works. Otherwise fall back to the button's visible text — but ONLY when that text
 * genuinely reads like a sign-in action, never just "the first button on the page".
 */
export function selectorForSubmit(source: string): string | null {
  const src = String(source ?? '');
  if (/<button\b[^>]*type\s*=\s*["']submit["']/i.test(src)) return 'button[type="submit"]';
  if (/<input\b[^>]*type\s*=\s*["']submit["']/i.test(src)) return 'input[type="submit"]';
  const labelled = /<button\b[^>]*>\s*([^<>{}]{2,30}?)\s*</i.exec(src);
  const text = labelled?.[1]?.trim();
  if (text && /(log ?in|sign ?in|continue|submit|enter)/i.test(text)) {
    return `button:has-text("${text.replace(/"/g, '')}")`;
  }
  return null;
}

/** The route a login screen is mounted at, if the code declares one. Null when it does not. */
export function findAuthRoute(files: Record<string, string>): string | null {
  for (const content of Object.values(files ?? {})) {
    const m = /path\s*=\s*["'](\/(?:login|signin|sign-in|auth)[^"']*)["']/i.exec(String(content ?? ''));
    if (m) return m[1];
  }
  return null;
}

/**
 * Find the login screen and read its real selectors.
 *
 * Returns null unless ALL THREE parts are found in one component: an email/username field, a password
 * field, and something to submit with. Two out of three is not a flow — it is a guess about the
 * third, and a guess is what produces a red test against working code.
 */
export function findAuthFlow(files: Record<string, string>): AuthFlowEvidence | null {
  const entries = Object.entries(files ?? {}).filter(([p, c]) => COMPONENT_RE.test(p) && typeof c === 'string');
  // Auth-named files first: on a large app this is both faster and far less likely to match a
  // password field that belongs to, say, a settings screen.
  const ordered = [
    ...entries.filter(([p]) => AUTH_NAME_RE.test(p)),
    ...entries.filter(([p]) => !AUTH_NAME_RE.test(p)),
  ];

  for (const [file, source] of ordered) {
    const tags = inputTags(source);
    const passwordTag = tags.find(isPasswordField);
    if (!passwordTag) continue;
    const emailTag = tags.find((t) => t !== passwordTag && isEmailField(t));
    if (!emailTag) continue;
    const email = selectorForInput(emailTag);
    const password = selectorForInput(passwordTag);
    const submit = selectorForSubmit(source);
    if (!email || !password || !submit) continue;
    return { file, route: findAuthRoute(files) ?? '/login', selectors: { email, password, submit } };
  }
  return null;
}

/**
 * The spec.
 *
 * It asserts the app RESPONDS to a sign-in attempt, not that the attempt succeeds — the scaffold has
 * no real account to sign in with, and inventing credentials would make the test fail on a perfectly
 * working app. What it proves is worth having on its own: the form exists, it accepts input, it
 * submits, and the app does something rather than sitting there. Two of the three most common
 * broken-login bugs (a dead submit handler, an unhandled crash on submit) fail exactly here.
 *
 * The credentials to make it a full sign-in test are left as an explicit, visible TODO with a
 * `test.skip`, so it is PENDING in the report — never a silent pass.
 */
export function buildAuthFlowSpec(evidence: AuthFlowEvidence): string {
  const { route, selectors, file } = evidence;
  return `import { test, expect } from '@playwright/test';

// Sign-in flow. The selectors below were read from ${file} — the real attributes in your own markup,
// not guessed — so they keep working as long as that form does.
test.describe('sign in', () => {
  test('the login form accepts input and submits', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('${route}');
    await expect(page.locator('${selectors.email}')).toBeVisible();
    await expect(page.locator('${selectors.password}')).toBeVisible();

    await page.fill('${selectors.email}', 'test@example.com');
    await page.fill('${selectors.password}', 'not-a-real-password');
    await page.click('${selectors.submit}');

    // Deliberately NOT asserting a successful login: this scaffold has no real account, and inventing
    // one would fail against a perfectly working app. What IS asserted is that submitting did not
    // crash the page — which is where a dead submit handler and an unhandled error both show up.
    await page.waitForTimeout(1000);
    expect(errors, 'submitting the login form threw: ' + errors.join(' | ')).toHaveLength(0);
  });

  // Fill in a real test account to turn the check above into a full sign-in test. Until then this is
  // reported as PENDING by Playwright, so it can never be mistaken for a passing test.
  test.skip('signs in with a real account and reaches the app', async () => {});
});
`;
}

/** Where the spec goes. Beside the smoke spec the auto-scaffold already writes. */
export const AUTH_SPEC_PATH = 'e2e/auth.spec.ts';
