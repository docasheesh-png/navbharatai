/** Authenticated administrative review only. Never calls a provider, changes activation,
 * provisions credentials, certifies a healthcheck, or creates spending authority. */
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { GATEWAY_ATTESTATIONS, GATEWAY_REVIEW_FIELDS, GATEWAY_SETUP_PROVIDERS, type GatewaySetupSubmission, type GatewaySetupStatus, type GatewaySetupPreview } from '../../../lib/inferenceGatewaySetup';
import { sanitizeText } from '../../../lib/observability/sanitize';
import { listProfessionals } from '../../professionals/registry';
import { realRateFor } from '../../AgentV3/providerRates';
import { readData, readPaidPolicy } from '../FreeChain/paidLedger';
import { maximumCostNanoUsd, usdToNanoUsd } from '../FreeChain/spendCap';
import { CHAT_INPUT_WEIGHT } from '../freeTierCostCeiling';
import { GATEWAY_CATALOG_PATH, type GatewayCatalog, type GatewayCatalogEntry, type GatewaySurfacePolicy, type GatewayRuntimeTransport } from './authorityStore';
import { gatewayAccountFencePath, gatewayAccountCooldownPath, gatewayCredentialHealthPath, readGatewayAccountAuthority, type GatewayAccountFence } from './accountMigration';
import { gatewayLedgerPath } from './firestoreLedger';
import { gatewayQuotaRulePath, gatewayQuotaWindow, reviewedGatewayQuotaRule, type GatewayQuotaRule, type GatewayRolloverPolicy } from './quotaRollover';
import { evidenceBinding, quotaLedgerKey } from './profiles';
import { gatewayTextCredentialBinding } from './textTransport';
import { gatewayEmbeddingCredentialBinding, VERTEX_EMBEDDING_VECTOR_SPACE } from './embeddingTransport';
import type { QuotaDimension, Surface } from './types';

type Db = Pick<Firestore, 'doc' | 'runTransaction'>;
type Raw = Record<string, any>;
const DAY = 86_400_000;
const hash = (value: unknown) => createHash('sha256').update(evidenceBinding(value)).digest('hex');
const same = (a: unknown, b: unknown) => evidenceBinding(a) === evidenceBinding(b);
const count = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const token = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,119}$/.test(x)
  && !/^(sk-|sk_|AIza|gh[pousr]_|Bearer|eyJ)/i.test(x) && sanitizeText(x, 200) === x;
const ref = (x: unknown): x is string => token(x) && /^review:[a-zA-Z0-9_.:-]{1,100}$/.test(x);
const object = (value: unknown): Raw | undefined => value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) ? value as Raw : undefined;
const keys = (value: unknown, allowed: string[], required = allowed): value is Raw => !!object(value)
  && Object.keys(value as Raw).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value as Raw, k));
const strings = (v: unknown, max = 8): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= max && v.every(token) && new Set(v).size === v.length;
const envName = (v: unknown): v is string => typeof v === 'string' && /^INFERENCE_GATEWAY_[A-Z0-9_]{1,61}$/.test(v)
  && !['INFERENCE_GATEWAY_ENABLED', 'INFERENCE_GATEWAY_SURFACES'].includes(v);
