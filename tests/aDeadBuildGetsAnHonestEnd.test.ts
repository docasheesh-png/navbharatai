// failedbr #2497 (2026-11-22): the build's server died at ~1 min without running any JS, its report stayed "unfinished"
// with no end forever, and for the next ~90 s its lease made the platform tell the user "your earlier build for this
// app is still running" about a build that was gone. The CLASS: a build that dies always gets an honest end, and a
// silent lease holder is never reported as running.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BUILD_ENDED_UNRECORDED_CODE, isOrphanedReport, lastSignOfLife, settleOrphanedReport } from '../src/server/AgentV3/orphanedBuildReport';
import { buildReportOutcome } from '../src/server/lib/buildReportRegistry';
import {
  claimWorkspaceBuild, claimWorkspaceBuildAwaitingRelease, silentHolderWaitUntil, LEASE_HEARTBEAT_MS, LEASE_STALE_MS,
  SILENT_HOLDER_MS, SILENT_HOLDER_MAX_WAIT_MS, WORKSPACE_BUILD_LEASE_COLLECTION, type BuildLeaseStore,
} from '../src/server/AgentV3/workspaceBuildLease';

afterEach(() => vi.useRealTimers());
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/** #2497's report as saved: the real start, first and last issues (timestamps and codes from the build report). */
const REPORT_2497 = {
  startedAt: 1795352443527,
  issues: [
    { ts: 1795352443527, code: 'BUILD_STARTED', severity: 'info' },
    { ts: 1795352476673, code: 'GAME_KIT_SEEDED', severity: 'info' },
    { ts: 1795352480124, code: 'PROVIDER_FALLBACK', severity: 'warning' },
    { ts: 1795352489084, code: 'HEARTBEAT', severity: 'info' },
    { ts: 1795352489084, code: 'TODO_ONLY_TURNS', severity: 'info' },
  ],
  problems: [{ ts: 1795352480124, code: 'PROVIDER_FALLBACK', severity: 'warning' }],
  counts: { total: 50, errors: 0, warnings: 1, unresolved: 0 },
};
/** #2498 started in the same workspace about two minutes later. */
const STARTED_2498 = 1795352574034;

describe('a build that died gets an honest end when the next build holds its workspace', () => {
  it('#2497 is settled as failed, ended at its last sign of life, saying what is known and nothing more', () => {
    expect(buildReportOutcome(REPORT_2497)).toBe('unfinished');
    expect(isOrphanedReport(REPORT_2497, STARTED_2498)).toBe(true);
    const settled = settleOrphanedReport(REPORT_2497, { newBuildStartedAt: STARTED_2498 });
    expect(settled.endedAt).toBe(lastSignOfLife(REPORT_2497));
    expect(settled.endedAt).toBe(1795352489084);
    expect(settled.ok).toBe(false);
    expect(buildReportOutcome(settled)).toBe('failed');
    const end = settled.issues.at(-1)!;
    expect(end).toMatchObject({ code: BUILD_ENDED_UNRECORDED_CODE, severity: 'error', autoResolved: false });
    expect(end.message).toContain('no work was recorded after 46 s');
    expect(end.message).toContain('85 s later');
    expect(settled.counts).toMatchObject({ total: 51, errors: 1, unresolved: 1 });
    expect(settled.issues.slice(0, -1)).toEqual(REPORT_2497.issues); // nothing the build recorded is rewritten
  });

  it('never settles a finished report or one that started after the new build', () => {
    expect(isOrphanedReport({ ...REPORT_2497, endedAt: 1795352500000, ok: true }, STARTED_2498)).toBe(false);
    expect(isOrphanedReport({ ...REPORT_2497, startedAt: STARTED_2498 + 1 }, STARTED_2498)).toBe(false);
    expect(isOrphanedReport(null, STARTED_2498)).toBe(false);
  });

  it('runs the moment a build holds the lease, from the one heartbeat every admitted build starts', () => {
    const coordination = read('src/server/AgentV3/BuildRequestCoordination.ts');
    const hb = coordination.slice(coordination.indexOf('export function startBuildLeaseHeartbeat('));
    expect(hb.indexOf('settleOrphanedBuildReports(opts.workspaceId, opts.admittedAt)')).toBeGreaterThan(0);
    expect(hb.indexOf('settleOrphanedBuildReports(')).toBeLessThan(hb.indexOf('const timer = setInterval('));
    const store = read('src/server/AgentV3/DiagnosticsStore.ts');
    expect(store).toMatch(/where\('inProgress', '==', true\)\.limit\(5\)/);
    expect(store).toMatch(/isOrphanedReport\(report, newBuildStartedAt\)[\s\S]{0,200}commitDiagnosticsHistory\(db, workspaceId, settleOrphanedReport\(/);
  });
});

function leaseStore() {
  const docs = new Map<string, Record<string, unknown>>();
  const db: BuildLeaseStore = {
    collection: (name) => ({ doc: (id) => `${name}/${id}` }),
    runTransaction: async (body) => body({ get: async (ref) => ({ exists: docs.has(String(ref)), data: () => docs.get(String(ref)) }), set: (ref, value) => { docs.set(String(ref), value); }, delete: (ref) => { docs.delete(String(ref)); } }),
  };
  return { db, docs };
}

describe('a silent lease holder is waited out, never reported as "still running"', () => {
  it('pure: only a holder that missed two beats extends the wait, to just past its lapse, bounded', () => {
    const start = 1_000_000;
    expect(silentHolderWaitUntil(start - LEASE_HEARTBEAT_MS, start, start)).toBe(0); // heartbeating
    expect(silentHolderWaitUntil(0, start, start)).toBe(0); // unreadable
    const beat = start - SILENT_HOLDER_MS;
    expect(silentHolderWaitUntil(beat, start, start)).toBe(beat + LEASE_STALE_MS + 2_000);
    expect(silentHolderWaitUntil(beat, start, start) - start).toBeLessThanOrEqual(SILENT_HOLDER_MAX_WAIT_MS);
  });

  it('#2497 shape: a holder dead for 50 s blocks no message — the claim waits for the lapse and admits', async () => {
    vi.useFakeTimers();
    const { db, docs } = leaseStore();
    const now = Date.now();
    docs.set(`${WORKSPACE_BUILD_LEASE_COLLECTION}/w`, { token: 'dead', owner: 'gone-instance', heartbeatAt: now - 50_000 });
    const p = claimWorkspaceBuildAwaitingRelease(db, { workspaceId: 'w', token: 'B', owner: 'worker-B', nowMs: now, waitMs: 12_000, pollMs: 1_000 });
    await vi.advanceTimersByTimeAsync(SILENT_HOLDER_MAX_WAIT_MS);
    expect(await p).toMatchObject({ ok: true });
  });

  it('a holder that keeps heartbeating is still honestly busy after the ordinary wait', async () => {
    vi.useFakeTimers();
    const { db, docs } = leaseStore();
    await claimWorkspaceBuild(db, { workspaceId: 'w', token: 'A', owner: 'worker-A' });
    const beat = setInterval(() => { const d = docs.get(`${WORKSPACE_BUILD_LEASE_COLLECTION}/w`); if (d) d.heartbeatAt = Date.now(); }, LEASE_HEARTBEAT_MS);
    const p = claimWorkspaceBuildAwaitingRelease(db, { workspaceId: 'w', token: 'B', owner: 'worker-B', waitMs: 12_000, pollMs: 1_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    clearInterval(beat);
    expect(await p).toMatchObject({ ok: false, reason: 'busy' });
  });
});
