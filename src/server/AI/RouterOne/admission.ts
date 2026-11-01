import type { WeakSurplusAdmissionGate } from '../SurplusRegistry/surplusChatAdmission';

/** Keep the existing pin policy and its lazy branches outside the oversized chat handler. */
export function admitWithRouterOnePin(pinned: boolean, admit: () => Promise<WeakSurplusAdmissionGate>): Promise<WeakSurplusAdmissionGate> {
  return pinned ? Promise.resolve({ ok: true, session: undefined, diag: undefined }) : admit();
}

export function scopeAskWithRouterOnePin<T>(pinned: boolean, routerOne: () => T, surplus: () => T): T {
  return pinned ? routerOne() : surplus();
}
