import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock state, reset per test. resetModules() + a fresh dynamic import gives each test a clean
// module instance (registeredForUid / currentToken are module-private `let`s with real state).
let isNative = true;
let platform: 'ios' | 'android' | 'web' = 'android';
let permission: 'granted' | 'denied' = 'granted';
let tokenValue = 'fcm-tok-1';
const listeners: Record<string, (e: any) => void> = {};

const registerMock = vi.fn(async (..._args: unknown[]) => true);
const unregisterMock = vi.fn(async (..._args: unknown[]) => true);
const deleteTokenMock = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative,
    getPlatform: () => platform,
  },
}));

// The device's own build number, reported alongside the token (2026-08-11) so the server can notify
// ONLY the devices that are genuinely behind. `appBuild` is set per-test; null models a device that
// cannot tell us — and an unknown must never be treated as "probably old".
let appBuild: string | null = null;
vi.mock('@capacitor/app', () => ({
  App: { getInfo: async () => ({ build: appBuild }) },
}));

// What the server answers a registration with (null = the request never reached it).
let serverStatus: number | null = 200;
vi.mock('./pushApi', () => ({
  registerDeviceToken: (...args: unknown[]) => registerMock(...args),
  registerDeviceTokenResult: async (...args: unknown[]) => {
    await registerMock(...args);
    return { ok: serverStatus !== null && serverStatus < 300, status: serverStatus };
  },
  unregisterDeviceToken: (...args: unknown[]) => unregisterMock(...args),
}));

const nonFatalMock = vi.fn((..._args: unknown[]) => {});
vi.mock('./observability', () => ({
  recordNonFatal: (...args: unknown[]) => nonFatalMock(...args),
}));

// The native side, per test: a getToken that fails, a token the plugin delivers later by itself, and
// whether the permission prompt was shown at all.
let getTokenError: Error | null = null;
let laterToken: string | null = null;
let requestPermissionThrows: Error | null = null;
const promptMock = vi.fn();
const getTokenMock = vi.fn();

vi.mock('@capacitor-firebase/messaging', () => ({
  FirebaseMessaging: {
    checkPermissions: async () => ({ receive: permission === 'granted' ? 'prompt' : permission }),
    requestPermissions: async () => {
      promptMock();
      if (requestPermissionThrows) throw requestPermissionThrows;
      return { receive: permission };
    },
    getToken: async () => {
      getTokenMock();
      if (getTokenError) throw getTokenError;
      return { token: tokenValue };
    },
    deleteToken: (...args: unknown[]) => deleteTokenMock(...args),
    addListener: async (name: string, cb: (e: any) => void) => {
      listeners[name] = cb;
      // The plugin RETAINS a token event until a listener consumes it (retainUntilConsumed: true).
      if (name === 'tokenReceived' && laterToken) { const t = laterToken; laterToken = null; setTimeout(() => cb({ token: t }), 5); }
      return { remove: () => {} };
    },
  },
}));

async function freshModule() {
  vi.resetModules();
  return import('./pushNotifications');
}

