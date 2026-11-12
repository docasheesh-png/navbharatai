import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { summarizeSandboxObservations, sandboxObservationNote } from '../src/server/AgentV3/sandboxObservationQuality';

const session = { startedAt: 100, endedAt: 200, busyMs: 0, ops: 0, sandboxId: 'machine', observationId: 'observation', endedBy: 'idle-sweep' };

describe('bounded sandbox observation quality', () => {
  it('reports empty returned data as unknown charges/history, not a free or empty fleet', () => {
    const q = summarizeSandboxObservations([], 500);
    expect(q).toMatchObject({ returnedRecords: 0, requestedLimit: 500, completeHistory: false, providerReconciled: false,
      firstObservedAt: null, lastObservedAt: null, reclaimableMs: null, actualComputeUsd: null });
    expect(sandboxObservationNote(q)).toContain('failed reads are not distinguishable');
  });

  it('distinguishes missing, unended, invalid and valid zero-duration observations', () => {
    const q = summarizeSandboxObservations([
      {}, { session: null }, { session: { startedAt: 0 } },
      { session: { ...session, endedAt: 100 } }, { session: { ...session, endedAt: 99 } },
    ], 10);
    expect(q).toMatchObject({ returnedRecords: 5, missingSession: 2, unendedObservation: 1,
      locallyEndedObservation: 1, zeroDurationObservation: 1, invalidInterval: 1,
      firstObservedAt: 0, lastObservedAt: 100 });
    expect(q.missingSession + q.unendedObservation + q.locallyEndedObservation + q.invalidInterval).toBe(q.returnedRecords);
  });

  it.each([NaN, Infinity, -1, null, '100', '', false])('does not coerce malformed timestamps %s into evidence', value => {
    expect(summarizeSandboxObservations([{ session: { ...session, startedAt: value } }], 1).invalidInterval).toBe(1);
    expect(summarizeSandboxObservations([{ session: { ...session, endedAt: value } }], 1).invalidInterval).toBe(1);
  });

  it('counts malformed session shapes without inventing timestamps', () => {
    const q = summarizeSandboxObservations([1, 'record', [], {}].map(s => ({ session: s })), 4);
    expect(q.invalidInterval).toBe(4);
    expect(q.firstObservedAt).toBeNull();
    expect(q.lastObservedAt).toBeNull();
  });

  it('keeps recorded end reasons and legacy identity separate from provider completion', () => {
    const q = summarizeSandboxObservations(['idle-sweep', 'orphan-sweep', 'dropped', undefined, 'provider-timeout'].map(endedBy => ({
      session: { ...session, endedBy, observationId: undefined },
    })), 5);
    expect(q.endReasons).toEqual({ idleSweep: 1, orphanSweep: 1, dropped: 1, unknown: 2 });
    expect(q.legacyIdentity).toBe(5);
    expect(sandboxObservationNote(q)).toContain('do not establish provider stop times');
  });

  it('does not infer waste during model wait or preview traffic, even when all measured operations are absent', () => {
    const q = summarizeSandboxObservations([{ session: { ...session, startedAt: 0, endedAt: 600_000, busyMs: 0 } }], 1);
    expect(q.reclaimableMs).toBeNull();
    expect(q.actualComputeUsd).toBeNull();
    expect(sandboxObservationNote(q)).toContain('model waits, active previews and unobserved work');
    expect(sandboxObservationNote(q)).toContain('not measured waste');
  });

  it('counts duplicate/overlapping rows only as observations, without claiming unique billing intervals', () => {
    const q = summarizeSandboxObservations([{ session }, { session }, { session: { ...session, startedAt: 150, endedAt: 250 } }], 3);
    expect(q.locallyEndedObservation).toBe(3);
    expect(q.lastObservedAt).toBe(250);
    expect(q.completeHistory).toBe(false);
    expect(sandboxObservationNote(q)).toContain('not deduplicated billing intervals');
  });

  it('reports missing, invalid and mismatched allocation identities without leaking IDs', () => {
    const q = summarizeSandboxObservations([
      { sandboxId: 'machine', session },
      { sandboxId: 'new-machine', session },
      { session: { ...session, sandboxId: undefined } },
      { sandboxId: '', session: { ...session, sandboxId: 1 } },
      { sandboxId: 4, session: { ...session, sandboxId: ' ' } },
      { sandboxId: null, session: null },
    ], 6);
    expect(q.allocationIdentity).toEqual({ matchingIds: 1, mismatchedIds: 1,
      missingRecordId: 2, invalidRecordId: 2, missingSessionId: 2, invalidSessionId: 2 });
    // Valid timestamps are not proof that the observation belongs to the current allocation.
    expect(q.locallyEndedObservation).toBe(5);
    expect(sandboxObservationNote(q)).toContain('separate from interval validity');
    expect(JSON.stringify(q)).not.toContain('new-machine');
  });

  it.each([undefined, NaN, Infinity, -1, null, '0'])('flags unverified operation fields %s without changing interval counts', value => {
    const q = summarizeSandboxObservations([
      { session: { ...session, busyMs: value } }, { session: { ...session, ops: value } },
    ], 2);
    expect(q.unverifiedOperationAccounting).toBe(2);
    expect(q.locallyEndedObservation).toBe(2);
  });

  it('flags busy time exceeding ended span and fractional operation counts, but accepts exact zero', () => {
    const q = summarizeSandboxObservations([
      { session: { ...session, busyMs: 101 } }, { session: { ...session, ops: 0.5 } },
      { session: { ...session, endedAt: session.startedAt } },
      { session: { ...session, busyMs: 100 } },
    ], 4);
    expect(q.unverifiedOperationAccounting).toBe(2);
    expect(q.zeroDurationObservation).toBe(1);
    expect(q.locallyEndedObservation).toBe(4);
  });

  it('does not mutate input or expose identifiers, private metadata or resource guesses', () => {
    const input = [{ session: { ...session, sandboxId: 'secret-machine', metadata: { key: 'private-key' }, cpuCount: 8 } }];
    const before = JSON.stringify(input);
    const q = summarizeSandboxObservations(input, 1);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(q)).not.toMatch(/secret-machine|private-key|cpuCount|observationId/);
  });
});

