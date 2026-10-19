import { describe, it, expect } from 'vitest';
import { SW_UPDATE_MIN_INTERVAL_MS, shouldCheckForUpdate } from './swUpdateCheck';

describe('swUpdateCheck — throttled service-worker update re-check (B8)', () => {
  it('does not re-check before the minimum interval has elapsed', () => {
    const last = 1_000_000;
    expect(shouldCheckForUpdate(last, last)).toBe(false);
    expect(shouldCheckForUpdate(last, last + SW_UPDATE_MIN_INTERVAL_MS - 1)).toBe(false);
  });

  it('re-checks once the minimum interval has elapsed (and beyond)', () => {
    const last = 1_000_000;
    expect(shouldCheckForUpdate(last, last + SW_UPDATE_MIN_INTERVAL_MS)).toBe(true);
    expect(shouldCheckForUpdate(last, last + SW_UPDATE_MIN_INTERVAL_MS * 5)).toBe(true);
  });

  it('honours a custom interval', () => {
    expect(shouldCheckForUpdate(0, 4_999, 5_000)).toBe(false);
    expect(shouldCheckForUpdate(0, 5_000, 5_000)).toBe(true);
  });

  it('a burst of refocus events within the window only allows the first check', () => {
    // Simulates rapid visibilitychange→visible events; only the first (after the window) passes.
    let last = 0;
    const now = SW_UPDATE_MIN_INTERVAL_MS; // window has just elapsed
    expect(shouldCheckForUpdate(last, now)).toBe(true);
    last = now; // the check ran, timestamp updated
    // three more refocuses in the same second → all throttled
    expect(shouldCheckForUpdate(last, now + 100)).toBe(false);
    expect(shouldCheckForUpdate(last, now + 500)).toBe(false);
    expect(shouldCheckForUpdate(last, now + 999)).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { controllerChangeReloader } from './swUpdateCheck';

describe('controllerChangeReloader — reload only for a real SW update, never for the first install (P1-C)', () => {
  it('🔴 a FIRST install claiming an uncontrolled page does NOT reload (the double page load)', () => {
    let reloads = 0;
    const onChange = controllerChangeReloader(false, () => { reloads += 1; });
    expect(onChange()).toBe('adopted');
    expect(reloads).toBe(0);
  });

  it('a deploy while the tab is open (one SW replacing another) reloads — exactly once', () => {
    let reloads = 0;
    const onChange = controllerChangeReloader(true, () => { reloads += 1; });
    expect(onChange()).toBe('reloaded');
    expect(onChange()).toBe('ignored');
    expect(reloads).toBe(1);
  });

  it('first install, then a deploy later in the SAME tab: adopt first, reload on the real update', () => {
    let reloads = 0;
    const onChange = controllerChangeReloader(false, () => { reloads += 1; });
    expect(onChange()).toBe('adopted');
    expect(onChange()).toBe('reloaded');
    expect(onChange()).toBe('ignored');
    expect(reloads).toBe(1);
  });

  it('main.tsx wires it with the controller state read at startup, and has no unconditional reload', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(main).toMatch(/addEventListener\(\s*'controllerchange',\s*controllerChangeReloader\(!!navigator\.serviceWorker\.controller,/);
    expect(main).not.toMatch(/reloadedForUpdate/);
    // The update machinery the reload pairs with is untouched: register, update on load, periodic + refocus re-check.
    expect(main).toContain("navigator.serviceWorker.register('/sw.js')");
    expect(main).toContain('reg.update()');
    expect(main).toContain('setInterval(checkForUpdate, SW_UPDATE_MIN_INTERVAL_MS)');
  });

  it('sw.js still activates immediately (skipWaiting + clients.claim), so a deploy is still picked up', () => {
    const sw = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    expect(sw).toContain('self.skipWaiting()');
    expect(sw).toContain('self.clients.claim()');
  });
});
