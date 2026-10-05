// CRASH REPORTS CARRY NO SECRETS, CANNOT STORM, AND CANNOT CRASH THE APP (Crashlytics, 2026-10-04).
//
// The reporter (src/lib/observability) is the one door every client error leaves through: to Firebase
// Crashlytics inside the phone apps and to our own /api/logs/error everywhere. These tests hold the
// promises the admin's brief made non-negotiable, each one against the real module:
//   §1 sanitization — tokens, JWTs, keys, passwords, payment data, URL queries never leave the device;
//   §2 fail-safe — an SDK that throws, rejects or never loads changes nothing for the app;
//   §3 storms — duplicates, floods and errors raised while reporting are bounded;
//   §4 user context — only a one-way hash of the uid, cleared on sign-out;
//   §5 the ErrorBoundary and the global handlers report through the reporter, nowhere else;
//   §6 the server intake sanitizes again and dist/'s private files are never served;
//   §7 native wiring and the crash-test gate.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeText, sanitizeUrl, sanitizeKeys, REDACTED } from '../src/lib/observability/sanitize';
import {
  initializeObservability, recordError, recordNonFatal, setUserContext, clearUserContext, setCrashKey,
  buildReport, parseStack, crashUserId, crashTestTools, featureAreaForView, droppedReports,
  __resetObservability, RATE_LIMIT, DEDUP_WINDOW_MS, type CrashlyticsSink, type ObservabilityDeps,
} from '../src/lib/observability';
import { clientErrorRecord } from '../src/server/routes/telemetry';
import { isServerOnlyArtifactPath } from '../src/server/lib/serverOnlyArtifacts';
import { firstComponent } from '../src/components/ErrorBoundary';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const JWT = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.eyJ1c2VyX2lkIjoiYWJjZGVmZ2hpamtsbW5vcCJ9.c2lnbmF0dXJlc2lnbmF0dXJlc2lnbmF0dXJl';

