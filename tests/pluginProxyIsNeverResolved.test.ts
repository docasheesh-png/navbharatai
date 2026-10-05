// A CAPACITOR PLUGIN IS NEVER THE VALUE A PROMISE RESOLVES TO.
//
// A plugin object (`registerPlugin(...)`, or the `FirebaseX` export of a `@capacitor-firebase/*`
// package) is a PROXY that turns every property read into a native method call. Resolving a promise
// with a value reads `.then` off that value to see whether it is a thenable — so returning the proxy
// from an async function makes a native call named `then`, which no platform implements. The promise
// never resolves, and an unhandled "X.then() is not implemented" is all anyone ever sees.
//
// It shipped THREE times: PlayBilling and DeviceIntegrity (2026-09-15, Android) and FirebaseAppCheck
// (2026-09-30, iOS app 103 — App Check never started on a phone). Each was fixed in its own file and
// the class was not. This test is the class: it reads every client file for the one shape that causes
// it — `return <plugin>` or `resolve(<plugin>)` — and fails CI on it. The fix is always a wrapper
// (`return { api: plugin }`, or plain functions that close over the plugin).

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN_PACKAGE = /['"]@capacitor(?:-firebase|-community)?\/[^'"]+['"]/;
/** Exports of @capacitor/core that are not plugin proxies. */
const NOT_A_PROXY = new Set(['Capacitor', 'registerPlugin', 'WebPlugin', 'CapacitorException', 'ExceptionCode', 'CapacitorHttp', 'CapacitorCookies']);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Names in this file that hold a plugin proxy. */
export function pluginNames(src: string): Set<string> {
  const names = new Set<string>();
  // import { A, B as C } from '@capacitor…'   /   const { A } = await import('@capacitor…')
  // `[^{}]`, not `[^}]` (Q-625): with `[^}]` a destructure that is the FIRST statement of a block was
  // matched from the block's own `{`, so the names came out as "const { A" and the plugin was never
  // seen — the scanner went blind exactly where a loader is most often written.
  const destructure = /(?:import\s*(?:type\s*)?\{([^{}]*)\}\s*from\s*|\{([^{}]*)\}\s*=\s*(?:await\s+)?import\(\s*)(['"][^'"]+['"])/g;
  for (const m of src.matchAll(destructure)) {
    if (!PLUGIN_PACKAGE.test(m[3])) continue;
    if (/import\s+type\s*\{/.test(m[0])) continue;
    for (const part of (m[1] ?? m[2] ?? '').split(',')) {
      const bits = part.trim().replace(/^type\s+/, '').split(/\s+as\s+|\s*:\s*/);
      const local = (bits[1] ?? bits[0]).trim();
      if (local && /^[A-Za-z_$][\w$]*$/.test(local) && !NOT_A_PROXY.has(bits[0].trim())) names.add(local);
    }
  }
  // const [{ A }, { B }] = await Promise.all([import('x'), import('@capacitor…')]) — paired by position.
  const allForm = /\[\s*((?:\{[^}]*\}\s*,?\s*)+)\]\s*=\s*await\s+Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/g;
  for (const m of src.matchAll(allForm)) {
    const objects = [...m[1].matchAll(/\{([^}]*)\}/g)].map((o) => o[1]);
    const specifiers = [...m[2].matchAll(/import\(\s*(['"][^'"]+['"])\s*\)/g)].map((i) => i[1]);
    objects.forEach((body, i) => {
      if (!specifiers[i] || !PLUGIN_PACKAGE.test(specifiers[i])) return;
      for (const part of body.split(',')) {
        const bits = part.trim().split(/\s*:\s*/);
        const local = (bits[1] ?? bits[0]).trim();
        if (local && /^[A-Za-z_$][\w$]*$/.test(local) && !NOT_A_PROXY.has(bits[0].trim())) names.add(local);
      }
    });
  }
  // x = registerPlugin<…>('Name')
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*registerPlugin\s*[<(]/g)) names.add(m[1]);
  return names;
}

