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
 * So this suite does two things: (1) proves, with a proxy that behaves like Capacitor's, that the App
 * Check loader now settles; (2) scans the whole client for any file that hands a proxy to a promise.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

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
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isPluginAvailable: () => true } }));
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2 · The class, repo-wide.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, '..');
const PLUGIN_PKG = /^@capacitor(?:-firebase|-community)?\/(?!core$|cli$)[\w-]+$/;

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Names a file binds to a plugin proxy. PURE. */
export function proxyNames(src: string): string[] {
  const code = stripComments(src);
  const names = new Set<string>();
  for (const m of code.matchAll(/\b(\w+)\s*=\s*registerPlugin\b/g)) names.add(m[1]);
  const bindings = [
    ...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g),
    ...code.matchAll(/\{([^{}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ];
  for (const n of promiseAllProxyNames(code)) names.add(n);
  for (const [, list, pkg] of bindings) {
    if (!PLUGIN_PKG.test(pkg)) continue;
    for (const part of list.split(',')) {
      const local = part.trim().replace(/^type\s+/, '').split(/\s+as\s+|\s*:\s*/).pop()?.trim();
      if (local && /^[A-Z]\w*$/.test(local)) names.add(local);
    }
  }
  return [...names];
}

/** Places a file hands a proxy to a promise. PURE. */
export function proxyLeaks(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const n of proxyNames(src)) {
    const re = new RegExp(`\\breturn\\s+${n}\\s*(?:;|\\bas\\b|$|\\))|\\bresolve\\(\\s*${n}\\s*\\)`, 'gm');
    if (re.test(code)) out.push(n);
  }
  // `return (await import('@capacitor/x')).Plugin` — a proxy returned without ever being named.
  for (const m of code.matchAll(/return\s+\(\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)\s*\)\.(\w+)\s*(?:;|\bas\b|$)/gm)) {
    if (PLUGIN_PKG.test(m[1])) out.push(m[2]);
  }
  return out;
}

function clientFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === 'server' || e === 'node_modules') continue;
      clientFiles(p, acc);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

describe('2 · no client file hands a plugin proxy to a promise', () => {
  it('the scanner catches the exact line that shipped, and its two older siblings (canary)', () => {
    const shipped = `const [{ Capacitor }, { FirebaseAppCheck }] = await Promise.all([
      import('@capacitor/core'),
      import('@capacitor-firebase/app-check'),
    ]);
    if (!Capacitor.isPluginAvailable('FirebaseAppCheck')) return null;
    return FirebaseAppCheck as unknown as NativeAppCheck;`;
    expect(proxyLeaks(shipped)).toEqual(['FirebaseAppCheck']);
    expect(proxyLeaks(`const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check');\nreturn FirebaseAppCheck;`)).toEqual(['FirebaseAppCheck']);
    expect(proxyLeaks(`cached = registerPlugin<P>('PlayBilling');\nreturn cached;`)).toEqual(['cached']);
    expect(proxyLeaks(`return (await import('@capacitor/browser')).Browser;`)).toEqual(['Browser']);
    expect(proxyLeaks(`const { Capacitor } = await import('@capacitor/core');\nreturn Capacitor;`)).toEqual([]);
  });

  it('a wrapper, a method call and a local use are all fine', () => {
    const fine = `
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      cached = registerPlugin<P>('X');
      return { api: cached };
      return { initialize: (o) => FirebaseAppCheck.initialize(o) };`;
    expect(proxyLeaks(fine)).toEqual([]);
  });

  it('🔒 every client file passes', () => {
    const offenders: string[] = [];
    for (const f of clientFiles(join(ROOT, 'src'))) {
      const src = readFileSync(f, 'utf8');
      if (!/registerPlugin|@capacitor/.test(src)) continue;
      const leaks = proxyLeaks(src);
      if (leaks.length) offenders.push(`${relative(ROOT, f)}: ${leaks.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the scan really reads the files it claims to (not a vacuous pass)', () => {
    const touching = clientFiles(join(ROOT, 'src')).filter((f) => /registerPlugin|@capacitor/.test(readFileSync(f, 'utf8')));
    expect(touching.length).toBeGreaterThan(5);
    expect(touching.map((f) => relative(ROOT, f))).toContain(join('src', 'lib', 'appCheckClient.ts'));
  });
});

/** Names bound through `const [{ A }, { B }] = await Promise.all([import('x'), import('y')])`. PURE. */
export function promiseAllProxyNames(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const m of code.matchAll(/\[\s*((?:\{[^{}]*\}\s*,?\s*)+)\]\s*=\s*await\s+Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/g)) {
    const lists = [...m[1].matchAll(/\{([^{}]*)\}/g)].map((x) => x[1]);
    const pkgs = [...m[2].matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((x) => x[1]);
    lists.forEach((list, i) => {
      if (!pkgs[i] || !PLUGIN_PKG.test(pkgs[i])) return;
      for (const part of list.split(',')) {
        const local = part.trim().split(/\s*:\s*/).pop()?.trim();
        if (local && /^[A-Z]\w*$/.test(local)) out.push(local);
      }
    });
  }
  return out;
}