describe('pushNotifications (native mobile push bootstrap)', () => {
  beforeEach(() => {
    isNative = true;
    platform = 'android';
    permission = 'granted';
    tokenValue = 'fcm-tok-1';
    registerMock.mockClear();
    unregisterMock.mockClear();
    deleteTokenMock.mockClear();
    nonFatalMock.mockClear();
    promptMock.mockClear();
    getTokenMock.mockClear();
    serverStatus = 200;
    getTokenError = null;
    laterToken = null;
    requestPermissionThrows = null;
    vi.unstubAllEnvs();
    for (const k of Object.keys(listeners)) delete listeners[k];
  });

  it('no-ops entirely on web — never registers a token', async () => {
    isNative = false;
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('registers the FCM token for the signed-in user on native, with the real platform', async () => {
    platform = 'ios';
    vi.stubEnv('VITE_IOS_PUSH', '1'); // an iPhone build signed with the push entitlement
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    // The 4th argument is the device's versionCode; null here because this device reports none.
    expect(registerMock).toHaveBeenCalledWith('user-1', 'fcm-tok-1', 'ios', null);
  });

  it('an honest stop when permission is denied — never fakes a registration', async () => {
    permission = 'denied';
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('is idempotent per session — a second call for the SAME uid does not re-register', async () => {
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    await initPushNotifications('user-1');
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('a different uid (account switch on the same device) DOES register again', async () => {
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    await initPushNotifications('user-2');
    expect(registerMock).toHaveBeenCalledTimes(2);
    expect(registerMock.mock.calls[1]).toEqual(['user-2', 'fcm-tok-1', 'android', null]);
  });

  it('reports the device\'s BUILD NUMBER when it has one — the whole point of the change', async () => {
    // Without this the server cannot tell an old install from a current one, and an update broadcast
    // has to choose between notifying everybody (which trains people to ignore us) or nobody.
    appBuild = '57';
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-9');
    expect(registerMock).toHaveBeenCalledWith('user-9', 'fcm-tok-1', 'android', 57);
    appBuild = null;
  });

  it('a token refresh re-registers the new token against the currently signed-in user', async () => {
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    expect(listeners.tokenReceived).toBeTypeOf('function');
    listeners.tokenReceived({ token: 'fcm-tok-REFRESHED' });
    // Back to a single microtask: the version is cached at init, so the refresh path no longer awaits
    // a dynamic import before re-registering. CI caught the racy version of this.
    await Promise.resolve();
    expect(registerMock).toHaveBeenLastCalledWith('user-1', 'fcm-tok-REFRESHED', 'android', null);
  });

  it('teardown unregisters the current token and resets session state for the next sign-in', async () => {
    const { initPushNotifications, teardownPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    await teardownPushNotifications();
    expect(unregisterMock).toHaveBeenCalledWith('user-1', 'fcm-tok-1');
    expect(deleteTokenMock).toHaveBeenCalled();
  });

  it('teardown is a no-op on web', async () => {
    isNative = false;
    const { teardownPushNotifications } = await freshModule();
    await teardownPushNotifications();
    expect(unregisterMock).not.toHaveBeenCalled();
    expect(deleteTokenMock).not.toHaveBeenCalled();
  });

  it('a native error never throws — init degrades silently', async () => {
    permission = 'granted';
    tokenValue = '';
    const { initPushNotifications } = await freshModule();
    await expect(initPushNotifications('user-1')).resolves.toBeUndefined();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('a native call that throws never throws out of init', async () => {
    getTokenError = new Error('boom');
    const { initPushNotifications } = await freshModule();
    await expect(initPushNotifications('user-1', { tokenWaitMs: 10 })).resolves.toBeUndefined();
  });
});

// ── Crashlytics, iOS 1.0 (108), iPhone 15, 2026-10-05: "Error: Push registration failed" ──────────────
// Build 108 was signed WITHOUT the aps-environment entitlement (ios-ipa.yml `enable_push_notifications`
// off), so iOS could never issue an APNs token — yet the app asked for notification permission and asked
// Firebase for a token on every sign-in, and reported only `err.name` ("Error") when it failed.
describe('an iPhone build uses push only when it was signed with it (Crashlytics, iOS 108)', () => {
  beforeEach(() => {
    isNative = true; platform = 'ios'; permission = 'granted'; tokenValue = 'fcm-tok-1';
    registerMock.mockClear(); nonFatalMock.mockClear(); promptMock.mockClear(); getTokenMock.mockClear();
    serverStatus = 200; getTokenError = null; laterToken = null; requestPermissionThrows = null;
    vi.unstubAllEnvs();
  });

  it('THE REPORTED CASE: no entitlement in the build → no prompt, no token request, no Crashlytics issue', async () => {
    getTokenError = new Error('No APNS token specified before fetching FCM Token'); // what 108 hit
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1', { tokenWaitMs: 10 });
    expect(promptMock).not.toHaveBeenCalled();   // never asks for a permission it cannot use
    expect(getTokenMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
    expect(nonFatalMock).not.toHaveBeenCalled();  // a certainty decided at build time is not an error
  });

  it('Android needs no stamp — it registers either way', async () => {
    platform = 'android';
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    expect(registerMock).toHaveBeenCalledWith('user-1', 'fcm-tok-1', 'android', null);
  });

  it('a token that is only late (APNs answered after getToken) is waited for, not reported', async () => {
    vi.stubEnv('VITE_IOS_PUSH', '1');
    getTokenError = new Error('No APNS token specified before fetching FCM Token');
    laterToken = 'fcm-tok-LATE';
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1', { tokenWaitMs: 2_000 });
    expect(getTokenMock).toHaveBeenCalledTimes(1);   // waited for the event — never called again
    expect(registerMock).toHaveBeenCalledWith('user-1', 'fcm-tok-LATE', 'ios', null);
    expect(nonFatalMock).not.toHaveBeenCalled();
  });

  it('a token that never comes is reported WITH its stage and the native cause — not just "Error"', async () => {
    vi.stubEnv('VITE_IOS_PUSH', '1');
    getTokenError = Object.assign(new Error('No APNS token specified before fetching FCM Token'), { code: 'UNAVAILABLE' });
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1', { tokenWaitMs: 20 });
    expect(registerMock).not.toHaveBeenCalled();
    expect(nonFatalMock).toHaveBeenCalledTimes(1);
    const [message, area, keys] = nonFatalMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(message).toBe('Push registration failed at token: No APNS token specified before fetching FCM Token');
    expect(area).toBe('notifications');
    expect(keys).toEqual({ stage: 'token', platform: 'ios', code: 'UNAVAILABLE' });
  });

  it('a failing permission prompt is a different issue from a failing token', async () => {
    vi.stubEnv('VITE_IOS_PUSH', '1');
    requestPermissionThrows = new Error('Notifications are not allowed for this application');
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1', { tokenWaitMs: 10 });
    expect(nonFatalMock.mock.calls[0][0]).toBe('Push registration failed at permission: Notifications are not allowed for this application');
    expect((nonFatalMock.mock.calls[0][2] as Record<string, unknown>).stage).toBe('permission');
  });

  it('a user who says no is not an error', async () => {
    vi.stubEnv('VITE_IOS_PUSH', '1');
    permission = 'denied';
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(nonFatalMock).not.toHaveBeenCalled();
  });

  it('our server refusing the token is reported with its status; an offline phone says so', async () => {
    vi.stubEnv('VITE_IOS_PUSH', '1');
    serverStatus = 401;
    let mod = await freshModule();
    await mod.initPushNotifications('user-1');
    expect(nonFatalMock.mock.calls[0][0]).toBe('Push registration failed at register: the server answered 401');
    expect(nonFatalMock.mock.calls[0][2]).toEqual({ stage: 'register', platform: 'ios', http_status: 401 });

    nonFatalMock.mockClear();
    serverStatus = null;
    mod = await freshModule();
    await mod.initPushNotifications('user-1');
    expect(nonFatalMock.mock.calls[0][0]).toBe('Push registration failed at register: the request did not reach the server');
  });

  it('the device token never appears in a report', async () => {
    vi.stubEnv('VITE_IOS_PUSH', '1');
    tokenValue = 'fcm-SECRET-TOKEN-VALUE';
    serverStatus = 500;
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    expect(JSON.stringify(nonFatalMock.mock.calls)).not.toContain('fcm-SECRET-TOKEN-VALUE');
  });
});

