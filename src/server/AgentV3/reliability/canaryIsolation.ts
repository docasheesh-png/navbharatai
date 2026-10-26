/** Dormant server-only isolation seam. No HTTP field, issuer, or activation route is provided. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

const PREFIX = 'nbai_canary_v1_';
export interface CanaryIsolationBinding {
  uid: string;
  jobId: string;
  fixtureHash: string;
  workspaceId: string;
}
export class CanaryIsolationBlocked extends Error {
  readonly code = 'BENCHMARK_CANARY_ISOLATION_BLOCKED';
  constructor(readonly reason: string) { super('The restricted benchmark cannot access this workspace or private context.'); }
}
function requireBinding(uid: string, jobId: string, fixtureHash: string): void {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.trim() !== uid
    || typeof jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(jobId)
    || typeof fixtureHash !== 'string' || !/^[a-f0-9]{64}$/.test(fixtureHash)) {
    throw new CanaryIsolationBlocked('invalid-binding');
  }
}
/** Length-framed JSON avoids ambiguous uid/job concatenations; inputs must already be canonical. */
export function canaryWorkspaceId(uid: string, jobId: string, fixtureHash: string): string {
  requireBinding(uid, jobId, fixtureHash);
  return PREFIX + createHash('sha256').update(JSON.stringify([uid, jobId, fixtureHash])).digest('hex');
}
/** Detection is deliberately broader than acceptance: malformed/case/space aliases never escape. */
export function isCanaryWorkspace(workspaceId: unknown): boolean {
  return typeof workspaceId === 'string' && workspaceId.trim().toLowerCase().startsWith(PREFIX);
}
/** Normal E2B machinery must not renew, reconnect or replace the isolated controller's workspace. */
export function assertNotCanaryWorkspace(workspaceId: unknown): void {
  if (isCanaryWorkspace(workspaceId)) throw new CanaryIsolationBlocked('normal-actuator-reserved-workspace');
}
const scopes = new AsyncLocalStorage<Readonly<CanaryIsolationBinding>>();
export function currentCanaryIsolation(): Readonly<CanaryIsolationBinding> | undefined { return scopes.getStore(); }
/** Server composition only: possession of these values is NOT authorization to create a sandbox. */
export function runWithCanaryIsolation<T>(binding: CanaryIsolationBinding, run: () => T): T {
  if (scopes.getStore()) throw new CanaryIsolationBlocked('nested-isolation-replacement');
  if (!binding || binding.workspaceId !== canaryWorkspaceId(binding.uid, binding.jobId, binding.fixtureHash)) {
    throw new CanaryIsolationBlocked('workspace-binding-mismatch');
  }
  return scopes.run(Object.freeze({ uid: binding.uid, jobId: binding.jobId, fixtureHash: binding.fixtureHash, workspaceId: binding.workspaceId }), run);
}
/** Private reads fail before cache/database/decryption. Ordinary requests remain unchanged. */
export function assertCanaryPrivateDataAllowed(): void {
  if (scopes.getStore()) throw new CanaryIsolationBlocked('private-context-forbidden');
}
