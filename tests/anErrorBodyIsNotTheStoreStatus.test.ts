// AN ERROR BODY IS NOT THE STORE STATUS — admin's TestFlight screenshot, 2026-10-01 (iOS build 105).
//
// App Mart crashed into the error boundary: `undefined is not an object (evaluating 'c.missing.join')`.
// The screen had stored whatever JSON `/api/nav-store/status` answered as the status, so the first guard
// that answered the phone with `{ error: … }` (the adaptive bot guard's 429, App Check's 401, the global
// 500) turned into a Publish tab reading `.missing.join` off an object with no `missing`. Retrying could
// not help: the same body came back every time.
//
// Three locks, each proven by reversion:
//   §1 the pure reader keeps only a 2xx body of the real shape, and turns every other answer into a
//      sentence the screen can show (the server's own `error` when it has one);
//   §2 App Mart goes through that reader and never casts a bare body again;
//   §3 a census over the whole client: a `res.json().catch(() => null)` followed by `set…(data as T)`
//      must have `res.ok`, `res.status`, an `in data` shape check or a type guard between them. The
//      pre-fix App Mart line fails this rule; every other cast in the client passes it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readStoreStatus, isStoreStatus } from '../src/components/ide/appMart/storeStatus';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/** The real success body `routes/navStore.ts` sends. */
const REAL_STATUS = {
  acceptingUploads: false, uploadFeeInr: 0, categories: ['Tools'], maxSizeMb: 32, isAdmin: false,
  missing: ['app storage (NAV_STORE_BUCKET)', 'malware scanning (VIRUSTOTAL_API_KEY)'],
};

describe('§1 the reader keeps only the real status', () => {
  it('a 2xx body of the real shape is the status', () => {
    const r = readStoreStatus(true, REAL_STATUS, 200);
    expect(r.status).toEqual(REAL_STATUS);
    expect(r.problem).toBeNull();
  });

  it('the three real error bodies of this server are never the status, and each keeps its own sentence', () => {
    // adaptiveRateLimit.ts (429), appCheck.ts (401), server.ts (500) — verbatim shapes.
    const bodies: Array<[number, unknown]> = [
      [429, { error: 'Too many automated requests. Try again in 30s.' }],
      [401, { error: 'This request could not be verified. Please update the app or refresh the page and try again.' }],
      [500, { error: 'Internal server error' }],
    ];
    for (const [http, body] of bodies) {
      const r = readStoreStatus(false, body, http);
      expect(r.status).toBeNull();
      expect(r.problem).toBe((body as { error: string }).error);
    }
  });

  it('a non-2xx answer with no sentence, and an unparseable body, are still not the status', () => {
    expect(readStoreStatus(false, null, 503)).toEqual({ status: null, problem: 'the server answered HTTP 503 instead of the store status' });
    expect(readStoreStatus(true, null, 200).status).toBeNull();
    expect(readStoreStatus(true, { acceptingUploads: false }, 200).status).toBeNull(); // the crash's exact shape: no `missing`
    expect(readStoreStatus(true, 'ok', 200).status).toBeNull();
  });

  it('REVERSION: the crash reproduces on the pre-fix rule and not on the reader', () => {
    const errorBody = { error: 'Too many automated requests. Try again in 30s.' } as unknown as { acceptingUploads?: boolean; missing: string[] };
    // The old line: `if (data) setStatus(data as StoreStatus)` — then the Publish tab's branch.
    const oldBranch = () => (!errorBody.acceptingUploads ? errorBody.missing.join(', ') : 'accepting');
    expect(oldBranch).toThrow(TypeError);
    const r = readStoreStatus(false, errorBody, 429);
    expect(r.status).toBeNull();
    expect(isStoreStatus(errorBody)).toBe(false);
  });
});

describe('§2 App Mart goes through the reader', () => {
  const src = code(read('src/components/ide/NavAppStore.tsx'));
  it('reads the status with readStoreStatus(res.ok, …) and never casts a bare body', () => {
    expect(src).toMatch(/readStoreStatus\(res\.ok, data, res\.status\)/);
    expect(src).not.toMatch(/setStatus\(data as StoreStatus\)/);
    expect(src).toMatch(/setStatus\(read\.status\)/);
    expect(src).toMatch(/setStatusProblem\(read\.problem\)/);
  });
  it('tells the user why the status could not be checked instead of crashing the Publish tab', () => {
    expect(src).toMatch(/tab === 'publish' && statusProblem &&/);
    expect(src).toMatch(/could not be checked just now/);
  });
  it('the type lives in one place', () => {
    expect(src).not.toMatch(/interface StoreStatus \{/);
    expect(src).toMatch(/from '\.\/appMart\/storeStatus'/);
  });
});

// §3 — the census. One rule, applied to every client source file.
function clientFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'server' && name !== 'node_modules') clientFiles(p, out); continue; }
    if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const JSON_LINE = /\.json\(\)\.catch\(\(\) => null\)|=\s*await\s+res\.json\(\)\s*;/;
const CAST_LINE = /\bset[A-Z]\w*\(\s*\w+\s+as\s+[A-Z]\w*/;
const GUARD = /res\.ok|res\.status|\bin\s+data\b|\bis[A-Z]\w*\(|readStoreStatus\(/;

/** Every (json line, cast line) pair within 8 lines, and whether something checked the answer between them. */
export function uncheckedCasts(source: string): Array<{ line: number; cast: string }> {
  const lines = source.split('\n');
  const bad: Array<{ line: number; cast: string }> = [];
  lines.forEach((l, i) => {
    if (!JSON_LINE.test(l)) return;
    const window = lines.slice(i + 1, i + 9);
    window.forEach((w, j) => {
      if (!CAST_LINE.test(w)) return;
      const between = window.slice(0, j + 1).join('\n');
      if (!GUARD.test(between)) bad.push({ line: i + 1, cast: w.trim() });
    });
  });
  return bad;
}

describe('§3 census: no client screen stores an unchecked body as a typed state', () => {
  it('the rule recognises the pre-fix App Mart line (so an empty census is not a blind one)', () => {
    const preFix = [
      "      const res = await fetch('/api/nav-store/status', { headers: await authedHeaders() });",
      '      const data = await res.json().catch(() => null);',
      '      if (liveRef.current && data) setStatus(data as StoreStatus);',
    ].join('\n');
    expect(uncheckedCasts(preFix)).toEqual([{ line: 2, cast: 'if (liveRef.current && data) setStatus(data as StoreStatus);' }]);
    const guarded = preFix.replace('if (liveRef.current && data)', 'if (res.ok && liveRef.current && data)');
    expect(uncheckedCasts(guarded)).toEqual([]);
  });

  it('every client file passes the rule', () => {
    const offenders: string[] = [];
    for (const f of clientFiles(join(ROOT, 'src'))) {
      for (const b of uncheckedCasts(readFileSync(f, 'utf8'))) offenders.push(`${f.slice(ROOT.length + 1)}:${b.line} ${b.cast}`);
    }
    expect(offenders).toEqual([]);
  });
});
