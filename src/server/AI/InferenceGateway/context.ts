import type { DataClass, QualityTier, RoutingMode, Surface } from './types';

/**
 * The caller's existing funding boundary, not a budget authorization. The runtime
 * must resolve current server-owned authority for this boundary. In particular,
 * a funded professional or tenant call must not borrow the platform fallback pool.
 */
export type GatewayFundingBoundary = 'platform-free-fallback' | 'existing-professional'
  | 'existing-tenant' | 'funded-builder' | 'tenant-byok';

/**
 * Server-created ingress context. Never deserialize this from a request body.
 * These fields describe REQUIREMENTS, not evidence that a model, account, price,
 * quality gate, payer or quota is approved. Only the trusted runtime supplies that
 * authority. An unknown professional is health/clinical until explicitly reviewed.
 */
export interface InferenceGatewayContext {
  readonly principalId: string;
  readonly tenantId: string;
  readonly surface: Surface;
  readonly policyKey: string;
  /** Server-only independent-audit constraint; descendants may add exclusions, never remove them. */
  readonly excludedModelIds?: readonly string[];
  readonly qualityTier: QualityTier;
  readonly dataClass: DataClass;
  readonly funding: GatewayFundingBoundary;
  readonly mode: RoutingMode;
  /** One absolute deadline from ingress, shared by every nested physical call. */
  readonly deadlineAtMs: number;
  readonly signal?: AbortSignal;
}