describe('§1 nothing private leaves the device', () => {
  it.each([
    ['an Authorization header with a JWT', `Authorization: Bearer ${JWT}`, JWT],
    ['an opaque Bearer token', 'request failed: Bearer ya29.a0AfB_byC-opaque-oauth-token', 'ya29.a0AfB_byC-opaque-oauth-token'],
    ['a bare Firebase ID token', `token rejected ${JWT}`, JWT],
    ['an API key', 'key AIzaSyA1234567890abcdefghijklmnopqrstuv failed', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
    ['a provider key', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'],
    ['a GitHub token', 'gho_abcdefghijklmnopqrstuvwxyz0123456789AB', 'gho_abcdefghijklmnopqrstuvwxyz0123456789AB'],
    ['a password assignment', 'login failed password=hunter2secret', 'hunter2secret'],
    ['a cookie', 'Cookie: session=abc123def456; theme=dark', 'abc123def456'],
    ['a card number', 'charge 4111 1111 1111 1111 declined', '4111 1111 1111 1111'],
    ['a UPI address', 'collect request to rahul.sharma@okhdfcbank failed', 'rahul.sharma@okhdfcbank'],
    ['an email', 'no account for priya@example.com', 'priya@example.com'],
    ['an Indian mobile number', 'OTP to 9876543210 failed', '9876543210'],
    ['a URL query with an OAuth code', 'GET https://navbharatai.com/auth/callback?code=4/0AbCdEf&state=xyz', 'code=4/0AbCdEf'],
  ])('redacts %s', (_label, input, secret) => {
    const out = sanitizeText(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it('leaves an ordinary error readable', () => {
    expect(sanitizeText("TypeError: Cannot read properties of undefined (reading 'map')"))
      .toBe("TypeError: Cannot read properties of undefined (reading 'map')");
  });

  it('does not mistake an order number for a card (Luhn)', () => {
    expect(sanitizeText('order 1234567812345678 not found')).toContain('1234567812345678');
  });

  it('keeps only the origin and path of a page URL', () => {
    expect(sanitizeUrl('https://navbharatai.com/app?view=billing&token=abc#frag')).toBe('https://navbharatai.com/app');
  });

  it('refuses custom keys whose NAME suggests private data, whatever the value', () => {
    const keys = sanitizeKeys({ screen: 'billing', wallet_balance: 500, user_prompt: 'x', auth_token: 'y', retries: 2, 'Bad-Key': 1 });
    expect(keys).toEqual({ screen: 'billing', retries: 2 });
  });

  it('never copies a property of the error other than its message and stack', () => {
    const err = Object.assign(new Error('Request failed'), { config: { data: '{"prompt":"my private app idea"}' }, prompt: 'secret plan' });
    const report = buildReport(err, { kind: 'handled' });
    expect(JSON.stringify(report)).not.toContain('private app idea');
    expect(JSON.stringify(report)).not.toContain('secret plan');
  });

  it('a sanitizer that cannot read its input sends nothing rather than the raw text', () => {
    const hostile = { toString() { throw new Error('boom'); } };
    expect(sanitizeText(hostile)).toBe('');
  });
});

function harness(over: Partial<ObservabilityDeps> = {}, sinkOver: Partial<CrashlyticsSink> = {}) {
  const posted: string[] = [];
  const calls: { kind: string; arg: unknown }[] = [];
  const sink: CrashlyticsSink = {
    recordException: async (r) => { calls.push({ kind: 'record', arg: r }); },
    setUserId: async (id) => { calls.push({ kind: 'user', arg: id }); },
    setCustomKey: async (k, v) => { calls.push({ kind: 'key', arg: [k, v] }); },
    log: async (m) => { calls.push({ kind: 'log', arg: m }); },
    crash: async () => { calls.push({ kind: 'crash', arg: null }); },
    ...sinkOver,
  };
  let t = 1_000_000;
  const deps: ObservabilityDeps = {
    enabled: true,
    postLog: (b) => { posted.push(b); },
    loadCrashlytics: async () => sink,
    now: () => t,
    ...over,
  };
  initializeObservability(deps);
  return { posted, calls, advance: (ms: number) => { t += ms; } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('§2 the reporter can never become a source of crashes', () => {
  beforeEach(() => __resetObservability());

  it('a Crashlytics SDK that fails to load leaves the app and our own log working', async () => {
    const h = harness({ loadCrashlytics: async () => { throw new Error('native init failed'); } });
    expect(() => recordError(new Error('render failed'))).not.toThrow();
    await flush();
    expect(h.posted).toHaveLength(1);
  });

  it('a sink that throws synchronously or rejects is swallowed', async () => {
    harness({}, { recordException: () => { throw new Error('sdk crash'); }, setUserId: () => Promise.reject(new Error('x')) });
    expect(() => recordError(new Error('a'))).not.toThrow();
    expect(() => setUserContext('uid-1')).not.toThrow();
    await flush();
  });

  it('a log endpoint that throws is swallowed', () => {
    harness({ postLog: () => { throw new Error('offline'); } });
    expect(() => recordError(new Error('b'))).not.toThrow();
  });

  it('sends nothing at all from a non-production build', async () => {
    const h = harness({ enabled: false });
    recordError(new Error('dev error'));
    setUserContext('uid');
    await flush();
    expect(h.posted).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it('a broken SDK is loaded once, not retried in a loop', async () => {
    const load = vi.fn(async () => { throw new Error('no plugin'); });
    harness({ loadCrashlytics: load });
    for (let i = 0; i < 5; i++) recordError(new Error(`e${i}`));
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('§3 duplicates, storms and loops are bounded', () => {
  beforeEach(() => __resetObservability());

  it('an identical error inside the window is reported once', async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) recordError(new Error('same failure'));
    await flush();
    expect(h.posted).toHaveLength(1);
    expect(droppedReports()).toBe(9);
  });

  it('the same error after the window is reported again', async () => {
    const h = harness();
    recordError(new Error('same failure'));
    h.advance(DEDUP_WINDOW_MS + 1);
    recordError(new Error('same failure'));
    expect(h.posted).toHaveLength(2);
  });

  it(`a flood of distinct errors stops at ${RATE_LIMIT}`, () => {
    const h = harness();
    for (let i = 0; i < RATE_LIMIT * 3; i++) recordError(new Error(`distinct ${i}`));
    expect(h.posted).toHaveLength(RATE_LIMIT);
  });

  it('an unhandled rejection raised WHILE reporting is not reported (no infinite loop)', () => {
    let depth = 0;
    const h = harness({ postLog: () => { depth++; recordError(new Error(`nested ${depth}`), { kind: 'unhandled-rejection' }); } });
    recordError(new Error('first'), { kind: 'unhandled-rejection' });
    expect(depth).toBe(1);
    expect(h.posted).toHaveLength(0);
  });

  it('the payload carries no user prompt even when the error message quotes one', () => {
    const h = harness();
    recordError(new Error('Build failed for prompt: password=MyBankPass99 build me a bank app'));
    expect(h.posted[0]).not.toContain('MyBankPass99');
  });
});

describe('§4 the user is a one-way hash, and forgotten on sign-out', () => {
  beforeEach(() => __resetObservability());

  it('Crashlytics sees a 32-hex hash of the uid, never the uid itself', async () => {
    const h = harness();
    setUserContext('firebase-uid-123');
    await flush(); await flush(); await new Promise((r) => setTimeout(r, 10));
    const user = h.calls.find((c) => c.kind === 'user');
    expect(user?.arg).toMatch(/^[0-9a-f]{32}$/);
    expect(user?.arg).not.toContain('firebase-uid-123');
    expect(user?.arg).toBe(await crashUserId('firebase-uid-123'));
  });

  it('sign-out clears the id and marks the session signed out', async () => {
    const h = harness();
    setUserContext('uid-a');
    await new Promise((r) => setTimeout(r, 10));
    clearUserContext();
    await flush();
    const users = h.calls.filter((c) => c.kind === 'user').map((c) => c.arg);
    expect(users[users.length - 1]).toBe('');
    expect(h.calls.filter((c) => c.kind === 'key').map((c) => c.arg)).toContainEqual(['signed_in', false]);
  });

  it('the auth observer is the one place user context is set and cleared', () => {
    const app = read('src/App.tsx');
    const at = app.indexOf('onAuthStateChanged(auth, (currentUser) => {');
    const near = app.slice(at, at + 600);
    expect(near).toContain('setUserContext(currentUser.uid)');
    expect(near).toContain('clearUserContext()');
    expect(app).not.toMatch(/setUserContext\([^)]*email/);
  });
});

describe('§5 the ErrorBoundary and global handlers report only through the reporter', () => {
  beforeEach(() => __resetObservability());

  it('the boundary records react-render errors through recordError and no longer posts by itself', () => {
    const src = read('src/components/ErrorBoundary.tsx');
    expect(src).toContain("kind: 'react-render'");
    expect(src).not.toContain("fetch('/api/logs/error'");
    // The user sees a fixed sentence, never the raw error text.
    expect(src).not.toMatch(/\{this\.state\.errorMessage/);
  });

  it('names the failing component without its props', () => {
    expect(firstComponent('\n    at BillingPanel (https://x/assets/a.js:1:2)\n    at App')).toBe('BillingPanel');
    expect(firstComponent(undefined)).toBe('unknown');
  });

  it('main.tsx has exactly one error and one unhandledrejection reporter, both via recordError', () => {
    const main = read('src/main.tsx');
    expect(main).not.toContain("postWithFallback('/api/logs/error'");
    expect(main).toMatch(/recordError\(e\.error \?\? e\.message, \{ kind: 'window-error'/);
    expect(main).toMatch(/recordError\(e\.reason, \{ kind: 'unhandled-rejection'/);
  });

  it('parses V8 and JavaScriptCore stacks into frames', () => {
    expect(parseStack('Error: x\n    at render (https://navbharatai.com/assets/index.js:10:5)')[0])
      .toEqual({ functionName: 'render', fileName: 'https://navbharatai.com/assets/index.js', lineNumber: 10 });
    expect(parseStack('render@capacitor://localhost/assets/index.js:12:3')[0]?.lineNumber).toBe(12);
  });

  it('maps screens to product areas without guessing', () => {
    expect(featureAreaForView('billing')).toBe('payments');
    expect(featureAreaForView('nbi_pro_chat')).toBe('agentv3');
    expect(featureAreaForView('teacher_ai')).toBe('ai');
    expect(featureAreaForView('something_new')).toBe('app');
  });

  it('setCrashKey refuses a private key name', async () => {
    const h = harness();
    setCrashKey('wallet_balance', 900);
    setCrashKey('screen', 'billing');
    await flush();
    const keys = h.calls.filter((c) => c.kind === 'key').map((c) => (c.arg as unknown[])[0]);
    expect(keys).toContain('screen');
    expect(keys).not.toContain('wallet_balance');
  });

  it('a recorded non-fatal reaches both sinks', async () => {
    const h = harness();
    recordNonFatal('Push registration failed', 'notifications');
    await flush();
    expect(h.posted).toHaveLength(1);
    expect(h.calls.some((c) => c.kind === 'record')).toBe(true);
  });
});

describe('§6 the server sanitizes again, and never serves the private build files', () => {
  it('the /api/logs/error intake reduces the body to short sanitized fields', () => {
    const rec = clientErrorRecord({
      message: `token ${JWT}`, stack: 'at x (https://a.b/c.js:1:1)', url: 'https://navbharatai.com/?otp=123456',
      extra: 'dropped', line: 4, col: '5', password: 'nope',
    });
    expect(JSON.stringify(rec)).not.toContain(JWT);
    expect(rec.url).toBe('https://navbharatai.com/');
    expect(rec.col).toBeNull();
    expect(Object.keys(rec)).not.toContain('password');
    expect(Object.keys(rec)).not.toContain('extra');
  });

  it('the route no longer logs the caller IP and is rate-limited', () => {
    const src = read('src/server/routes/telemetry.ts');
    const at = src.indexOf("app.post('/api/logs/error'");
    const route = src.slice(at, at + 900);
    expect(route).toContain('clientErrorLimiter');
    expect(route).toContain('clientErrorRecord(req.body)');
    expect(route).not.toMatch(/x-forwarded-for|remoteAddress/);
  });

  it.each(['/server.cjs', '/server.cjs.map', '/assets/index-abc.js.map', '/SERVER.CJS'])('refuses %s', (p) => {
    expect(isServerOnlyArtifactPath(p)).toBe(true);
  });

  it.each(['/', '/assets/index-abc.js', '/sw.js', '/manifest.json'])('serves %s', (p) => {
    expect(isServerOnlyArtifactPath(p)).toBe(false);
  });

  it('the guard is mounted before every static handler, and Firebase Hosting ignores the same files', () => {
    const server = read('server.ts');
    // Since the merge with #3538 the mount is the unified, decoded guard (serverOnlyArtifacts.ts);
    // isServerOnlyArtifactPath delegates to the same predicate, asserted in theServerSourceIsNeverServed.
    const guard = server.indexOf('app.use(denyServerOnlyArtifacts());');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(server.indexOf('app.use(precompressedStatic(distPath))'));
    expect(guard).toBeLessThan(server.indexOf('app.use(express.static(distPath'));
    const ignore: string[] = JSON.parse(read('firebase.json')).hosting.ignore;
    expect(ignore).toEqual(expect.arrayContaining(['server.cjs', '**/*.map']));
  });

  it('no client source map is emitted by the production build', () => {
    expect(read('vite.config.ts')).not.toMatch(/sourcemap\s*:\s*(true|'inline')/);
  });
});

describe('§7 native wiring and the crash-test gate', () => {
  beforeEach(() => __resetObservability());

  it('the crash-test tools do not exist in a normal build', () => {
    expect(crashTestTools()).toBeNull();
  });

  it('both store workflows refuse to upload a crash-test build', () => {
    const android = read('.github/workflows/android-aab.yml');
    expect(android).toMatch(/crash_test builds contain controlled crash tools and cannot be uploaded to Google Play/);
    expect(android).toMatch(/VITE_CRASH_TEST: \$\{\{ inputs\.crash_test && '1' \|\| '' \}\}/);
    const ios = read('.github/workflows/ios-ipa.yml');
    expect(ios).toMatch(/cannot be uploaded to TestFlight/);
    expect(ios).toMatch(/VITE_CRASH_TEST: \$\{\{ inputs\.crash_test && '1' \|\| '' \}\}/);
  });

  it('Android collects crashes in release builds only', () => {
    const gradle = read('android/app/build.gradle');
    expect(gradle).toMatch(/manifestPlaceholders = \[crashlyticsCollectionEnabled: "false"\]/);
    expect(gradle).toMatch(/release \{\s*manifestPlaceholders = \[crashlyticsCollectionEnabled: "true"\]/);
    expect(gradle).toContain("apply plugin: 'com.google.firebase.crashlytics'");
    expect(read('android/app/src/main/AndroidManifest.xml')).toContain('android:value="${crashlyticsCollectionEnabled}"');
    expect(read('android/build.gradle')).toContain('firebase-crashlytics-gradle');
  });

  it('the plugin is pinned to the same line as the other Firebase plugins, and wired on both platforms', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@capacitor-firebase/crashlytics']).toBe(pkg.dependencies['@capacitor-firebase/app-check']);
    expect(read('android/capacitor.settings.gradle')).toContain(':capacitor-firebase-crashlytics');
    expect(read('capacitor.config.ts')).toContain("'@capacitor-firebase/crashlytics': { symlink: true }");
    expect(read('fastlane/Fastfile')).toContain('upload_symbols_to_crashlytics(');
  });

  it('the JS layer never turns collection on itself (setEnabled persists on the device)', () => {
    expect(read('src/lib/observability/native.ts')).not.toContain('setEnabled');
  });
});
