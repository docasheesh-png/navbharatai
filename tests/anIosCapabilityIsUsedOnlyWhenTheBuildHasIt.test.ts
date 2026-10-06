// AN iOS CAPABILITY IS USED ONLY WHEN THE BUILD HAS IT (2026-10-06, Crashlytics: "Error: Push registration
// failed", iOS 1.0 (108), iPhone 15).
//
// THE CLASS: an opt-in entitlement of the iPhone build (push, App Attest) whose JavaScript assumed it was always
// there. Build 108 was signed without aps-environment, still asked for notification permission and a token, and
// reported the certain failure on every sign-in. These guards pin the ONE source of truth — the workflow input
// that adds an entitlement also stamps it into the bundle — and fail when a new sibling appears without it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { installAppCheck, __resetAppCheckInstall } from '../src/lib/appCheckClient';

const WF = readFileSync('.github/workflows/ios-ipa.yml', 'utf8');
const FASTFILE = readFileSync('fastlane/Fastfile', 'utf8');
const CAPS = readFileSync('src/lib/iosBuildCapabilities.ts', 'utf8');

/** The `run:` body of the step with this name (up to the next step). */
function step(name: string): string {
  const i = WF.indexOf(`- name: ${name}`);
  expect(i, `step "${name}" exists`).toBeGreaterThan(-1);
  const next = WF.indexOf('\n      - name:', i + 1);
  return WF.slice(i, next === -1 ? undefined : next);
}

/** Every workflow input gating a step that writes an entitlement into App.entitlements. */
function entitlementInputs(): string[] {
  const out = new Set<string>();
  const re = /- name: [^\n]+\n\s+if: \$\{\{ inputs\.([a-z_]+) \}\}\n[\s\S]*?(?=\n {6}- name:|$)/g;
  for (const m of WF.matchAll(re)) if (m[0].includes('App.entitlements')) out.add(m[1]);
  return [...out].sort();
}

// An entitlement input that is NOT stamped must say why here. Sign in with Apple defaults ON, and App Store
// Guideline 4.8 requires the button on iOS whenever Google sign-in is offered — hiding it on a build without the
// entitlement would turn a build that must not ship into one Apple rejects. Its failure is already an honest,
// specific message (AuthComponent: "enable the Sign in with Apple capability").
const NOT_STAMPED: Record<string, string> = {
  apple_signin: 'default ON; Guideline 4.8 keeps the button; failure already explained to the user',
};

describe('the build tells the bundle what it was signed with', () => {
  it('push and App Attest are stamped from the SAME inputs that add their entitlements', () => {
    const build = step('Build the web bundle');
    expect(build).toContain("VITE_IOS_PUSH: ${{ inputs.enable_push_notifications && '1' || '' }}");
    expect(build).toContain("VITE_IOS_APP_ATTEST: ${{ inputs.enable_app_attest && '1' || '' }}");
    expect(CAPS).toContain("import.meta.env.VITE_IOS_PUSH === '1'");
    expect(CAPS).toContain("import.meta.env.VITE_IOS_APP_ATTEST === '1'");
  });

  it('CENSUS: every entitlement input is stamped into the bundle, or says here why not', () => {
    const inputs = entitlementInputs();
    expect(inputs).toEqual(['apple_signin', 'enable_app_attest', 'enable_push_notifications']);
    const build = step('Build the web bundle');
    for (const input of inputs) {
      const stamped = build.includes(`inputs.${input} &&`);
      expect(stamped || input in NOT_STAMPED, `${input}: stamp it into the bundle or record why not`).toBe(true);
    }
  });

  it('every entitlement forces a fresh provisioning profile (App Attest was the sibling left out)', () => {
    const fastlaneStep = WF.slice(WF.indexOf('fastlane ios beta') - 4000, WF.indexOf('fastlane ios beta'));
    for (const [env, input] of [['APPLE_SIGNIN', 'apple_signin'], ['ENABLE_PUSH', 'enable_push_notifications'], ['ENABLE_APP_ATTEST', 'enable_app_attest']]) {
      expect(fastlaneStep).toContain(`${env}: \${{ inputs.${input} }}`);
      expect(FASTFILE).toMatch(new RegExp(`force:[^\\n]*ENV\\["${env}"\\] == "true"`));
    }
  });

  it('CENSUS: every client module that drives an opt-in native capability consults the build stamp', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { if (n !== 'server' && n !== 'node_modules') walk(p); }
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) files.push(p);
      }
    };
    walk('src');
    const users = files.filter((f) => /@capacitor-firebase\/(messaging|app-check)/.test(readFileSync(f, 'utf8'))).sort();
    expect(users).toEqual(['src/lib/appCheckClient.ts', 'src/lib/pushNotifications.ts']);
    for (const f of users) expect(readFileSync(f, 'utf8'), f).toMatch(/from '\.\/iosBuildCapabilities'/);
  });
});

describe('APNs reaches the plugin', () => {
  it('the push step injects all three AppDelegate forwards, and fails the build if the template moved', () => {
    const push = step('Enable push-notifications entitlement (opt-in)');
    expect(push).toContain('NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)');
    expect(push).toContain('NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)');
    expect(push).toContain('Notification.Name.init("didReceiveRemoteNotification")');
    expect(push).toMatch(/for want in capacitorDidRegisterForRemoteNotifications capacitorDidFailToRegisterForRemoteNotifications didReceiveRemoteNotification; do/);
    expect(push).toContain('::error::AppDelegate APNs forwarding missing');
  });

  it('the forwards match what @capacitor-firebase/messaging listens for', () => {
    const plugin = readFileSync('node_modules/@capacitor-firebase/messaging/ios/Plugin/FirebaseMessagingPlugin.swift', 'utf8');
    expect(plugin).toContain('name: .capacitorDidRegisterForRemoteNotifications');
    expect(plugin).toContain('Notification.Name.init("didReceiveRemoteNotification")');
  });
});

describe('App Check on an iPhone build without App Attest (the sibling)', () => {
  afterEach(() => { vi.unstubAllEnvs(); __resetAppCheckInstall(); });
  const iphone = () => ({
    location: { origin: 'capacitor://localhost' }, fetch: (async () => new Response('ok')) as never,
    Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
  });

  it('does not start an attestation that cannot succeed', async () => {
    __resetAppCheckInstall();
    const loadNative = vi.fn(async () => ({ initialize: async () => {}, getToken: async () => ({ token: 'T' }) }));
    expect(await installAppCheck(iphone(), { loadNative })).toBe('not-in-build');
    expect(loadNative).not.toHaveBeenCalled();
  });

  it('starts it when the build was signed with App Attest', async () => {
    __resetAppCheckInstall();
    vi.stubEnv('VITE_IOS_APP_ATTEST', '1');
    const loadNative = vi.fn(async () => ({ initialize: async () => {}, getToken: async () => ({ token: 'T' }) }));
    expect(await installAppCheck(iphone(), { loadNative })).toBe('installed-native');
  });

  it('Android is untouched by the iOS stamp', async () => {
    __resetAppCheckInstall();
    const w = { ...iphone(), Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } };
    const loadNative = vi.fn(async () => ({ initialize: async () => {}, getToken: async () => ({ token: 'T' }) }));
    expect(await installAppCheck(w, { loadNative })).toBe('installed-native');
  });
});
