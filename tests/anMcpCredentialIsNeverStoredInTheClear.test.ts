// Q-628 (forensic audit 2026-10-04): the headers a user configures for a connected (MCP) service — their
// bearer token — were stored in plaintext in `agentv3_mcp_servers` and `agentv3_mcp_library`.
// Now they are sealed with lib/secrets.ts (AES-256-GCM) as `headersEnc`; legacy rows still work and are
// re-sealed; a key that cannot be decrypted fails CLOSED (the service is not called, the owner is told).

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { McpServerStore, MCP_COLLECTION } from '../src/server/AgentV3/McpServerStore';
import { McpLibraryStore, MCP_LIBRARY_COLLECTION } from '../src/server/AgentV3/McpLibraryStore';
import { openServer, sealServer, UNREADABLE_CREDENTIALS_MESSAGE } from '../src/server/AgentV3/mcpCredentials';
import { encrypt } from '../src/server/lib/secrets';

// ── A small in-memory Firestore: collection().doc().get()/set(merge), and runTransaction. ────────────
type Doc = Record<string, unknown>;
function fakeDb(opts: { failReads?: boolean } = {}) {
  const data = new Map<string, Doc>();
  const key = (c: string, id: string) => `${c}/${id}`;
  const ref = (c: string, id: string) => ({
    _k: key(c, id),
    async get() {
      if (opts.failReads) throw new Error('read failed');
      const d = data.get(key(c, id));
      return { exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) };
    },
    async set(v: Doc, o?: { merge?: boolean }) {
      const prev = o?.merge ? (data.get(key(c, id)) ?? {}) : {};
      data.set(key(c, id), JSON.parse(JSON.stringify({ ...prev, ...v })));
    },
  });
  const db = {
    collection: (c: string) => ({ doc: (id: string) => ref(c, id) }),
    async runTransaction(fn: (t: unknown) => Promise<unknown>) {
      const t = {
        get: (r: ReturnType<typeof ref>) => r.get(),
        set: (r: ReturnType<typeof ref>, v: Doc, o?: { merge?: boolean }) => { void r.set(v, o); },
      };
      return fn(t);
    },
  };
  return { db: db as never, data, raw: (c: string, id: string) => data.get(key(c, id)), seed: (c: string, id: string, d: Doc) => data.set(key(c, id), d) };
}

const SECRET = 'Bearer sk-live-THE-USERS-OWN-KEY-123';
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('🔒 a write never stores a header value in plaintext', () => {
  it('McpServerStore.add seals the headers into headersEnc', async () => {
    const f = fakeDb();
    const store = new McpServerStore(() => f.db);
    expect(await store.add('ws1', { id: 'notion', url: 'https://mcp.example.com', headers: { Authorization: SECRET } })).toBe(true);
    const stored = JSON.stringify(f.raw(MCP_COLLECTION, 'ws1'));
    expect(stored).not.toContain('sk-live-THE-USERS-OWN-KEY-123');
    expect(stored).not.toContain('"headers"');
    const entry = (f.raw(MCP_COLLECTION, 'ws1')!.servers as Doc[])[0];
    expect(String(entry.headersEnc)).toMatch(/^g\d+:/);
  });

  it('McpLibraryStore.save seals the headers too', async () => {
    const f = fakeDb();
    const lib = new McpLibraryStore(() => f.db);
    expect(await lib.save('u1', { id: 'notion', url: 'https://mcp.example.com', headers: { Authorization: SECRET } })).toBe(true);
    const stored = JSON.stringify(f.raw(MCP_LIBRARY_COLLECTION, 'u1'));
    expect(stored).not.toContain('sk-live-THE-USERS-OWN-KEY-123');
    expect(stored).not.toContain('"headers"');
  });

  it('a service with no auth stores no credential field at all', () => {
    expect(sealServer({ id: 'open', url: 'https://x.example' })).toEqual({ id: 'open', url: 'https://x.example' });
    expect(sealServer({ id: 'open', url: 'https://x.example', headers: {} })).toEqual({ id: 'open', url: 'https://x.example' });
  });
});

