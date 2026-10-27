/** Fractional liabilities are segregated by the funds allowed to pay them, not separate wallets. */
import { TOKEN_CARRY_FIELD } from './walletStatement';

export type CarryPurpose = 'cash' | 'ordinary' | 'admin';
const fields = { cash: 'cashRequiredTokenCarry', ordinary: 'ordinaryGiftTokenCarry', admin: 'adminEligibleTokenCarry' } as const;
type Carries = Record<CarryPurpose, number>;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;

export function walletCarries(w: Record<string, any>): Carries {
  if (Object.values(fields).some(field => w[field] !== undefined)) {
    return { cash: num(w[fields.cash]), ordinary: num(w[fields.ordinary]), admin: num(w[fields.admin]) };
  }
  // The old scalar has no trustworthy source attribution. Preserve the liability, conservatively
  // cash-required; never infer that an old purchase may be settled from a newly issued admin grant.
  return { cash: num(w[TOKEN_CARRY_FIELD]), ordinary: 0, admin: 0 };
}

export function carryPatch(c: Carries): Record<string, number> {
  return { [fields.cash]: c.cash, [fields.ordinary]: c.ordinary, [fields.admin]: c.admin,
    [TOKEN_CARRY_FIELD]: c.cash + c.ordinary + c.admin };
}

/** Merge preserves the FULL pending liability, even when a bucket now exceeds one token. */
export function mergeCarryPatch(a: Record<string, any>, b: Record<string, any>): Record<string, number> {
  const x = walletCarries(a); const y = walletCarries(b);
  return carryPatch({ cash: x.cash + y.cash, ordinary: x.ordinary + y.ordinary, admin: x.admin + y.admin });
}

export function chargePurpose(adminEligible: boolean, paused: boolean, paidOnly = false): CarryPurpose {
  return paidOnly || (!adminEligible && paused) ? 'cash' : adminEligible ? 'admin' : 'ordinary';
}

/** Materialize only this purpose's debt, never past its eligible funding capacity. Retain every tail. */
export function materializeWalletCharge(w: Record<string, any>, amount: number, purpose: CarryPurpose, capacity: number, hold = false) {
  const c = walletCarries(w);
  if (hold) return { tokens: amount, patch: carryPatch(c) }; // validated whole-token, exactly reversible
  const owed = Math.round((amount + c[purpose]) * 1e6) / 1e6;
  const tokens = Math.min(Math.floor(owed), Math.floor(Math.max(0, capacity)));
  c[purpose] = Math.max(0, Math.round((owed - tokens) * 1e6) / 1e6);
  return { tokens, patch: carryPatch(c) };
}
