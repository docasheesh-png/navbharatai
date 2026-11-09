import { assertCanaryLegacyAllowed } from '../AgentV3/reliability/canarySpendGuard';
import type { RequestHandler } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { parseEnvFlag } from '../lib/envFlag';
import { assertNoUnclaimedGatewayDispatch } from './InferenceGateway/dispatchBoundary';

export type InferenceScope = 'free-modules' | 'weak' | 'paid-builder' | 'paid-professional' | 'paid-voice';
const surplusBuild = new AsyncLocalStorage<{ enabled: boolean }>();
/** Narrow server-owned build boundary: unrelated requests and media keep their existing policy. */
export function runWithSurplusBuild<T>(enabled: boolean, fn: () => T): T { return surplusBuild.run({ enabled }, fn); }
export function activateSurplusBuildForCurrentRequest(enabled = true): void {
  const state = surplusBuild.getStore();
  if (!state) throw new Error('Missing discounted build request scope');
  state.enabled = enabled;
}
export class SurplusLegacyFallbackError extends Error {
  readonly code = 'DISCOUNT_BUILD_LEGACY_FALLBACK_BLOCKED';
  constructor() { super('The discounted build engine cannot use this auxiliary engine. No paid fallback was used.'); }
}
const SURPLUS_MEDIA_EXCEPTIONS = new Set(['image-generation', 'image-edit', 'image-enhancement', 'vision', 'vision-description']);
export const surplusBuildInferenceScope: RequestHandler = (_req, _res, next) => runWithSurplusBuild(false, next);

const admittedImageEdit = new AsyncLocalStorage<boolean>();
const scopes = new AsyncLocalStorage<{ scope: InferenceScope }>();
/** Server-owned scope only. Never derive this from a user's prompt or arbitrary request field. */
export function runWithInferenceScope<T>(scope: InferenceScope, fn: () => T): T { return scopes.run({ scope }, fn); }
export function strictFreeRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const scope = scopes.getStore()?.scope;
  // Pro App Builder, including Weak, retains its pre-registry routing.
  // The retired Weak flag cannot re-enable the removed free-builder option.
  if (scope !== 'free-modules') return false;
  return parseEnvFlag(env.STRICT_FREE_MODULES_ENABLED) === true;
}
export class StrictFreeCapabilityError extends Error {
  readonly code = 'STRICT_FREE_CAPABILITY_UNAVAILABLE';
  readonly status = 503;
  constructor(readonly capability: string) { super('This feature has no verified free endpoint available. No paid fallback was used.'); }
}
/** Every legacy network path must opt out before dispatch, not after provider billing. */
export function assertLegacyInferenceAllowed(capability: string): void {
  assertCanaryLegacyAllowed(capability);
  assertNoUnclaimedGatewayDispatch(capability);
  if (surplusBuild.getStore()?.enabled === true && !SURPLUS_MEDIA_EXCEPTIONS.has(capability)) throw new SurplusLegacyFallbackError();
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
