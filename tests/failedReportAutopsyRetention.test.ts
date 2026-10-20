import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import { purgeExpired, RETENTION_POLICIES, type RetentionPolicy } from '../src/server/lib/DataRetentionManager';
import { RETENTION_PURGE_TOKEN } from '../src/server/lib/retentionFence';
import { failedReportDigest } from '../src/server/lib/failedBuildReports';
import { isFailedBuildPage } from '../src/lib/failedBuildReports';
import { readFailedReportAutopsy, updateFailedReportAutopsy, withFailedReportAutopsies } from '../src/server/lib/failedReportAutopsy';

const COLLECTION = 'admin_failed_report_autopsies';
const NOW = Date.parse('2026-10-20T00:00:00Z');
const OLD = NOW - 200 * 86_400_000;
const CUTOFF = NOW - 180 * 86_400_000;
const POLICY = RETENTION_POLICIES.find(policy => policy.collection === COLLECTION)!;
const report = { ok: false, startedAt: 100, endedAt: 101, buildId: 'build-1', rootCause: 'Test failure' };
const reportDigest = failedReportDigest(report);
const input = (revision = 0) => ({
  expectedRevision: revision, reportDigest, mutationId: `${String(revision + 1).padStart(8, '0')}-1234-1234-1234-123456789abc`,
  status: 'in_progress', summary: 'The retained evidence is under a complete root-cause review.',
  ledgerUrl: '', counts: { total: 1, resolved: 0, blocked: 0 }, blockers: '', verification: null, reason: 'Begin review',
});
type Row = Record<string, any>;
type Change = { kind: 'set' | 'create' | 'update' | 'delete'; ref: any; value?: Row };