describe('a read returns the headers the user configured', () => {
  it('server store: listFull gives back the exact headers; the display list never does', async () => {
    const f = fakeDb();
    const store = new McpServerStore(() => f.db);
    await store.add('ws1', { id: 'notion', url: 'https://mcp.example.com', headers: { Authorization: SECRET, 'X-Team': 't1' } });
    expect(await store.listFull('ws1')).toEqual([{ id: 'notion', url: 'https://mcp.example.com', headers: { Authorization: SECRET, 'X-Team': 't1' } }]);
    const shown = await store.listForDisplay('ws1');
    expect(shown).toEqual([{ id: 'notion', url: 'https://mcp.example.com', hasAuth: true }]);
    expect(JSON.stringify(shown)).not.toContain('sk-live');
  });

  it('library: get returns the saved headers, and attach copies them sealed into the app', async () => {
    const f = fakeDb();
    const lib = new McpLibraryStore(() => f.db);
    const store = new McpServerStore(() => f.db);
    await lib.save('u1', { id: 'notion', url: 'https://mcp.example.com', headers: { Authorization: SECRET } });
    const saved = await lib.get('u1', 'notion');
    expect(saved?.headers).toEqual({ Authorization: SECRET });
    await store.add('ws1', saved!);
    expect(JSON.stringify(f.raw(MCP_COLLECTION, 'ws1'))).not.toContain('sk-live');
    expect((await store.listFull('ws1'))[0].headers).toEqual({ Authorization: SECRET });
  });
});

describe('a legacy plaintext row keeps working, and is sealed', () => {
  const legacy = { id: 'linear', url: 'https://linear.example', headers: { Authorization: 'Bearer legacy-plain-777' } };

  it('reads as before', async () => {
    const f = fakeDb();
    f.seed(MCP_COLLECTION, 'ws1', { workspaceId: 'ws1', servers: [legacy] });
    const store = new McpServerStore(() => f.db);
    expect(await store.listFull('ws1')).toEqual([legacy]);
  });

  it('a read starts a migration that re-seals it, and it still reads afterwards', async () => {
    const f = fakeDb();
    f.seed(MCP_COLLECTION, 'ws1', { workspaceId: 'ws1', servers: [legacy] });
    const store = new McpServerStore(() => f.db);
    await store.listFull('ws1');
    await flush(); await flush();
    const stored = JSON.stringify(f.raw(MCP_COLLECTION, 'ws1'));
    expect(stored).not.toContain('legacy-plain-777');
    expect(stored).toContain('headersEnc');
    expect(await store.listFull('ws1')).toEqual([legacy]);
  });

  it('the next write seals it too (library)', async () => {
    const f = fakeDb();
    f.seed(MCP_LIBRARY_COLLECTION, 'u1', { userId: 'u1', servers: [legacy] });
    const lib = new McpLibraryStore(() => f.db);
    await lib.save('u1', { id: 'notion', url: 'https://mcp.example.com', headers: { Authorization: SECRET } });
    const stored = JSON.stringify(f.raw(MCP_LIBRARY_COLLECTION, 'u1'));
    expect(stored).not.toContain('legacy-plain-777');
    expect(stored).not.toContain('sk-live');
    expect((await lib.listFull('u1')).map((s) => s.id).sort()).toEqual(['linear', 'notion']);
    expect((await lib.get('u1', 'linear'))?.headers).toEqual(legacy.headers);
  });
});

describe('🔒 a tampered (or unreadable) ciphertext fails CLOSED', () => {
  function tampered(): string {
    const enc = encrypt(JSON.stringify({ Authorization: SECRET }));
    const parts = enc.split(':');
    const ct = parts[3];
    parts[3] = (ct[0] === '0' ? '1' : '0') + ct.slice(1); // one flipped nibble — GCM's tag catches it
    return parts.join(':');
  }

  it('openServer drops the headers and says the key is unreadable', () => {
    const o = openServer({ id: 'notion', url: 'https://mcp.example.com', headersEnc: tampered() });
    expect(o.credentialsUnreadable).toBe(true);
    expect(o.cfg.headers).toBeUndefined();
    expect(openServer({ id: 'n', url: 'https://x', headersEnc: 'not-a-ciphertext' }).credentialsUnreadable).toBe(true);
    expect(openServer({ id: 'n', url: 'https://x', headersEnc: encrypt('"just a string"') }).credentialsUnreadable).toBe(true);
  });

  it('the server store never hands it out for a call, names it, and the screen says reconnect', async () => {
    const f = fakeDb();
    f.seed(MCP_COLLECTION, 'ws1', { workspaceId: 'ws1', servers: [
      { id: 'notion', url: 'https://mcp.example.com', headersEnc: tampered() },
      { id: 'open', url: 'https://open.example' },
    ] });
    const store = new McpServerStore(() => f.db);
    expect((await store.listFull('ws1')).map((s) => s.id)).toEqual(['open']);
    expect(await store.unreadableIds('ws1')).toEqual(['notion']);
    expect(await store.listForDisplay('ws1')).toEqual([
      { id: 'notion', url: 'https://mcp.example.com', hasAuth: true, needsReconnect: true },
      { id: 'open', url: 'https://open.example', hasAuth: false },
    ]);
  });

  it('another write keeps the unreadable entry byte for byte — deleting it is the owner\'s choice', async () => {
    const f = fakeDb();
    const bad = tampered();
    f.seed(MCP_COLLECTION, 'ws1', { workspaceId: 'ws1', servers: [{ id: 'notion', url: 'https://mcp.example.com', headersEnc: bad }] });
    const store = new McpServerStore(() => f.db);
    await store.add('ws1', { id: 'open', url: 'https://open.example' });
    const servers = f.raw(MCP_COLLECTION, 'ws1')!.servers as Doc[];
    expect(servers.find((s) => s.id === 'notion')?.headersEnc).toBe(bad);
  });

  it('the library refuses to hand it out, and tells why', async () => {
    const f = fakeDb();
    f.seed(MCP_LIBRARY_COLLECTION, 'u1', { userId: 'u1', servers: [{ id: 'notion', url: 'https://mcp.example.com', headersEnc: tampered() }] });
    const lib = new McpLibraryStore(() => f.db);
    expect(await lib.get('u1', 'notion')).toBeNull();
    expect((await lib.getOpened('u1', 'notion'))?.credentialsUnreadable).toBe(true);
    expect(UNREADABLE_CREDENTIALS_MESSAGE).toMatch(/connect it again/i);
  });

  it('a read failure is never mistaken for an empty list by a write', async () => {
    const f = fakeDb({ failReads: true });
    const store = new McpServerStore(() => f.db);
    expect(await store.add('ws1', { id: 'x', url: 'https://x.example' })).toBe(false);
    expect(await store.remove('ws1', 'x')).toBe(false);
    expect(f.raw(MCP_COLLECTION, 'ws1')).toBeUndefined();
  });
});

