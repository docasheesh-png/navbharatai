/**
 * A CAPACITOR PLUGIN PROXY IS NEVER A PROMISE'S VALUE — for every file, not only the reported ones.
 *
 * THE REPORT (admin Diagnostics capture, 2026-09-30, iOS 18.7):
 *     `"FirebaseAppCheck.then()" is not implemented on ios @ unhandled promise`
 *
 * The same sentence, with a different plugin name, was root-caused on 2026-09-15
 * (`"PlayBilling.then()" is not implemented on android`). That fix guarded the two files it touched,
 * by NAME (`homeLagAndPluginRejection.test.ts`), so eleven days later a third file — App Check slice 2 —
 * wrote `return FirebaseAppCheck` from an async function and nothing noticed. The instance was fixed;
 * the class was not.
 *
 * WHY IT MATTERS MORE THAN A LOG LINE: Capacitor's proxy turns every property read into a native call,
 * and resolving a promise reads `.then` to ask "is this a thenable?". The native `then` never calls
 * back, so the promise NEVER SETTLES. `installAppCheck` awaited it, so App Check never started on any
 * phone — silently, since nothing waits on it.
 *
 * The repo-wide SCAN for the shape lives in `tests/pluginProxyIsNeverResolved.test.ts` (#3388, which
 * fixed the same line the same day). This suite is the other half that scan cannot give: a proxy that
 * BEHAVES like Capacitor's, proving the App Check loader actually settles rather than merely that the
 * text no longer matches.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/** A stand-in for Capacitor's `registerPlugin` proxy: every property is a "native method". */
function capacitorLikeProxy(name: string, calls: string[]): Record<string, unknown> {
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      return (...args: unknown[]) => {
        calls.push(prop);
        if (prop === 'then') {
          // Capacitor's wrapper: a native call that rejects, and never calls the resolve/reject it was handed.
          void args;
          const p = Promise.reject(new Error(`"${name}.then()" is not implemented on ios`));
          p.catch(() => {});
          return p;
        }
        if (prop === 'getToken') return Promise.resolve({ token: 'tok-123' });
        return Promise.resolve(undefined);
      };
    },
  });
}

describe('1 · the App Check loader settles on a phone', () => {
  afterEach(() => { vi.doUnmock('@capacitor/core'); vi.doUnmock('@capacitor-firebase/app-check'); vi.resetModules(); });

  it('🔴 the report: with a Capacitor-like proxy, installAppCheck resolves and never touches `.then`', async () => {
    const calls: string[] = [];
    vi.resetModules();
    // `isNativePlatform` too: appCheckClient imports `./firebase` statically since Q-625, and that module
    // asks it once at load to pick its auth persistence. `w.Capacitor` below still drives the native branch.
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isPluginAvailable: () => true, isNativePlatform: () => false } }));
    vi.doMock('@capacitor-firebase/app-check', () => ({ FirebaseAppCheck: capacitorLikeProxy('FirebaseAppCheck', calls) }));
    const mod = await import('../src/lib/appCheckClient');
    mod.__resetAppCheckInstall();
    const realFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const w = { fetch: realFetch, location: { origin: 'capacitor://localhost' }, Capacitor: { isNativePlatform: () => true } };
    const outcome = await Promise.race([
      mod.installAppCheck(w),
      new Promise<string>((r) => setTimeout(() => r('HUNG'), 1_000)),
    ]);
    expect(outcome).toBe('installed-native');
    expect(calls).not.toContain('then');
    expect(calls).toContain('initialize');
  });
});