/** Serialized, atomic transactions plus deterministic interleavings at real query/commit boundaries. */
function database() {
  const data = new Map<string, Row>([
    ['workspace_diagnostics_v3/app/history/100', { report }],
    ['workspace_diagnostics_v3/app', { report }],
  ]);
  const deleted: string[] = [];
  const deletionBatches: number[] = [];
  const accesses: string[] = [];
  let serial = Promise.resolve();
  const hooks = {
    candidates: undefined as undefined | (() => Promise<void>),
    children: undefined as undefined | ((path: string) => Promise<void>),
    committed: undefined as undefined | ((changes: Change[]) => Promise<void>),
    failDelete: undefined as undefined | ((path: string) => boolean),
    enforceRequestBytes: false,
  };
  const snapshot = (ref: any) => ({ ref, exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
  const ref = (path: string): any => ({
    path, get: async () => snapshot(ref(path)),
    delete: async () => { throw new Error(`Unfenced direct delete: ${path}`); },
    collection: (name: string) => collection(`${path}/${name}`),
  });
  const collection = (path: string): any => ({
    doc: (id: string) => ref(`${path}/${id}`),
    limit: (size: number) => ({
      get: async () => {
        accesses.push(path);
        const docs = [...data.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
          .sort().slice(0, size).map(key => snapshot(ref(key)));
        await hooks.children?.(path);
        return { docs };
      },
    }),
    where: (field: string, op: string, bound: unknown) => {
      let cap = Infinity;
      const query = {
        limit: (size: number) => { cap = size; return query; },
        get: async () => {
          accesses.push(path);
          const docs = [...data.entries()].filter(([key, row]) => key.startsWith(`${path}/`) &&
            key.split('/').length === path.split('/').length + 1 &&
            op === '<' && typeof row[field] === 'number' && row[field] < Number(bound))
            .slice(0, cap).map(([key]) => snapshot(ref(key)));
          await hooks.candidates?.();
          return { docs };
        },
      };
      return query;
    },
  });
  const db: any = {
    collection, getAll: async (...refs: any[]) => refs.map(snapshot),
    runTransaction: (operation: (tx: any) => Promise<any>) => {
      const run = serial.then(async () => {
        const changes: Change[] = [];
        let wrote = false;
        const value = await operation({
          get: async (target: any) => {
            if (wrote) throw new Error('Firestore forbids reads after writes');
            return snapshot(target);
          },
          set: (target: any, row: Row) => { wrote = true; changes.push({ kind: 'set', ref: target, value: row }); },
          create: (target: any, row: Row) => { wrote = true; changes.push({ kind: 'create', ref: target, value: row }); },
          update: (target: any, row: Row) => { wrote = true; changes.push({ kind: 'update', ref: target, value: row }); },
          delete: (target: any) => { wrote = true; changes.push({ kind: 'delete', ref: target }); },
        });
        for (const change of changes) {
          if (change.kind === 'create' && data.has(change.ref.path)) throw new Error('Already exists');
          if (change.kind === 'update' && !data.has(change.ref.path)) throw new Error('Missing parent');
          if (change.kind === 'delete' && hooks.failDelete?.(change.ref.path)) throw new Error('Injected child deletion failure');
        }
        const deletes = changes.filter(change => change.kind === 'delete');
        if (hooks.enforceRequestBytes && deletes.reduce((bytes, change) =>
          bytes + Buffer.byteLength(JSON.stringify(data.get(change.ref.path) ?? {}), 'utf8'), 0) > 10 * 1024 * 1024) {
          throw new Error('Firestore transaction exceeds 10 MiB before index bytes');
        }
        if (deletes.length) deletionBatches.push(deletes.length);
        for (const change of changes) {
          if (change.kind === 'delete') { data.delete(change.ref.path); deleted.push(change.ref.path); }
          else data.set(change.ref.path, structuredClone(change.kind === 'update' ? { ...data.get(change.ref.path), ...change.value } : change.value!));
        }
        return { value, changes };
      });
      serial = run.then(() => undefined, () => undefined);
      return run.then(async result => { await hooks.committed?.(result.changes); return result.value; });
    },
  };
  return { db, data, deleted, deletionBatches, accesses, hooks,
    parent: () => [...data.keys()].find(key => key.startsWith(`${COLLECTION}/`) && key.split('/').length === 2)!,
    metadata: () => [...data.keys()].filter(key => key.startsWith(`${COLLECTION}/`)),
  };
}
async function seeded(revisions = 1, at = OLD) {
  const d = database(); state.db = d.db;
  for (let revision = 0; revision < revisions; revision++) {
    await updateFailedReportAutopsy('app', '100', input(revision), 'admin:owner', at);
  }
  return d;
}
beforeEach(() => { state.db = null; });

describe('report-review retention is transaction-fenced, bounded and resumable', () => {
  it('registers the actual write clock and both children, without modifying the diagnostic lifecycle', () => {
    expect(POLICY).toEqual({ collection: COLLECTION, ttlDays: 180, timestampField: 'updatedAt',
      timestampKind: 'epochMs', subs: ['revisions', 'mutations'], fenced: true });
    expect(RETENTION_POLICIES.filter(policy => policy.fenced).map(policy => policy.collection)).toEqual([COLLECTION]);
    expect(RETENTION_POLICIES.some(policy => policy.collection === 'workspace_diagnostics_v3')).toBe(false);
  });
  it('removes every expired metadata child before the parent, never querying or writing diagnostics', async () => {
    const d = await seeded(2); const parent = d.parent(); d.accesses.length = 0;
    const result = await purgeExpired(d.db, NOW, [POLICY]);
    expect(result.totalDeleted).toBe(5);
    expect(result.collections[0].error).toBeUndefined();
    expect(d.metadata()).toEqual([]);
    expect(d.deleted.at(-1)).toBe(parent);
    expect(d.accesses.every(path => path.startsWith(COLLECTION))).toBe(true);
    expect(d.data.get('workspace_diagnostics_v3/app/history/100')).toEqual({ report });
    expect(d.data.get('workspace_diagnostics_v3/app')).toEqual({ report });
    expect((await purgeExpired(d.db, NOW, [POLICY])).totalDeleted).toBe(0);
  });
  it.each([NOW, CUTOFF])('keeps fresh and exact-cutoff metadata and children (%s)', async at => {
    const d = await seeded(1, at);
    expect((await purgeExpired(d.db, NOW, [POLICY])).totalDeleted).toBe(0);
    expect(d.metadata()).toHaveLength(3);
    expect(d.data.get(d.parent())).not.toHaveProperty(RETENTION_PURGE_TOKEN);
  });
  it('rechecks the clock transactionally: a review refreshed after nomination wins', async () => {
    const d = await seeded();
    d.hooks.candidates = async () => {
      d.hooks.candidates = undefined;
      await updateFailedReportAutopsy('app', '100', input(1), 'admin:owner', NOW);
    };
    expect((await purgeExpired(d.db, NOW, [POLICY])).totalDeleted).toBe(0);
    expect((await readFailedReportAutopsy('app', '100'))?.revision).toBe(2);
    expect(d.metadata()).toHaveLength(5);
  });
  it('fenced records refuse fresh writes, receipt retries and direct reads honestly', async () => {
    const d = await seeded(2);
    // One child consumes the entire budget; parent remains fenced and reachable.
    await purgeExpired(d.db, NOW, [{ ...POLICY, maxPerRun: 1 }]);
    const parent = d.parent();
    expect(d.data.get(parent)?.[RETENTION_PURGE_TOKEN]).toMatch(/^[a-f0-9-]{36}$/);
    const before = structuredClone([...d.data]);
    await expect(updateFailedReportAutopsy('app', '100', input(2), 'admin:owner', NOW)).rejects.toThrow(/cleanup is in progress/);
    await expect(updateFailedReportAutopsy('app', '100', input(0), 'admin:owner', NOW)).rejects.toThrow(/cleanup is in progress/);
    await expect(readFailedReportAutopsy('app', '100')).rejects.toThrow(/no status was substituted/);
    expect([...d.data]).toEqual(before);
    expect(d.data.get(parent)?.updatedAt).toBe(OLD);
  });
  it('a known cleanup preserves the report page, continuation and unaffected statuses, without hiding corruption', async () => {
    const d = await seeded(); const parent = d.parent();
    await purgeExpired(d.db, NOW, [{ ...POLICY, maxPerRun: 1 }]);
    await updateFailedReportAutopsy('app', 'latest', input(), 'admin:owner', NOW);
    const row = { workspaceId: 'app', historyId: '100', reportDigest, buildId: 'build-1',
      startedAt: 100, endedAt: 101, appLabel: 'Test', rootCause: null };
    const page = { reports: [row, { ...row, historyId: 'latest' }, { ...row, historyId: '200' }], nextCursor: 'continue', scanned: 3 };
    const result = await withFailedReportAutopsies(page);
    expect(result).toEqual({ ...page, reports: [
      { ...row, autopsy: { state: 'cleanup_in_progress', revision: null } },
      { ...row, historyId: 'latest', autopsy: { state: 'in_progress', revision: 1 } },
      { ...row, historyId: '200', autopsy: { state: 'not_started', revision: 0 } },
    ] });
    expect(isFailedBuildPage(result)).toBe(true);
    for (const autopsy of [{ state: 'cleanup_in_progress', revision: 0 }, { state: 'done', revision: null },
      { state: 'not_a_state', revision: 1 }]) {
      expect(isFailedBuildPage({ ...page, reports: [{ ...row, autopsy }] })).toBe(false);
    }
    d.data.get(parent)!.summary = undefined;
    await expect(withFailedReportAutopsies(page)).rejects.toThrow(/metadata is invalid/);
    d.data.get(parent)![RETENTION_PURGE_TOKEN] = 'invalid';
    await expect(withFailedReportAutopsies(page)).rejects.toThrow(/fence is invalid/);
  });
  it('counts children in its cap and resumes the same fence until the complete parent can be removed', async () => {
    const d = await seeded(4); const parent = d.parent();
    let token: unknown;
    let total = 0;
    for (let run = 0; run < 5 && d.metadata().length; run++) {
      const result = await purgeExpired(d.db, NOW, [{ ...POLICY, maxPerRun: 3 }]);
      expect(result.totalDeleted).toBeLessThanOrEqual(3);
      expect(result.collections[0].error).toBeUndefined();
      total += result.totalDeleted;
      if (d.data.has(parent)) {
        expect(result.collections[0].capped).toBe(true);
        token ??= d.data.get(parent)?.[RETENTION_PURGE_TOKEN];
        expect(d.data.get(parent)?.[RETENTION_PURGE_TOKEN]).toBe(token);
        expect(d.data.get(parent)?.updatedAt).toBe(OLD);
      }
    }
    expect(total).toBe(9);
    expect(d.metadata()).toEqual([]);
    expect(d.deleted.at(-1)).toBe(parent);
  });
  it('pages real-size child collections without exceeding the child-inclusive allowance', async () => {
    const d = await seeded(); const parent = d.parent();
    for (let index = 2; index <= 650; index++) d.data.set(`${parent}/revisions/${String(index).padStart(6, '0')}`, { revision: index });
    const first = await purgeExpired(d.db, NOW, [POLICY]);
    expect(first.totalDeleted).toBe(500);
    expect(first.collections[0].capped).toBe(true);
    expect(d.data.has(parent)).toBe(true);
    const second = await purgeExpired(d.db, NOW, [POLICY]);
    expect(second.totalDeleted).toBe(152);
    expect(second.collections[0].capped).toBeUndefined();
    expect(d.metadata()).toEqual([]);
  });
  it('accepted maximum Unicode review notes never create an oversized transactional deletion page', async () => {
    const d = database(); state.db = d.db; d.hooks.enforceRequestBytes = true;
    const text = '漢'.repeat(4000);
    for (let revision = 0; revision < 300; revision++) {
      await updateFailedReportAutopsy('app', '100', { ...input(revision), status: 'blocked',
        summary: text, blockers: text, counts: { total: 1, resolved: 0, blocked: 1 },
        verification: { scope: 'source_and_tests', commitSha: 'a'.repeat(40),
          pullRequestUrl: 'https://github.com/docasheesh-png/navbharatai/pull/1',
          ciRunUrl: 'https://github.com/docasheesh-png/navbharatai/actions/runs/1', testSummary: text },
      }, 'admin:owner', OLD);
    }
    expect(Buffer.byteLength(text, 'utf8') * 3 * 300).toBeGreaterThan(10 * 1024 * 1024);
    let removed = 0;
    while (d.metadata().length) {
      const result = await purgeExpired(d.db, NOW, [POLICY]);
      expect(result.collections[0].error).toBeUndefined();
      expect(result.totalDeleted).toBeGreaterThan(0);
      expect(result.totalDeleted).toBeLessThanOrEqual(500);
      removed += result.totalDeleted;
    }
    expect(removed).toBe(601);
    expect(Math.max(...d.deletionBatches)).toBeLessThanOrEqual(16);
  });
  it('keeps a fenced parent and reports partial progress when child deletion fails; retry finishes', async () => {
    const d = await seeded(); const parent = d.parent();
    d.hooks.failDelete = path => path.includes('/mutations/');
    const first = await purgeExpired(d.db, NOW, [POLICY]);
    expect(first.totalDeleted).toBe(1);
    expect(first.collections[0].error).toMatch(/Injected child deletion failure/);
    expect(d.data.has(parent)).toBe(true);
    expect(d.data.get(parent)).toHaveProperty(RETENTION_PURGE_TOKEN);
    d.hooks.failDelete = undefined;
    expect((await purgeExpired(d.db, NOW, [POLICY])).totalDeleted).toBe(2);
    expect(d.metadata()).toEqual([]);
  });
  it('duplicate cleaners do not count an already removed child twice', async () => {
    const d = await seeded();
    let inner = 0;
    d.hooks.children = async path => {
      if (!path.endsWith('/revisions')) return;
      d.hooks.children = undefined;
      inner = (await purgeExpired(d.db, NOW, [{ ...POLICY, maxPerRun: 1 }])).totalDeleted;
    };
    const outer = await purgeExpired(d.db, NOW, [POLICY]);
    expect(inner).toBe(1);
    expect(outer.totalDeleted).toBe(2);
    expect(d.metadata()).toEqual([]);
    expect(new Set(d.deleted).size).toBe(d.deleted.length);
  });
  it.each(['before-child-batch', 'before-parent-delete'])('a stale cleaner cannot erase a recreated review: %s', async boundary => {
    const d = await seeded(); let nestedDeleted = 0;
    d.hooks.children = async path => {
      if (!path.endsWith(boundary === 'before-child-batch' ? '/revisions' : '/mutations')) return;
      d.hooks.children = undefined;
      nestedDeleted = (await purgeExpired(d.db, NOW, [POLICY])).totalDeleted;
      await updateFailedReportAutopsy('app', '100', input(), 'admin:owner', NOW);
    };
    const outer = await purgeExpired(d.db, NOW, [POLICY]);
    expect(outer.collections[0].error).toBeUndefined();
    expect(nestedDeleted + outer.totalDeleted).toBe(3);
    expect(d.metadata()).toHaveLength(3);
    expect((await readFailedReportAutopsy('app', '100'))?.record?.updatedAt).toBe(NOW);
  });
  it('a generation token also protects an empty-parent final delete from a stale cleaner', async () => {
    const d = await seeded();
    d.data.delete([...d.data.keys()].find(path => path.includes('/mutations/'))!);
    d.hooks.children = async path => {
      if (!path.endsWith('/mutations')) return;
      d.hooks.children = undefined;
      await purgeExpired(d.db, NOW, [POLICY]);
      await updateFailedReportAutopsy('app', '100', input(), 'admin:owner', NOW);
    };
    await purgeExpired(d.db, NOW, [POLICY]);
    expect(d.metadata()).toHaveLength(3);
    expect((await readFailedReportAutopsy('app', '100'))?.record?.updatedAt).toBe(NOW);
  });
  it('cannot fall back to direct deletion when a database lacks transactions', async () => {
    const d = await seeded(); delete d.db.runTransaction;
    const result = await purgeExpired(d.db, NOW, [POLICY]);
    expect(result.totalDeleted).toBe(0);
    expect(result.collections[0].error).toMatch(/requires transactions/);
    expect(d.metadata()).toHaveLength(3);
  });
  it('does not accept a malformed fence or an unsupported clock as deletion authority', async () => {
    const d = await seeded(); d.data.get(d.parent())![RETENTION_PURGE_TOKEN] = 'invalid';
    expect((await purgeExpired(d.db, NOW, [POLICY])).collections[0].error).toMatch(/Invalid retention fence/);
    expect((await purgeExpired(d.db, NOW, [{ ...POLICY, timestampKind: 'iso' } as RetentionPolicy])).collections[0].error).toMatch(/epochMs/);
    expect(d.deleted).toEqual([]);
  });
});
