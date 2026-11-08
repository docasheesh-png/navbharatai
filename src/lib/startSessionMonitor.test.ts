import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ native: true, check: vi.fn(async () => {}), stop: vi.fn(), listener: null as null | ((v: { isActive: boolean }) => void), remove: vi.fn(), auth: { currentUser: {} } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async (_event: string, listener: typeof h.listener) => { h.listener = listener; return { remove: h.remove }; } } }));
vi.mock('./firebase', () => ({ auth: h.auth }));
vi.mock('./accountSessions', () => ({ logoutCurrentDevice: vi.fn(), isAccountLogoutPending: () => false }));
vi.mock('./sessionMonitor', () => ({ createSessionMonitor: () => ({ check: h.check, stop: h.stop }), SESSION_CHECK_INTERVAL_MS: 60_000 }));
import { startSessionMonitor } from './startSessionMonitor';
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); h.listener = null; h.native = true; vi.useFakeTimers(); vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' })); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('web/mobile monitor lifecycle', () => {
  it('checks startup, reconnect, focus, visibility, native resume and active heartbeat then cleans up', async () => {
    const stop = startSessionMonitor(); await vi.dynamicImportSettled(); await flush(); expect(h.check).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
    h.listener?.({ isActive: true }); h.listener?.({ isActive: false });
    await vi.advanceTimersByTimeAsync(60_000); expect(h.check).toHaveBeenCalledTimes(6);
    stop(); expect(h.stop).toHaveBeenCalledTimes(1); expect(h.remove).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(60_000);
    expect(h.check).toHaveBeenCalledTimes(6);
  });
  it('web does not load native resume hooks', async () => {
    h.native = false; const stop = startSessionMonitor(); await vi.dynamicImportSettled(); await flush(); expect(h.listener).toBeNull(); stop();
  });
  it('a native listener resolving after unmount removes itself rather than leaking', async () => {
    const stop = startSessionMonitor(); stop(); await vi.dynamicImportSettled(); await flush(); expect(h.remove).toHaveBeenCalledTimes(1);
  });
});