/** Every place this file hands a plugin proxy to promise resolution. */
export function proxyResolutions(src: string): string[] {
  const code = stripComments(src);
  const hits: string[] = [];
  for (const name of pluginNames(code)) {
    const esc = name.replace(/[$]/g, '\\$');
    // `return X;` / `return X as Y` / `resolve(X)` — the proxy itself, not `X.method()` or `{ api: X }`.
    const re = new RegExp(`(?:\\breturn\\s+|\\bresolve\\(\\s*)${esc}(?=\\s*(?:as\\b|[;)\\n}]))`, 'g');
    for (const m of code.matchAll(re)) hits.push(`${name}: ${m[0].trim()}`);
  }
  // return (await import('@capacitor…')).X — the proxy without ever being named.
  for (const m of code.matchAll(/\breturn\s*\(\s*await\s+import\(\s*(['"][^'"]+['"])\s*\)\s*\)\.([A-Za-z_$][\w$]*)(?=\s*(?:as\b|[;)\n}]))/g)) {
    if (PLUGIN_PACKAGE.test(m[1])) hits.push(`${m[2]}: ${m[0].trim()}`);
  }
  return hits;
}

function clientFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (p === join('src', 'server') || entry === 'node_modules') continue;
      clientFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

describe('a Capacitor plugin proxy is never the value a promise resolves to', () => {
  it('the detector catches the exact code that shipped (App Check, 2026-09-30)', () => {
    const shipped = `
      async function loadNativeAppCheck() {
        const [{ Capacitor }, { FirebaseAppCheck }] = await Promise.all([
          import('@capacitor/core'),
          import('@capacitor-firebase/app-check'),
        ]);
        if (!Capacitor.isPluginAvailable('FirebaseAppCheck')) return null;
        return FirebaseAppCheck as unknown as NativeAppCheck;
      }`;
    expect(proxyResolutions(shipped)).toEqual(['FirebaseAppCheck: return FirebaseAppCheck']);
  });

  it('…and the registerPlugin shape (PlayBilling, 2026-09-15)', () => {
    const shipped = `
      async function plugin() {
        if (cached) return cached;
        const { registerPlugin } = await import('@capacitor/core');
        cached = registerPlugin<PlayBillingPlugin>('PlayBilling');
        return cached;
      }`;
    expect(proxyResolutions(shipped).length).toBe(2);
  });

  it('the wrappers that fix it are not flagged', () => {
    const fixed = `
      async function plugin() {
        const { registerPlugin } = await import('@capacitor/core');
        cached = registerPlugin<P>('PlayBilling');
        return { api: cached };
      }
      async function load() {
        const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check');
        return { getToken: (o) => FirebaseAppCheck.getToken(o) };
      }
      async function use() {
        const { Browser } = await import('@capacitor/browser');
        return Browser.open({ url: 'x' });
      }`;
    expect(proxyResolutions(fixed)).toEqual([]);
  });

  it('🔴 a plugin destructured as the FIRST statement of a block is still seen (Q-625 scanner fix)', () => {
    const shipped = `
      async function loadNativeAppCheck() {
        const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check');
        return FirebaseAppCheck;
      }`;
    expect(proxyResolutions(shipped)).toEqual(['FirebaseAppCheck: return FirebaseAppCheck']);
  });

  it('no client file does it', () => {
    const offenders: string[] = [];
    for (const file of clientFiles('src')) {
      const src = readFileSync(file, 'utf8');
      if (!PLUGIN_PACKAGE.test(src) && !/registerPlugin/.test(src)) continue;
      for (const hit of proxyResolutions(src)) offenders.push(`${file} — ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the scan really reads the plugin-using files (a scanner that sees nothing passes for ever)', () => {
    const seen = clientFiles('src').filter((f) => PLUGIN_PACKAGE.test(readFileSync(f, 'utf8')));
    expect(seen).toEqual(expect.arrayContaining([
      join('src', 'lib', 'appCheckClient.ts'),
      join('src', 'lib', 'pushNotifications.ts'),
      join('src', 'components', 'AuthComponent.tsx'),
    ]));
    expect(pluginNames(readFileSync(join('src', 'lib', 'appCheckClient.ts'), 'utf8')).has('FirebaseAppCheck')).toBe(true);
    expect(pluginNames(readFileSync(join('src', 'lib', 'playBillingNative.ts'), 'utf8')).has('cached')).toBe(true);
  });
});
