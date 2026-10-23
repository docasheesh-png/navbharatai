import { modelSlotIdentity, modelSlotPath, modelSlotBinding, readModelSlotPolicy, readModelSlotState, readHeldModelSlot, type GatewayModelSlotPolicy } from './modelConcurrency';
/**
 * Server-only issuer over reviewed, non-client-writable configuration and existing
 * migrated quota state. This does NOT enroll accounts, assume an empty quota, create
 * paid budget authority, or certify a provider from environment flags.
 */
import { parseEnvFlag } from '../../lib/envFlag';
import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { readData, readPaidPolicy, readSpendDay } from '../FreeChain/paidLedger';
import { civilDayWindow, nonnegativeInteger } from '../FreeChain/quota';
import { maximumCostNanoUsd, OWNER_PAID_DAILY_CEILING_NANO_USD, PAID_BUDGET_TIME_ZONE } from '../FreeChain/spendCap';
import type { InferenceGatewayContext } from './context';
import type { AuthenticatedRejection, AuthoritativeUsage, DispatchClaim, ExecutionKey, ExecutionSnapshot, Reservation, SpendScope } from './executor';
import { gatewayLedgerPath, type GatewayAuthorityDocument, type GatewayQuotaPolicy } from './firestoreLedger';
import { evidenceBinding, quotaLedgerKey, withoutEvidence, hasCurrentEvidence } from './profiles';
import { gatewayAccountCooldownPath, gatewayCredentialHealthPath, gatewayAccountFencePath, gatewayAccountScopeIds, readGatewayAccountAuthority, type GatewayAccountFence, type GatewayFreeBillingSafety } from './accountMigration';
import { GatewayQuotaRollover, gatewayQuotaRulePath, gatewayQuotaWindow, reviewedGatewayQuotaRule, type GatewayRolloverPolicy } from './quotaRollover';
import { isIdentifier } from './capabilities';
import type { BudgetAuthorization, Candidate, EvidenceKind, EvidenceRecord, PrivacyRequirement, ProviderProfile, QualityRequirement, RoutingRequest, Surface, CapabilityRequest } from './types';
import { gatewayTextCredentialBinding, readGatewayTextHealth, readGatewayTextCostAnomaly, readGatewayTextRejection, readGatewayTextUsage, readGatewayTextCompletion, readGatewayTextConservativeUsage, type GatewayTextTransportConfig, type GatewayTextResponse } from './textTransport';
import { readGatewayOpenRouterHealth, readGatewayOpenRouterCostAnomaly, readGatewayOpenRouterRejection, readGatewayOpenRouterUsage, type GatewayOpenRouterConfig } from './openRouterTransport';
import { gatewayEmbeddingCredentialBinding, readGatewayEmbeddingHealth, readGatewayEmbeddingUsage, readGatewayEmbeddingCostAnomaly, type GatewayEmbeddingConfig } from './embeddingTransport';
import { readGatewayGroundingHealth, readGatewayGroundingUsage, type GatewayGroundingConfig } from './groundingTransport';
import { readGatewayVisionHealth, readGatewayVisionUsage, readGatewayVisionCompletion, readGatewayVisionConservativeUsage, readGatewayVisionCostAnomaly, readGatewayVisionRejection, type GatewayVisionTransportConfig } from './visionTransport';
import type { GatewayInvocationPayload, GatewayOperationPolicy } from './capabilityInvocation';
export type GatewayRuntimeTransport = (GatewayTextTransportConfig & { readonly kind?: 'text' })
  | (GatewayOpenRouterConfig & { readonly kind?: 'text'; readonly rateCard?: never })
  | GatewayEmbeddingConfig | GatewayGroundingConfig | GatewayVisionTransportConfig;

