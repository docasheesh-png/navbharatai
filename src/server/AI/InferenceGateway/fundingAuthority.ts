/**
 * Select an implemented funding authority without manufacturing one.
 *
 * This is a server-only BOUNDARY gate, not a budget authorization, balance check,
 * reservation, or authenticated identity verifier. The runtime must supply the UID
 * produced by its ingress verifier, or the strictly chat-scoped principal from its live private guest admission; never a body/context UID asserted by a caller.
 * A platform result still requires the current reviewed catalog, migrated quota
 * ownership, paid-budget policy, and atomic reserve/claim in authorityStore and
 * firestoreLedger. It grants no allowance and creates no state.
 *
 * The existing non-platform gates cannot be promoted into atomic authority:
 * - professionals/passGate reads balances, passes and answered-message counts;
 *   lib/aiTurnCharge charges the unchanged measured user price AFTER an answer.
 * - developerApi and appAiAnswer read daily caps; ApiKeyUsageStore/AppAiUsageStore
 *   increment them AFTER an answer. Concurrent reads own no reserved capacity.
 * - AgentV3/Affordability explicitly lets an admitted build finish, including
 *   estimate overruns. Neither a build lock nor cost telemetry reserves money.
 * - lib/appAiOwnKey selects a tenant vault key, not a reviewed account allowance
 *   or a durable, exclusively owned reservation for the generic gateway.
 *
 * holdWalletRolledUp is deliberately NOT used: its only current caller is the
 * excluded image path. It debits a fixed user price up front; it neither reserves
 * variable provider cost nor coordinates text daily caps or maximum-to-actual
 * reconciliation. Calling it here would change wallet semantics and risk a second
 * charge from the existing after-answer settlement. No wallet/pricing/hosting
 * writer, independent pool, inferred spend limit or new quota is introduced here.
 */
import { isIdentifier } from './capabilities';
import type { InferenceGatewayContext } from './context';

export type MissingFundingAuthority =
  | 'professional-predispatch-reservation'
  | 'tenant-predispatch-reservation'
  | 'builder-predispatch-reservation'
  | 'byok-account-authorization'
  | 'surface-funding-mismatch'
  | 'unknown-funding-boundary';

export type GatewayFundingAuthorityResolution =
  | { readonly kind: 'platform-authority-required' }
  | { readonly kind: 'unavailable'; readonly reason: 'context-unverified' }
  | { readonly kind: 'unavailable'; readonly reason: 'funding-integration-unavailable';
      readonly missingAuthority: MissingFundingAuthority };

type FundingContext = Pick<InferenceGatewayContext, 'principalId' | 'tenantId' | 'surface' | 'funding'>;
const PLATFORM_SURFACES = new Set<InferenceGatewayContext['surface']>(['chat', 'professional']);
const PLATFORM_AUTHORITY_REQUIRED = Object.freeze({ kind: 'platform-authority-required' } as const);
const UNVERIFIED = Object.freeze({ kind: 'unavailable', reason: 'context-unverified' } as const);
const unavailable = (missingAuthority: MissingFundingAuthority): GatewayFundingAuthorityResolution =>
  Object.freeze({ kind: 'unavailable', reason: 'funding-integration-unavailable', missingAuthority });

/**
 * Pure boundary resolution. Pass only the verified runtime principal (account or scoped guest); matching
 * strings alone are NOT authentication. Cross-tenant delegation has no implemented
 * authority bridge, so a tenant locator cannot transfer another principal's funds.
 * No result from this function may be used as a dispatch permit.
 */
export function resolveGatewayFundingAuthority(
  context: FundingContext | undefined,
  authenticatedPrincipalId: string | null | undefined,
): GatewayFundingAuthorityResolution {
  if (!context || typeof authenticatedPrincipalId !== 'string' || !isIdentifier(authenticatedPrincipalId)
    || authenticatedPrincipalId !== context.principalId || context.principalId !== context.tenantId) return UNVERIFIED;

  switch (context.funding) {
    case 'platform-free-fallback':
      // An explicit allowlist prevents future or mislabeled funded/image surfaces
      // from acquiring the shared platform pool by default. Catalog policy must
      // independently authorize this exact surface before any admission.
      return PLATFORM_SURFACES.has(context.surface) ? PLATFORM_AUTHORITY_REQUIRED : unavailable('surface-funding-mismatch');
    case 'existing-professional': return unavailable('professional-predispatch-reservation');
    case 'existing-tenant': return unavailable('tenant-predispatch-reservation');
    case 'funded-builder': return unavailable('builder-predispatch-reservation');
    case 'tenant-byok': return unavailable('byok-account-authorization');
    default: return unavailable('unknown-funding-boundary');
  }
}
