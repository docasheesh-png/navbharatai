import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from '../../lib/serverDb';
import { livePilotIdentity } from './liveAdmission';
import { assertPilotAccountingState, surplusReceiptDigest } from './receiptStore';
import { PILOT_REASONS, isSurplusPilotStatus, type SurplusPilotStatus } from '../../../shared/surplusPilotStatus';

/** One exact document read, no receipt scan, provider call, transaction, or recovery mutation. */
export async function readSurplusPilotStatus(
  env: NodeJS.ProcessEnv = process.env,
  getDb: () => Pick<Firestore, 'doc'> | null = getServerDb,
): Promise<SurplusPilotStatus> {
  const identity = livePilotIdentity(env);
  const base: SurplusPilotStatus = { status: 'unknown', canDispatch: false, pending: null, blocked: null, quarantined: null,
    reason: null, recordedExpenseMicroUsd: null, calls: null, reservedEstimateMicroUsd: null,
    maxCalls: identity?.maxCalls ?? null, maxEstimatedMicroUsd: identity?.maxEstimatedMicroUsd ?? null };
  if (!identity) return base;
  try {
    const db = getDb();
    if (!db) return base;
    const snapshot = await db.doc(`surplus_pilot_admissions/${surplusReceiptDigest([identity.accountId, identity.credentialSha256, identity.pilotId])}`).get();
    if (!snapshot.exists) return { ...base, status: 'no_record' };
    const state = snapshot.data();
    try {
      if (!state || state.authorityId !== identity.pilotId) return { ...base, status: 'invalid_state' };
      assertPilotAccountingState(state);
      const view: SurplusPilotStatus = { ...base, status: 'recorded', pending: state.pendingCallId !== null,
        blocked: state.blocked === true, quarantined: state.quarantineReason != null || state.quarantinedAt != null,
        reason: state.quarantineReason == null ? null : PILOT_REASONS.includes(state.quarantineReason) ? state.quarantineReason : 'other',
        recordedExpenseMicroUsd: state.actualMicroUsd, calls: state.calls, reservedEstimateMicroUsd: state.reservedEstimatedMicroUsd };
      return isSurplusPilotStatus(view) ? view : { ...base, status: 'invalid_state' };
    } catch { return { ...base, status: 'invalid_state' }; }
  } catch { return base; } // Read failures never prove that a prior reservation failed to commit.
}
