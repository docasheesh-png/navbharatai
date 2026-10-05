// Q-673 (found 2026-10-05 by the Q-627 work) — every /api path the client names is a route the server has.
//
// `useChatEngine` sent any agent id other than `navbharatai` to `/api/chat`, a route the server has never
// had, while the comment beside it promised a fall-through to "the general chat". A Pro session's agent id
// therefore got a 404 on send. Nothing compared the client's paths with the server's routes, so a path
// could point at nothing and only a user pressing Send would find out. This census does the comparison.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
};
// Comments are dropped so a path a comment mentions is not mistaken for a call.
const code = (f: string) => readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');

/** Server routes, with every `:param` and `*splat` written as one wildcard segment `X`. */
function serverRoutes(): string[] {
  const files = [...walk('src/server'), 'server.ts'];
  const out = new Set<string>();
  const re = /\b(?:app|router)\.(?:get|post|put|patch|delete|all|use)\(\s*['"`](\/api\/[^'"`]+)['"`]/g;
  // Route paths defined as exported constants (e.g. PREVIEW_IMAGE_PATH, SONIC_WS_PATH).
  const constRe = /export const [A-Z_]+_PATH\s*=\s*['"`](\/api\/[^'"`]+)['"`]/g;
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(re)) out.add(m[1]);
    for (const m of s.matchAll(constRe)) out.add(m[1]);
  }
  return [...out].map((p) => p.replace(/:[A-Za-z_]+|\*\w*/g, 'X').replace(/\/$/, ''));
}

/** Paths named in client code, with each `${…}` written as `X`. */
function clientPaths(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of walk('src')) {
    if (f.startsWith(join('src', 'server'))) continue;
    for (const m of code(f).matchAll(/['"`](\/api\/[^'"`\s?#]*)/g)) {
      const p = m[1].replace(/\$\{[^}]*\}/g, 'X').replace(/\/$/, '');
      if (p === '/api') continue; // the prefix itself (apiBase.ts rewrites anything under it), not a route
      if (!out.has(p)) out.set(p, f);
    }
  }
  return out;
}

function served(p: string, routes: string[]): boolean {
  const pp = p.split('/');
  return routes.some((r) => {
    if (r === p) return true;
    const rr = r.split('/');
    if (rr.length === pp.length && rr.every((s, i) => s === pp[i] || s === 'X' || pp[i] === 'X')) return true;
    if (r.endsWith('/X') && p.startsWith(r.slice(0, -1))) return true; // a splat route
    return p.startsWith(`${r}/`); // a prefix mounted with app.use
  });
}

/** Paths that are not calls, each with the reason. A new entry needs one as good. */
const NOT_A_CALL: Record<string, string> = {
  '/api/github': 'githubService.ts: a base the calls append a sub-path to (all served under /api/github/…)',
  '/api/order-status/:orderId': 'paymentSetup.ts: server code it GENERATES for the user\'s own app, not a call to us',
  '/api/order-status/:sessionId': 'paymentSetup.ts: generated server code for the user\'s app',
  '/api/verify-payment': 'paymentSetup.ts: generated code for the user\'s app',
  '/api/user': 'PluginSystem.tsx: example code shown to plugin authors',
  '/api/verify': 'PluginSystem.tsx: example code shown to plugin authors',
};

describe('the client never calls a route the server does not have', () => {
  const routes = serverRoutes();
  const paths = clientPaths();

  it('found the routes and the calls (the census is looking at real code)', () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(paths.size).toBeGreaterThan(300);
  });

  it('every client path is served, or listed with the reason it is not a call', () => {
    const missing = [...paths].filter(([p]) => !served(p, routes) && !(p in NOT_A_CALL)).map(([p, f]) => `${p}  ← ${f}`);
    expect(missing).toEqual([]);
  });

  it('the chat send goes to the one chat route, whatever the agent id', () => {
    const src = code('src/hooks/useChatEngine.ts');
    expect(src).toContain("const endpoint = '/api/chat/navbharat';");
    expect(src).not.toMatch(/['"`]\/api\/chat['"`]/);
  });

  it('no allowance is stale — each one still appears in the client', () => {
    const stale = Object.keys(NOT_A_CALL).filter((p) => !paths.has(p));
    expect(stale).toEqual([]);
  });
});