// ── The census ──────────────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) out.push(rel);
  }
  return out;
}
const STORES = ['src/server/AgentV3/McpServerStore.ts', 'src/server/AgentV3/McpLibraryStore.ts'];

describe('🔒 census: the MCP stores never write a `headers` field in plaintext', () => {
  it('neither store handles `headers` itself — every header goes through mcpCredentials.ts', () => {
    for (const f of STORES) expect(code(f), f).not.toMatch(/\bheaders\b/);
  });

  it('every write of `servers` is sealed (sealServer / resealStored)', () => {
    for (const f of STORES) {
      const src = code(f);
      const writes = [...src.matchAll(/\.set\(\s*[^,]*?,?\s*\{[^}]*?\bservers\s*:\s*([^,}]+)/g)];
      expect(writes.length, f).toBeGreaterThanOrEqual(3);
      for (const w of writes) {
        const expr = w[1].trim();
        const def = /^\w+$/.test(expr) ? (src.match(new RegExp(`const\\s+${expr}\\b[^=]*=([^;]+);`))?.[1] ?? '') : expr;
        expect(`${expr} ${def}`, `${f}: servers: ${expr}`).toMatch(/resealStored|sealServer/);
      }
    }
  });

  it('nothing else in the server writes to the two MCP collections', () => {
    // DataRetentionManager names the library only to DELETE it with the account (right to erasure).
    const ERASE_ONLY = 'src/server/lib/DataRetentionManager.ts';
    const touching = walk('src/server').filter((f) => /agentv3_mcp_(servers|library)|MCP_(LIBRARY_)?COLLECTION/.test(code(f)));
    expect(touching.filter((f) => f !== ERASE_ONLY).sort()).toEqual([...STORES].sort());
    expect(code(ERASE_ONLY)).not.toMatch(/\.(set|update|add)\(\s*\{|setDoc\(|updateDoc\(|addDoc\(/);
  });

  it('the routes fail closed: check does not probe an unreadable service, attach refuses it, the build names it', () => {
    const routes = code('src/server/routes/agentv3.ts');
    const check = routes.slice(routes.indexOf("app.post('/api/agentv3/mcp/check'"), routes.indexOf("app.post('/api/agentv3/mcp/attach'"));
    expect(check).toContain('mcpServerStore.listOpened(workspaceId)');
    expect(check.indexOf('if (credentialsUnreadable)')).toBeLessThan(check.indexOf('listRemoteTools(cfg)'));
    const attach = routes.slice(routes.indexOf("app.post('/api/agentv3/mcp/attach'"), routes.indexOf("app.post('/api/agentv3/mcp/forget'"));
    expect(attach).toContain('opened.credentialsUnreadable');
    expect(attach.indexOf('opened.credentialsUnreadable')).toBeLessThan(attach.indexOf('listRemoteTools(saved)'));
    expect(routes).toContain('mcpServerStore.unreadableIds(workspaceId)');
  });
});
