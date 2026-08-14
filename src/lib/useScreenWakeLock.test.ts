import { describe, it, expect, vi } from 'vitest';
import { createScreenWakeLock } from './useScreenWakeLock';

interface FakeSentinel { release: () => Promise<void>; addEventListener: (t: string, cb: () => void) => void; _released: boolean; _fireRelease: () => void }

function fakeNav() {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async (_type: 'screen') => {
    let onRelease: (() => void) | null = null;
    const s: FakeSentinel = {
      _released: false,
      release: vi.fn(async () => { s._released = true; }),
      addEventListener: vi.fn((t: string, cb: () => void) => { if (t === 'release') onRelease = cb; }),
      _fireRelease: () => { s._released = true; onRelease?.(); },
    };
    sentinels.push(s);
    return s;
  });
  return { nav: { wakeLock: { request } }, request, sentinels };
}

function fakeDoc(initial = 'visible') {
  let visibilityState = initial;
  const listeners: Record<string, Array<() => void>> = {};
  return {
    doc: {
      get visibilityState() { return visibilityState; },
      addEventListener: (t: string, cb: () => void) => { (listeners[t] ??= []).push(cb); },
      removeEventListener: (t: string, cb: () => void) => { listeners[t] = (listeners[t] || []).filter((f) => f !== cb); },
    },
    setVisible(v: string) { visibilityState = v; },
    fire(t: string) { (listeners[t] || []).forEach((f) => f()); },
    count(t: string) { return (listeners[t] || []).length; },
  };
}

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('createScreenWakeLock', () => {
  it('acquires on start and releases on stop', async () => {
    const n = fakeNav(); const d = fakeDoc();
    const wl = createScreenWakeLock({ nav: n.nav, doc: d.doc as any });
    wl.start();
    await tick();
    expect(n.request).toHaveBeenCalledWith('screen');
    expect(wl._held()).toBe(true);

    wl.stop();
    expect(n.sentinels[0]._released).toBe(true);
    expect(wl._held()).toBe(false);
    expect(d.count('visibilitychange')).toBe(0); // listener removed on stop
  });

  it('is a silent no-op when the Wake Lock API is unsupported', () => {
    const d = fakeDoc();
    const wl = createScreenWakeLock({ nav: {}, doc: d.doc as any });
    expect(wl.supported).toBe(false);
    expect(() => { wl.start(); wl.stop(); }).not.toThrow();
  });

  it('does not acquire while hidden, then acquires when the tab becomes visible', async () => {
    const n = fakeNav(); const d = fakeDoc('hidden');
    const wl = createScreenWakeLock({ nav: n.nav, doc: d.doc as any });
    wl.start();
    await tick();
    expect(n.request).not.toHaveBeenCalled();

    d.setVisible('visible');
    d.fire('visibilitychange');
    await tick();
    expect(n.request).toHaveBeenCalledTimes(1);
    expect(wl._held()).toBe(true);
    wl.stop();
  });

  it('re-acquires after the OS spontaneously releases the lock', async () => {
    const n = fakeNav(); const d = fakeDoc();
    const wl = createScreenWakeLock({ nav: n.nav, doc: d.doc as any });
    wl.start();
    await tick();
    expect(wl._held()).toBe(true);

    n.sentinels[0]._fireRelease(); // OS dropped it (e.g. low battery)
    expect(wl._held()).toBe(false);

    d.fire('visibilitychange'); // still visible → re-acquire
    await tick();
    expect(n.request).toHaveBeenCalledTimes(2);
    wl.stop();
  });

  it('holds at most one lock even if visibility fires repeatedly', async () => {
    const n = fakeNav(); const d = fakeDoc();
    const wl = createScreenWakeLock({ nav: n.nav, doc: d.doc as any });
    wl.start();
    d.fire('visibilitychange');
    d.fire('visibilitychange');
    await tick();
    expect(n.request).toHaveBeenCalledTimes(1);
    wl.stop();
  });

  it('never throws when neither nav nor doc exist', () => {
    const wl = createScreenWakeLock({ nav: undefined, doc: undefined });
    expect(() => { wl.start(); wl.stop(); }).not.toThrow();
  });
});
