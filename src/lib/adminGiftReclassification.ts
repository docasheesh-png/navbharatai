/** A read-only, account-specific preview. No balance or payment is added by confirmation. */
export interface AdminGiftReclassificationPreview {
  requestedUserId: string;
  canonicalUserId: string;
  accountEmail: string | null;
  amount: number;
  balanceTokens: number;
  remainingInr: number;
  giftTokens: number;
  adminTokens: number;
  availableGiftTokens: number;
  afterAdminTokens: number;
  fingerprint: string;
}
