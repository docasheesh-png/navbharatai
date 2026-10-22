import type { RequestHandler } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { parseEnvFlag } from '../lib/envFlag';

export type InferenceScope = 'free-modules' | 'weak' | 'paid-builder';
const admittedImageEdit = new AsyncLocalStorage<boolean>();
const scopes = new AsyncLocalStorage<{ scope: InferenceScope }>();
/** Server-owned scope only. Never derive this from a user's prompt or arbitrary request field. */
export function runWithInferenceScope<T>(scope: InferenceScope, fn: () => T): T { return scopes.run({ scope }, fn); }
export function strictFreeRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const scope = scopes.getStore()?.scope;
  if (!scope || scope === 'paid-builder') return false;
  return parseEnvFlag(scope === 'weak' ? env.STRICT_FREE_WEAK_ENABLED : env.STRICT_FREE_MODULES_ENABLED) === true;
}
export class StrictFreeCapabilityError extends Error {
  readonly code = 'STRICT_FREE_CAPABILITY_UNAVAILABLE';
  readonly status = 503;
  constructor(readonly capability: string) { super('This feature has no verified free endpoint available. No paid fallback was used.'); }
}
/** Every legacy network path must opt out before dispatch, not after provider billing. */
export function assertLegacyInferenceAllowed(capability: string): void {
  if (capability === 'image-edit' && scopes.getStore()?.scope === 'free-modules' && admittedImageEdit.getStore() === true) return;
  if (strictFreeRequired()) throw new StrictFreeCapabilityError(capability);
}

/** Mutates only the current server-created request scope; never creates ambient context. */
export function setInferenceScopeForCurrentRequest(scope: InferenceScope): void {
  const state = scopes.getStore();
  if (!state) throw new Error('Missing server inference scope');
  state.scope = scope;
}

/** Bind to the actual Express route registration so aliases cannot miss a pathname filter. */
export const freeModuleInferenceScope: RequestHandler = (_req, _res, next) => runWithInferenceScope('free-modules', next);

/** Existing owner-funded image exception, only AFTER the image quota/payment hold is admitted.
 * Does not relax text, vision, embeddings, or Weak Builder policy inside the callback.
 */
export function runAdmittedLegacyImageEdit<T>(fn: () => T): T {
  if (scopes.getStore()?.scope !== 'free-modules') throw new StrictFreeCapabilityError('image-edit-admission');
  return admittedImageEdit.run(true, fn);
}
