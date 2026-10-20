import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  parents: new Map<string, Record<string, unknown>>(),
  rows: new Map<string, Map<string, Record<string, unknown>>>(),
}));
vi.mock('firebase-admin', () => ({ apps: [{}] }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => ({
  collection: (name: string) => ({ doc: (key: string) => ({
    set: async (meta: Record<string, unknown>) => { state.parents.set(`${name}/${key}`, meta); },
    get: async () => ({ exists: state.parents.has(`${name}/${key}`), data: () => state.parents.get(`${name}/${key}`) }),
    collection: () => {
      const path = `${name}/${key}`;
      const rows = state.rows.get(path) ?? new Map<string, Record<string, unknown>>();
      state.rows.set(path, rows);
      const query = {
        select: () => query, orderBy: () => query, limit: () => query,
        get: async () => ({ size: rows.size, docs: [...rows.values()].map((row) => ({ data: () => row })) }),
        doc: (id: string) => ({
          set: async (row: Record<string, unknown>) => { rows.set(id, row); },
          get: async () => ({ exists: rows.has(id), data: () => rows.get(id) }),
        }),
      };
      return query;
    },
  }) }),
}) }));

import { buildHistoryStore } from '../src/server/project/BuildHistoryStore';
import { proBuildSessionStore } from '../src/server/pro/ProBuildSession';

beforeEach(() => {
  vi.stubEnv('VITEST', '');
  vi.stubEnv('NODE_ENV', 'production');
  state.parents.clear(); state.rows.clear();
});
afterEach(() => vi.unstubAllEnvs());

describe('canonical history storage', () => {
  const entry = (owner: string) => ({
    commitMessage: owner, files: { 'app.ts': `${owner} source` }, fileCount: 1, isEdit: false, ok: true,
  });

  it('isolates equal session suffixes and leaves discoverable parents for later account erasure', async () => {
    for (const owner of ['alice', 'bob']) {
      const key = `agentv3-${owner}-same-session`;
      expect(await buildHistoryStore.save(key, entry(owner))).toBe(true);
      expect(state.parents.get(`build_history_v2/${key}`)).toMatchObject({ workspaceId: key, storageVersion: 2 });
      const versions = await buildHistoryStore.list(key);
      expect(versions).toHaveLength(1);
      expect((await buildHistoryStore.get(key, versions[0].id))?.files).toEqual({ 'app.ts': `${owner} source` });
    }
    expect(state.rows.has('build_history_v2/same-session')).toBe(false);
  });

  it('does not read, write or delete legacy global records without owner proof', async () => {
    const legacy = new Map([['old-v1', { id: 'old-v1', files: { 'app.ts': 'private old source' } }]]);
    state.rows.set('build_history/same-session', legacy);
    expect(await buildHistoryStore.save('same-session', entry('attacker'))).toBe(false);
    expect(await buildHistoryStore.list('same-session')).toEqual([]);
    expect(await buildHistoryStore.get('same-session', 'old-v1')).toBeNull();
    expect(state.rows.get('build_history/same-session')).toBe(legacy);
    expect(legacy.get('old-v1')?.files).toEqual({ 'app.ts': 'private old source' });
    expect(state.parents.size).toBe(0);
  });

  it('cannot mistake an old arbitrary session shaped like a victim workspace for an owned v2 row', async () => {
    const key = 'agentv3-victim-session123';
    const legacy = new Map([['poisoned', { id: 'poisoned', files: { 'app.ts': 'attacker snapshot' } }]]);
    state.rows.set(`build_history/${key}`, legacy);
    expect(await buildHistoryStore.list(key)).toEqual([]);
    expect(await buildHistoryStore.get(key, 'poisoned')).toBeNull();
    expect(await buildHistoryStore.save(key, entry('victim'))).toBe(true);
    const versions = await buildHistoryStore.list(key);
    expect(versions).toHaveLength(1);
    expect((await buildHistoryStore.get(key, versions[0].id))?.files).toEqual({ 'app.ts': 'victim source' });
    expect(state.rows.get(`build_history/${key}`)).toBe(legacy);
  });

  it('keeps legacy global collections outside application read/write paths', () => {
    const server = join(process.cwd(), 'src/server');
    const offenders: string[] = [];
    for (const relative of readdirSync(server, { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(relative) || /\.test\./.test(relative)) continue;
      const source = readFileSync(join(server, relative), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/\.collection\(\s*['"](?:build_history|build_sessions)['"]\s*\)/.test(source)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  it('also separates transient build sessions from historical arbitrary-id records', async () => {
    const key = 'agentv3-victim-session123';
    const legacy = { ok: true, fileCount: 1, files: { 'app.ts': 'attacker old session' }, savedAt: 1 };
    state.parents.set(`build_sessions/${key}`, legacy);
    expect(await proBuildSessionStore.load(key)).toBeNull();
    await proBuildSessionStore.save(key, { ok: true, fileCount: 1, files: { 'app.ts': 'victim source' } });
    expect((await proBuildSessionStore.load(key))?.files).toEqual({ 'app.ts': 'victim source' });
    expect(state.parents.get(`build_sessions/${key}`)).toBe(legacy);
    expect(await proBuildSessionStore.load('session123')).toBeNull();
  });
});
