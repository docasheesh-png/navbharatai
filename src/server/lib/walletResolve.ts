// Canonical-wallet resolver — completes the one-wallet merge (admin 2026-07-16).
//
// When the admin merges account B INTO account A (accountMerge.ts), B's wallet is retired: zeroed and
// stamped `mergedInto: A`. Slice 1 stops B from being spent (0 balance), but a user who logs into B still
// sees 0 instead of their real, unified balance under A. This resolver closes that gap: it follows the
// `mergedInto` pointer to the CANONICAL wallet id, so every wallet operation for a retired account
// transparently reads/writes the account it was merged into — the user sees ONE wallet however they log in.
//
// PURE (the Firestore read is injected) + loop-safe + fail-safe: any error, a cycle, or exceeding the hop
// bound resolves to the last known id (never throws, never loops forever). Gated by WALLET_MERGE_RESOLVE so
// it is a no-op until the admin turns it on after verifying a real merge.

/** Is the canonical-wallet resolver active? Default OFF — flip WALLET_MERGE_RESOLVE=on to enable. */

/**
 * Strict variant for financial reads/writes. A failed, corrupt, cyclic, or overlong merge chain
 * must never fall back to a retired uid: that can credit/debit a wallet the user no longer sees.
 * Callers should surface a retryable unavailable result when this throws.
 */
export class WalletOwnerResolutionError extends Error {
  readonly code = 'WALLET_OWNER_RESOLUTION_UNAVAILABLE';
  constructor(message = 'Wallet ownership could not be verified. Please retry.') {
    super(message);
    this.name = 'WalletOwnerResolutionError';
  }
}

export async function resolveCanonicalWalletIdStrict(
  readMergedInto: (uid: string) => Promise<string | null | undefined>,
  uid: string,
  maxHops = 5,
): Promise<string> {
  const start = typeof uid === 'string' ? uid.trim() : '';
  if (!start || !Number.isSafeInteger(maxHops) || maxHops < 1) {
    throw new WalletOwnerResolutionError('Wallet ownership input is invalid.');
  }

  const seen = new Set<string>([start]);
  let current = start;
  const readNext = async (id: string): Promise<string | null> => {
    let raw: string | null | undefined;
    try {
      raw = await readMergedInto(id);
    } catch {
      throw new WalletOwnerResolutionError();
    }
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new WalletOwnerResolutionError('Wallet merge metadata is invalid.');
    }
    return raw.trim();
  };

  for (let hop = 0; hop < maxHops; hop += 1) {
    const next = await readNext(current);
    if (!next || next === current) return current;
    if (seen.has(next)) throw new WalletOwnerResolutionError('Wallet merge metadata contains a cycle.');
    seen.add(next);
    current = next;
  }

  // Confirm the last reached wallet is terminal; do not silently stop at an intermediate owner.
  const tail = await readNext(current);
  if (!tail || tail === current) return current;
  throw new WalletOwnerResolutionError('Wallet merge chain exceeds the supported depth.');
}

export function walletMergeResolveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WALLET_MERGE_RESOLVE === 'on';
}

/**
 * Follow the `mergedInto` chain from `uid` to the canonical wallet id. `readMergedInto(uid)` returns the
 * `mergedInto` field of that wallet doc (or null/undefined when the doc is missing or not merged). Bounded
 * to `maxHops` and cycle-guarded, so a bad chain can never loop or hang. Returns the last resolved id on any
 * error or when no further pointer exists.
 */
export async function resolveCanonicalWalletId(
  readMergedInto: (uid: string) => Promise<string | null | undefined>,
  uid: string,
  maxHops = 5,
): Promise<string> {
  let current = uid;
  const seen = new Set<string>([uid]);
  for (let hop = 0; hop < maxHops; hop++) {
    let next: string | null | undefined;
    try {
      next = await readMergedInto(current);
    } catch {
      return current; // fail-safe: never let a resolver error block a wallet op
    }
    if (!next || typeof next !== 'string' || next === current || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
  return current; // hop bound hit — return the deepest we reached (still a valid wallet id)
}
