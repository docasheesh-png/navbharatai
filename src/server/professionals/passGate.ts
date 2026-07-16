// Shared Professional Pass gate — the ONE place both the config-driven professional route and the
// bespoke Doctor AI (SDA) route enforce the pass/quota gate, so "Doctor AI = same as all professionals"
// (admin 2026-07-15) can never drift between the two. FLAG OFF ⇒ always allow (today's behaviour, zero
// extra Firestore reads). FLAG ON ⇒ free-list & active-pass are unlimited; anonymous callers must sign
// in; everyone else gets professionalFreeDailyLimit() free messages/day (shared across ALL professionals
// AND Doctor AI). Returns the model tier for an allowed turn, or a ready-to-send block payload.

import { decideProfessionalAccess } from './access';
import {
  professionalPaidEnabled, professionalFreeDailyLimit, professionalPassPriceInr,
  professionalPassDays, isProfessionalFreeUser,
} from './professionalPaid';
import { professionalPassStore } from './ProfessionalPassStore';
import { professionalUsageStore } from './ProfessionalUsageStore';

export type ProfessionalTier = 'free' | 'paid';

export type PassGateResult =
  | { allow: true; countsAgainstFree: boolean; remainingFree?: number; uid: string | null; tier: ProfessionalTier }
  | { allow: false; status: number; body: Record<string, unknown> };

/** Decide access + model tier for one professional/Doctor-AI turn. `uid`/`email` MUST be the server-
 *  verified identity (never a client-claimed body field). */
export async function gateProfessionalTurn(uid: string | null, email: string | null): Promise<PassGateResult> {
  if (!professionalPaidEnabled()) {
    // Flag off → today's behaviour: full paid-quality chain, no metering.
    return { allow: true, countsAgainstFree: false, uid, tier: 'paid' };
  }
  const freeListed = isProfessionalFreeUser(uid, email);
  const freeDailyLimit = professionalFreeDailyLimit();
  // Only touch Firestore for a signed-in, non-free-listed user (pass + today's count).
  const hasActivePass = !!uid && !freeListed ? (await professionalPassStore.getStatus(uid)).active : false;
  const usedToday = !!uid && !freeListed && !hasActivePass ? await professionalUsageStore.getTodayCount(uid) : 0;
  const decision = decideProfessionalAccess({
    enabled: true, signedIn: !!uid, isFreeListed: freeListed, hasActivePass, usedToday, freeDailyLimit,
  });
  if (decision.action === 'allow') {
    // Model tier: an active Pass (or the admin free-list) → the full paid chain; a within-quota free
    // user → the free chain (GLM → Vertex only). This is what makes "free = cheap models" real.
    const tier: ProfessionalTier = decision.reason === 'within-free-quota' ? 'free' : 'paid';
    return { allow: true, countsAgainstFree: decision.countsAgainstFree, remainingFree: decision.remainingFree, uid, tier };
  }
  const login = decision.reason === 'login-required';
  return {
    allow: false,
    status: login ? 401 : 402,
    body: {
      error: login
        ? 'Please sign in to use the Professionals. New users get free messages every day.'
        : `You've used your ${freeDailyLimit} free messages for today. Get the Professional Pass for unlimited access to every professional.`,
      code: login ? 'login_required' : 'professional_paywall',
      reason: decision.reason,
      remainingFree: 0,
      freeDailyLimit,
      passPriceInr: professionalPassPriceInr(),
      passDays: professionalPassDays(),
    },
  };
}

/** Record one consumed free message (only call after a genuinely-answered free-tier turn). Best-effort. */
export function burnFreeMessage(uid: string | null | undefined): void {
  if (uid) void professionalUsageStore.increment(uid);
}
