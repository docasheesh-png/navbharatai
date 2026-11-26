// ONE way to turn a resolved owner identity into a paid / free / admin / unknown tier (2026-11-26).
//
// Two admin routes (the build-report list and All builds) each spelled this out in place, and the built-apps list was
// about to need a third copy — the drift class: three filters labelled "Paid" that could disagree. They all call this.
// The rule itself lives in accountTier.ts; this only feeds it the identity's facts in one consistent way.

import { accountTier, type AccountTier } from './accountTier';
import { freeListLabelForStoredEmail } from '../AgentV3/featureFlag';

export interface TierIdentity {
  anonymous: boolean;
  email: string;
  /** null = no wallet record found (unknown), never "free". */
  paid: boolean | null;
}

/**
 * The tier of the account behind `uid`. `storedEmail` is an email recorded on the item itself (a build report's), used
 * before the identity's own for the free-list check, as the build-report list always did. PURE apart from the free-list
 * label read.
 */
export function tierOfIdentity(uid: string | null | undefined, identity: TierIdentity, storedEmail?: string | null): AccountTier {
  return accountTier({
    anonymous: identity.anonymous,
    freeListed: freeListLabelForStoredEmail(uid ?? null, storedEmail || identity.email || null), // a label (Q-624)
    // `paid` rode in on the identity, read from the wallet document the caller already fetched for the name and email —
    // so the tier costs no extra Firestore read.
    wallet: identity.paid === null ? null : { totalMoneySpent: identity.paid ? 1 : 0 },
    walletFound: identity.paid !== null,
  });
}