const current = (a: unknown, b: unknown, now: number) => count(a) && count(b) && a <= now && now < b && b - a <= DAY;
export class GatewaySetupError extends Error {
  constructor(readonly code: 'invalid-review' | 'conflict' | 'credential-unavailable' | 'state-unavailable' | 'preview-changed') { super(code); }
}
function requireValue(v: unknown, code: GatewaySetupError['code'] = 'invalid-review'): asserts v { if (!v) throw new GatewaySetupError(code); }
export function gatewaySetupScopes(): GatewaySetupStatus['scopes'] {
  return [
    { key: 'chat:text', label: 'Free chat text', dataClass: 'health' as const, qualityTier: 'clinical' as const },
    ...listProfessionals().map(p => ({ key: `professional:${p.id}`, label: p.name, dataClass: 'health' as const, qualityTier: 'clinical' as const })),
    ...['chat', 'generate'].map(op => ({ key: `mode:repo-analyst:${op}`, label: `Repo analyst ${op}`, dataClass: 'confidential' as const, qualityTier: 'professional' as const })),
  ];
}
const inputKeys = ['operationId', 'expectedCatalogRevision', 'profileId', 'provider', 'modelId', 'modelRevision', 'canonicalModelId', 'canonicalAccountId', 'credentialEnv', 'platformOwnerId', 'policyKeys', 'termsPolicyId', 'qualityGateId', 'qualityGateVersion', 'privacyPolicyId', 'processingRegions', 'retentionHours', 'maxInputTokens', 'maxOutputTokens', 'maxContextTokens', 'localTokensPerMinute', 'billing', 'reviewedAtMs', 'expiresAtMs', 'evidence', 'attestations', 'reason'];
/** Invalid requests are never reflected, partially saved, or coerced into a free profile. */
export function readGatewaySetupSubmission(value: unknown, now: number): GatewaySetupSubmission {
  requireValue(keys(value, [...inputKeys, 'operation', 'reviewedPriority', 'recoverHealth', 'inputNanoUsdPerMillion', 'outputNanoUsdPerMillion', 'endpointTag', 'registryVersion'], inputKeys));
  const v = value as GatewaySetupSubmission;
  requireValue(v.recoverHealth === undefined || typeof v.recoverHealth === 'boolean');
  requireValue(Buffer.byteLength(evidenceBinding(v)) <= 16_384 && count(now));
  requireValue(['operationId', 'profileId', 'modelId', 'modelRevision', 'canonicalModelId', 'canonicalAccountId', 'platformOwnerId', 'termsPolicyId', 'qualityGateId', 'qualityGateVersion', 'privacyPolicyId'].every(k => token((v as unknown as Raw)[k]))
    && (v.expectedCatalogRevision === null || token(v.expectedCatalogRevision)) && GATEWAY_SETUP_PROVIDERS.includes(v.provider) && (v.provider === 'VERTEX' ? v.credentialEnv === 'ADC' : envName(v.credentialEnv)));
  requireValue(strings(v.policyKeys) && v.policyKeys.every(k => gatewaySetupScopes().some(s => s.key === k)) && strings(v.processingRegions)
    && count(v.retentionHours) && v.retentionHours <= 8760 && [v.maxInputTokens, v.maxOutputTokens, v.maxContextTokens, v.localTokensPerMinute].every(n => count(n) && n > 0)
    && v.maxInputTokens <= 1_048_576 && v.maxOutputTokens <= 8192 && v.maxContextTokens <= 2_097_152
    && v.maxInputTokens + v.maxOutputTokens <= v.maxContextTokens && v.localTokensPerMinute >= (v.operation?.kind === 'grounding-search' ? 1 : v.maxInputTokens + v.maxOutputTokens) && v.localTokensPerMinute <= 1_000_000_000);
  requireValue(current(v.reviewedAtMs, v.expiresAtMs, now) && now - v.reviewedAtMs <= 300_000
    && keys(v.evidence, [...GATEWAY_REVIEW_FIELDS]) && GATEWAY_REVIEW_FIELDS.every(k => ref(v.evidence[k]))
    && keys(v.attestations, [...GATEWAY_ATTESTATIONS]) && GATEWAY_ATTESTATIONS.every(k => v.attestations[k] === true)
    && typeof v.reason === 'string' && v.reason.trim().length >= 10 && v.reason.length <= 500 && sanitizeText(v.reason, 500) === v.reason);
  requireValue(['intrinsic-zero', 'provider-hard-stop', 'metered'].includes(v.billing)
    && (v.reviewedPriority === undefined || (count(v.reviewedPriority) && v.reviewedPriority <= 1000)));
  const op = v.operation;
  if (op !== undefined) {
    if (op.kind === 'embedding') {
      requireValue(keys(op, ['kind', 'maxInputBytes', 'project', 'location', 'credentialPrincipal', 'maxNanoUsdPerCharacter'])
        && v.provider === 'VERTEX' && v.modelId === 'text-embedding-004' && v.billing === 'metered'
        && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(op.project) && v.canonicalAccountId === op.project
        && /^[a-z]+-[a-z]+\d$/.test(op.location) && v.processingRegions.includes(op.location)
        && /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(op.credentialPrincipal)
        && count(op.maxInputBytes) && op.maxInputBytes > 0 && op.maxInputBytes <= 65536
        && count(op.maxNanoUsdPerCharacter) && op.maxNanoUsdPerCharacter >= 25 && op.maxNanoUsdPerCharacter <= 1000
        && v.maxInputTokens === 2048 && v.maxOutputTokens === 1);
    } else if (op.kind === 'grounding-search') {
      requireValue(keys(op, ['kind', 'maxQueryBytes', 'maxResults', 'requestNanoUsd'])
        && v.provider === 'BRAVE' && v.modelId === 'brave-search-v1' && v.billing === 'metered'
        && count(op.maxQueryBytes) && op.maxQueryBytes > 0 && op.maxQueryBytes <= 4000
        && count(op.maxResults) && op.maxResults > 0 && op.maxResults <= 20
        && count(op.requestNanoUsd) && op.requestNanoUsd >= 5_000_000 && op.requestNanoUsd <= 10_000_000
        && v.maxInputTokens === 1 && v.maxOutputTokens === 1);
    } else if (op.kind === 'vision-pdf') {
      requireValue(keys(op, ['kind', 'maxImages', 'maxPdfPages', 'maxAttachmentBytes', 'maxImageDimension'])
        && count(op.maxImages) && op.maxImages > 0 && op.maxImages <= 8 && [0, 1000].includes(op.maxPdfPages)
        && count(op.maxAttachmentBytes) && op.maxAttachmentBytes > 0 && op.maxAttachmentBytes <= 5_000_000
        && count(op.maxImageDimension) && op.maxImageDimension > 0 && op.maxImageDimension <= 6000
        && (v.provider === 'GLM' ? v.modelId === 'glm-4.6v-flash' && v.billing === 'intrinsic-zero' && op.maxPdfPages === 0 && v.maxContextTokens <= 131072
          : v.provider === 'GEMINI' && ['gemini-2.5-flash', 'gemini-2.5-pro'].includes(v.modelId) && v.billing === 'metered'
            && (op.maxPdfPages === 1000 ? v.maxInputTokens === 1048576 : v.maxInputTokens + v.maxOutputTokens <= 131072) && v.maxOutputTokens >= 256
            && v.maxContextTokens >= 1048576 + v.maxOutputTokens && v.localTokensPerMinute >= 1048576 + v.maxOutputTokens
            && count(v.inputNanoUsdPerMillion) && count(v.outputNanoUsdPerMillion)
            && v.inputNanoUsdPerMillion >= (v.modelId === 'gemini-2.5-pro' ? 2_500_000_000 : 300_000_000)
            && v.outputNanoUsdPerMillion >= (v.modelId === 'gemini-2.5-pro' ? 15_000_000_000 : 2_500_000_000)
            && maximumCostNanoUsd(1048576, v.maxOutputTokens, v.inputNanoUsdPerMillion, v.outputNanoUsdPerMillion) <= maximumCostNanoUsd(1048576, v.maxOutputTokens, 2_500_000_000, 15_000_000_000)));
    } else requireValue(false);
    if (op.kind !== 'vision-pdf' || v.provider !== 'GEMINI') requireValue(!Object.hasOwn(v, 'inputNanoUsdPerMillion') && !Object.hasOwn(v, 'outputNanoUsdPerMillion'));
  } else if (v.billing === 'metered') {
    requireValue(v.provider === 'DEEPSEEK' && v.modelId === 'deepseek-flash' && count(v.inputNanoUsdPerMillion) && count(v.outputNanoUsdPerMillion));
    const floor = realRateFor('DEEPSEEK', v.modelId); const ceiling = realRateFor('KIMI', 'kimi-k2.7');
    requireValue(v.inputNanoUsdPerMillion >= usdToNanoUsd(floor.inputPerMTok) && v.outputNanoUsdPerMillion >= usdToNanoUsd(floor.outputPerMTok)
      && maximumCostNanoUsd(CHAT_INPUT_WEIGHT * 1_000_000, 1_000_000, v.inputNanoUsdPerMillion, v.outputNanoUsdPerMillion)
      <= maximumCostNanoUsd(CHAT_INPUT_WEIGHT * 1_000_000, 1_000_000, usdToNanoUsd(ceiling.inputPerMTok), usdToNanoUsd(ceiling.outputPerMTok)));
  } else {
    requireValue(!['DEEPSEEK', 'VERTEX', 'BRAVE', 'GEMINI'].includes(v.provider) && !Object.hasOwn(v, 'inputNanoUsdPerMillion') && !Object.hasOwn(v, 'outputNanoUsdPerMillion'));
    if (v.provider === 'GLM') requireValue(v.billing === 'intrinsic-zero' && ['glm-4.7-flash', 'glm-4.5-flash'].includes(v.modelId));
    if (v.provider === 'GROQ' || v.provider === 'CLOUDFLARE') requireValue(v.billing === 'provider-hard-stop');
    if (v.provider === 'OPENROUTER') requireValue(v.billing === 'intrinsic-zero' && v.modelId.includes('/') && v.modelId !== 'openrouter/free' && token(v.endpointTag) && token(v.registryVersion));
  }
  if (v.provider !== 'OPENROUTER') requireValue(!Object.hasOwn(v, 'endpointTag') && !Object.hasOwn(v, 'registryVersion'));
  if (v.provider === 'CLOUDFLARE') requireValue(/^[a-f0-9]{32}$/.test(v.canonicalAccountId));
  return JSON.parse(evidenceBinding(v)) as GatewaySetupSubmission;
}
function reviewedPriority(v: GatewaySetupSubmission): number {
  return v.reviewedPriority ?? (v.provider === 'GLM' ? (v.modelId === 'glm-4.7-flash' ? 10 : 20)
    : ({ GROQ: 30, OPENROUTER: 40, CLOUDFLARE: 50, DEEPSEEK: 90, VERTEX: 90, BRAVE: 90, GEMINI: 90 } as const)[v.provider]);
}
export interface GatewaySetupOptions { now(): number; environment(): Record<string, string | undefined>; deploymentEnabled(): boolean }
export function gatewayCredentialAccountPath(generation: string): string { return `free_chat_chain/gateway_credential_account_${hash(generation)}`; }
export function gatewaySetupAuditPath(id: string): string { return `free_chat_chain/gateway_setup_audit_${hash(id)}`; }
export class GatewayAdminSetup {
  constructor(private readonly db: Db, private readonly options: GatewaySetupOptions) {}
  private async get(tx: Transaction, path: string): Promise<any> { return readData(await tx.get(this.db.doc(path))); }
  private credential(v: GatewaySetupSubmission): string {
    if (v.operation?.kind === 'embedding') {
      const env = this.options.environment();
      requireValue(env.GOOGLE_CLOUD_PROJECT === v.operation.project && env.INFERENCE_GATEWAY_VERTEX_PRINCIPAL === v.operation.credentialPrincipal, 'credential-unavailable');
      return gatewayEmbeddingCredentialBinding({ project: v.operation.project, credentialPrincipal: v.operation.credentialPrincipal });
    }
    const credential = this.options.environment()[v.credentialEnv];
    requireValue(typeof credential === 'string' && credential.length > 0, 'credential-unavailable');
    return gatewayTextCredentialBinding(credential);
  }
  private catalog(raw: unknown): GatewayCatalog | undefined {
    if (raw === undefined) return undefined;
    const c = object(raw) as unknown as GatewayCatalog | undefined;
    requireValue(c && c.kind === 'gateway_catalog' && c.version === 1 && c.enabled === true && token(c.revision)
      && count(c.issuedAtMs) && count(c.expiresAtMs) && c.expiresAtMs > c.issuedAtMs && c.expiresAtMs - c.issuedAtMs <= DAY
      && c.platformScope && token(c.platformScope.id) && token(c.platformScope.ownerId) && object(c.policies)
      && Array.isArray(c.profiles) && c.profiles.length <= 32 && new Set(c.profiles.map(p => p.profile?.id)).size === c.profiles.length, 'state-unavailable');
    return c;
  }
  async status(): Promise<GatewaySetupStatus> {
    const now = this.options.now();
    return this.db.runTransaction(async tx => {
      const [raw, paidRaw] = await Promise.all([this.get(tx, GATEWAY_CATALOG_PATH), this.get(tx, 'free_chat_chain/paid_budget_policy')]);
      let c: GatewayCatalog | undefined; let invalid = false;
      try { c = this.catalog(raw); } catch { invalid = true; }
      const paid = readPaidPolicy(paidRaw);
      const profiles: GatewaySetupStatus['profiles'] = [];
      for (const p of c?.profiles ?? []) {
        if (!token(p.profile?.id) || !token(p.profile?.providerId) || !token(p.profile?.modelId) || !count(p.expiresAtMs)) { invalid = true; continue; }
        const transport = p.transport;
        const embedding = 'kind' in transport && transport.kind === 'embedding' ? transport : undefined;
        const credential = 'credentialEnv' in transport && envName(transport.credentialEnv) ? this.options.environment()[transport.credentialEnv] : undefined;
        const associated = embedding
          ? this.options.environment().GOOGLE_CLOUD_PROJECT === embedding.project && this.options.environment().INFERENCE_GATEWAY_VERTEX_PRINCIPAL === embedding.credentialPrincipal
            && p.accountCredentialBinding === gatewayEmbeddingCredentialBinding({ project: embedding.project, credentialPrincipal: embedding.credentialPrincipal })
          : !!credential && p.accountCredentialBinding === gatewayTextCredentialBinding(credential);
        let reviewed = false;
        try {
          const dimensions = p.profile.quotaDimensions;
          const account = readGatewayAccountAuthority(await this.get(tx, gatewayAccountFencePath(p.legacyProvider, dimensions.filter(d => d.scope.kind !== 'model').map(d => d.scope.id))), dimensions, now);
          reviewed = account.credentialBindings.includes(p.accountCredentialBinding) && current(p.reviewedAtMs, p.expiresAtMs, now)
            && p.review && Object.values(p.review).length === 6 && Object.values(p.review).every(ref)
            && (p.profile.charging === 'metered' || (p.profile.charging === 'verified-free-no-overage' && !!p.freeBillingSafety
              && ['intrinsic-zero', 'provider-hard-stop'].includes(p.freeBillingSafety.kind) && ref(p.freeBillingSafety.evidenceRef) && current(p.freeBillingSafety.reviewedAtMs, p.freeBillingSafety.expiresAtMs, now)));
        } catch { reviewed = false; }
        profiles.push({ id: p.profile.id, provider: p.profile.providerId, modelId: p.profile.modelId, operationKind: transport.kind ?? 'text', expiresAtMs: p.expiresAtMs,
          reviewState: !associated ? 'invalid' : p.expiresAtMs <= now ? 'expired' : reviewed ? 'current' : 'invalid', credentialAssociated: associated,
          billing: p.profile.charging === 'metered' ? 'metered' : ['intrinsic-zero', 'provider-hard-stop'].includes(p.freeBillingSafety?.kind ?? '') ? p.freeBillingSafety!.kind : 'unreviewed' });
      }
      return { kind: 'gateway_setup_status', version: 1, observedAtMs: now, deploymentEnabled: this.options.deploymentEnabled(),
        catalogRevision: c?.revision ?? null, expiresAtMs: c?.expiresAtMs ?? null,
        reviewState: invalid ? 'invalid' : !c ? 'missing' : c.expiresAtMs <= now ? 'expired' : profiles.some(p => p.reviewState === 'current') ? 'current' : 'invalid',
        credentialEnvironments: Object.keys(this.options.environment()).filter(k => envName(k) && !!this.options.environment()[k]).sort().slice(0, 64),
        scopes: gatewaySetupScopes(), profiles, paidAuthority: paid ? 'existing' : 'missing', paidCapUsd: paid ? paid.capNanoUsd / 1_000_000_000 : null,
        upstreamRemaining: 'unknown', liveProviderVerified: false };
    });
  }
  private policies(v: GatewaySetupSubmission): Record<string, GatewaySurfacePolicy> {
    return Object.fromEntries(v.policyKeys.map(key => {
      const scope = gatewaySetupScopes().find(s => s.key === key)!;
      const surface: Surface = key === 'chat:text' ? 'chat' : 'professional';
      const operation = v.operation?.kind === 'embedding' ? { kind: 'embedding' as const, maxInputBytes: v.operation.maxInputBytes, dimensions: 768 as const, vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE }
        : v.operation?.kind === 'grounding-search' ? { kind: 'grounding-search' as const, maxQueryBytes: v.operation.maxQueryBytes, maxResults: v.operation.maxResults }
        : v.operation?.kind === 'vision-pdf' ? { kind: 'vision-pdf' as const, maxImages: v.operation.maxImages, maxPdfPages: v.operation.maxPdfPages, formats: [...['image/png' as const, 'image/jpeg' as const], ...(v.operation.maxPdfPages ? ['application/pdf' as const] : [])], maxAttachmentBytes: v.operation.maxAttachmentBytes } : undefined;
      const suffix = operation?.kind === 'embedding' ? ':embedding' : operation?.kind === 'grounding-search' ? ':grounding' : operation?.kind === 'vision-pdf' ? (operation.maxPdfPages ? ':vision-pdf' : ':vision-image') : '';
      return [key + suffix, { ...(operation ? { operation } : {}), surface, funding: 'platform-free-fallback', termsPolicyId: v.termsPolicyId,
        quality: { tier: scope.qualityTier, gateId: v.qualityGateId, gateVersion: v.qualityGateVersion },
        privacy: { dataClass: scope.dataClass, policyId: v.privacyPolicyId, allowedProcessingRegions: v.processingRegions,
          maxRetentionHours: v.retentionHours, allowTraining: false, allowHumanReview: false },
        maxInputTokens: v.maxInputTokens, maxOutputTokens: v.maxOutputTokens, maxQueueWaitMs: 5000,
        firstOutputTimeoutMs: 20_000, attemptTimeoutMs: 90_000, logicalLimitNanoUsd: v.operation?.kind === 'embedding' ? v.operation.maxInputBytes * v.operation.maxNanoUsdPerCharacter : v.operation?.kind === 'grounding-search' ? v.operation.requestNanoUsd : v.operation?.kind === 'vision-pdf' ? maximumCostNanoUsd(1048576, v.maxOutputTokens, 2_500_000_000, 15_000_000_000) : 10_000_000 } satisfies GatewaySurfacePolicy];
    }));
  }
  private entry(v: GatewaySetupSubmission, generation: string, migrationId: string, dimension: QuotaDimension): GatewayCatalogEntry {
    const policies = Object.values(this.policies(v));
    const baseURLs = { GLM: 'https://api.z.ai/api/paas/v4', GROQ: 'https://api.groq.com/openai/v1', CLOUDFLARE: `https://api.cloudflare.com/client/v4/accounts/${v.canonicalAccountId}/ai/v1`, DEEPSEEK: 'https://api.deepseek.com/v1' };
    const operation = v.operation;
    let transport: GatewayRuntimeTransport;
    if (operation?.kind === 'embedding') transport = { kind: 'embedding', provider: 'VERTEX', model: 'text-embedding-004', project: operation.project, location: operation.location,
      credentialPrincipal: operation.credentialPrincipal, vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE, maxInputBytes: operation.maxInputBytes, timeoutMs: 6000,
      rateCard: { version: v.operationId, maxNanoUsdPerCharacter: operation.maxNanoUsdPerCharacter, verifiedAtMs: v.reviewedAtMs, expiresAtMs: v.expiresAtMs } };
    else if (operation?.kind === 'grounding-search') transport = { kind: 'grounding-search', provider: 'BRAVE', model: 'brave-search-v1', baseURL: 'https://api.search.brave.com/res/v1/web/search',
      credentialEnv: v.credentialEnv, credentialBinding: generation, timeoutMs: 6000, maxQueryBytes: operation.maxQueryBytes, maxResults: operation.maxResults,
      rateCard: { version: v.operationId, requestNanoUsd: operation.requestNanoUsd, verifiedAtMs: v.reviewedAtMs, expiresAtMs: v.expiresAtMs } };
    else if (operation?.kind === 'vision-pdf') transport = { kind: 'vision-pdf', provider: v.provider as 'GLM' | 'GEMINI', model: v.modelId as 'glm-4.6v-flash' | 'gemini-2.5-flash' | 'gemini-2.5-pro', credentialEnv: v.credentialEnv, credentialBinding: generation,
      timeoutMs: 90000, maxOutputTokens: v.maxOutputTokens, maxImages: operation.maxImages, maxImageBytes: operation.maxAttachmentBytes,
      maxTotalBytes: Math.min(20_000_000, operation.maxImages * operation.maxAttachmentBytes), maxDimension: operation.maxImageDimension, maxPixels: operation.maxImageDimension ** 2,
      ...(v.provider === 'GEMINI' ? { rateCard: { version: v.operationId, inputNanoUsdPerMillion: v.inputNanoUsdPerMillion!, outputNanoUsdPerMillion: v.outputNanoUsdPerMillion!, verifiedAtMs: v.reviewedAtMs, expiresAtMs: v.expiresAtMs } } : {}) };
    else if (v.provider === 'OPENROUTER') transport = { provider: 'OPENROUTER', model: v.modelId, endpointTag: v.endpointTag!, registryVersion: v.registryVersion!, maxOutputTokens: v.maxOutputTokens, timeoutMs: 90_000, credentialEnv: v.credentialEnv, credentialBinding: generation };
    else {
      requireValue(v.provider === 'GLM' || v.provider === 'GROQ' || v.provider === 'CLOUDFLARE' || v.provider === 'DEEPSEEK');
      transport = { provider: v.provider, baseURL: baseURLs[v.provider], model: v.modelId, maxOutputTokens: v.maxOutputTokens,
        timeoutMs: 90_000, streamUsage: true, credentialEnv: v.credentialEnv, credentialBinding: generation,
        ...(v.billing === 'metered' ? { rateCard: { version: v.operationId, inputNanoUsdPerMillion: v.inputNanoUsdPerMillion!, outputNanoUsdPerMillion: v.outputNanoUsdPerMillion!, verifiedAtMs: v.reviewedAtMs, expiresAtMs: v.expiresAtMs } } : {}) };
    }
    const review = Object.fromEntries(GATEWAY_REVIEW_FIELDS.filter(k => k !== 'quota').map(k => [k, v.evidence[k]])) as GatewayCatalogEntry['review'];
    return { profile: { id: v.profileId, version: v.operationId, reviewedPriority: reviewedPriority(v), providerId: v.provider, modelId: v.modelId, modelRevision: v.modelRevision,
      adapterId: operation?.kind === 'embedding' ? 'gateway-vertex-embedding-v1' : operation?.kind === 'grounding-search' ? 'gateway-brave-search-v1' : operation?.kind === 'vision-pdf' ? 'gateway-vision-v1' : v.provider === 'OPENROUTER' ? 'gateway-openrouter-text-v1' : 'gateway-openai-text-v1', status: 'approved', serviceClass: 'production', product: 'inference-api',
      surfaces: [...new Set(policies.map(p => p.surface))], qualityApprovals: [...new Map(policies.map(p => [p.quality.tier, p.quality])).values()], termsApprovals: [v.termsPolicyId],
      capabilities: operation?.kind === 'embedding' ? [{ kind: 'embedding', maxInputTokens: 2048, dimensions: 768, vectorSpaceId: VERTEX_EMBEDDING_VECTOR_SPACE }]
        : operation?.kind === 'grounding-search' ? [{ kind: 'grounding-search', maxQueries: 1, maxResults: operation.maxResults, citations: true, domainFiltering: false }]
        : operation?.kind === 'vision-pdf' ? [{ kind: 'vision-pdf', formats: ['image/png', 'image/jpeg', ...(operation.maxPdfPages ? ['application/pdf' as const] : [])], maxImages: operation.maxImages, maxPdfPages: operation.maxPdfPages,
          maxInputTokens: v.provider === 'GEMINI' ? 1048576 : v.maxInputTokens, maxOutputTokens: v.maxOutputTokens, maxContextTokens: v.maxContextTokens, streaming: false, systemPrompt: true }]
        : [{ kind: 'text', maxInputTokens: v.maxInputTokens, maxOutputTokens: v.maxOutputTokens, maxContextTokens: v.maxContextTokens, streaming: true, systemPrompt: true }],
      privacy: { dataClasses: [...new Set(policies.map(p => p.privacy.dataClass))], training: 'none', humanReview: 'none', retentionHours: v.retentionHours, processingRegions: v.processingRegions },
      credentialOwner: { kind: 'platform', ownerId: v.platformOwnerId }, quotaDimensions: [dimension],
      charging: v.billing === 'metered' ? 'metered' : 'verified-free-no-overage', evidenceRef: v.evidence.capability }, transport,
      canonicalModelId: v.canonicalModelId, accountCredentialBinding: generation,
      ...(v.billing === 'metered' ? {} : { freeBillingSafety: { kind: v.billing, evidenceRef: v.evidence.pricing, reviewedAtMs: v.reviewedAtMs, expiresAtMs: v.expiresAtMs } }),
      availability: { coolingUntilMs: 0, predictedQueueMs: 0, predictedFirstOutputMs: 20_000, predictedCompletionMs: 60_000 },
      legacyProvider: v.provider.toLowerCase(), migrationId, review, reviewedAtMs: v.reviewedAtMs, expiresAtMs: v.expiresAtMs };
  }
  async preview(value: unknown): Promise<GatewaySetupPreview> { return this.prepare(value); }
  async submit(value: unknown, previewBinding: string, actor: string): Promise<{ ok: true; catalogRevision: string; operationId: string }> {
    requireValue(typeof actor === 'string' && actor.trim().length > 0 && actor.length <= 200 && sanitizeText(actor, 200) === actor);
    requireValue(typeof previewBinding === 'string' && /^[a-f0-9]{64}$/.test(previewBinding));
    return this.prepare(value, { previewBinding, actor }) as Promise<any>;
  }
  private async prepare(value: unknown, commit?: { previewBinding: string; actor: string }): Promise<any> {
    const v = readGatewaySetupSubmission(value, this.options.now()); const generation = this.credential(v);
    return this.db.runTransaction(async tx => {
      const now = this.options.now(); readGatewaySetupSubmission(v, now); requireValue(this.credential(v) === generation, 'preview-changed');
      const dimension: QuotaDimension = { scope: { kind: v.provider === 'VERTEX' ? 'project' : 'account', providerId: v.provider, id: v.canonicalAccountId }, meter: v.operation?.kind === 'grounding-search' ? 'requests/minute' : 'tokens/minute' };
      const ledgerKey = quotaLedgerKey(dimension); const accountPath = gatewayAccountFencePath(v.provider.toLowerCase(), [v.canonicalAccountId]);
      const [raw, oldAccount, oldPolicy, oldState, oldRule, paidRaw, receipt, generationAccount] = await Promise.all([
        this.get(tx, GATEWAY_CATALOG_PATH), this.get(tx, accountPath), this.get(tx, gatewayLedgerPath('quota-policy', ledgerKey)),
        this.get(tx, gatewayLedgerPath('quota-state', ledgerKey)), this.get(tx, gatewayQuotaRulePath(ledgerKey)),
        this.get(tx, 'free_chat_chain/paid_budget_policy'), this.get(tx, gatewaySetupAuditPath(v.operationId)), this.get(tx, gatewayCredentialAccountPath(generation)),
      ]);
      if (receipt !== undefined && commit) {
        requireValue(receipt.kind === 'gateway_setup_audit' && receipt.submissionBinding === hash(v) && receipt.previewBinding === commit.previewBinding && receipt.actor === commit.actor, 'conflict');
        return { ok: true, catalogRevision: receipt.catalogRevision, operationId: v.operationId };
      }
      if (generationAccount !== undefined) requireValue(generationAccount.kind === 'gateway_credential_account' && generationAccount.version === 1
        && generationAccount.credentialBinding === generation && generationAccount.provider === v.provider
        && generationAccount.canonicalAccountId === v.canonicalAccountId && !('expireAt' in generationAccount) && !('expiresAt' in generationAccount), 'conflict');
      const c = this.catalog(raw); requireValue((c?.revision ?? null) === v.expectedCatalogRevision, 'conflict');
      requireValue(!c || c.platformScope.ownerId === v.platformOwnerId, 'conflict');
      // A known credential generation cannot be relabeled into a second account quota.
      for (const p of c?.profiles ?? []) if (p.accountCredentialBinding === generation) requireValue(p.profile.providerId === v.provider
        && p.profile.quotaDimensions.every(d => d.scope.kind === 'model' || d.scope.id === v.canonicalAccountId), 'conflict');
      const existing = c?.profiles.find(p => p.profile.id === v.profileId);
      if (existing) requireValue(existing.profile.providerId === v.provider && existing.canonicalModelId === v.canonicalModelId
        && same(existing.profile.quotaDimensions, [dimension]), 'conflict');
      requireValue(existing || !c || c.profiles.length < 32, 'conflict');
      const healthRecords: { path: string; value: Raw }[] = [];
      if (v.recoverHealth) {
        requireValue(existing && oldAccount, 'conflict');
        for (const [path, kind] of [
          [gatewayAccountCooldownPath(v.provider.toLowerCase(), [v.canonicalAccountId]), 'gateway_account_cooldown'],
          [gatewayCredentialHealthPath(v.provider.toLowerCase(), [v.canonicalAccountId], generation), 'gateway_credential_health'],
        ]) {
          const saved = await this.get(tx, path);
          if (saved !== undefined) {
            requireValue(saved.kind === kind && saved.version === 1 && count(saved.untilMs)
              && (kind !== 'gateway_credential_health' || saved.credentialBinding === generation), 'state-unavailable');
            healthRecords.push({ path, value: saved });
          }
        }
        requireValue(healthRecords.length > 0, 'conflict');
      }
      const allAbsent = [oldAccount, oldPolicy, oldState, oldRule].every(x => x === undefined);
      let oldPeriod: Raw | undefined;
      if (!allAbsent) {
        requireValue(oldAccount && oldPolicy && oldState && oldRule, 'state-unavailable');
        requireValue(oldAccount.kind === 'gateway_account_owner' && oldAccount.version === 2 && oldAccount.provider === v.provider.toLowerCase()
          && oldAccount.authority === 'gateway-local-capacity' && same(oldAccount.accountScopeIds, [v.canonicalAccountId]) && token(oldAccount.migrationId)
          && Array.isArray(oldAccount.credentialBindings) && oldAccount.credentialBindings.length > 0 && oldAccount.credentialBindings.length <= 32 && oldAccount.credentialBindings.every((s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)), 'state-unavailable');
        requireValue(oldPolicy.kind === 'gateway_quota_policy' && oldPolicy.authority === 'gateway-local-capacity' && oldPolicy.accountingBasis === 'gateway-local-only'
          && oldPolicy.ledgerKey === ledgerKey && oldPolicy.migrationId === oldAccount.migrationId && count(oldPolicy.revision) && oldPolicy.revision > 0
          && oldPolicy.limit === v.localTokensPerMinute && oldPolicy.window && count(oldPolicy.window.startsAtMs) && count(oldPolicy.window.endsAtMs), 'conflict');
        requireValue(oldState.kind === 'gateway_quota_state' && oldState.version === 1 && oldState.ledgerKey === ledgerKey && oldState.migrationId === oldAccount.migrationId
          && oldState.quarantined === false && count(oldState.held), 'state-unavailable');
        requireValue(oldRule.kind === 'gateway_quota_rule' && oldRule.version === 1 && oldRule.ledgerKey === ledgerKey && count(oldRule.revision)
          && same(oldRule.dimension, dimension) && same(oldRule.overlappingDimensions, [dimension]) && oldRule.accounting === 'local-only'
          && same(oldRule.reset, { kind: 'fixed-interval', anchorAtMs: 0, intervalMs: 60_000 }), 'state-unavailable');
        oldPeriod = await this.get(tx, gatewayLedgerPath('quota-period', evidenceBinding([ledgerKey, oldPolicy.window.id])));
        requireValue(oldPeriod && oldPeriod.kind === 'gateway_quota_period' && oldPeriod.version === 1 && oldPeriod.ledgerKey === ledgerKey
          && same(oldPeriod.window, oldPolicy.window) && count(oldPeriod.spent), 'state-unavailable');
      }
      // Bootstrap durable identity for valid previously seeded account generations too.
      // The mapping records identity only; it never allocates a key-based quota.
      const associations = new Map<string, any>([[generation, generationAccount]]);
      for (const binding of new Set<string>(oldAccount?.credentialBindings ?? [])) {
        if (binding === generation) continue;
        const previous = await this.get(tx, gatewayCredentialAccountPath(binding));
        requireValue(previous === undefined || (previous.kind === 'gateway_credential_account' && previous.version === 1
          && previous.credentialBinding === binding && previous.provider === v.provider && previous.canonicalAccountId === v.canonicalAccountId
          && !('expireAt' in previous) && !('expiresAt' in previous)), 'conflict');
        associations.set(binding, previous);
      }
      const migrationId = oldAccount?.migrationId ?? `review:${hash([v.provider, v.canonicalAccountId]).slice(0, 32)}`;
      const account: GatewayAccountFence = { kind: 'gateway_account_owner', version: 2, provider: v.provider.toLowerCase(), migrationId,
        authority: 'gateway-local-capacity', accountScopeIds: [v.canonicalAccountId], credentialBindings: [...new Set<string>([...(oldAccount?.credentialBindings ?? []), generation])],
        accountReviewRef: v.evidence.account, upstreamQuota: 'unknown', reviewedAtMs: v.reviewedAtMs, expiresAtMs: v.expiresAtMs };
      readGatewayAccountAuthority(account, [dimension], now);
      const rule: GatewayQuotaRule = { kind: 'gateway_quota_rule', version: 1, ledgerKey, revision: (oldRule?.revision ?? 0) + 1,
        dimension, overlappingDimensions: [dimension], migrationId, limit: v.localTokensPerMinute, reviewRef: v.evidence.quota,
        reviewedAtMs: v.reviewedAtMs, expiresAtMs: v.expiresAtMs, reset: { kind: 'fixed-interval', anchorAtMs: 0, intervalMs: 60_000 },
        accounting: 'local-only', accountPolicyPath: accountPath, accountPolicyBinding: evidenceBinding(account),
        zeroBaseline: { kind: 'local-reservation-window', evidenceRef: v.evidence.quota } };
      reviewedGatewayQuotaRule(rule, dimension, [dimension], now);
      const window = gatewayQuotaWindow(rule, now)!;
      // A human review must never reset usage inside an existing capacity window.
      if (oldPolicy && oldPolicy.window.startsAtMs === window.startsAtMs) requireValue(same(oldPolicy.window, window), 'state-unavailable');
      const nextPeriodPath = gatewayLedgerPath('quota-period', evidenceBinding([ledgerKey, window.id]));
      const nextPeriod = oldPolicy && same(oldPolicy.window, window) ? oldPeriod : await this.get(tx, nextPeriodPath);
      requireValue(nextPeriod === undefined || (nextPeriod.kind === 'gateway_quota_period' && nextPeriod.version === 1 && nextPeriod.ledgerKey === ledgerKey && same(nextPeriod.window, window) && count(nextPeriod.spent)), 'state-unavailable');
      const policy: GatewayRolloverPolicy = { kind: 'gateway_quota_policy', version: 1, ledgerKey, revision: (oldPolicy?.revision ?? 0) + 1,
        authority: 'gateway-local-capacity', accountingBasis: 'gateway-local-only', migrationId, limit: v.localTokensPerMinute, window,
        rolloverRule: { revision: rule.revision, binding: evidenceBinding(rule) } };
      const proposedPolicies = this.policies(v);
      for (const [key, p] of Object.entries(proposedPolicies)) if (c?.policies[key]) requireValue(same(c.policies[key], p), 'conflict');
      const entry = this.entry(v, generation, migrationId, dimension);
      const profiles = [...(c?.profiles.filter(p => p.profile.id !== v.profileId) ?? []), entry];
      const catalog: GatewayCatalog = { kind: 'gateway_catalog', version: 1, enabled: true, revision: v.operationId,
        issuedAtMs: now, expiresAtMs: Math.max(...profiles.map(p => p.expiresAtMs)),
        platformScope: c?.platformScope ?? { id: 'platform-free-fallback', ownerId: v.platformOwnerId },
        policies: { ...(c?.policies ?? {}), ...proposedPolicies }, profiles };
      requireValue(catalog.expiresAtMs > now, 'conflict');
      const finalNow = this.options.now(); readGatewaySetupSubmission(v, finalNow);
      requireValue(this.credential(v) === generation && same(gatewayQuotaWindow(rule, finalNow), window), 'preview-changed');
      const deploymentEnabled = this.options.deploymentEnabled();
      const previewBinding = hash({ submission: v, credentialGeneration: generation, account: oldAccount ?? null, policy: oldPolicy ?? null, rule: oldRule ?? null, deploymentEnabled, ...(v.recoverHealth ? { healthRecords } : {}) });
      const preview: GatewaySetupPreview = { kind: 'gateway_setup_preview', version: 1, previewBinding, ...(v.recoverHealth ? { healthRecoveryRecords: healthRecords.length } : {}), profileId: v.profileId,
        canonicalAccountId: v.canonicalAccountId, policyKeys: Object.keys(proposedPolicies), operationKind: v.operation?.kind ?? 'text', quotaMeter: dimension.meter as 'tokens/minute' | 'requests/minute', maximumOperationNanoUsd: v.billing !== 'metered' ? 0 : v.operation?.kind === 'vision-pdf' ? maximumCostNanoUsd(1048576, v.maxOutputTokens, v.inputNanoUsdPerMillion!, v.outputNanoUsdPerMillion!) : Math.max(...Object.values(proposedPolicies).map(p => p.logicalLimitNanoUsd)), billing: v.billing, expiresAtMs: v.expiresAtMs,
        localTokensPerMinute: v.localTokensPerMinute, reviewedPriority: reviewedPriority(v), credentialAssociated: true, paidAuthority: readPaidPolicy(paidRaw) ? 'existing' : 'missing', activationFlagChanged: false, deploymentEnabled };
      if (!commit) return preview;
      requireValue(commit.previewBinding === previewBinding, 'preview-changed');
      for (const [binding, previous] of associations) if (previous === undefined) tx.create(this.db.doc(gatewayCredentialAccountPath(binding)), { kind: 'gateway_credential_account', version: 1,
        credentialBinding: binding, provider: v.provider, canonicalAccountId: v.canonicalAccountId, accountReviewRef: v.evidence.account, createdAtMs: now });
      tx.set(this.db.doc(accountPath), account); tx.set(this.db.doc(gatewayQuotaRulePath(ledgerKey)), rule);
      tx.set(this.db.doc(gatewayLedgerPath('quota-policy', ledgerKey)), policy);
      if (allAbsent) tx.create(this.db.doc(gatewayLedgerPath('quota-state', ledgerKey)), { kind: 'gateway_quota_state', version: 1, ledgerKey, migrationId, held: 0, quarantined: false });
      if (nextPeriod === undefined) tx.create(this.db.doc(nextPeriodPath), { kind: 'gateway_quota_period', version: 1, ledgerKey, window, spent: 0 });
      tx.set(this.db.doc(GATEWAY_CATALOG_PATH), catalog);
      // Explicit reviewed recovery affects health only. Quarantined quota state,
      // paid policy, unresolved holds, receipts and usage are never reset here.
      for (const { path, value: health } of healthRecords) tx.set(this.db.doc(path), { ...health, untilMs: 0, failures: 0, recoveredAtMs: now, recoveryOperationId: v.operationId });
      tx.create(this.db.doc(gatewaySetupAuditPath(v.operationId)), { kind: 'gateway_setup_audit', version: 1, actor: commit.actor, reason: v.reason,
        atMs: now, operationId: v.operationId, previousCatalogRevision: v.expectedCatalogRevision, catalogRevision: catalog.revision,
        submissionBinding: hash(v), previewBinding, ...(v.recoverHealth ? { healthRecovery: healthRecords.map(h => ({ kind: h.value.kind, previousUntilMs: h.value.untilMs })) } : {}), profileId: v.profileId, evidence: v.evidence, reviewedAtMs: v.reviewedAtMs, expiresAtMs: v.expiresAtMs,
        canonicalAccountId: v.canonicalAccountId, credentialGeneration: generation, billing: v.billing, localQuotaOnly: true, activationChanged: false, paidAuthorityChanged: false });
      return { ok: true, catalogRevision: catalog.revision, operationId: v.operationId };
    });
  }
}
