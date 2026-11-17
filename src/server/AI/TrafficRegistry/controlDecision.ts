/**
 * Traffic Manager V2, P2: what the control store DECIDES. Pure — the caller passes the document it holds (the
 * instance's last-known-good) and the clock, so the same inputs always give the same answer.
 *
 * Order of authority, strongest first (owner requirement 4 keeps the env OFF on top):
 *   1. the deployment env (`INFERENCE_GATEWAY_ENABLED`, `INFERENCE_GATEWAY_SURFACES`, `TEXT_CHAIN_POLICY`) — read by
 *      the gateway itself, unchanged;
 *   2. the global emergency switch here (`global.gateway: off` ⇒ every surface on its legacy path);
 *   3. a per-surface switch (`legacy`);
 *   4. provider and model state (disabled / draining / traffic cap) and the admission gate.
 * The kill switch (`providerSwitches.ts`) is separate and still beats a provider's state here: it withdraws the key.
 */
import { createHash } from 'node:crypto';
import type { Surface } from '../InferenceGateway/types';
import type { AdmissionEvidence, ControlDoc, RouteControl } from './controlTypes';

/** May the gateway serve this surface, by the control store? `null` document = no store yet = env decides. */
export function controlAllowsGateway(doc: ControlDoc | null, surface?: Surface): boolean {
  if (!doc) return true;
  if (doc.global.gateway === 'off') return false;
  if (surface && doc.surfaces[surface] === 'legacy') return false;
  return true;
}

/** Gateway provider ids are upper-case labels of the same accounts the kill switch names. */
export function familyOfGatewayProvider(providerId: string): string {
  return String(providerId ?? '').trim().toLowerCase();
}

/** The admission checks still missing for a model, empty when complete. */
export function admissionGaps(a: AdmissionEvidence | undefined, nowMs: number): string[] {
  if (!a) return ['capability test', 'price verification', 'security review', 'operational test'];
  const gaps: string[] = [];
  const past = (t: number | undefined) => typeof t === 'number' && t <= nowMs;
  if (!past(a.capabilityTestAtMs)) gaps.push('capability test');
  if (!past(a.priceVerifiedAtMs) || !a.priceSource) gaps.push('price verification');
  if (!past(a.securityReviewAtMs)) gaps.push('security review');
  if (!past(a.opsTestAtMs)) gaps.push('operational test');
  if (!a.reviewer) gaps.push('reviewer');
  if (typeof a.expiresAtMs !== 'number' || a.expiresAtMs <= nowMs) gaps.push('unexpired review');
  return gaps;
}

/**
 * The bucket 0–99 of one logical request for one route. Stable for the whole logical request, so every attempt of
 * the same request gets the same answer (a cap never flips mid-request).
 */
export function trafficBucket(logicalRequestId: string, routeKey: string): number {
  return createHash('sha256').update(`${logicalRequestId}\u0000${routeKey}`).digest().readUInt32BE(0) % 100;
}

function capRefuses(c: RouteControl | undefined, logicalRequestId: string, key: string): boolean {
  if (!c) return false;
  if (c.state !== 'enabled') return true;
  return c.trafficCapPct < 100 && trafficBucket(logicalRequestId, key) >= c.trafficCapPct;
}

export type CandidateVerdict = { allowed: true; admissionGaps: string[] } | { allowed: false; reason: 'control' | 'admission' };

/**
 * May the gateway PLAN a new attempt on this provider/model? Checked only when a new attempt is planned, so an
 * attempt already dispatched always finishes (that is what "draining" means), and a request is never re-run.
 */
export function candidateVerdict(doc: ControlDoc | null, providerId: string, modelId: string, logicalRequestId: string, nowMs: number): CandidateVerdict {
  if (!doc) return { allowed: true, admissionGaps: [] };
  const family = familyOfGatewayProvider(providerId);
  const modelKey = `${family}/${modelId}`;
  if (capRefuses(doc.providers[family], logicalRequestId, family)) return { allowed: false, reason: 'control' };
  const model = doc.models[modelKey];
  if (capRefuses(model, logicalRequestId, modelKey)) return { allowed: false, reason: 'control' };
  const gaps = model?.admission ? admissionGaps(model.admission, nowMs) : [];
  if (model?.admission?.required && gaps.length) return { allowed: false, reason: 'admission' };
  return { allowed: true, admissionGaps: gaps };
}
