/** Read-only metadata about the existing bounded latest-workspace sample, not a billing ledger. */
export interface SandboxObservationQuality {
  scope: 'latest-session-per-workspace';
  requestedLimit: number;
  returnedRecords: number;
  completeHistory: false;
  providerReconciled: false;
  missingSession: number;
  invalidInterval: number;
  unendedObservation: number;
  /** Valid timestamp rows with recorded end metadata, not verified lifecycle events. */
  locallyEndedObservation: number;
  zeroDurationObservation: number;
  legacyIdentity: number;
  /** Orthogonal to the interval partition; equality alone does not prove current ownership. */
  allocationIdentity: {
    missingRecordId: number; invalidRecordId: number;
    missingSessionId: number; invalidSessionId: number;
    matchingIds: number; mismatchedIds: number;
  };
  /** Missing/malformed operation counters, or busy time exceeding a valid ended span. */
  unverifiedOperationAccounting: number;
  endReasons: { idleSweep: number; orphanSweep: number; dropped: number; unknown: number };
  firstObservedAt: number | null;
  lastObservedAt: number | null;
  reclaimableMs: null;
  actualComputeUsd: null;
}

const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const usableId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** No I/O, clock, deduplication or inferred provider state. The caller supplies its already-read rows. */
export function summarizeSandboxObservations(
  records: ReadonlyArray<{ sandboxId?: unknown; session?: unknown }>, requestedLimit: number,
): SandboxObservationQuality {
  const result: SandboxObservationQuality = {
    scope: 'latest-session-per-workspace', requestedLimit, returnedRecords: records.length,
    completeHistory: false, providerReconciled: false,
    missingSession: 0, invalidInterval: 0, unendedObservation: 0, locallyEndedObservation: 0,
    zeroDurationObservation: 0, legacyIdentity: 0,
    allocationIdentity: { missingRecordId: 0, invalidRecordId: 0, missingSessionId: 0, invalidSessionId: 0, matchingIds: 0, mismatchedIds: 0 },
    unverifiedOperationAccounting: 0,
    endReasons: { idleSweep: 0, orphanSweep: 0, dropped: 0, unknown: 0 },
    firstObservedAt: null, lastObservedAt: null, reclaimableMs: null, actualComputeUsd: null,
  };
  for (const record of records) {
    const raw = record?.session;
    const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
    const recordId = record?.sandboxId;
    const sessionId = s?.sandboxId;
    if (recordId == null) result.allocationIdentity.missingRecordId++;
    else if (!usableId(recordId)) result.allocationIdentity.invalidRecordId++;
    if (sessionId == null) result.allocationIdentity.missingSessionId++;
    else if (!usableId(sessionId)) result.allocationIdentity.invalidSessionId++;
    if (usableId(recordId) && usableId(sessionId)) {
      if (recordId === sessionId) result.allocationIdentity.matchingIds++;
      else result.allocationIdentity.mismatchedIds++;
    }
    const busy = s?.busyMs;
    const ops = s?.ops;
    const endedSpan = s && timestamp(s.startedAt) && timestamp(s.endedAt) && s.endedAt >= s.startedAt
      ? s.endedAt - s.startedAt : null;
    if (!timestamp(busy) || !timestamp(ops) || !Number.isInteger(ops)
      || (endedSpan !== null && busy > endedSpan)) {
      result.unverifiedOperationAccounting++;
    }
    if (raw == null) { result.missingSession++; continue; }
    if (!s) { result.invalidInterval++; continue; }
    if (!usableId(s.observationId)) result.legacyIdentity++;
    const { startedAt, endedAt } = s;
    // An absent end is unknown, not now and not zero. Null/strings are malformed, not timestamps.
    if (!timestamp(startedAt) || (endedAt !== undefined && (!timestamp(endedAt) || endedAt < startedAt))) {
      result.invalidInterval++; continue;
    }
    result.firstObservedAt = result.firstObservedAt === null ? startedAt : Math.min(result.firstObservedAt, startedAt);
    const last = endedAt === undefined ? startedAt : endedAt as number;
    result.lastObservedAt = result.lastObservedAt === null ? last : Math.max(result.lastObservedAt, last);
    if (endedAt === undefined) { result.unendedObservation++; continue; }
    result.locallyEndedObservation++;
    if (endedAt === startedAt) result.zeroDurationObservation++;
    if (s.endedBy === 'idle-sweep') result.endReasons.idleSweep++;
    else if (s.endedBy === 'orphan-sweep') result.endReasons.orphanSweep++;
    else if (s.endedBy === 'dropped') result.endReasons.dropped++;
    else result.endReasons.unknown++;
  }
  return result;
}

export function sandboxObservationNote(q: SandboxObservationQuality): string {
  return `Returned ${q.returnedRecords} workspace records (requested limit ${q.requestedLimit}); latest observations only, not complete history. `
    + `${q.locallyEndedObservation} with recorded end metadata, ${q.unendedObservation} without an observed end, ${q.missingSession} missing and ${q.invalidInterval} invalid intervals; ${q.zeroDurationObservation} valid zero-duration observations. `
    + `Allocation IDs: ${q.allocationIdentity.matchingIds} matching, ${q.allocationIdentity.mismatchedIds} mismatched; record IDs ${q.allocationIdentity.missingRecordId} missing/${q.allocationIdentity.invalidRecordId} invalid, session IDs ${q.allocationIdentity.missingSessionId} missing/${q.allocationIdentity.invalidSessionId} invalid. These counts are separate from interval validity; matching IDs do not prove current ownership. `
    + `${q.unverifiedOperationAccounting} records have unverified operation accounting. `
    + `${q.legacyIdentity} observations lack an observation ID (legacy/unverified). Recorded ends may be inherited legacy fields; dropped handles and end metadata do not establish provider stop times. `
    + 'Outside measured operations can include model waits, active previews and unobserved work; it is not measured waste. '
    + 'Repeated or overlapping observations and workspace-only build joins are not deduplicated billing intervals. '
    + 'Missing records, overwritten history and failed reads are not distinguishable in this sample. '
    + 'Actual compute charges and reclaimable time are unknown, not zero. Daily create/connect counters are a separate best-effort sample, not completed applications or verified provider starts.';
}
