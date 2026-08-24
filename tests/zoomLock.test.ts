import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installZoomLock, PINCH_EVENTS, type ZoomLockTarget } from '../src/lib/zoomLock';

/**
 * "do unglio se jaise webpage zoom karte hai woh zoom app me nahi hona chahiye" (admin 2026-08-24).
 *
 * Pinch-zooming the shell is the last big "this is a web page in a wrapper" tell left, after the
 * tap-highlight rectangle, pull-to-refresh and the rubber-band bounce. Three layers are needed and
 * they are not redundant — each platform answers to a different mechanism:
 *
 *   • CSS `touch-action: pan-x pan-y`  → Chrome / Android WebView (the standards-based blocker)
 *   • `user-scalable=no, maximum-scale=1` → Android honours it; iOS has ignored it since Safari 10
 *   • WebKit `gesturestart` preventDefault → the ONLY thing that works inside a WKWebView
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

function fakeTarget() {
  const handlers = new Map<string, Array<(e: Event) => void>>();
  const options: unknown[] = [];
  const target: ZoomLockTarget = {
    addEventListener(type, handler, opts) {
      options.push(opts);
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = (handlers.get(type) ?? []).filter((h) => h !== handler);
      if (list.length) handlers.set(type, list); else handlers.delete(type);
    },
  };
  return { target, handlers, options };
}

describe('installZoomLock', () => {
  it('listens for all three WebKit pinch events', () => {
    const { target, handlers } = fakeTarget();
    installZoomLock(target);
    for (const type of PINCH_EVENTS) expect(handlers.has(type), type).toBe(true);
  });

  it('🔒 registers NON-PASSIVE — a passive listener may not preventDefault', () => {
    // Without this the handlers install cleanly, run on every pinch, and do nothing at all: a dead
    // feature that looks alive, which is the exact failure this codebase keeps deleting.
    const { target, options } = fakeTarget();
    installZoomLock(target);
    expect(options.length).toBe(PINCH_EVENTS.length);
    for (const o of options) expect(o).toEqual({ passive: false });
  });

  it('cancels a real pinch', () => {
    const { target, handlers } = fakeTarget();
    installZoomLock(target);
    const preventDefault = vi.fn();
    handlers.get('gesturestart')![0]({ cancelable: true, preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('does not call preventDefault on a non-cancellable event', () => {
    // Doing so is a console warning in every browser and achieves nothing.
    const { target, handlers } = fakeTarget();
    installZoomLock(target);
    const preventDefault = vi.fn();
    handlers.get('gesturechange')![0]({ cancelable: false, preventDefault } as unknown as Event);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('the cleanup removes every listener it added', () => {
    const { target, handlers } = fakeTarget();
    installZoomLock(target)();
    expect(handlers.size).toBe(0);
  });

  it('🔒 never throws — a polish must not be able to break the app it polishes', () => {
    expect(() => installZoomLock(null)()).not.toThrow();
    expect(() => installZoomLock(undefined)()).not.toThrow();
    expect(() => installZoomLock({} as unknown as ZoomLockTarget)()).not.toThrow();
    const hostile: ZoomLockTarget = {
      addEventListener() { throw new Error('refused'); },
      removeEventListener() { throw new Error('refused'); },
    };
    expect(() => installZoomLock(hostile)()).not.toThrow();
  });

  it('a target that refused every listener has nothing to clean up', () => {
    const removed: string[] = [];
    const target: ZoomLockTarget = {
      addEventListener() { throw new Error('refused'); },
      removeEventListener(type) { removed.push(type); },
    };
    installZoomLock(target)();
    expect(removed).toEqual([]);
  });
});

describe('🔒 all three layers are present — one alone does not cover every platform', () => {
  it('the CSS layer is on `*`, because pinch belongs to the elements under the fingers', () => {
    // On `html, body` alone it stops working the moment both fingers land on an ordinary div.
    const css = src('src/index.css');
    expect(css).toContain('touch-action: pan-x pan-y;');
    const rule = css.slice(css.indexOf('* {'), css.indexOf('* {') + 1400);
    expect(rule).toContain('touch-action: pan-x pan-y;');
  });

  it('the meta layer sets both attributes Android honours', () => {
    const html = src('index.html');
    const viewport = html.slice(html.indexOf('<meta name="viewport"'), html.indexOf('<meta name="viewport"') + 200);
    expect(viewport).toContain('user-scalable=no');
    expect(viewport).toContain('maximum-scale=1');
    // The notch support this tag already carried must survive the edit.
    expect(viewport).toContain('viewport-fit=cover');
  });

  it('the JS layer is actually installed at startup, not merely written', () => {
    const main = src('src/main.tsx');
    expect(main).toContain("import { installZoomLock } from './lib/zoomLock';");
    expect(main).toContain('installZoomLock(typeof document');
  });

  it('🔒 desktop zoom is deliberately untouched', () => {
    // ctrl+wheel and the browser's own controls are how a low-vision user on a laptop reads anything,
    // and no native-feel argument applies to a window that is already a browser window.
    const lock = src('src/lib/zoomLock.ts');
    expect(lock).not.toContain("'wheel'");
    expect(lock).not.toContain('ctrlKey');
  });

  it('🔒 double-tap is left to touch-action, not guarded in JS', () => {
    // A JS double-tap guard has to swallow a fast second tap, which breaks real double-taps.
    const lock = src('src/lib/zoomLock.ts');
    expect(lock).not.toContain("'touchend'");
  });
});
