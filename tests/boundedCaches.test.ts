/**
 * Performance audit 2026-10-11, F1 and its class: per-instance state that grows with traffic, or costs O(n) per
 * request.
 *
 * Measured on a 2-core production build: the bot guard walked its WHOLE address map on every `/api` request once
 * it held 10,000 addresses, and only dropped addresses idle for 5 minutes, so the map kept growing — 1,162 → 486
 * req/s, ~38% of all CPU in that loop, memory 304 → 750 MB in 60 s. The same shape lived in the shared
 * `rateLimiter()` buckets, the OTP and developer-API limiters, `TTLCache.set`, the admin-login guard and the
 * per-workspace stores; a sibling shape (CLEAR the whole map at a size) reset every caller's limit at once.
 *
 * These tests lock the class: one bounded O(1) cache, the guard bounded under a flood of fresh addresses, and a
 * census that fails on any new module-level Map/Set that is neither a BoundedCache nor listed with a reason.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BoundedCache, SharedReadCache } from '../src/server/lib/boundedCache';
import { TTLCache, chatReplyCacheKey } from '../src/server/AgentV3/PromptCache';
import { adaptiveGuard, trackedCallerCount, resetAdaptiveGuardState, MAX_TRACKED_CALLERS } from '../src/server/lib/adaptiveRateLimit';
import { sdaStoreKey } from '../src/server/lib/clinical/sdaStoreKey';
import { SessionReportStore } from '../src/server/lib/clinical/reportMemory';

describe('BoundedCache — the one shape a per-instance cache may take', () => {
  it('evicts the least recently used entry at the bound', () => {
    const c = new BoundedCache<string, number>({ maxEntries: 2 });
    c.set('a', 1); c.set('b', 2);
    c.get('a'); // a is now the most recent
    c.set('c', 3); // evicts b
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });

  it('expires by TTL on read, and a re-set restarts the TTL', () => {
    const c = new BoundedCache<string, string>({ maxEntries: 10, ttlMs: 100 });
    c.set('k', 'v', 0);
    expect(c.get('k', 99)).toBe('v');
    c.set('k', 'v2', 99);
    expect(c.get('k', 150)).toBe('v2');
    expect(c.get('k', 199)).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it('a stored null is a value, not a miss (the static-file stat cache relies on it)', () => {
    const c = new BoundedCache<string, number | null>({ maxEntries: 4 });
    c.set('missing', null);
    expect(c.has('missing')).toBe(true);
    expect(c.get('missing')).toBeNull();
  });

  it('never exceeds its bound however many keys arrive', () => {
    const c = new BoundedCache<number, number>({ maxEntries: 1_000 });
    for (let i = 0; i < 100_000; i++) c.set(i, i);
    expect(c.size).toBe(1_000);
    expect(c.get(99_999)).toBe(99_999);
    expect(c.get(0)).toBeUndefined();
  });

  it('sweep drops only expired entries', () => {
    const c = new BoundedCache<string, number>({ maxEntries: 10, ttlMs: 10 });
    c.set('old', 1, 0); c.set('new', 2, 50);
    expect(c.sweep(55)).toBe(1);
    expect(c.entries(55)).toEqual([['new', 2]]);
  });

  it('rejects an unbounded configuration', () => {
    expect(() => new BoundedCache({ maxEntries: Infinity })).toThrow();
    expect(() => new BoundedCache({ maxEntries: 0 })).toThrow();
  });

  it('TTLCache (the chat reply cache) is the same bounded cache', () => {
    const c = new TTLCache<string>(3, 1000);
    for (let i = 0; i < 50; i++) c.set(`k${i}`, 'v', 0);
    expect(c.size).toBe(3);
    expect(readFileSync('src/server/AgentV3/PromptCache.ts', 'utf8')).not.toMatch(/for \(const \[k, e\] of this\.map\)/);
  });
});

/** A minimal request/response pair for driving the guard directly. */
function call(guard: ReturnType<typeof adaptiveGuard>, address: string, auth?: string): Promise<number> {
  return new Promise((resolve) => {
    const req = {
      // Exercise a guarded app endpoint: liveness probes intentionally bypass this policy.
      path: '/api/pro-chat', method: 'GET',
      headers: { 'x-forwarded-for': address, 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/128', ...(auth ? { authorization: auth } : {}) },
      socket: { remoteAddress: '10.0.0.1' },
    } as never;
    let status = 200;
    const res = {
      setHeader() { /* noop */ },
      status(s: number) { status = s; return this; },
      json() { resolve(status); return this; },
    } as never;
    void guard(req, res, () => resolve(200));
  });
}

describe('the bot guard stays bounded and O(1) per request', () => {
  beforeEach(() => resetAdaptiveGuardState());

  it('a flood of fresh addresses never grows the map past its bound (the measured collapse)', async () => {
    const guard = adaptiveGuard({ runInTests: true });
    const n = MAX_TRACKED_CALLERS + 5_000;
    for (let i = 0; i < n; i++) {
      await call(guard, `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    }
    expect(trackedCallerCount()).toBeLessThanOrEqual(MAX_TRACKED_CALLERS);
  });

  it('the old per-request walk is gone from the source', () => {
    const src = readFileSync('src/server/lib/adaptiveRateLimit.ts', 'utf8');
    expect(src).not.toMatch(/function pruneClients/);
    expect(src).toMatch(/new BoundedCache<string, ClientState>\(\{ maxEntries: MAX_TRACKED_CALLERS \}\)/);
    expect(src).toMatch(/const addressKey = addressRateKey\(req\)/);
  });

  // F3: one shared address (carrier NAT, office) — a verified account is judged on its own traffic.
  it('a hot shared address blocks anonymous callers but not a VERIFIED account behind it', async () => {
    const verifyUid = async (r: { headers: Record<string, string> }) => (r.headers.authorization === 'Bearer good-alice' ? 'alice' : null);
    const guard = adaptiveGuard({ runInTests: true, maxInWindow: 3, blockAfter: 1, blockMs: 60_000, verifyUid: verifyUid as never });
    const nat = '100.64.7.7';
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push(await call(guard, nat));
    expect(statuses.at(-1)).toBe(429); // the address is now blocked
    expect(await call(guard, nat)).toBe(429); // anonymous: still blocked
    expect(await call(guard, nat, 'Bearer forged')).toBe(429); // a forged token is not an identity
    expect(await call(guard, nat, 'Bearer good-alice')).toBe(200); // alice is judged on her own traffic
  });

  it('server.ts wires the verified-account check into the guard', () => {
    expect(readFileSync('server.ts', 'utf8')).toMatch(/app\.use\(adaptiveGuard\(\{ verifyUid: verifyFirebaseTokenForIntegrations \}\)\)/);
  });
});

describe('Doctor AI cases are reachable only by the account that made them (F2)', () => {
  const fresh = () => 'r4nd0m';
  it('the key starts with the VERIFIED uid; a body userId is never part of it', () => {
    expect(sdaStoreKey('docA', 'case-1', fresh)).toBe('docA:case-1');
    expect(sdaStoreKey('docB', 'case-1', fresh)).toBe('docB:case-1'); // same case id, different account
    expect(sdaStoreKey('docB', undefined, fresh)).toBe('docB:default');
    expect(sdaStoreKey('docB', 'docA:case-1', fresh)).toBe('docB:default'); // cannot smuggle another prefix
    expect(sdaStoreKey(null, 'case-1', fresh)).toBe('anon:r4nd0m');
  });

  it('the route builds its key from the verified identity, not from the body', () => {
    const src = readFileSync('src/server/routes/sda.ts', 'utf8');
    expect(src).toMatch(/sdaStoreKey\(sdaIdentity\?\.uid, sessionId,/);
    expect(src).not.toMatch(/sessionId \|\| userId \|\| crypto/);
    expect(src).not.toMatch(/sessionId: sdaSessionId/); // the internal key never goes back to the client
    expect(readFileSync('server.ts', 'utf8')).not.toMatch(/sdaClinicalStore/); // the dead duplicate is gone
  });

  it('report files have a total memory budget; the newest file always stays', () => {
    const store = new SessionReportStore(10_000, 100);
    const file = (n: number) => ({ fileData: 'x'.repeat(n), fileType: 'image/png', fileName: 'ecg.png' });
    store.remember('s1', file(6_000), 1);
    store.remember('s2', file(6_000), 2); // over budget → s1 (oldest) leaves
    expect(store.latest('s1', 3)).toBeNull();
    expect(store.latest('s2', 3)).not.toBeNull();
    expect(store.totalBytes).toBe(6_000);
    store.remember('s3', file(20_000), 4); // bigger than the budget alone: it stays, everything else goes
    expect(store.latest('s3', 5)).not.toBeNull();
    expect(store.latest('s2', 5)).toBeNull();
  });
});

describe('the plain-chat reply cache can never hand one person another prompt\'s answer', () => {
  it('a SHA-256 key per prompt and model lane', () => {
    expect(chatReplyCacheKey('hi', false)).toBe(chatReplyCacheKey('hi', false));
    expect(chatReplyCacheKey('hi', false)).not.toBe(chatReplyCacheKey('hi', true));
    expect(chatReplyCacheKey('hi', false)).not.toBe(chatReplyCacheKey('hi ', false));
    expect(chatReplyCacheKey('hi', false)).toMatch(/^chatv2:[0-9a-f]{64}$/);
  });

  it('a live-search answer and a per-workspace steer are never cached', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const line = src.split('\n').find((l) => l.includes('const cacheable = ')) ?? '';
    expect(line).toMatch(/!liveGrounded/);
    expect(line).toMatch(/!askFramework/);
    expect(src).toMatch(/chatReplyCacheKey\(prompt, /);
  });
});

/** Every server source file (not tests, not code generators whose module-level text is emitted into user apps). */
function serverSources(): string[] {
  const out: string[] = ['server.ts'];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
      if (/\.ts$/.test(name) && !/\.test\.|\.spec\./.test(name) && !/Generator\.ts$/.test(name)) out.push(p);
    }
  };
  walk('src/server');
  return out;
}

const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

describe('census: per-instance state cannot grow with traffic', () => {
  const CENSUS: Record<string, string> = JSON.parse(readFileSync('tests/fixtures/moduleStateCensus.json', 'utf8'));
  const RAW = /^(?:export )?(?:const|let) ([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*new (Map|Set)\b(?:<[^\n]*?>)?\(\s*\)/gm;
  const found: string[] = [];
  for (const f of serverSources()) for (const m of readFileSync(f, 'utf8').matchAll(RAW)) found.push(`${f}::${m[1]}`);

  it('every raw module-level Map/Set is listed with the reason it is bounded', () => {
    const unlisted = found.filter((k) => !(k in CENSUS));
    expect(unlisted, 'Use BoundedCache (src/server/lib/boundedCache.ts), or list it in tests/fixtures/moduleStateCensus.json with a real reason').toEqual([]);
  });

  it('the census only shrinks — an entry that became a BoundedCache (or was deleted) leaves it', () => {
    const stale = Object.keys(CENSUS).filter((k) => !k.startsWith('_') && !found.includes(k));
    expect(stale).toEqual([]);
  });

  it('nothing clears a whole map because it got big (that resets every caller\'s limit at once)', () => {
    const offenders = serverSources().filter((f) => /\.size\s*>=?\s*(?:\d{3,}[\d_]*|[A-Z][A-Z0-9_]+)\s*\)\s*\{?\s*\w+\.clear\(\)/.test(code(readFileSync(f, 'utf8'))))
      // allowAfterCooldown: its keys are verified identities, and its own header argues the trade-off.
      .filter((f) => f !== join('src/server/lib/callCooldown.ts'));
    expect(offenders).toEqual([]);
  });

  it('nothing walks a whole map on the request path because it got big', () => {
    const offenders = serverSources().filter((f) => /if \(\s*\w+\.size\s*>=?\s*(?:\d{3,}[\d_]*|[A-Z][A-Z0-9_]+)\s*\)\s*\{?\s*\n?\s*for \(const/.test(code(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });
});

describe('SharedReadCache — public listings read once per TTL per instance', () => {
  it('concurrent misses share ONE read; a hit within the TTL reads nothing', async () => {
    const c = new SharedReadCache<number[]>({ maxEntries: 2, ttlMs: 60_000 });
    let reads = 0;
    const load = async () => { reads++; await new Promise((r) => setTimeout(r, 5)); return [1, 2]; };
    const all = await Promise.all(Array.from({ length: 20 }, () => c.get('k', load)));
    expect(all.every((v) => v.length === 2)).toBe(true);
    expect(reads).toBe(1);
    await c.get('k', load);
    expect(reads).toBe(1);
  });

  it('a failed read is not cached — the next request tries again', async () => {
    const c = new SharedReadCache<string>({ maxEntries: 2, ttlMs: 60_000 });
    await expect(c.get('k', async () => { throw new Error('down'); })).rejects.toThrow('down');
    expect(await c.get('k', async () => 'ok')).toBe('ok');
  });

  it('the store and gallery listings use it; an admin review clears it only after the admin check', () => {
    const nav = readFileSync('src/server/routes/navStore.ts', 'utf8');
    expect(nav).toMatch(/publicListings\.get\('web-apps'/);
    expect(nav).toMatch(/publicApprovedApps\.get\('approved'/);
    for (const route of ['/api/nav-store/admin/review', '/api/nav-store/web/admin/review']) {
      const block = nav.slice(nav.indexOf(`app.post('${route}'`), nav.indexOf(`app.post('${route}'`) + 600);
      expect(block.indexOf('.forget()')).toBeGreaterThan(block.indexOf('isStoreAdmin('));
    }
    const gal = readFileSync('src/server/routes/gallery.ts', 'utf8');
    expect(gal).toMatch(/approvedGallery\.get\(`approved:\$\{limit\}`/);
  });
});
