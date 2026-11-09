import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { aiMaintenanceStore, MAINTENANCE_COLLECTION, MAINTENANCE_DOCUMENT } from './aiMaintenance';
import { assertLegacyInferenceAllowed } from '../AI/inferencePolicy';
import { QubaxError } from './qubax';

/** Request-local revocation latch. The initial async policy check and final transaction
 * still establish authority; a cache observer is not a substitute for either read.
 * Never throw from the shared store listener or change another workload's policy. */
export function createTestChatPolicyFence() {
  let revoked = false, closed = false, initialized = false;
  const unsubscribe = aiMaintenanceStore.onChange(state => { if (state.enabled || state.unavailable) revoked = true; });
  const unsubscribeUnavailable = aiMaintenanceStore.onUnavailable(() => { revoked = true; });
  return {
    async refresh() {
      try {
        aiMaintenanceStore.start();
        const state = await aiMaintenanceStore.read();
        // The isolated paid test does not inherit the general serving path's recent-off fail-open window.
        if (state.enabled || state.unavailable) revoked = true;
        if (revoked || closed) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
        assertLegacyInferenceAllowed('admin-test-chat-bot');
        initialized = true;
      } catch (error) { revoked = true; throw error; }
    },
    assertCurrent() {
      if (!initialized || revoked || closed) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
      assertLegacyInferenceAllowed('admin-test-chat-bot');
    },
    close() { if (!closed) { closed = true; unsubscribe(); unsubscribeUnavailable(); } },
  };
}

/** Included in the same atomic admission snapshot as catalog + exact approval.
 * Missing means the existing default-off policy. An existing malformed/unknown
 * pause state cannot authorize an Admin paid test. No policy is written here. */
export async function assertTestChatMaintenanceAtClaim(db: Firestore, tx: Transaction): Promise<void> {
  const snapshot = await tx.get(db.doc(`${MAINTENANCE_COLLECTION}/${MAINTENANCE_DOCUMENT}`));
  if (!snapshot.exists) return;
  const value = snapshot.data();
  if (!value || typeof value.enabled !== 'boolean' || value.enabled
    || (value.unavailable !== undefined && value.unavailable !== false)) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
}
