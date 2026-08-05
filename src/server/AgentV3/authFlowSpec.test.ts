import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  findAuthFlow, findAuthRoute, selectorForInput, selectorForSubmit, buildAuthFlowSpec,
} from './authFlowSpec';

const LOGIN = `
export default function Login() {
  return (
    <form onSubmit={submit}>
      <input type="email" name="email" placeholder="Email" />
      <input type="password" name="password" placeholder="Password" />
      <button type="submit">Sign in</button>
    </form>
  );
}`;

describe('selectors are READ from the markup, never guessed', () => {
  it('prefers the attribute that survives a restyle', () => {
    // type outlives renaming and restyling; a placeholder is the most likely of the four to change.
    expect(selectorForInput('<input type="email" name="e" id="x" placeholder="Email" />')).toBe('input[type="email"]');
    expect(selectorForInput('<input name="username" id="x" />')).toBe('input[name="username"]');
    expect(selectorForInput('<input id="user" />')).toBe('#user');
    expect(selectorForInput('<input placeholder="Your email" />')).toBe('input[placeholder="Your email"]');
  });

  it('returns null when the tag declares nothing to target', () => {
    // Nothing to aim at means no spec — not a guess that will fail against working code.
    expect(selectorForInput('<input />')).toBeNull();
    expect(selectorForInput('<input class="w-full" />')).toBeNull();
  });

  it('finds the submit control, and refuses to just take the first button', () => {
    expect(selectorForSubmit('<button type="submit">Go</button>')).toBe('button[type="submit"]');
    expect(selectorForSubmit('<button>Log in</button>')).toBe('button:has-text("Log in")');
    // A cancel button is not a submit button, and treating it as one would test the wrong thing.
    expect(selectorForSubmit('<button>Cancel</button>')).toBeNull();
    expect(selectorForSubmit('<div>no buttons here</div>')).toBeNull();
  });
});

describe('findAuthFlow — all three parts, or nothing', () => {
  it('reads a real login component', () => {
    const found = findAuthFlow({ 'src/pages/Login.tsx': LOGIN });
    expect(found).toMatchObject({
      file: 'src/pages/Login.tsx',
      selectors: { email: 'input[type="email"]', password: 'input[type="password"]', submit: 'button[type="submit"]' },
    });
  });

  it('accepts a username field, not only type=email', () => {
    const src = LOGIN.replace('<input type="email" name="email" placeholder="Email" />', '<input name="username" />');
    expect(findAuthFlow({ 'src/Login.tsx': src })?.selectors.email).toBe('input[name="username"]');
  });

  it('writes NOTHING when a part is missing — two out of three is a guess about the third', () => {
    // No password field:
    expect(findAuthFlow({ 'src/Login.tsx': '<form><input type="email" /><button type="submit">Go</button></form>' })).toBeNull();
    // No submit control:
    expect(findAuthFlow({ 'src/Login.tsx': '<form><input type="email" /><input type="password" /></form>' })).toBeNull();
    // No identifying attributes at all:
    expect(findAuthFlow({ 'src/Login.tsx': '<form><input /><input /><button type="submit">Go</button></form>' })).toBeNull();
  });

  it('does not mistake a settings page\'s password field for a login screen', () => {
    // Auth-named files are searched first precisely so a "change password" form does not win.
    const settings = '<form><input type="password" name="new" /><input name="email" /><button type="submit">Save</button></form>';
    const found = findAuthFlow({ 'src/Settings.tsx': settings, 'src/pages/Login.tsx': LOGIN });
    expect(found?.file).toBe('src/pages/Login.tsx');
  });

  it('ignores an app with no login at all, and junk input', () => {
    expect(findAuthFlow({ 'src/App.tsx': 'export default () => <h1>Hi</h1>;' })).toBeNull();
    expect(findAuthFlow({})).toBeNull();
    expect(findAuthFlow(null as never)).toBeNull();
  });
});

describe('findAuthRoute', () => {
  it('uses the route the code declares', () => {
    expect(findAuthRoute({ 'src/App.tsx': '<Route path="/signin" element={<Login/>} />' })).toBe('/signin');
  });

  it('falls back to /login only when the code says nothing', () => {
    expect(findAuthRoute({ 'src/App.tsx': 'no routes' })).toBeNull();
    expect(findAuthFlow({ 'src/Login.tsx': LOGIN })?.route).toBe('/login');
  });
});

describe('the spec it writes', () => {
  const spec = buildAuthFlowSpec({
    file: 'src/pages/Login.tsx',
    route: '/login',
    selectors: { email: 'input[type="email"]', password: 'input[type="password"]', submit: 'button[type="submit"]' },
  });

  it('drives the real form with the real selectors', () => {
    expect(spec).toContain("await page.goto('/login')");
    expect(spec).toContain(`page.fill('input[type="email"]'`);
    expect(spec).toContain(`page.click('button[type="submit"]')`);
  });

  it('does NOT assert a successful login, because it has no real account', () => {
    // Inventing credentials would fail against a perfectly working app — the same class of bug the
    // unit scaffolds carried until Phase 4.4.
    expect(spec).toContain('Deliberately NOT asserting a successful login');
    expect(spec).not.toContain('toHaveURL');
    expect(spec).not.toContain('/dashboard');
  });

  it('asserts the thing it CAN prove: submitting did not crash the page', () => {
    // Where a dead submit handler and an unhandled error both show up.
    expect(spec).toContain("page.on('pageerror'");
    expect(spec).toContain('toHaveLength(0)');
  });

  it('leaves the full sign-in as a PENDING test, never a silent pass', () => {
    expect(spec).toContain('test.skip(');
    expect(spec).toContain('Fill in a real test account');
  });

  it('names the file the selectors came from, so a person can check our work', () => {
    expect(spec).toContain('read from src/pages/Login.tsx');
  });
});

describe('wired into the E2E scaffold', () => {
  const route = readFileSync(join(__dirname, '..', 'routes', 'agentv3.ts'), 'utf8');

  it('rides the same scaffold pass, so it inherits its refusals', () => {
    // The import-turn refusal, the failed-build refusal and the create-only rule are all decided by
    // shouldAutoScaffoldE2e above this — duplicating them here is how the two would drift.
    const at = route.indexOf('findAuthFlow(e2eFiles)');
    expect(at).toBeGreaterThan(-1);
    expect(route.lastIndexOf('shouldAutoScaffoldE2e(', at)).toBeGreaterThan(-1);
  });

  it('never overwrites an auth spec the user already has', () => {
    expect(route).toContain('if (!authExists)');
  });

  it('tells the user which file the selectors came from', () => {
    expect(route).toContain('reads its selectors from ${auth.file}');
  });

  it('writes nothing when the markup has no login form', () => {
    // findAuthFlow returns null, and the `if (auth)` guard is the whole story — no fallback spec.
    const at = route.indexOf('findAuthFlow(e2eFiles)');
    expect(route.slice(at, at + 700)).toContain('if (auth) {');
  });
});