export const GATEWAY_CATALOG_PATH = 'free_chat_chain/gateway_catalog';
type GatewayPayload = GatewayInvocationPayload;
export interface GatewaySurfacePolicy {
  /** Absent is text-only. Every auxiliary operation needs a separately reviewed server key. */
  operation?: GatewayOperationPolicy;
  surface: Surface; funding: 'platform-free-fallback'; termsPolicyId: string;
  quality: QualityRequirement; privacy: PrivacyRequirement;
  /** Full admitted model context bounds, not a character/token guess. */
  maxInputTokens: number; maxOutputTokens: number; maxQueueWaitMs: number;
  firstOutputTimeoutMs: number; attemptTimeoutMs: number; logicalLimitNanoUsd: number;
}
export interface GatewayCatalogEntry {
  profile: ProviderProfile; transport: GatewayRuntimeTransport;
  /** Reviewed underlying model identity across providers/aliases, required for independent audit. */
  canonicalModelId?: string;
  accountCredentialBinding: string;
  modelConcurrency?: GatewayModelSlotPolicy;
  freeBillingSafety?: GatewayFreeBillingSafety;
  availability: { coolingUntilMs: number; predictedQueueMs: number; predictedFirstOutputMs: number; predictedCompletionMs: number };
  legacyProvider: string; migrationId: string;
  review: { account: string; terms: string; quality: string; privacy: string; capability: string; pricing: string };
  reviewedAtMs: number; expiresAtMs: number;
}
export interface GatewayCatalog {
  kind: 'gateway_catalog'; version: 1; enabled: true; revision: string;
  issuedAtMs: number; expiresAtMs: number;
  platformScope: { id: string; ownerId: string };
  policies: Record<string, GatewaySurfacePolicy>;
  profiles: GatewayCatalogEntry[];
}
type Db = Pick<Firestore, 'doc' | 'runTransaction'>;
const same = (a: unknown, b: unknown) => evidenceBinding(a) === evidenceBinding(b);
const copy = <T>(v: T): T => JSON.parse(evidenceBinding(v)) as T;
function requireValue(value: unknown): asserts value { if (!value) throw new Error('Gateway authority unavailable'); }
function object(v: unknown): Record<string, unknown> {
  requireValue(v && typeof v === 'object' && !Array.isArray(v));
  const r = v as Record<string, unknown>;
  requireValue(!('expireAt' in r) && !('expiresAt' in r));
  return r;
}
function current(start: number, end: number, now: number): boolean {
  return nonnegativeInteger(start) && nonnegativeInteger(end) && start <= now && now < end;
}
function positive(n: unknown): n is number { return nonnegativeInteger(n) && n > 0; }
function usageAmount(meter: string, input: number, output: number): number {
  if (/^requests\/(minute|day)$/.test(meter)) return 1;
  if (/^tokens\/(minute|day)$/.test(meter)) return input + output;
  if (/^input-tokens\/(minute|day)$/.test(meter)) return input;
  if (/^output-tokens\/(minute|day)$/.test(meter)) return output;
  throw new Error('Unsupported quota meter');
}
function transportCredentialBinding(t: GatewayRuntimeTransport): string {
  if (t.kind === 'embedding') return gatewayEmbeddingCredentialBinding({ project: t.project, credentialPrincipal: t.credentialPrincipal });
  requireValue(/^INFERENCE_GATEWAY_[A-Z0-9_]+$/.test(t.credentialEnv) && !!process.env[t.credentialEnv]);
  const binding = gatewayTextCredentialBinding(process.env[t.credentialEnv]!);
  requireValue(t.credentialBinding === binding); return binding;
}
function requestedCapability(p: GatewaySurfacePolicy, payload: GatewayPayload): CapabilityRequest {
  const kind = payload.kind ?? 'text';
  if (kind === 'text') {
    requireValue(!p.operation && (payload.kind === undefined || payload.kind === 'text'));
    requireValue(Buffer.byteLength(payload.prompt + (payload.systemPrompt ?? ''), 'utf8') + 256 <= p.maxInputTokens);
    return { kind: 'text', inputTokens: p.maxInputTokens, outputTokens: p.maxOutputTokens,
      systemPrompt: !!payload.systemPrompt, streaming: payload.streaming };
  }
  const operation = p.operation; requireValue(operation && operation.kind === kind);
  if (payload.kind === 'embedding' && operation.kind === 'embedding') {
    requireValue(typeof payload.text === 'string' && !!payload.text.trim() && payload.text === payload.text.trim()
      && positive(operation.maxInputBytes) && operation.maxInputBytes <= 65536
      && Buffer.byteLength(payload.text, 'utf8') <= operation.maxInputBytes && p.maxInputTokens === 2048
      && operation.dimensions === 768 && isIdentifier(operation.vectorSpaceId));
    return { kind: 'embedding', inputTokens: p.maxInputTokens, dimensions: operation.dimensions, vectorSpaceId: operation.vectorSpaceId };
  }
  if (payload.kind === 'grounding-search' && operation.kind === 'grounding-search') {
    requireValue(typeof payload.query === 'string' && !!payload.query.trim() && payload.domains === undefined
      && positive(operation.maxQueryBytes) && operation.maxQueryBytes <= 4000
      && Buffer.byteLength(payload.query, 'utf8') <= operation.maxQueryBytes
      && positive(payload.maxResults) && positive(operation.maxResults) && operation.maxResults <= 20 && payload.maxResults <= operation.maxResults);
    return { kind: 'grounding-search', queries: 1, maxResults: payload.maxResults, citations: true, domainFiltering: false };
  }
  if (payload.kind === 'vision-pdf' && operation.kind === 'vision-pdf') {
    const pdfs = payload.attachments.filter(a => a.mimeType === 'application/pdf').length;
    const images = payload.attachments.length - pdfs;
    requireValue(typeof payload.prompt === 'string' && !!payload.prompt.trim() && payload.streaming === false
      && Array.isArray(payload.attachments) && payload.attachments.length > 0
      && nonnegativeInteger(operation.maxImages) && images <= operation.maxImages
      && (pdfs === 0 ? operation.maxPdfPages === 0 || operation.maxPdfPages === 1000 : pdfs === 1 && operation.maxPdfPages === 1000)
      && Array.isArray(operation.formats) && positive(operation.maxAttachmentBytes)
      && payload.attachments.every(a => a && ['image/png', 'image/jpeg', 'application/pdf'].includes(a.mimeType) && operation.formats.includes(a.mimeType)
        && typeof a.data === 'string' && a.data.length <= Math.ceil(operation.maxAttachmentBytes / 3) * 4)
      && Buffer.byteLength(payload.prompt + (payload.systemPrompt ?? ''), 'utf8') + 256 <= p.maxInputTokens);
    return { kind: 'vision-pdf', inputTokens: p.maxInputTokens, outputTokens: p.maxOutputTokens,
      systemPrompt: !!payload.systemPrompt, streaming: false, imageCount: images,
      // Reviewed provider maximum reservation, NOT a locally measured PDF page count.
      pdfPages: pdfs ? 1000 : 0, formats: [...new Set(payload.attachments.map(a => a.mimeType))] };
  }
  throw new Error('Unsupported reviewed operation');
}
function maximumFor(t: GatewayRuntimeTransport, p: GatewaySurfacePolicy, payload: GatewayPayload): number {
  const rate = t.rateCard; requireValue(rate && current(rate.verifiedAtMs, rate.expiresAtMs, Date.now()) && isIdentifier(rate.version));
  if (t.kind === 'embedding') {
    requireValue(payload.kind === 'embedding' && positive(t.rateCard.maxNanoUsdPerCharacter) && t.rateCard.maxNanoUsdPerCharacter >= 25);
    const maximum = Buffer.byteLength(payload.text, 'utf8') * t.rateCard.maxNanoUsdPerCharacter; requireValue(nonnegativeInteger(maximum)); return maximum;
  }
  if (t.kind === 'grounding-search') {
    requireValue(payload.kind === 'grounding-search' && positive(t.rateCard.requestNanoUsd) && t.rateCard.requestNanoUsd >= 5_000_000);
    return t.rateCard.requestNanoUsd;
  }
  requireValue(t.rateCard);
  return maximumCostNanoUsd(t.kind === 'vision-pdf' && t.provider === 'GEMINI' ? 1048576 : p.maxInputTokens, p.maxOutputTokens, t.rateCard.inputNanoUsdPerMillion, t.rateCard.outputNanoUsdPerMillion);
}
function operationUsage(meter: string, capability: CapabilityRequest, transport: GatewayRuntimeTransport): number {
  if (/^requests\/(minute|day)$/.test(meter)) return 1;
  requireValue(capability.kind !== 'grounding-search' && capability.kind !== 'voice-session');
  // Common image compatibility requirements do not bound Gemini's visual input charge.
  const input = capability.kind === 'vision-pdf' && transport.kind === 'vision-pdf' && transport.provider === 'GEMINI' ? 1048576 : capability.inputTokens;
  return usageAmount(meter, input, capability.kind === 'embedding' ? 0 : capability.outputTokens);
}
function catalogAt(raw: unknown, now: number): GatewayCatalog {
  const c = object(raw) as unknown as GatewayCatalog;
  requireValue(c.kind === 'gateway_catalog' && c.version === 1 && c.enabled === true && isIdentifier(c.revision)
    && current(c.issuedAtMs, c.expiresAtMs, now) && c.expiresAtMs - c.issuedAtMs <= 86_400_000
    && c.platformScope && isIdentifier(c.platformScope.id) && isIdentifier(c.platformScope.ownerId)
    && c.policies && typeof c.policies === 'object' && Array.isArray(c.profiles) && c.profiles.length > 0 && c.profiles.length <= 32
    && new Set(c.profiles.map(p => p.profile?.id)).size === c.profiles.length);
  return c;
}
function validFence(value: unknown, entry: GatewayCatalogEntry, now: number): GatewayAccountFence {
  const f = readGatewayAccountAuthority(object(value), entry.profile.quotaDimensions, now);
  requireValue(f.provider === entry.legacyProvider && f.migrationId === entry.migrationId
    && f.credentialBindings.includes(entry.accountCredentialBinding));
  return f;
}
export interface GatewayQuotaMaintenanceResult {
  inspected: number; rolled: number; blocked: number; observedAtMs: number; refreshAtMs: number;
}
const maintenance = new WeakMap<object, { pending: boolean; refreshAtMs: number; promise: Promise<GatewayQuotaMaintenanceResult> }>();
/** Coalesces only bounded metadata/maintenance work. It never caches dispatch permission. */
export async function maintainGatewayQuotaWindows(db: Db): Promise<GatewayQuotaMaintenanceResult> {
  const now = Date.now();
  if (parseEnvFlag(process.env.INFERENCE_GATEWAY_ENABLED) !== true) return { inspected: 0, rolled: 0, blocked: 0, observedAtMs: now, refreshAtMs: now };
  const previous = maintenance.get(db);
  if (previous && (previous.pending || previous.refreshAtMs > now)) return previous.promise;
  const observation = { pending: true, refreshAtMs: 0, promise: Promise.resolve({ inspected: 0, rolled: 0, blocked: 0, observedAtMs: now, refreshAtMs: now }) };
  const work = (async (): Promise<GatewayQuotaMaintenanceResult> => {
    const catalog = catalogAt(readData(await db.doc(GATEWAY_CATALOG_PATH).get()), Date.now());
    const result = { inspected: 0, rolled: 0, blocked: 0, observedAtMs: now, refreshAtMs: Math.min(now + 5000, catalog.expiresAtMs) };
    const seen = new Set<string>();
    for (const entry of catalog.profiles) {
      if (Date.now() >= now + 5000 || parseEnvFlag(process.env.INFERENCE_GATEWAY_ENABLED) !== true) { result.blocked++; break; }
      if (!current(entry.reviewedAtMs, entry.expiresAtMs, Date.now())) continue;
      const dimensions = entry.profile.quotaDimensions;
      if (!Array.isArray(dimensions) || !dimensions.length || dimensions.length > 32) { result.blocked++; continue; }
      const group = evidenceBinding(dimensions.map(quotaLedgerKey).sort()); if (seen.has(group)) continue; seen.add(group);
      const policies = await Promise.all(dimensions.map(async dimension => object(readData(await db.doc(gatewayLedgerPath('quota-policy', quotaLedgerKey(dimension))).get())) as unknown as GatewayRolloverPolicy)).catch(() => undefined);
      result.inspected++;
      if (!policies) { result.blocked++; continue; }
      if (!policies.some(p => p.window?.endsAtMs <= Date.now())) {
        result.refreshAtMs = Math.min(result.refreshAtMs, ...policies.map(p => p.window?.endsAtMs ?? now)); continue;
      }
      const status = await new GatewayQuotaRollover(db, { now: Date.now }).rollover({ dimensions, operationId: randomUUID(),
        expectedPolicyRevisions: policies.map(p => ({ ledgerKey: p.ledgerKey, revision: p.revision })) });
      if (status.status === 'rolled') result.rolled++; else if (status.status === 'blocked') result.blocked++;
      result.refreshAtMs = Math.min(result.refreshAtMs, ...status.dimensions.map(d => d.window.endsAtMs));
    }
    return result;
  })();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  observation.promise = Promise.race([work, new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Gateway quota maintenance observation timed out')), 5000);
  })]);
  maintenance.set(db, observation);
  void work.then(result => { observation.refreshAtMs = result.refreshAtMs; }, () => { observation.refreshAtMs = 0; })
    .finally(() => { observation.pending = false; if (timeout !== undefined) clearTimeout(timeout); });
  return observation.promise;
}

