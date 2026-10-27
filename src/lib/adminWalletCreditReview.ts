/** Admin-only diagnostic facts. None of these fields authorizes a balance change. */
export interface AdminWalletCreditReview {
  ok: boolean;
  reason?: string;
  requestedUserId: string;
  canonicalUserId: string | null;
  identityChain: string[];
  mergeResolutionEnabled: boolean;
  paused: boolean;
  pauseStateKnown: boolean;
  storedTokens?: number | null;
  storedInr?: number | null;
  ownerVisibleTokens?: number | null;
  ownerVisibleInr?: number | null;
  trackedGiftTokens?: number | null;
  trackedAdminTokens?: number | null;
  weakEligibleTokens?: number | null;
  paidSpendableTokens?: number | null;
  trackedOrdinaryGiftTokens?: number | null;
  provenanceConsistent?: boolean;
  pendingReservations?: boolean;
  suspended?: boolean;
  ledgerRows?: Array<{
    type: string;
    tokens: number | null;
    adminTokensDelta: number | null;
    at: string;
    description: string;
    creditSource: string;
    requestId: string;
    buildRef: string;
    rollupRef: string;
  }>;
  retainedAdminRows?: number;
  retainedUndatedRows?: number;
}
