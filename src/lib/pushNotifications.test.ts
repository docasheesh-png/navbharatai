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

vi.mock('./pushApi', () => ({
  registerDeviceToken: (...args: unknown[]) => registerMock(...args),
  unregisterDeviceToken: (...args: unknown[]) => unregisterMock(...args),
}));

vi.mock('@capacitor-firebase/messaging', () => ({
  FirebaseMessaging: {
    checkPermissions: async () => ({ receive: permission }),
    requestPermissions: async () => ({ receive: permission }),
    getToken: async () => ({ token: tokenValue }),
    deleteToken: (...args: unknown[]) => deleteTokenMock(...args),
    addListener: async (name: string, cb: (e: any) => void) => { listeners[name] = cb; return { remove: () => {} }; },
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
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    expect(registerMock).toHaveBeenCalledWith('user-1', 'fcm-tok-1', 'ios');
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
    expect(registerMock.mock.calls[1]).toEqual(['user-2', 'fcm-tok-1', 'android']);
  });

  it('a token refresh re-registers the new token against the currently signed-in user', async () => {
    const { initPushNotifications } = await freshModule();
    await initPushNotifications('user-1');
    expect(listeners.tokenReceived).toBeTypeOf('function');
    listeners.tokenReceived({ token: 'fcm-tok-REFRESHED' });
    await Promise.resolve(); // let the fire-and-forget re-register microtask settle
    expect(registerMock).toHaveBeenLastCalledWith('user-1', 'fcm-tok-REFRESHED', 'android');
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
});