export class GatewayAuthorityStore {
  private catalog!: GatewayCatalog;
  private authority!: GatewayAuthorityDocument;
  private entries = new Map<string, GatewayCatalogEntry>();
  private records = new Map<string, EvidenceRecord>();
  private closedDispatchClaims = new Set<string>();
  private dispatchHorizons = new Map<string, Readonly<{ claimBinding: string; notBeforeMs: number; expiresAtMs: number }>>();
  readonly evidence = { lookup: (reference: string) => this.records.get(reference) };
  constructor(private readonly db: Db, private readonly context: InferenceGatewayContext, private readonly key: ExecutionKey,
    private readonly payload: GatewayPayload, private readonly strictFree: boolean, private readonly signal?: AbortSignal,
    private readonly queueWaitConsumedMs = 0, private readonly paidAuthorityObserved = true) {}
  private checkLive(): void { requireValue(!this.signal?.aborted && Date.now() < this.context.deadlineAtMs); }
  private async get(tx: Transaction, path: string): Promise<unknown> { return readData(await tx.get(this.db.doc(path))); }
  async issue(): Promise<{ platformScope: GatewayCatalog['platformScope']; scope: SpendScope; cancellationId: string; createdAtMs: number }> {
    this.checkLive();
    await maintainGatewayQuotaWindows(this.db);
    const issued = await this.db.runTransaction(async tx => {
      const now = Date.now();
      const c = catalogAt(await this.get(tx, GATEWAY_CATALOG_PATH), now);
      const p = c.policies[this.context.policyKey];
      const excluded = this.context.excludedModelIds ?? [];
      requireValue(Array.isArray(excluded) && excluded.length <= 8 && excluded.every(isIdentifier));
      const excludedCanonical = new Set<string>();
      for (const modelId of excluded) {
        const aliases = c.profiles.filter(entry => entry.profile?.modelId === modelId);
        requireValue(aliases.length > 0 && aliases.every(entry => typeof entry.canonicalModelId === 'string' && isIdentifier(entry.canonicalModelId)
          && current(entry.reviewedAtMs, entry.expiresAtMs, now)));
        const identities = new Set(aliases.map(entry => entry.canonicalModelId!));
        requireValue(identities.size === 1); excludedCanonical.add(aliases[0].canonicalModelId!);
      }
      requireValue(p && p.surface === this.context.surface && p.funding === this.context.funding
        && p.quality?.tier === this.context.qualityTier && p.privacy?.dataClass === this.context.dataClass
        && isIdentifier(p.termsPolicyId) && positive(p.maxInputTokens) && positive(p.maxOutputTokens)
        && p.maxInputTokens <= 1_048_576 && p.maxOutputTokens <= 131_072
        && nonnegativeInteger(p.maxQueueWaitMs) && p.maxQueueWaitMs <= 5000
        && positive(p.firstOutputTimeoutMs) && positive(p.attemptTimeoutMs) && p.firstOutputTimeoutMs <= p.attemptTimeoutMs
        && p.attemptTimeoutMs <= 120_000 && nonnegativeInteger(p.logicalLimitNanoUsd)
        && p.logicalLimitNanoUsd <= OWNER_PAID_DAILY_CEILING_NANO_USD);
      const capability = requestedCapability(p, this.payload);
      const window = civilDayWindow(now, PAID_BUDGET_TIME_ZONE);
      const [paidRaw, dayRaw, existingAuthority] = await Promise.all([
        this.get(tx, 'free_chat_chain/paid_budget_policy'), this.get(tx, `free_chat_chain/paid_day_${window.key}`),
        this.get(tx, gatewayLedgerPath('authority', this.key.logicalRequestId)),
      ]);
      requireValue(existingAuthority === undefined);
      const paid = readPaidPolicy(paidRaw); const day = readSpendDay(dayRaw, window);
      const r: RoutingRequest = { ...this.key, nextPhysicalAttemptId: randomUUID(), policyRevision: c.revision,
        termsPolicyId: p.termsPolicyId, budgetScopeId: c.platformScope.id, surface: this.context.surface,
        quality: p.quality, privacy: p.privacy, payer: { kind: 'platform', ownerId: c.platformScope.ownerId },
        capability,
        mode: this.strictFree ? 'strict-free' : 'free-first-authorized-paid', createdAtMs: now - this.queueWaitConsumedMs,
        deadlineAtMs: Math.min(this.context.deadlineAtMs, now + p.attemptTimeoutMs), maxQueueWaitMs: p.maxQueueWaitMs,
        queueEnteredAtMs: now, queueWaitConsumedMs: this.queueWaitConsumedMs, firstOutputTimeoutMs: p.firstOutputTimeoutMs,
        attemptTimeoutMs: p.attemptTimeoutMs, cancellation: { id: randomUUID(), cancelled: false }, outputVisible: false,
        maxPhysicalAttempts: 4, attempts: [], evidenceRef: randomUUID() };
      const binding = evidenceBinding(withoutEvidence(r));
      const candidates: Candidate[] = []; const entries = new Map<string, GatewayCatalogEntry>();
      const sourceBindings: { path: string; binding: string }[] = [];
      const modelSlots: Record<string, GatewayModelSlotPolicy> = {};
      const records = new Map<string, EvidenceRecord>();
      const issueEvidence = (kind: EvidenceKind, subject: { evidenceRef: string }, expiresAtMs: number) => {
        records.set(subject.evidenceRef, { kind, binding: evidenceBinding(withoutEvidence(subject)), issuedAtMs: now,
          expiresAtMs: Math.min(expiresAtMs, c.expiresAtMs, r.deadlineAtMs), revoked: false });
      };
      issueEvidence('request', r, c.expiresAtMs);
      for (const entry of c.profiles) {
        try {
          requireValue(entry.profile && entry.transport
            && (!excluded.length || (typeof entry.canonicalModelId === 'string' && isIdentifier(entry.canonicalModelId) && !excludedCanonical.has(entry.canonicalModelId) && !excluded.includes(entry.profile.modelId)))
            && isIdentifier(entry.migrationId) && isIdentifier(entry.legacyProvider)
            && current(entry.reviewedAtMs, entry.expiresAtMs, now) && entry.expiresAtMs - entry.reviewedAtMs <= 86_400_000
            && entry.review && ['account', 'terms', 'quality', 'privacy', 'capability', 'pricing'].every(k => isIdentifier(entry.review[k as keyof typeof entry.review]))
            && (entry.transport.kind ?? 'text') === capability.kind
            && entry.legacyProvider === ({ GLM: 'glm', GEMINI: 'gemini', GROQ: 'groq', CLOUDFLARE: 'cloudflare', DEEPSEEK: 'deepseek', OPENROUTER: 'openrouter', VERTEX: 'vertex', BRAVE: 'brave' } as const)[entry.transport.provider]
            && entry.profile.adapterId === (entry.transport.kind === 'embedding' ? 'gateway-vertex-embedding-v1'
              : entry.transport.kind === 'grounding-search' ? 'gateway-brave-search-v1' : entry.transport.kind === 'vision-pdf' ? 'gateway-vision-v1'
              : entry.transport.provider === 'OPENROUTER' ? 'gateway-openrouter-text-v1' : 'gateway-openai-text-v1') && entry.profile.modelId === entry.transport.model
            && (entry.transport.kind === 'embedding' || entry.transport.kind === 'grounding-search' || entry.transport.maxOutputTokens === p.maxOutputTokens)
            && entry.accountCredentialBinding === transportCredentialBinding(entry.transport)
            && (entry.profile.charging === 'metered' || (entry.freeBillingSafety
              && ['intrinsic-zero', 'provider-hard-stop'].includes(entry.freeBillingSafety.kind)
              && isIdentifier(entry.freeBillingSafety.evidenceRef)
              && current(entry.freeBillingSafety.reviewedAtMs, entry.freeBillingSafety.expiresAtMs, now)
              && entry.freeBillingSafety.expiresAtMs - entry.freeBillingSafety.reviewedAtMs <= 86_400_000))
            && Array.isArray(entry.profile.quotaDimensions) && entry.profile.quotaDimensions.length > 0 && entry.profile.quotaDimensions.length <= 32);
          const fencePath = gatewayAccountFencePath(entry.legacyProvider, gatewayAccountScopeIds(entry.profile.quotaDimensions));
          const fenceRaw = await this.get(tx, fencePath); const fence = validFence(fenceRaw, entry, now);
          const slotIdentity = modelSlotIdentity(entry.profile);
          let slotPolicy: GatewayModelSlotPolicy | undefined;
          if (slotIdentity) {
            slotPolicy = readModelSlotPolicy(await this.get(tx, modelSlotPath('policy', slotIdentity)), slotIdentity, now);
            const state = readModelSlotState(await this.get(tx, modelSlotPath('state', slotIdentity)), slotIdentity);
            requireValue(same(slotPolicy, entry.modelConcurrency) && slotPolicy.accountReviewRef === entry.review.account
              && Object.keys(state.occupants).length < slotPolicy.limit);
          }
          if (entry.transport.kind === 'vision-pdf' && entry.transport.provider === 'GEMINI') requireValue(entry.profile.capabilities.some(c => c.kind === 'vision-pdf' && c.maxInputTokens >= 1048576 && c.maxContextTokens >= 1048576 + p.maxOutputTokens));
          const profile = { ...entry.profile, evidenceRef: randomUUID() };
          const profileBinding = evidenceBinding(withoutEvidence(profile));
          const dimensions = []; const ruleSources: { path: string; binding: string }[] = []; const ruleExpiries: number[] = [];
          for (const d of profile.quotaDimensions) {
            const ledgerKey = quotaLedgerKey(d);
            const policy = object(await this.get(tx, gatewayLedgerPath('quota-policy', ledgerKey))) as unknown as GatewayRolloverPolicy;
            requireValue(policy.kind === 'gateway_quota_policy' && policy.version === 1 && policy.ledgerKey === ledgerKey
              && policy.authority === 'gateway-local-capacity' && policy.accountingBasis === 'gateway-local-only' && policy.migrationId === entry.migrationId && positive(policy.revision)
              && nonnegativeInteger(policy.limit) && policy.window && current(policy.window.startsAtMs, policy.window.endsAtMs, now));
            const rulePath = gatewayQuotaRulePath(ledgerKey);
            const rule = reviewedGatewayQuotaRule(await this.get(tx, rulePath), d, profile.quotaDimensions, now);
            requireValue(rule.accounting === 'local-only' && rule.reset.kind !== 'authoritative-import' && rule.accountPolicyPath === fencePath && rule.accountPolicyBinding === evidenceBinding(fence)
              && rule.migrationId === entry.migrationId && rule.limit === policy.limit
              && policy.rolloverRule?.revision === rule.revision && policy.rolloverRule.binding === evidenceBinding(rule)
              && (!gatewayQuotaWindow(rule, now) || same(gatewayQuotaWindow(rule, now), policy.window)));
            ruleSources.push({ path: rulePath, binding: evidenceBinding(rule) }); ruleExpiries.push(rule.expiresAtMs);
            const [stateRaw, periodRaw] = await Promise.all([
              this.get(tx, gatewayLedgerPath('quota-state', ledgerKey)),
              this.get(tx, gatewayLedgerPath('quota-period', evidenceBinding([ledgerKey, policy.window.id]))),
            ]);
            const state = object(stateRaw); const period = object(periodRaw);
            requireValue(state.kind === 'gateway_quota_state' && state.version === 1 && state.ledgerKey === ledgerKey
              && state.migrationId === entry.migrationId && state.quarantined === false && nonnegativeInteger(state.held)
              && period.kind === 'gateway_quota_period' && period.version === 1 && period.ledgerKey === ledgerKey
              && same(period.window, policy.window) && nonnegativeInteger(period.spent));
            const required = operationUsage(d.meter, capability, entry.transport);
            const remaining = Math.max(0, policy.limit - state.held - period.spent);
            dimensions.push({ ...d, required, remaining });
          }
          const candidate: Candidate = { profile, quota: { requestBinding: binding, profileBinding, profileVersion: profile.version,
            logicalRequestId: r.logicalRequestId, profileId: profile.id, dimensions, evidenceRef: randomUUID() },
            availability: { ...entry.availability, requestBinding: binding, profileBinding, profileId: profile.id,
              profileVersion: profile.version, evidenceRef: randomUUID() },
            ...(profile.charging === 'metered' ? { price: { requestBinding: binding, profileBinding, logicalRequestId: r.logicalRequestId,
              profileId: profile.id, profileVersion: profile.version, rateCardVersion: entry.transport.rateCard!.version,
              currency: 'USD' as const, estimatedNanoUsd: maximumFor(entry.transport, p, this.payload),
              ceilingNanoUsd: maximumFor(entry.transport, p, this.payload),
              coverage: 'all-request-usage' as const, capability: r.capability, evidenceRef: randomUUID() } } : {}) };
          candidates.push(candidate); entries.set(profile.id, copy(entry));
          if (slotPolicy) { modelSlots[profile.id] = slotPolicy; sourceBindings.push({ path: modelSlotPath('policy', slotIdentity!), binding: evidenceBinding(slotPolicy) }); }
          sourceBindings.push({ path: fencePath, binding: evidenceBinding(fence) }, ...ruleSources);
          const expiry = Math.min(entry.expiresAtMs, fence.expiresAtMs, entry.freeBillingSafety?.expiresAtMs ?? entry.expiresAtMs, slotPolicy?.expiresAtMs ?? entry.expiresAtMs, ...ruleExpiries);
          issueEvidence('profile', profile, expiry); issueEvidence('quota', candidate.quota, expiry);
          issueEvidence('availability', candidate.availability, expiry); if (candidate.price) issueEvidence('price', candidate.price, Math.min(expiry, entry.transport.rateCard!.expiresAtMs));
        } catch { /* An unknown/missing account is not free capacity. Other reviewed candidates may remain. */ }
      }
      requireValue(candidates.length > 0);
      let budget: BudgetAuthorization | undefined;
      const paidIds = candidates.filter(c => c.profile.charging === 'metered').map(c => c.profile.id);
      if (this.paidAuthorityObserved && !this.strictFree && paidIds.length && paid && paid.updatedAt <= now && paid.capNanoUsd > 0) {
        budget = { id: randomUUID(), principalId: r.principalId, tenantId: r.tenantId, logicalRequestId: r.logicalRequestId,
          payer: r.payer, surface: r.surface, allowedProfileIds: paidIds, budgetScopeId: r.budgetScopeId,
          periodId: window.key, periodStartsAtMs: window.startAt, periodEndsAtMs: window.resetAt,
          maxAttemptNanoUsd: p.logicalLimitNanoUsd, remainingLogicalRequestNanoUsd: p.logicalLimitNanoUsd,
          remainingPeriodNanoUsd: Math.max(0, paid.capNanoUsd - day.heldNanoUsd - day.spentNanoUsd), periodLimitNanoUsd: paid.capNanoUsd,
          evidenceRef: randomUUID() };
        issueEvidence('budget', budget, window.resetAt);
      }
      const authority: GatewayAuthorityDocument = { kind: 'gateway_authority', version: 1, key: this.key,
        snapshot: { revision: randomUUID(), request: r, candidates, ...(budget ? { budget } : {}) },
        scope: { id: c.platformScope.id, kind: 'platform-free-fallback' }, logicalLimitNanoUsd: p.logicalLimitNanoUsd,
        paidPolicyRevision: paid?.revision ?? 0, configurationBinding: evidenceBinding(c),
        modelSlots, sourceBindings: [...new Map(sourceBindings.map(source => [source.path, source])).values()] };
      requireValue(authority.sourceBindings!.length <= 32);
      this.checkLive();
      for (const [reference, record] of records) tx.create(this.db.doc(gatewayLedgerPath('evidence', reference)), record);
      tx.create(this.db.doc(gatewayLedgerPath('authority', this.key.logicalRequestId)), authority);
      return { authority, c, entries, records };
    });
    this.authority = copy(issued.authority); this.catalog = copy(issued.c);
    this.entries = issued.entries; this.records = issued.records;
    return { platformScope: this.catalog.platformScope, scope: this.authority.scope,
      cancellationId: this.authority.snapshot.request.cancellation.id, createdAtMs: this.authority.snapshot.request.createdAtMs };
  }
  transportFor(profileId: string): GatewayRuntimeTransport {
    const entry = this.entries.get(profileId); requireValue(entry); return copy(entry.transport);
  }
  private async readCurrent(tx: Transaction): Promise<GatewayAuthorityDocument> {
    this.checkLive(); const now = Date.now();
    const [catalog, authorityRaw] = await Promise.all([this.get(tx, GATEWAY_CATALOG_PATH), this.get(tx, gatewayLedgerPath('authority', this.key.logicalRequestId))]);
    requireValue(same(catalogAt(catalog, now), this.catalog));
    const authority = object(authorityRaw) as unknown as GatewayAuthorityDocument;
    requireValue(same(authority, this.authority) && same(authority.key, this.key));
    for (const source of authority.sourceBindings ?? []) requireValue(evidenceBinding(await this.get(tx, source.path)) === source.binding);
    return authority;
  }
  async readTrusted(key: ExecutionKey, reservation?: Reservation): Promise<ExecutionSnapshot> {
    requireValue(same(key, this.key));
    const refreshed = await this.db.runTransaction(async tx => {
      const authority = await this.readCurrent(tx); const records = new Map<string, EvidenceRecord>();
      for (const reference of this.records.keys()) {
        records.set(reference, object(await this.get(tx, gatewayLedgerPath('evidence', reference))) as unknown as EvidenceRecord);
      }
      if (reservation) {
        const attempt = object(await this.get(tx, `free_chat_chain/gateway_attempt_${reservation.id}`));
        requireValue(attempt.phase === 'held' && same(attempt.reservation, reservation));
        return { authority, records };
      }
      const logicalRaw = await this.get(tx, gatewayLedgerPath('logical', key.logicalRequestId));
      const logical = logicalRaw === undefined ? undefined : object(logicalRaw);
      if (logical) requireValue(logical.activeAttemptId === null && logical.cancelled === false && logical.outputVisible === false
        && logical.terminal === false && logical.completed === false && Array.isArray(logical.attempts)
        && nonnegativeInteger(logical.heldNanoUsd) && nonnegativeInteger(logical.spentNanoUsd) && nonnegativeInteger(logical.queueWaitConsumedMs));
      const previous = authority.snapshot.request;
      const history = logical ? logical.attempts as RoutingRequest['attempts'] : previous.attempts;
      requireValue(history.length <= previous.maxPhysicalAttempts && history.every(a => a.outcome === 'definite-failure'
        && a.failureClass === 'retryable-provider-failure' && a.outputVisible === false));
      const advancing = history.length > previous.attempts.length;
      requireValue(history.length >= previous.attempts.length && same(history.slice(0, previous.attempts.length), previous.attempts));
      const now = Date.now();
      // Refreshing counters never revives withdrawn or expired authority.
      requireValue([...records.values()].every(record => record.revoked === false && record.expiresAtMs > now));
      const request: RoutingRequest = { ...previous, ...(advancing ? { nextPhysicalAttemptId: randomUUID(), attempts: history,
        queueWaitConsumedMs: logical!.queueWaitConsumedMs as number, queueEnteredAtMs: now, evidenceRef: randomUUID() } : {}) };
      const requestBinding = evidenceBinding(withoutEvidence(request));
      const writes = new Map<string, EvidenceRecord>();
      const issue = (kind: EvidenceKind, subject: { evidenceRef: string }, expiresAtMs: number) => {
        const record = { kind, binding: evidenceBinding(withoutEvidence(subject)), issuedAtMs: now,
          expiresAtMs: Math.min(expiresAtMs, this.catalog.expiresAtMs, request.deadlineAtMs), revoked: false };
        writes.set(subject.evidenceRef, record); records.set(subject.evidenceRef, record);
      };
      if (advancing) issue('request', request, this.catalog.expiresAtMs);
      const rejectedProviders = new Set(history.map(a => this.entries.get(a.profileId)?.profile.providerId));
      const candidates: Candidate[] = [];
      for (const old of authority.snapshot.candidates) {
        const entry = this.entries.get(old.profile.id)!;
        if (rejectedProviders.has(old.profile.providerId)) continue;
        const slotIdentity = modelSlotIdentity(old.profile);
        if (slotIdentity) {
          const slotPolicy = readModelSlotPolicy(await this.get(tx, modelSlotPath('policy', slotIdentity)), slotIdentity, now);
          const state = readModelSlotState(await this.get(tx, modelSlotPath('state', slotIdentity)), slotIdentity);
          requireValue(same(slotPolicy, authority.modelSlots?.[old.profile.id]));
          if (Object.keys(state.occupants).length >= slotPolicy.limit) continue;
        }
        const dimensions = [];
        for (const d of old.profile.quotaDimensions) {
          const ledgerKey = quotaLedgerKey(d);
          const policy = object(await this.get(tx, gatewayLedgerPath('quota-policy', ledgerKey))) as unknown as GatewayQuotaPolicy;
          requireValue(policy.authority === 'gateway-local-capacity' && policy.accountingBasis === 'gateway-local-only' && policy.migrationId === entry.migrationId
            && policy.ledgerKey === ledgerKey && positive(policy.revision) && nonnegativeInteger(policy.limit)
            && current(policy.window.startsAtMs, policy.window.endsAtMs, now));
          const [stateRaw, periodRaw] = await Promise.all([this.get(tx, gatewayLedgerPath('quota-state', ledgerKey)),
            this.get(tx, gatewayLedgerPath('quota-period', evidenceBinding([ledgerKey, policy.window.id])))]);
          const state = object(stateRaw); const period = object(periodRaw);
          requireValue(state.migrationId === entry.migrationId && state.quarantined === false && nonnegativeInteger(state.held)
            && period.ledgerKey === ledgerKey && same(period.window, policy.window) && nonnegativeInteger(period.spent));
          dimensions.push({ ...d, required: operationUsage(d.meter, request.capability, entry.transport), remaining: Math.max(0, policy.limit - state.held - period.spent) });
        }
        const cooldownRaw = await this.get(tx, gatewayAccountCooldownPath(entry.legacyProvider, gatewayAccountScopeIds(entry.profile.quotaDimensions)));
        const credentialRaw = await this.get(tx, gatewayCredentialHealthPath(entry.legacyProvider, gatewayAccountScopeIds(entry.profile.quotaDimensions), entry.accountCredentialBinding));
        const credentialUntil = credentialRaw === undefined ? 0 : object(credentialRaw).untilMs; requireValue(nonnegativeInteger(credentialUntil));
        const cooldown = Math.max(cooldownRaw === undefined ? 0 : object(cooldownRaw).untilMs as number, credentialUntil);
        requireValue(nonnegativeInteger(cooldown));
        const candidate: Candidate = { profile: old.profile,
          quota: { ...old.quota, requestBinding, dimensions, evidenceRef: randomUUID() },
          availability: { ...old.availability, requestBinding, coolingUntilMs: Math.max(old.availability.coolingUntilMs, cooldown), evidenceRef: randomUUID() },
          ...(old.price ? { price: { ...old.price, requestBinding, capability: request.capability, evidenceRef: randomUUID() } } : {}) };
        issue('quota', candidate.quota, entry.expiresAtMs); issue('availability', candidate.availability, entry.expiresAtMs);
        if (candidate.price) issue('price', candidate.price, entry.transport.rateCard!.expiresAtMs);
        candidates.push(candidate);
      }
      const window = civilDayWindow(now, PAID_BUDGET_TIME_ZONE);
      const [paidRaw, dayRaw] = await Promise.all([this.get(tx, 'free_chat_chain/paid_budget_policy'), this.get(tx, `free_chat_chain/paid_day_${window.key}`)]);
      const paid = readPaidPolicy(paidRaw); const day = readSpendDay(dayRaw, window);
      let budget: BudgetAuthorization | undefined;
      if (request.mode !== 'strict-free' && authority.snapshot.budget && paid && paid.updatedAt <= now && paid.capNanoUsd > 0) {
        const previousBudget = authority.snapshot.budget;
        budget = { ...previousBudget, id: advancing ? randomUUID() : previousBudget.id,
          allowedProfileIds: candidates.filter(c => c.profile.charging === 'metered').map(c => c.profile.id),
          periodId: window.key, periodStartsAtMs: window.startAt, periodEndsAtMs: window.resetAt,
          remainingPeriodNanoUsd: Math.max(0, paid.capNanoUsd - day.heldNanoUsd - day.spentNanoUsd), periodLimitNanoUsd: paid.capNanoUsd,
          remainingLogicalRequestNanoUsd: Math.max(0, authority.logicalLimitNanoUsd - Number(logical?.heldNanoUsd ?? 0) - Number(logical?.spentNanoUsd ?? 0)), evidenceRef: randomUUID() };
        if (budget.allowedProfileIds.length) issue('budget', budget, window.resetAt); else budget = undefined;
      }
      const fresh: GatewayAuthorityDocument = { ...authority, paidPolicyRevision: paid?.revision ?? 0,
        snapshot: { revision: randomUUID(), request, candidates, ...(budget ? { budget } : {}) } };
      this.checkLive();
      for (const [reference, record] of writes) tx.create(this.db.doc(gatewayLedgerPath('evidence', reference)), record);
      tx.set(this.db.doc(gatewayLedgerPath('authority', key.logicalRequestId)), fresh);
      return { authority: fresh, records };
    });
    this.authority = copy(refreshed.authority); this.records = refreshed.records;
    return copy(refreshed.authority.snapshot);
  }
  closeDispatchClaim(claim: DispatchClaim): void {
    this.closedDispatchClaims.add(claim.binding.physicalAttemptId);
    this.dispatchHorizons.delete(claim.binding.physicalAttemptId);
  }
  /** Synchronous last-moment check: no async commit response can extend dispatch authority. */
  isDispatchClaimCurrent(claim: DispatchClaim): boolean {
    const horizon = this.dispatchHorizons.get(claim.binding.physicalAttemptId);
    const now = Date.now();
    const valid = !this.closedDispatchClaims.has(claim.binding.physicalAttemptId) && !!horizon && horizon.claimBinding === evidenceBinding(claim) && !this.signal?.aborted
      && now >= horizon.notBeforeMs && now < horizon.expiresAtMs && now < this.context.deadlineAtMs;
    if (!valid) this.closeDispatchClaim(claim);
    return valid;
  }
  async authorizeClaim(claim: DispatchClaim): Promise<boolean> {
    this.dispatchHorizons.delete(claim.binding.physicalAttemptId);
    try {
      requireValue(!this.closedDispatchClaims.has(claim.binding.physicalAttemptId));
      const horizon = await this.db.runTransaction(async tx => {
        const authority = await this.readCurrent(tx); const r = authority.snapshot.request;
        const entry = this.entries.get(claim.binding.profileId); requireValue(entry && same(claim.binding.key, this.key));
        const attempt = object(await this.get(tx, gatewayLedgerPath('attempt', claim.binding.physicalAttemptId)));
        const logical = object(await this.get(tx, gatewayLedgerPath('logical', this.key.logicalRequestId)));
        requireValue(attempt.phase === 'claimed' && attempt.dispatchAuthorizedAtMs === undefined && same(attempt.claim, claim) && logical.cancelled === false);
        const candidate = authority.snapshot.candidates.find(c => c.profile.id === claim.binding.profileId)!;
        const subjects = [['request', r], ['profile', candidate.profile], ['quota', candidate.quota], ['availability', candidate.availability],
          ...(candidate.price ? [['price', candidate.price]] : []), ...(authority.snapshot.budget ? [['budget', authority.snapshot.budget]] : [])] as [EvidenceKind, { evidenceRef: string }][];
        const finalChecks: ((now: number) => boolean)[] = [];
        // Profile evidence is also capped by the exact bound account/rule reviews.
        const expiries = [r.deadlineAtMs, this.context.deadlineAtMs, this.catalog.expiresAtMs, entry.expiresAtMs,
          entry.freeBillingSafety?.expiresAtMs ?? entry.expiresAtMs, entry.transport.rateCard?.expiresAtMs ?? entry.expiresAtMs];
        for (const [kind, subject] of subjects) {
          const record = object(await this.get(tx, gatewayLedgerPath('evidence', subject.evidenceRef))) as unknown as EvidenceRecord;
          expiries.push(record.expiresAtMs);
          finalChecks.push(now => hasCurrentEvidence({ lookup: () => record }, subject.evidenceRef, kind, withoutEvidence(subject), now));
        }
        requireValue(entry.transport.model === claim.binding.modelId);
        const slotIdentity = modelSlotIdentity(entry.profile);
        if (slotIdentity) {
          const policy = readModelSlotPolicy(await this.get(tx, modelSlotPath('policy', slotIdentity)), slotIdentity, Date.now());
          const state = readModelSlotState(await this.get(tx, modelSlotPath('state', slotIdentity)), slotIdentity);
          const held = readHeldModelSlot(attempt.heldModelSlot);
          const occupant = state.occupants[claim.binding.physicalAttemptId];
          requireValue(same(policy, entry.modelConcurrency) && same(held.identity, slotIdentity) && held.policyRevision === policy.revision
            && occupant?.intentBinding === held.intentBinding && occupant.claimBinding === modelSlotBinding(claim)
            && Object.keys(state.occupants).length <= policy.limit);
          expiries.push(policy.expiresAtMs); finalChecks.push(now => current(policy.reviewedAtMs, policy.expiresAtMs, now));
        }
        for (const path of [gatewayAccountCooldownPath(entry.legacyProvider, gatewayAccountScopeIds(entry.profile.quotaDimensions)),
          gatewayCredentialHealthPath(entry.legacyProvider, gatewayAccountScopeIds(entry.profile.quotaDimensions), entry.accountCredentialBinding)]) {
          const raw = await this.get(tx, path); const until = raw === undefined ? 0 : object(raw).untilMs;
          requireValue(nonnegativeInteger(until)); finalChecks.push(now => until <= now);
        }
        requireValue(await this.get(tx, gatewayLedgerPath('profile-quarantine', evidenceBinding([claim.binding.providerId, claim.binding.profileId]))) === undefined);
        const heldQuota = attempt.heldQuota as { ledgerKey: string; amount: number; migrationId: string; policyRevision: number; window: GatewayQuotaPolicy['window'] }[];
        requireValue(Array.isArray(heldQuota) && heldQuota.length === claim.binding.quota.length);
        for (const hold of heldQuota) {
          const [policyRaw, stateRaw] = await Promise.all([this.get(tx, gatewayLedgerPath('quota-policy', hold.ledgerKey)), this.get(tx, gatewayLedgerPath('quota-state', hold.ledgerKey))]);
          const policy = object(policyRaw) as unknown as GatewayQuotaPolicy; const state = object(stateRaw);
          requireValue(policy.authority === 'gateway-local-capacity' && policy.accountingBasis === 'gateway-local-only' && policy.migrationId === hold.migrationId && policy.revision === hold.policyRevision
            && same(policy.window, hold.window)
            && state.migrationId === hold.migrationId && state.quarantined === false && nonnegativeInteger(state.held) && state.held >= hold.amount);
          expiries.push(policy.window.endsAtMs);
          finalChecks.push(now => current(policy.window.startsAtMs, policy.window.endsAtMs, now));
        }
        if (claim.binding.budget) {
          const [policyRaw, dayRaw] = await Promise.all([this.get(tx, 'free_chat_chain/paid_budget_policy'), this.get(tx, `free_chat_chain/paid_day_${claim.binding.budget.periodId}`)]);
          const policy = readPaidPolicy(policyRaw); const budget = claim.binding.budget;
          expiries.push(authority.snapshot.budget!.periodEndsAtMs, Number(object(attempt.window).resetAt));
          finalChecks.push(now => {
            const window = civilDayWindow(now, PAID_BUDGET_TIME_ZONE); const day = readSpendDay(dayRaw, window);
            return !!policy && policy.revision === authority.paidPolicyRevision && policy.capNanoUsd > 0 && policy.updatedAt <= now
              && window.key === budget.periodId && same(attempt.window, window) && day.pending > 0
              && day.heldNanoUsd >= budget.amountNanoUsd && day.heldNanoUsd + day.spentNanoUsd <= policy.capNanoUsd;
          });
        }
        // No time-sensitive decision uses a pre-read timestamp. Reads can span quota resets,
        // evidence expiry or IST midnight; all gates share this final clock observation.
        const now = Date.now(); this.checkLive();
        requireValue(now < r.deadlineAtMs && current(this.catalog.issuedAtMs, this.catalog.expiresAtMs, now)
          && current(entry.reviewedAtMs, entry.expiresAtMs, now)
          && entry.accountCredentialBinding === transportCredentialBinding(entry.transport) && finalChecks.every(check => check(now)));
        const expiresAtMs = Math.min(...expiries); requireValue(Number.isSafeInteger(expiresAtMs) && now < expiresAtMs);
        tx.set(this.db.doc(gatewayLedgerPath('attempt', claim.binding.physicalAttemptId)), { ...attempt, dispatchAuthorizedAtMs: now });
        return Object.freeze({ claimBinding: evidenceBinding(claim), notBeforeMs: now, expiresAtMs });
      });
      // The transaction may already have committed even when this response arrives too late.
      // Keep its holds; a missed dispatch horizon is never proof of non-commit or a refund.
      if (this.closedDispatchClaims.has(claim.binding.physicalAttemptId)) return false;
      this.dispatchHorizons.set(claim.binding.physicalAttemptId, horizon);
      return this.isDispatchClaimCurrent(claim);
    } catch { this.closeDispatchClaim(claim); return false; }
  }
  async recordTrustedHealth(error: unknown, claim: DispatchClaim): Promise<void> {
    const proof = readGatewayTextHealth(error, claim) ?? readGatewayOpenRouterHealth(error, claim) ?? readGatewayGroundingHealth(error, claim) ?? readGatewayEmbeddingHealth(error, claim) ?? readGatewayVisionHealth(error, claim); if (!proof) return;
    const entry = this.entries.get(claim.binding.profileId); requireValue(entry && same(proof.binding, claim.binding) && same(claim.binding.key, this.key));
    requireValue(proof.cooldownUntilMs === undefined || (nonnegativeInteger(proof.cooldownUntilMs)
      && proof.cooldownUntilMs >= proof.receivedAtMs && proof.cooldownUntilMs <= proof.receivedAtMs + 7 * 86400000));
    const path = proof.kind === 'auth' ? gatewayCredentialHealthPath(entry.legacyProvider, gatewayAccountScopeIds(entry.profile.quotaDimensions), entry.accountCredentialBinding)
      : gatewayAccountCooldownPath(entry.legacyProvider, gatewayAccountScopeIds(entry.profile.quotaDimensions));
    const receiptPath = gatewayLedgerPath('incident', evidenceBinding(['health', claim.binding.physicalAttemptId]));
    await this.db.runTransaction(async tx => {
      const attempt = object(await this.get(tx, gatewayLedgerPath('attempt', claim.binding.physicalAttemptId)));
      const receipt = await this.get(tx, receiptPath);
      const previousRaw = await this.get(tx, path); const previous = previousRaw === undefined ? {} : object(previousRaw);
      requireValue(['claimed', 'pending'].includes(String(attempt.phase)) && same(attempt.claim, claim)
        && nonnegativeInteger(attempt.dispatchAuthorizedAtMs) && nonnegativeInteger(proof.receivedAtMs)
        && proof.receivedAtMs >= (attempt.dispatchAuthorizedAtMs as number) && proof.receivedAtMs <= Date.now());
      if (receipt !== undefined) { requireValue(same(object(receipt).binding, claim.binding)); return; }
      const priorUntil = previous.untilMs ?? 0; requireValue(nonnegativeInteger(priorUntil));
      const recent = nonnegativeInteger(previous.lastFailureAtMs) && proof.receivedAtMs - previous.lastFailureAtMs < 300000;
      const failures = recent && nonnegativeInteger(previous.failures) ? Math.min(previous.failures + 1, 10) : 1;
      const delay = proof.kind === 'auth' ? 3600000 : Math.min(300000, 30000 * 2 ** (failures - 1));
      const until = proof.kind === 'cooldown-unavailable' ? Number.MAX_SAFE_INTEGER : proof.receivedAtMs + delay;
      tx.set(this.db.doc(path), { kind: proof.kind === 'auth' ? 'gateway_credential_health' : 'gateway_account_cooldown', version: 1,
        untilMs: Math.max(priorUntil, until, proof.cooldownUntilMs ?? 0), lastFailureAtMs: proof.receivedAtMs, failures,
        reason: proof.kind, ...(proof.kind === 'auth' ? { credentialBinding: entry.accountCredentialBinding } : {}) });
      tx.create(this.db.doc(receiptPath), { kind: 'gateway_transport_health', version: 1, binding: claim.binding,
        observation: proof.kind, atMs: proof.receivedAtMs });
    });
  }
  async recordTrustedCostAnomaly(error: unknown, claim: DispatchClaim): Promise<void> {
    const proof = readGatewayTextCostAnomaly(error, claim) ?? readGatewayOpenRouterCostAnomaly(error, claim) ?? readGatewayEmbeddingCostAnomaly(error, claim) ?? readGatewayVisionCostAnomaly(error, claim); if (!proof) return;
    requireValue(same(proof.binding, claim.binding) && same(claim.binding.key, this.key));
    await this.db.runTransaction(async tx => {
      const attempt = object(await this.get(tx, gatewayLedgerPath('attempt', claim.binding.physicalAttemptId)));
      requireValue(['claimed', 'pending'].includes(String(attempt.phase)) && same(attempt.claim, claim)
        && nonnegativeInteger(attempt.dispatchAuthorizedAtMs) && nonnegativeInteger(proof.receivedAtMs)
        && proof.receivedAtMs >= (attempt.dispatchAuthorizedAtMs as number) && proof.receivedAtMs <= Date.now());
      const paidPolicy = readPaidPolicy(await this.get(tx, 'free_chat_chain/paid_budget_policy'));
      const held = attempt.heldQuota;
      requireValue(Array.isArray(held) && held.length > 0 && held.length <= 32);
      const states = await Promise.all((held as Record<string, unknown>[]).map(async hold => {
        requireValue(typeof hold.ledgerKey === 'string');
        const state = object(await this.get(tx, gatewayLedgerPath('quota-state', hold.ledgerKey as string)));
        requireValue(state.kind === 'gateway_quota_state' && state.ledgerKey === hold.ledgerKey
          && state.migrationId === hold.migrationId && nonnegativeInteger(state.held));
        return state;
      }));
      // Keep every money/quota hold. The anomaly is NOT invoice evidence and never
      // supplies an actual amount. Shared account quota quarantine survives restart.
      {
        const revision = (paidPolicy?.revision ?? 0) + 1; requireValue(nonnegativeInteger(revision));
        // Any authenticated billing contradiction makes total liability unknown,
        // including a purported-free request that had no monetary reservation.
        // Stop the shared pool, not just one alias.
        // No invoice amount is invented and every original hold remains committed.
        tx.set(this.db.doc('free_chat_chain/paid_budget_policy'), { kind: 'paid_budget_policy', version: 1,
          revision, capNanoUsd: 0, updatedAt: Date.now(), source: 'safety' });
      }
      for (const state of states) tx.set(this.db.doc(gatewayLedgerPath('quota-state', state.ledgerKey as string)), { ...state, quarantined: true });
      tx.set(this.db.doc(gatewayLedgerPath('profile-quarantine', evidenceBinding([claim.binding.providerId, claim.binding.profileId]))), {
        kind: 'gateway_profile_quarantine', version: 1, providerId: claim.binding.providerId, profileId: claim.binding.profileId,
        attemptId: claim.binding.physicalAttemptId, atMs: proof.receivedAtMs,
      });
      tx.set(this.db.doc(gatewayLedgerPath('incident', claim.binding.physicalAttemptId)), {
        kind: 'gateway_transport_incident', version: 1, attemptId: claim.binding.physicalAttemptId,
        binding: claim.binding, anomaly: proof.kind, unresolved: true, atMs: proof.receivedAtMs,
      });
    });
  }
  async recordTrustedRejection(error: unknown, claim: DispatchClaim): Promise<string | undefined> {
    const proof = readGatewayTextRejection(error, claim) ?? readGatewayOpenRouterRejection(error, claim) ?? readGatewayVisionRejection(error, claim); if (!proof) return undefined;
    const reference = randomUUID(); const rejection: AuthenticatedRejection = { ...proof, evidenceRef: reference };
    const entry = this.entries.get(claim.binding.profileId); requireValue(entry);
    await this.db.runTransaction(async tx => {
      const attempt = object(await this.get(tx, gatewayLedgerPath('attempt', claim.binding.physicalAttemptId)));
      const cooldownRaw = await this.get(tx, gatewayAccountCooldownPath(entry.legacyProvider, gatewayAccountScopeIds(entry.profile.quotaDimensions)));
      const until = cooldownRaw === undefined ? 0 : object(cooldownRaw).untilMs;
      requireValue(nonnegativeInteger(until) && attempt.phase === 'claimed' && same(attempt.claim, claim)
        && nonnegativeInteger(attempt.dispatchAuthorizedAtMs) && nonnegativeInteger(proof.receivedAtMs)
        && proof.receivedAtMs >= (attempt.dispatchAuthorizedAtMs as number) && proof.receivedAtMs <= Date.now()
        && (proof.cooldownUntilMs === undefined || (nonnegativeInteger(proof.cooldownUntilMs)
          && proof.cooldownUntilMs >= proof.receivedAtMs && proof.cooldownUntilMs <= proof.receivedAtMs + 7 * 86_400_000)));
      tx.create(this.db.doc(gatewayLedgerPath('rejection', reference)), { kind: 'gateway_rejection', version: 1, rejection });
      tx.set(this.db.doc(gatewayAccountCooldownPath(entry.legacyProvider, gatewayAccountScopeIds(entry.profile.quotaDimensions))), { kind: 'gateway_account_cooldown', version: 1,
        untilMs: Math.max(until, proof.receivedAtMs + 60_000, proof.cooldownUntilMs ?? 0), reason: 'verified-http-429' });
    });
    return reference;
  }
  async readAuthoritativeRejection(claim: DispatchClaim, reference: string): Promise<AuthenticatedRejection | undefined> {
    requireValue(same(claim.binding.key, this.key) && isIdentifier(reference));
    const value = readData(await this.db.doc(gatewayLedgerPath('rejection', reference)).get());
    if (!value) return undefined;
    const document = object(value); const rejection = document.rejection as AuthenticatedRejection;
    requireValue(document.kind === 'gateway_rejection' && document.version === 1 && same(rejection.binding, claim.binding)
      && rejection.evidenceRef === reference); return rejection;
  }
  /** Releases physical occupancy only; financial/quota holds and incidents are untouched. */
  async releaseTrustedModelSlot(value: unknown, claim: DispatchClaim): Promise<void> {
    const entry = this.entries.get(claim.binding.profileId); requireValue(entry && same(claim.binding.key, this.key));
    const identity = modelSlotIdentity(entry.profile); if (!identity) return;
    const terminal = readGatewayTextCompletion(value, claim) ?? readGatewayVisionCompletion(value, claim);
    const rejection = readGatewayTextRejection(value, claim) ?? readGatewayVisionRejection(value, claim);
    const proof = terminal ?? rejection; if (!proof) return;
    const kind = terminal ? 'provider-terminal' : 'no-generation-rejection';
    const receiptPath = modelSlotPath('release', claim.binding.physicalAttemptId);
    await this.db.runTransaction(async tx => {
      const [attemptRaw, stateRaw, receipt] = await Promise.all([
        this.get(tx, gatewayLedgerPath('attempt', claim.binding.physicalAttemptId)), this.get(tx, modelSlotPath('state', identity)), this.get(tx, receiptPath),
      ]);
      const attempt = object(attemptRaw); const held = readHeldModelSlot(attempt.heldModelSlot);
      requireValue(same(attempt.claim, claim) && same(held.identity, identity) && nonnegativeInteger(attempt.dispatchAuthorizedAtMs)
        && proof.receivedAtMs >= (attempt.dispatchAuthorizedAtMs as number) && proof.receivedAtMs <= Date.now());
      const claimBinding = modelSlotBinding(claim);
      if (receipt !== undefined) { requireValue(object(receipt).claimBinding === claimBinding); return; }
      const state = readModelSlotState(stateRaw, identity); const occupant = state.occupants[claim.binding.physicalAttemptId];
      requireValue(occupant?.claimBinding === claimBinding && occupant.intentBinding === held.intentBinding);
      const occupants = { ...state.occupants }; delete occupants[claim.binding.physicalAttemptId];
      tx.set(this.db.doc(modelSlotPath('state', identity)), { ...state, occupants });
      tx.create(this.db.doc(receiptPath), { kind: 'gateway_model_slot_release', version: 1, claimBinding, identity, proof: kind, atMs: proof.receivedAtMs });
    });
  }
  async recordTrustedUsage(result: unknown, claim: DispatchClaim): Promise<string | undefined> {
    const measured = readGatewayTextUsage(result, claim) ?? readGatewayOpenRouterUsage(result, claim)
      ?? readGatewayTextConservativeUsage(result, claim) ?? readGatewayEmbeddingUsage(result, claim)
      ?? readGatewayGroundingUsage(result, claim) ?? readGatewayVisionUsage(result, claim) ?? readGatewayVisionConservativeUsage(result, claim); if (!measured) return undefined;
    const entry = this.entries.get(claim.binding.profileId); requireValue(entry);
    const reference = randomUUID();
    const usage: AuthoritativeUsage = { evidenceRef: reference, binding: claim.binding, final: true,
      outcome: measured.outcome, outputVisible: measured.outputVisible,
      ...('chargeBasis' in measured ? { chargeBasis: measured.chargeBasis, conservativeCeilingNanoUsd: measured.conservativeCeilingNanoUsd, rateCardVersion: measured.rateCardVersion }
        : { actualNanoUsd: measured.actualNanoUsd }),
      quotaUsage: entry.profile.quotaDimensions.map(d => ({ ledgerKey: quotaLedgerKey(d), amount: /^requests\/(minute|day)$/.test(d.meter) ? 1 : usageAmount(d.meter, 'inputTokens' in measured ? measured.inputTokens : NaN, 'outputTokens' in measured ? measured.outputTokens : 0) })) };
    await this.db.runTransaction(async tx => {
      const attempt = object(await this.get(tx, gatewayLedgerPath('attempt', claim.binding.physicalAttemptId)));
      requireValue(['claimed', 'pending'].includes(String(attempt.phase)) && same(attempt.claim, claim));
      if (usage.chargeBasis === 'conservative-ceiling') {
        // A refresh/reprice while generation is running cannot retroactively mint a
        // lower liability proof from an obsolete tariff. Retain the original hold.
        const catalog = await this.get(tx, GATEWAY_CATALOG_PATH);
        const now = Date.now();
        requireValue(same(catalog, this.catalog) && current(entry.reviewedAtMs, entry.expiresAtMs, now)
          && entry.transport.rateCard
          && current(entry.transport.rateCard.verifiedAtMs, entry.transport.rateCard.expiresAtMs, now)
          && usage.rateCardVersion === entry.transport.rateCard.version && usage.rateCardVersion === claim.binding.budget?.rateCardVersion);
      }
      tx.create(this.db.doc(gatewayLedgerPath('usage', reference)), { kind: 'gateway_usage', version: 1, usage });
    });
    return reference;
  }
  async readAuthoritativeUsage(claim: DispatchClaim, reference: string): Promise<AuthoritativeUsage | undefined> {
    requireValue(same(claim.binding.key, this.key) && isIdentifier(reference));
    const value = readData(await this.db.doc(gatewayLedgerPath('usage', reference)).get());
    if (!value) return undefined;
    const document = object(value); const usage = document.usage as AuthoritativeUsage;
    requireValue(document.kind === 'gateway_usage' && document.version === 1 && same(usage.binding, claim.binding) && usage.evidenceRef === reference);
    return usage;
  }
}