describe('existing bounded read and presentation wiring', () => {
  const route = readFileSync('src/server/routes/admin.ts', 'utf8');
  const at = route.indexOf("app.get('/api/admin/sandbox-handover'");
  const handler = route.slice(at, route.indexOf("app.get('/api/admin/audit-log'", at));
  const ui = readFileSync('src/components/AdminDashboard.tsx', 'utf8');

  it('reuses exactly the existing bounded reads with no provider or persistence calls', () => {
    expect(handler).toContain('verifyAdminToken');
    expect(handler.match(/listBuildFacts\(limit\)/g)).toHaveLength(1);
    expect(handler.match(/sandboxStore.listRecent\(limit\)/g)).toHaveLength(1);
    expect(handler.match(/sandboxStore.listDailyStarts\(14\)/g)).toHaveLength(1);
    expect(handler).toContain('summarizeSandboxObservations(sandboxes, limit)');
    expect(handler).toContain('observationQuality, observationNote');
    expect(handler).not.toMatch(/getInfo\(|countRunningSandboxes\(|\.set\(|\.update\(|\.delete\(/);
    expect(handler).toContain('window: limit, sample, pauseCauses, minutes, starts');
  });

  it('shows caveats even on an older response and removes unsupported savings/provider claims', () => {
    expect(ui).toContain('aria-label="Sandbox observation limits"');
    expect(ui).toContain('handover.observationNote ??');
    expect(ui.match(/observationNote\?: string/g)).toHaveLength(1);
    expect(ui).toContain('Sampled observations, not verified billing or savings.');
    expect(ui).toContain('<summary className="cursor-pointer font-bold">Observation quality and limitations</summary>');
    expect(ui).toContain('Recorded build-to-pause gap');
    expect(ui).toContain('outside measured operations');
    expect(ui).toContain('Recorded create/connect reasons');
    expect(ui).not.toContain("% of billed time was nobody's work");
    expect(ui).not.toContain("['Reclaimable'");
    expect(ui).not.toContain('>reclaimable</span>');
    expect(ui).not.toContain('lifetime doing the reaping');
    expect(ui).not.toContain('h/day</span> reclaimable');
  });
});
