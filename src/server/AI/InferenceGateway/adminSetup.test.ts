import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { sessionGreetingRule } from '../../lib/sessionGreeting';
import { FREE_ANSWER_ALL_RULES } from '../../lib/freeChatReplies';
import { freeChatModeGuide } from '../../lib/freeChatModeGuide';
import { CREATOR_IDENTITY, INDIA_TERRITORIAL_INTEGRITY, LINK_POLICY, recencyDirective } from '../../lib/prompts';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../professionals/registry', () => ({ listProfessionals: () => [{ id: 'teacher_ai', name: 'Teacher' }] }));
import { GatewayAdminSetup, gatewayCredentialAccountPath, gatewaySetupAuditPath, readGatewaySetupSubmission } from './adminSetup';
import { GatewayAuthorityStore, GATEWAY_CATALOG_PATH } from './authorityStore';
import { FirestoreInferenceLedger, gatewayLedgerPath } from './firestoreLedger';
import { gatewayQuotaRulePath } from './quotaRollover';
import { gatewayAccountFencePath, gatewayAccountCooldownPath, gatewayCredentialHealthPath } from './accountMigration';
import { evidenceBinding, quotaLedgerKey } from './profiles';
import { gatewayTextCredentialBinding, gatewayTextPayloadDigest } from './textTransport';
import { planInference } from './policy';
import { admissionIntentFor } from './executor';
import { gatewayVisionPayloadDigest } from './visionTransport';
import { gatewayEmbeddingPayloadDigest } from './embeddingTransport';
import { gatewayGroundingPayloadDigest } from './groundingTransport';
import { GATEWAY_ATTESTATIONS, GATEWAY_REVIEW_FIELDS, isGatewaySetupStatus, type GatewaySetupSubmission } from '../../../lib/inferenceGatewaySetup';
// Read the real route-owned prompt builders; do not substitute a tiny test-only system prompt.
function actualSystemPrompt() {
 const source=readFileSync(new URL('../../routes/chat.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('chat.ts',source,ts.ScriptTarget.Latest,true);
 let language='',builder='';
 function visit(node:ts.Node) { if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){if(node.name.text==='LANGUAGE_RULE') language=node.initializer.getText(ast);if(node.name.text==='buildFreeSystemPrompt') builder=node.initializer.getText(ast);}ts.forEachChild(node,visit); }
 visit(ast);expect(language).not.toBe('');expect(builder).not.toBe('');
 const js=ts.transpile(`const build=${builder}; return build(undefined,true);`,{target:ts.ScriptTarget.ES2022});
 const base=new Function('LANGUAGE_RULE','sessionGreetingRule',js)(new Function(`return ${language}`)(),sessionGreetingRule) as string;
 return `${base}\n\n${freeChatModeGuide()}`.replace(/APP BUILDING — LEAD WITH NavBharatAI Pro[\s\S]*?(?=\nHARD LIMITS:)/,`${FREE_ANSWER_ALL_RULES}\n`).replace('(guide them to NavBharatAI Pro instead, per the rule above)','(for an app request, explain the idea instead, per the rule above)')+`\n\n${CREATOR_IDENTITY}\n\n${INDIA_TERRITORIAL_INTEGRITY}\n\n${recencyDirective()}\n\n${LINK_POLICY}\n\nReply in English.`;
}
const START = 1_800_000_010_000;
export function gatewayReviewFixture(): GatewaySetupSubmission {
  return { operationId: 'operation-one', expectedCatalogRevision: null, profileId: 'glm-flash-profile', provider: 'GLM', modelId: 'glm-4.7-flash', modelRevision: '2026-10', canonicalModelId: 'glm47flash',
    canonicalAccountId: 'canonical-account-one', credentialEnv: 'INFERENCE_GATEWAY_TEST_KEY', platformOwnerId: 'platform-owner', policyKeys: ['chat:text'],
    termsPolicyId: 'terms-v1', qualityGateId: 'clinical-review', qualityGateVersion: 'v1', privacyPolicyId: 'private-v1', processingRegions: ['reviewed-region'], retentionHours: 0,
    maxInputTokens: 4096, maxOutputTokens: 512, maxContextTokens: 8192, localTokensPerMinute: 100_000, billing: 'intrinsic-zero', reviewedAtMs: START - 1, expiresAtMs: START + 60_000,
    evidence: Object.fromEntries(GATEWAY_REVIEW_FIELDS.map(k => [k, `review:${k}-evidence`])) as GatewaySetupSubmission['evidence'],
    attestations: Object.fromEntries(GATEWAY_ATTESTATIONS.map(k => [k, true])) as GatewaySetupSubmission['attestations'], reason: 'Independent exact model and account review completed' };
}
function fixture() {
  const docs = new Map<string, any>(); let now = START; let env: Record<string, string> = { INFERENCE_GATEWAY_TEST_KEY: 'synthetic-never-live-secret' }; let on = false;
  let afterRead: ((path: string) => void) | undefined; const writes: string[] = [];
  const db: any = { doc: (path: string) => ({ path }), runTransaction: async (fn: any) => {
    const changes: [string, any, boolean][] = []; let writing = false;
    const result = await fn({ get: async ({ path }: any) => { if (writing) throw new Error('read-after-write'); const data = docs.get(path); afterRead?.(path); return { exists: data !== undefined, data: () => structuredClone(data) }; },
      set: ({ path }: any, data: any) => { writing = true; changes.push([path, data, false]); },
      create: ({ path }: any, data: any) => { writing = true; if (docs.has(path)) throw new Error('already-exists'); changes.push([path, data, true]); } });
    for (const [path, data] of changes) { docs.set(path, structuredClone(data)); writes.push(path); } return result;
  } };
  const setup = new GatewayAdminSetup(db, { now: () => now, environment: () => env, deploymentEnabled: () => on });
  const submit = async (v = gatewayReviewFixture()) => { const preview = await setup.preview(v); return setup.submit(v, preview.previewBinding, 'verified-admin'); };
  return { docs, writes, setup, submit, db, setNow: (v: number) => { now = v; }, setEnv: (v: Record<string, string>) => { env = v; }, setOn: () => { on = true; }, afterRead: (fn: (path: string) => void) => { afterRead = fn; } };
}
const dimension = { scope: { kind: 'account' as const, providerId: 'GLM', id: 'canonical-account-one' }, meter: 'tokens/minute' };
const ledgerKey = quotaLedgerKey(dimension);
describe('bounded administrative gateway setup', () => {
  it('reports missing review honestly without initializing budget, quota or credentials', async () => {
    const f = fixture(); const view = await f.setup.status(); expect(isGatewaySetupStatus(view)).toBe(true);
    expect(view).toMatchObject({ reviewState: 'missing', catalogRevision: null, deploymentEnabled: false, paidAuthority: 'missing', paidCapUsd: null, upstreamRemaining: 'unknown', liveProviderVerified: false });
    expect(f.writes).toEqual([]); expect(JSON.stringify(view)).not.toContain('synthetic-never-live-secret');
    expect(view.scopes.some(s => /doctor|sda|builder|image/.test(s.key))).toBe(false);
  });
  it('preview is read-only; submit atomically creates reviewed catalog, canonical local quota, and immutable audit', async () => {
    const f = fixture(); const v = gatewayReviewFixture(); const p = await f.setup.preview(v); expect(f.writes).toEqual([]);
    expect(p).toMatchObject({ activationFlagChanged: false, deploymentEnabled: false, paidAuthority: 'missing', credentialAssociated: true });
    await expect(f.setup.submit(v, p.previewBinding, 'verified-admin')).resolves.toEqual({ ok: true, catalogRevision: v.operationId, operationId: v.operationId });
    expect(f.docs.get(GATEWAY_CATALOG_PATH).profiles[0]).toMatchObject({ accountCredentialBinding: gatewayTextCredentialBinding('synthetic-never-live-secret'), freeBillingSafety: { kind: 'intrinsic-zero', evidenceRef: v.evidence.pricing } });
    expect(f.docs.get(gatewayLedgerPath('quota-policy', ledgerKey))).toMatchObject({ authority: 'gateway-local-capacity', accountingBasis: 'gateway-local-only', limit: 100_000 });
    expect(f.docs.get(gatewaySetupAuditPath(v.operationId))).toMatchObject({ actor: 'verified-admin', paidAuthorityChanged: false, activationChanged: false });
    expect(f.writes).toHaveLength(8); expect(f.docs.has('free_chat_chain/paid_budget_policy')).toBe(false);
    expect(JSON.stringify([...f.docs.values()])).not.toContain('synthetic-never-live-secret');
  });
  it('the real authority issuer and planner admit the complete ordinary-chat prompt from typed admin enrollment', async () => {
    const f = fixture(); await f.submit({ ...gatewayReviewFixture(), maxInputTokens: 32768, maxContextTokens: 65536 });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(START);
    vi.stubEnv('INFERENCE_GATEWAY_TEST_KEY', 'synthetic-never-live-secret');
    try {
      const payload = { prompt: 'Hello', systemPrompt: actualSystemPrompt(), streaming: false };
      expect(Buffer.byteLength(payload.systemPrompt)).toBeGreaterThan(9000);
      const key = { principalId: 'verified-user', tenantId: 'verified-user', logicalRequestId: 'admin-enrolled-request', payloadDigest: gatewayTextPayloadDigest(payload) };
      const context = { principalId: key.principalId, tenantId: key.tenantId, surface: 'chat' as const, policyKey: 'chat:text', qualityTier: 'clinical' as const,
        dataClass: 'health' as const, funding: 'platform-free-fallback' as const, mode: 'strict-free' as const, deadlineAtMs: START + 90_000 };
      const issuer = new GatewayAuthorityStore(f.db, context, key, payload, true);
      await expect(issuer.issue()).resolves.toMatchObject({ platformScope: { id: 'platform-free-fallback', ownerId: 'platform-owner' } });
      const snapshot = await issuer.readTrusted(key);
      expect(snapshot.candidates).toHaveLength(1);
      expect(planInference({ ...snapshot, authority: issuer.evidence, nowMs: START })).toMatchObject({ kind: 'plan', profileId: 'glm-flash-profile' });
    } finally { clock.mockRestore(); vi.unstubAllEnvs(); }
  });
  it.each([
    { reviewedPriority: -1 }, { reviewedPriority: 1001 }, { reviewedPriority: 0.5 }, { billing: 'unknown' }, { billing: 'intrinsic-zero', provider: 'DEEPSEEK', modelId: 'deepseek-flash' },
    { provider: 'GROQ', billing: 'intrinsic-zero' }, { provider: 'GLM', modelId: 'glm-paid' }, { provider: 'GEMINI' },
    { policyKeys: ['builder:text'] }, { policyKeys: ['doctor:text'] }, { policyKeys: ['doctor:audit'] }, { policyKeys: ['image-generation'] }, { policyKeys: ['developer-api:text'] },
    { canonicalAccountId: 'sk-' + 's'.repeat(40) }, { credential: 'secret' }, { actor: 'spoofed' }, { expiresAtMs: START },
    { expiresAtMs: START + 86_400_000 }, { reviewedAtMs: START + 1 }, { localTokensPerMinute: 1 },
    { inputNanoUsdPerMillion: 0 }, { apiKey: 'do-not-store' }, { maxContextTokens: 4096 },
  ])('rejects contradictory/unsafe submission without any write %#', async change => {
    const f = fixture(); await expect(f.setup.preview({ ...gatewayReviewFixture(), ...change })).rejects.toMatchObject({ code: 'invalid-review' }); expect(f.writes).toEqual([]);
  });
  it('requires every independent review and explicit assertion; secret reason/ref is rejected rather than persisted', () => {
    const v = gatewayReviewFixture();
    for (const key of GATEWAY_ATTESTATIONS) expect(() => readGatewaySetupSubmission({ ...v, attestations: { ...v.attestations, [key]: false } }, START)).toThrow();
    for (const key of GATEWAY_REVIEW_FIELDS) expect(() => readGatewaySetupSubmission({ ...v, evidence: { ...v.evidence, [key]: '' } }, START)).toThrow();
    expect(() => readGatewaySetupSubmission({ ...v, evidence: { ...v.evidence, apiKey: 'secret' } }, START)).toThrow();
    expect(() => readGatewaySetupSubmission({ ...v, reason: `Accidentally pasted sk-${'s'.repeat(40)}` }, START)).toThrow();
  });
  it('cannot enroll a missing credential generation or spoof its non-secret binding', async () => {
    const f = fixture(); f.setEnv({}); await expect(f.setup.preview(gatewayReviewFixture())).rejects.toMatchObject({ code: 'credential-unavailable' });
    await expect(f.setup.preview({ ...gatewayReviewFixture(), accountCredentialBinding: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'invalid-review' }); expect(f.writes).toEqual([]);
  });
  it('validates exact metered rates but never creates or increases paid authority', async () => {
    const f = fixture(); const v = { ...gatewayReviewFixture(), provider: 'DEEPSEEK' as const, modelId: 'deepseek-flash', billing: 'metered' as const, inputNanoUsdPerMillion: 300_000_000, outputNanoUsdPerMillion: 1_200_000_000 };
    await f.submit(v); expect(f.docs.has('free_chat_chain/paid_budget_policy')).toBe(false);
    expect(f.docs.get(GATEWAY_CATALOG_PATH).profiles[0].profile.charging).toBe('metered');
    await expect(f.setup.preview({ ...v, inputNanoUsdPerMillion: 0 })).rejects.toMatchObject({ code: 'invalid-review' });
  });
  it('binds deliberate default model priority and explicit bounded overrides into review', async () => {
    const f = fixture(); const v = gatewayReviewFixture(); expect(await f.setup.preview(v)).toMatchObject({ reviewedPriority: 10 });
    await f.submit({ ...v, reviewedPriority: 7 }); expect(f.docs.get(GATEWAY_CATALOG_PATH).profiles[0].profile.reviewedPriority).toBe(7);
  });
  it('retains previous configuration on invalid review, revision conflict, or mismatched preview', async () => {
    const f = fixture(); await f.submit(); const prior = evidenceBinding([...f.docs.entries()]);
    await expect(f.submit({ ...gatewayReviewFixture(), operationId: 'operation-two' })).rejects.toMatchObject({ code: 'conflict' });
    const update = { ...gatewayReviewFixture(), operationId: 'operation-two', expectedCatalogRevision: 'operation-one' };
    await expect(f.setup.submit(update, '0'.repeat(64), 'verified-admin')).rejects.toMatchObject({ code: 'preview-changed' });
    expect(evidenceBinding([...f.docs.entries()])).toBe(prior);
  });
  it('same-account second model shares one period and preserves spent and all outstanding holds', async () => {
    const f = fixture(); await f.submit(); const p = f.docs.get(gatewayLedgerPath('quota-policy', ledgerKey));
    const periodPath = gatewayLedgerPath('quota-period', evidenceBinding([ledgerKey, p.window.id]));
    f.docs.get(periodPath).spent = 777; f.docs.get(gatewayLedgerPath('quota-state', ledgerKey)).held = 888;
    await f.submit({ ...gatewayReviewFixture(), operationId: 'operation-two', expectedCatalogRevision: 'operation-one', profileId: 'glm45-profile', modelId: 'glm-4.5-flash', canonicalModelId: 'glm45flash' });
    expect(f.docs.get(periodPath).spent).toBe(777); expect(f.docs.get(gatewayLedgerPath('quota-state', ledgerKey)).held).toBe(888);
    expect(f.docs.get(gatewayLedgerPath('quota-policy', ledgerKey)).window).toEqual(p.window);
    expect([...f.docs.values()].filter(d => d.kind === 'gateway_quota_state')).toHaveLength(1);
    expect(f.docs.get(GATEWAY_CATALOG_PATH).profiles).toHaveLength(2);
  });
  it('cannot relabel a known generation as a new canonical account to multiply local capacity', async () => {
    const f = fixture(); await f.submit(); const count = f.writes.length;
    await expect(f.submit({ ...gatewayReviewFixture(), operationId: 'operation-two', expectedCatalogRevision: 'operation-one', profileId: 'new-profile', canonicalAccountId: 'invented-second-account' })).rejects.toMatchObject({ code: 'conflict' });
    expect(f.writes).toHaveLength(count);
  });
  it('retains canonical generation association after rotation even when no active profile uses the old key', async () => {
    const f = fixture(); await f.submit(); f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'rotated-synthetic-secret' });
    await f.submit({ ...gatewayReviewFixture(), operationId: 'operation-two', expectedCatalogRevision: 'operation-one' });
    f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'synthetic-never-live-secret' });
    await expect(f.submit({ ...gatewayReviewFixture(), operationId: 'operation-three', expectedCatalogRevision: 'operation-two', profileId: 'new-profile', canonicalAccountId: 'invented-second-account' })).rejects.toMatchObject({ code: 'conflict' });
    expect([...f.docs.values()].filter(d => d.kind === 'gateway_quota_state')).toHaveLength(1);
  });
  it('backfills seeded historical generations atomically and rejects conflicting prior associations without writes', async () => {
    const f = fixture(); await f.submit(); const historical = gatewayTextCredentialBinding('synthetic-never-live-secret');
    f.docs.delete(gatewayCredentialAccountPath(historical)); // Valid pre-workflow seeded account.
    f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'rotated-synthetic-secret' });
    await f.submit({ ...gatewayReviewFixture(), operationId: 'operation-two', expectedCatalogRevision: 'operation-one' });
    expect(f.docs.get(gatewayCredentialAccountPath(historical))).toMatchObject({ provider: 'GLM', canonicalAccountId: 'canonical-account-one' });
    f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'synthetic-never-live-secret' });
    const before = evidenceBinding([...f.docs.entries()]);
    await expect(f.submit({ ...gatewayReviewFixture(), operationId: 'operation-three', expectedCatalogRevision: 'operation-two', profileId: 'another-profile', canonicalAccountId: 'different-account' })).rejects.toMatchObject({ code: 'conflict' });
    expect(evidenceBinding([...f.docs.entries()])).toBe(before);
    f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'third-synthetic-secret' });
    f.docs.get(gatewayCredentialAccountPath(historical)).canonicalAccountId = 'inconsistent-account';
    const conflicting = evidenceBinding([...f.docs.entries()]);
    await expect(f.submit({ ...gatewayReviewFixture(), operationId: 'operation-three', expectedCatalogRevision: 'operation-two' })).rejects.toMatchObject({ code: 'conflict' });
    expect(evidenceBinding([...f.docs.entries()])).toBe(conflicting);
  });
  it('two expired profiles can be reviewed separately without renewing the other approval', async () => {
    const f = fixture(); await f.submit(); const second = { ...gatewayReviewFixture(), operationId: 'operation-two', expectedCatalogRevision: 'operation-one', profileId: 'glm45-profile', modelId: 'glm-4.5-flash', canonicalModelId: 'glm45flash' };
    await f.submit(second); f.setNow(START + 70_000);
    await f.submit({ ...gatewayReviewFixture(), operationId: 'operation-three', expectedCatalogRevision: 'operation-two', reviewedAtMs: START + 70_000, expiresAtMs: START + 120_000 });
    expect(f.docs.get(GATEWAY_CATALOG_PATH).profiles.find((p: any) => p.profile.id === second.profileId).expiresAtMs).toBe(second.expiresAtMs);
    await f.submit({ ...second, operationId: 'operation-four', expectedCatalogRevision: 'operation-three', reviewedAtMs: START + 70_000, expiresAtMs: START + 120_000 });
    expect(f.docs.get(GATEWAY_CATALOG_PATH).revision).toBe('operation-four');
  });
  it('quarantine, partial missing state and changed quota limits cannot be bypassed through enrollment', async () => {
    for (const change of ['quarantine', 'missing', 'limit']) {
      const f = fixture(); await f.submit(); const v = { ...gatewayReviewFixture(), operationId: 'operation-two', expectedCatalogRevision: 'operation-one' };
      if (change === 'quarantine') f.docs.get(gatewayLedgerPath('quota-state', ledgerKey)).quarantined = true;
      if (change === 'missing') f.docs.delete(gatewayQuotaRulePath(ledgerKey));
      if (change === 'limit') v.localTokensPerMinute++;
      const prior = evidenceBinding([...f.docs.entries()]); await expect(f.submit(v)).rejects.toThrow(); expect(evidenceBinding([...f.docs.entries()])).toBe(prior);
    }
  });
  it('idempotent receipt reconciles a lost successful response without duplicate audit or budget changes', async () => {
    const f = fixture(); const v = gatewayReviewFixture(); const p = await f.setup.preview(v); await f.setup.submit(v, p.previewBinding, 'verified-admin'); const writes = f.writes.length;
    await expect(f.setup.submit(v, p.previewBinding, 'verified-admin')).resolves.toMatchObject({ ok: true, catalogRevision: 'operation-one' }); expect(f.writes).toHaveLength(writes);
    await expect(f.setup.submit({ ...v, reason: 'Another request under an existing operation ID' }, p.previewBinding, 'verified-admin')).rejects.toMatchObject({ code: 'conflict' });
  });
  it.each(['expiry', 'minute', 'credential'])('fresh final read rejects %s changes during async preparation with no writes', async change => {
    const f = fixture(); f.afterRead(path => { if (!path.includes('gateway_quota_period_')) return;
      if (change === 'expiry') f.setNow(START + 60_000);
      if (change === 'minute') f.setNow(START + 51_000);
      if (change === 'credential') f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'rotated-synthetic-secret' });
    });
    await expect(f.setup.preview(gatewayReviewFixture())).rejects.toThrow(); expect(f.writes).toEqual([]);
  });
  it('discloses live eligibility effect and invalidates preview when deployment flag changes', async () => {
    const f = fixture(); const v = gatewayReviewFixture(); const p = await f.setup.preview(v); f.setOn();
    await expect(f.setup.submit(v, p.previewBinding, 'verified-admin')).rejects.toMatchObject({ code: 'preview-changed' });
    expect(await f.setup.preview(v)).toMatchObject({ deploymentEnabled: true, activationFlagChanged: false });
  });
  it('reports expiry and rotated credentials explicitly rather than healthy/readiness success', async () => {
    const f = fixture(); await f.submit(); f.setNow(START + 70_000); const view = await f.setup.status(); expect(view.reviewState).toBe('expired'); expect(view.profiles[0].reviewState).toBe('expired');
    f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'rotated-synthetic-secret' }); expect((await f.setup.status()).profiles[0]).toMatchObject({ credentialAssociated: false, reviewState: 'invalid' });
    expect(f.docs.get(gatewayAccountFencePath('glm', ['canonical-account-one'])).accountScopeIds).toEqual(['canonical-account-one']);
  });
});

describe('reviewed capability operation enrollment', () => {
  function embedding(): GatewaySetupSubmission {
    return { ...gatewayReviewFixture(), provider: 'VERTEX', modelId: 'text-embedding-004', canonicalModelId: 'vertex004', profileId: 'embedding-profile',
      canonicalAccountId: 'my-project', credentialEnv: 'ADC', billing: 'metered', policyKeys: ['professional:teacher_ai'], processingRegions: ['us-central1'],
      maxInputTokens: 2048, maxOutputTokens: 1, maxContextTokens: 2049,
      operation: { kind: 'embedding', project: 'my-project', location: 'us-central1', credentialPrincipal: 'runtime@my-project.iam.gserviceaccount.com', maxInputBytes: 4096, maxNanoUsdPerCharacter: 25 } };
  }
  function grounding(): GatewaySetupSubmission {
    return { ...gatewayReviewFixture(), provider: 'BRAVE', modelId: 'brave-search-v1', canonicalModelId: 'brave-search', profileId: 'grounding-profile',
      billing: 'metered', maxInputTokens: 1, maxOutputTokens: 1, maxContextTokens: 2, localTokensPerMinute: 30,
      operation: { kind: 'grounding-search', maxQueryBytes: 1000, maxResults: 5, requestNanoUsd: 5_000_000 } };
  }
  it('enrolls exact Vertex vector identity with character rates and project-scoped token pressure, no credentials or budget writes', async () => {
    const f = fixture(); f.setEnv({ GOOGLE_CLOUD_PROJECT: 'my-project', INFERENCE_GATEWAY_VERTEX_PRINCIPAL: 'runtime@my-project.iam.gserviceaccount.com' });
    const v = embedding(); const preview = await f.setup.preview(v);
    expect(preview).toMatchObject({ policyKeys: ['professional:teacher_ai:embedding'], operationKind: 'embedding', quotaMeter: 'tokens/minute', paidAuthority: 'missing' });
    await f.setup.submit(v, preview.previewBinding, 'admin'); const catalog = f.docs.get(GATEWAY_CATALOG_PATH);
    expect(catalog.profiles[0].transport).toMatchObject({ kind: 'embedding', provider: 'VERTEX', model: 'text-embedding-004', rateCard: { maxNanoUsdPerCharacter: 25 } });
    expect(catalog.profiles[0].transport).not.toHaveProperty('credentialEnv');
    expect(catalog.profiles[0].profile.capabilities).toEqual([{ kind: 'embedding', maxInputTokens: 2048, dimensions: 768, vectorSpaceId: 'vertex:text-embedding-004:default-task:trim-v1:768' }]);
    expect(catalog.profiles[0].profile.quotaDimensions[0]).toMatchObject({ scope: { kind: 'project', id: 'my-project' }, meter: 'tokens/minute' });
    expect(f.writes).not.toContain('free_chat_chain/paid_budget_policy');
    expect((await f.setup.status()).profiles[0].credentialAssociated).toBe(true);
  });
  it.each(['embedding', 'grounding'] as const)('real issuer and planner consume enrolled %s operation with the shared paid pool', async kind => {
    const f = fixture(); const v = kind === 'embedding' ? embedding() : grounding();
    if (kind === 'embedding') f.setEnv({ GOOGLE_CLOUD_PROJECT: 'my-project', INFERENCE_GATEWAY_VERTEX_PRINCIPAL: 'runtime@my-project.iam.gserviceaccount.com' });
    await f.submit(v); f.docs.set('free_chat_chain/paid_budget_policy', { kind: 'paid_budget_policy', version: 1, revision: 1, capNanoUsd: 10_000_000_000, updatedAt: START - 100, source: 'admin' });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(START);
    vi.stubEnv('INFERENCE_GATEWAY_TEST_KEY', 'synthetic-never-live-secret');
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'my-project'); vi.stubEnv('INFERENCE_GATEWAY_VERTEX_PRINCIPAL', 'runtime@my-project.iam.gserviceaccount.com');
    try {
      const payload = kind === 'embedding' ? { kind: 'embedding' as const, text: 'Remember this lesson' } : { kind: 'grounding-search' as const, query: 'weather today', maxResults: 5 };
      const key = { principalId: 'verified-user', tenantId: 'verified-user', logicalRequestId: `enrolled-${kind}`, payloadDigest: kind === 'embedding' ? gatewayEmbeddingPayloadDigest('Remember this lesson') : gatewayGroundingPayloadDigest({ kind: 'grounding-search', query: 'weather today', maxResults: 5 }) };
      const context = { principalId: key.principalId, tenantId: key.tenantId, surface: kind === 'embedding' ? 'professional' as const : 'chat' as const,
        policyKey: v.policyKeys[0] + (kind === 'embedding' ? ':embedding' : ':grounding'), qualityTier: 'clinical' as const,
        dataClass: 'health' as const, funding: 'platform-free-fallback' as const, mode: 'free-first-authorized-paid' as const, deadlineAtMs: START + 90_000 };
      const issuer = new GatewayAuthorityStore(f.db, context, key, payload, false);
      await issuer.issue(); const snapshot = await issuer.readTrusted(key);
      expect(snapshot.candidates).toHaveLength(1);
      const plan = planInference({ ...snapshot, authority: issuer.evidence, nowMs: START });
      expect(plan).toMatchObject({ kind: 'plan', profileId: v.profileId });
      if (plan.kind !== 'plan') throw new Error('Enrolled operation is not eligible');
      const ledger = new FirestoreInferenceLedger(f.db, { now: () => START, principal: { principalId: key.principalId, tenantId: key.tenantId }, platformScope: { id: 'platform-free-fallback', ownerId: 'platform-owner' }, adminEmails: () => [], requireConfigurationBinding: true });
      const intent = admissionIntentFor(key, snapshot, plan); const held = await ledger.reserve(intent);
      expect(held.kind).toBe('held');
      if (held.kind !== 'held') throw new Error('Enrolled operation reserve failed');
      const claimed = await ledger.claim(held.reservation, intent, 0);
      expect(claimed.kind).toBe('claimed');
      expect(f.docs.get(gatewayLedgerPath('attempt', intent.binding.physicalAttemptId))).toMatchObject({ phase: 'claimed', heldNanoUsd: kind === 'embedding' ? Buffer.byteLength('Remember this lesson') * 25 : 5000000 });
      expect(snapshot.budget?.budgetScopeId).toBe('platform-free-fallback');
    } finally { clock.mockRestore(); vi.unstubAllEnvs(); }
  });
  it('does not enroll an ADC principal merely because a project name was supplied', async () => {
    const f = fixture(); f.setEnv({ GOOGLE_CLOUD_PROJECT: 'my-project' });
    await expect(f.submit(embedding())).rejects.toMatchObject({ code: 'credential-unavailable' }); expect(f.writes).toHaveLength(0);
  });
  it('enrolls Brave one-request price and request quota rather than token or invented monthly-credit accounting', async () => {
    const f = fixture(); const v = grounding(); await f.submit(v); const catalog = f.docs.get(GATEWAY_CATALOG_PATH);
    expect(catalog.profiles[0].profile.quotaDimensions[0].meter).toBe('requests/minute');
    expect(catalog.profiles[0].profile.charging).toBe('metered');
    expect(catalog.profiles[0].transport).toMatchObject({ kind: 'grounding-search', rateCard: { requestNanoUsd: 5_000_000 } });
    expect(catalog.policies['chat:text:grounding']).toMatchObject({ operation: { kind: 'grounding-search', maxResults: 5 }, logicalLimitNanoUsd: 5_000_000 });
    expect(catalog.policies['chat:text']).toBeUndefined();
  });
  it('enrolls GLM vision without claiming PDF or image-generation support', async () => {
    const f = fixture(); const v: GatewaySetupSubmission = { ...gatewayReviewFixture(), modelId: 'glm-4.6v-flash', canonicalModelId: 'glm46v',
      operation: { kind: 'vision-pdf', maxImages: 2, maxPdfPages: 0, maxAttachmentBytes: 1000000, maxImageDimension: 2048 } };
    await f.submit(v); const catalog = f.docs.get(GATEWAY_CATALOG_PATH);
    expect(catalog.profiles[0].profile.adapterId).toBe('gateway-vision-v1');
    expect(catalog.profiles[0].profile.capabilities[0]).toMatchObject({ kind: 'vision-pdf', maxPdfPages: 0, formats: ['image/png', 'image/jpeg'] });
    expect(catalog.policies['chat:text:vision-image'].surface).toBe('chat');
  });
  it.each(['cheap', 'free-credit', 'wrong-model', 'client-policy', 'raw-secret'])('rejects contradictory grounding review %s without writes', async kind => {
    const f = fixture(); const v = grounding();
    if (kind === 'cheap') (v.operation as any).requestNanoUsd = 1;
    if (kind === 'free-credit') v.billing = 'intrinsic-zero';
    if (kind === 'wrong-model') v.modelId = 'brave-answers';
    if (kind === 'client-policy') v.policyKeys = ['chat:text:grounding'];
    if (kind === 'raw-secret') (v.operation as any).apiKey = 'synthetic-secret';
    await expect(f.submit(v)).rejects.toMatchObject({ code: 'invalid-review' }); expect(f.writes).toHaveLength(0);
  });
});

it('keeps non-text operation evidence out of text routing policy and forbids operation changes under an existing profile identity', async () => {
 const f = fixture(); await f.submit();
 const changed: GatewaySetupSubmission = { ...gatewayReviewFixture(), operationId: 'vision-update', expectedCatalogRevision: 'operation-one', modelId: 'glm-4.6v-flash', canonicalModelId: 'glm46v',
   operation: { kind: 'vision-pdf', maxImages: 1, maxPdfPages: 0, maxAttachmentBytes: 100000, maxImageDimension: 1000 } };
 await expect(f.submit(changed)).rejects.toMatchObject({ code: 'conflict' });
 expect(f.docs.get(GATEWAY_CATALOG_PATH).policies['chat:text:vision-image']).toBeUndefined();
 expect(f.docs.get(GATEWAY_CATALOG_PATH).policies['chat:text']).not.toHaveProperty('operation');
});

describe('reviewed paid Gemini PDF maximum reservation', () => {
 function pdf(pro = false): GatewaySetupSubmission {
   return { ...gatewayReviewFixture(), provider: 'GEMINI', modelId: pro ? 'gemini-2.5-pro' : 'gemini-2.5-flash', canonicalModelId: pro ? 'gemini25pro' : 'gemini25flash',
     billing: 'metered', maxInputTokens: 1048576, maxOutputTokens: 8192, maxContextTokens: 1056768, localTokensPerMinute: 2_000_000,
     inputNanoUsdPerMillion: pro ? 2_500_000_000 : 300_000_000, outputNanoUsdPerMillion: pro ? 15_000_000_000 : 2_500_000_000,
     operation: { kind: 'vision-pdf', maxImages: 2, maxPdfPages: 1000, maxAttachmentBytes: 5_000_000, maxImageDimension: 6000 } };
 }
 it.each([false, true])('prices full context at the reviewed maximum band (Pro=%s), never a guessed page count', async pro => {
   const f = fixture(); const v = pdf(pro); const preview = await f.setup.preview(v);
   const maximum = pro ? 2_744_320_000 : 335_052_800;
   expect(preview).toMatchObject({ maximumOperationNanoUsd: maximum, operationKind: 'vision-pdf', policyKeys: ['chat:text:vision-pdf'], paidAuthority: 'missing' });
   await f.setup.submit(v, preview.previewBinding, 'admin'); const catalog = f.docs.get(GATEWAY_CATALOG_PATH);
   expect(catalog.policies['chat:text:vision-pdf']).toMatchObject({ maxInputTokens: 1048576, logicalLimitNanoUsd: 2_744_320_000, operation: { maxPdfPages: 1000, formats: ['image/png', 'image/jpeg', 'application/pdf'] } });
   expect(catalog.profiles[0].profile.charging).toBe('metered'); expect(f.docs.has('free_chat_chain/paid_budget_policy')).toBe(false);
 });
 it.each([false, true])('enrolls GLM images and Gemini PDF in either order (PDF first=%s)', async pdfFirst => {
   const f = fixture(); const image: GatewaySetupSubmission = { ...gatewayReviewFixture(), profileId: 'image-profile', modelId: 'glm-4.6v-flash', canonicalModelId: 'glm46v', operation: { kind: 'vision-pdf', maxImages: 2, maxPdfPages: 0, maxAttachmentBytes: 1000000, maxImageDimension: 2048 } };
   const document = { ...pdf(), profileId: 'pdf-profile', credentialEnv: 'INFERENCE_GATEWAY_GEMINI_KEY' };
   f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'synthetic-never-live-secret', INFERENCE_GATEWAY_GEMINI_KEY: 'synthetic-gemini-secret' });
   const entries = pdfFirst ? [document, image] : [image, document];
   for (const [i, v] of entries.entries()) await f.submit({ ...v, operationId: `media-${i}`, expectedCatalogRevision: i ? 'media-0' : null });
   const catalog = f.docs.get(GATEWAY_CATALOG_PATH);
   expect(catalog.profiles).toHaveLength(2);
   expect(catalog.policies['chat:text:vision-image']).toMatchObject({ maxInputTokens: 4096, operation: { maxPdfPages: 0 } });
   expect(catalog.policies['chat:text:vision-pdf']).toMatchObject({ maxInputTokens: 1048576, logicalLimitNanoUsd: 2744320000, operation: { maxPdfPages: 1000 } });
   f.docs.set('free_chat_chain/paid_budget_policy', { kind: 'paid_budget_policy', version: 1, revision: 1, capNanoUsd: 10000000000, updatedAt: START - 100, source: 'admin' });
   const clock = vi.spyOn(Date, 'now').mockReturnValue(START);
   vi.stubEnv('INFERENCE_GATEWAY_TEST_KEY', 'synthetic-never-live-secret'); vi.stubEnv('INFERENCE_GATEWAY_GEMINI_KEY', 'synthetic-gemini-secret');
   try {
     const png = Buffer.alloc(33); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(13,8); png.write('IHDR',12); png.writeUInt32BE(1,16); png.writeUInt32BE(1,20);
     for (const isPdf of [false, true]) {
       const payload = { kind: 'vision-pdf' as const, prompt: 'Describe this', streaming: false, attachments: [{ mimeType: isPdf ? 'application/pdf' as const : 'image/png' as const, data: (isPdf ? Buffer.from('%PDF-1.7\n%%EOF') : png).toString('base64') }] };
       const key = { principalId: 'media-user', tenantId: 'media-user', logicalRequestId: `media-${isPdf}`, payloadDigest: gatewayVisionPayloadDigest(payload) };
       const context = { principalId: key.principalId, tenantId: key.tenantId, surface: 'chat' as const, policyKey: `chat:text:vision-${isPdf ? 'pdf' : 'image'}`, qualityTier: 'clinical' as const, dataClass: 'health' as const, funding: 'platform-free-fallback' as const, mode: 'free-first-authorized-paid' as const, deadlineAtMs: START + 90000 };
       const issuer = new GatewayAuthorityStore(f.db, context, key, payload, false); await issuer.issue(); const snapshot = await issuer.readTrusted(key);
       const plan = planInference({ ...snapshot, authority: issuer.evidence, nowMs: START });
       expect(plan).toMatchObject({ kind: 'plan', profileId: isPdf ? 'pdf-profile' : 'image-profile' });
       if (plan.kind !== 'plan') throw new Error('Media plan unavailable');
       const ledger = new FirestoreInferenceLedger(f.db, { now: () => START, principal: { principalId: key.principalId, tenantId: key.tenantId }, platformScope: { id: 'platform-free-fallback', ownerId: 'platform-owner' }, adminEmails: () => [], requireConfigurationBinding: true });
       const intent = admissionIntentFor(key, snapshot, plan); const held = await ledger.reserve(intent); expect(held.kind).toBe('held');
       if (held.kind !== 'held') throw new Error('Media reservation failed');
       expect((await ledger.claim(held.reservation, intent, 0)).kind).toBe('claimed');
       expect(f.docs.get(gatewayLedgerPath('attempt', intent.binding.physicalAttemptId)).heldNanoUsd).toBe(isPdf ? 335052800 : 0);
     }
   } finally { clock.mockRestore(); vi.unstubAllEnvs(); }
 });
 it.each([false, true])('enrolls Flash and Pro PDFs in either order without replacing shared policy (Pro first=%s)', async proFirst => {
   const f = fixture();
   for (const [i, pro] of [proFirst, !proFirst].entries()) await f.submit({ ...pdf(pro), profileId: pro ? 'pro-pdf' : 'flash-pdf', operationId: `pdf-${i}`, expectedCatalogRevision: i ? 'pdf-0' : null });
   const catalog = f.docs.get(GATEWAY_CATALOG_PATH);
   expect(catalog.profiles).toHaveLength(2); expect(Object.keys(catalog.policies)).toEqual(['chat:text:vision-pdf']);
   expect(catalog.policies['chat:text:vision-pdf'].logicalLimitNanoUsd).toBe(2744320000);
   expect(catalog.profiles.find((p: any) => p.profile.id === 'flash-pdf').transport.rateCard.inputNanoUsdPerMillion).toBe(300000000);
   expect(catalog.profiles.find((p: any) => p.profile.id === 'pro-pdf').transport.rateCard.inputNanoUsdPerMillion).toBe(2500000000);
 });
 it.each([false, true])('enrolls a reviewed paid image fallback beside GLM in either order (paid first=%s)', async paidFirst => {
   const f = fixture();
   const image: GatewaySetupSubmission = { ...gatewayReviewFixture(), profileId: 'free-image', modelId: 'glm-4.6v-flash', canonicalModelId: 'glm46v', operation: { kind: 'vision-pdf', maxImages: 2, maxPdfPages: 0, maxAttachmentBytes: 1000000, maxImageDimension: 2048 } };
   const paid: GatewaySetupSubmission = { ...pdf(), profileId: 'paid-image', maxInputTokens: image.maxInputTokens, maxOutputTokens: image.maxOutputTokens, maxContextTokens: 1048576 + image.maxOutputTokens, credentialEnv: 'INFERENCE_GATEWAY_GEMINI_KEY', operation: image.operation };
   f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'synthetic-never-live-secret', INFERENCE_GATEWAY_GEMINI_KEY: 'synthetic-gemini-secret' });
   for (const [i,v] of (paidFirst ? [paid,image] : [image,paid]).entries()) await f.submit({ ...v, operationId: `image-fallback-${i}`, expectedCatalogRevision: i ? 'image-fallback-0' : null });
   const catalog = f.docs.get(GATEWAY_CATALOG_PATH);
   expect(Object.keys(catalog.policies)).toEqual(['chat:text:vision-image']);
   expect(catalog.policies['chat:text:vision-image'].maxInputTokens).toBe(image.maxInputTokens);
   expect(catalog.policies['chat:text:vision-image'].logicalLimitNanoUsd).toBe(1048576 * 2500 + image.maxOutputTokens * 15000);
   expect(catalog.profiles.find((p: any) => p.profile.id === 'paid-image').profile.capabilities[0].maxInputTokens).toBe(1048576);
   expect(catalog.profiles.find((p: any) => p.profile.id === 'free-image').profile.capabilities[0].maxInputTokens).toBe(image.maxInputTokens);
 });
 it.each(['free', 'short-band', 'estimated-input', 'imaginary-pages', 'vertex-door'])('rejects %s PDF review without saving', async variant => {
   const f = fixture(); const v = pdf(true);
   if (variant === 'free') v.billing = 'provider-hard-stop';
   if (variant === 'short-band') v.inputNanoUsdPerMillion = 1_250_000_000;
   if (variant === 'estimated-input') v.maxInputTokens = 4096;
   if (variant === 'imaginary-pages') (v.operation as any).maxPdfPages = 1;
   if (variant === 'vertex-door') v.provider = 'VERTEX';
   await expect(f.submit(v)).rejects.toMatchObject({ code: 'invalid-review' }); expect(f.writes).toHaveLength(0);
 });
});

describe('explicit audited health recovery leaves financial authority untouched', () => {
 const renewal = () => ({ ...gatewayReviewFixture(), operationId: 'health-recovery', expectedCatalogRevision: 'operation-one', recoverHealth: true });
 it('requires an exact current preview and records recovery without changing money or held quota', async () => {
  const f = fixture(); await f.submit();
  const path = gatewayAccountCooldownPath('glm', ['canonical-account-one']);
  f.docs.set(path, { kind: 'gateway_account_cooldown', version: 1, untilMs: Number.MAX_SAFE_INTEGER, reason: 'cooldown-unavailable' });
  const paid = { kind: 'sentinel-money', held: 123 }; f.docs.set('free_chat_chain/paid_day_sentinel', paid);
  const before = structuredClone([...f.docs].filter(([p]) => p.includes('quota-state') || p.includes('paid_')));
  const v = renewal(); const preview = await f.setup.preview(v); expect(preview.healthRecoveryRecords).toBe(1);
  expect(f.docs.get(path).untilMs).toBe(Number.MAX_SAFE_INTEGER);
  await f.setup.submit(v, preview.previewBinding, 'verified-admin');
  expect(f.docs.get(path).untilMs).toBe(0);
  expect([...f.docs].filter(([p]) => p.includes('quota-state') || p.includes('paid_'))).toEqual(before);
  expect(f.docs.get(gatewaySetupAuditPath(v.operationId)).healthRecovery).toEqual([{ kind: 'gateway_account_cooldown', previousUntilMs: Number.MAX_SAFE_INTEGER }]);
  const writes = f.writes.length; await f.setup.submit(v, preview.previewBinding, 'verified-admin'); expect(f.writes.length).toBe(writes);
 });
 it('rejects a new health observation after preview instead of clearing it', async () => {
  const f = fixture(); await f.submit(); const path = gatewayAccountCooldownPath('glm', ['canonical-account-one']);
  f.docs.set(path, { kind: 'gateway_account_cooldown', version: 1, untilMs: START + 100 });
  const v = renewal(); const preview = await f.setup.preview(v);
  f.docs.set(path, { kind: 'gateway_account_cooldown', version: 1, untilMs: START + 500 });
  await expect(f.setup.submit(v, preview.previewBinding, 'verified-admin')).rejects.toThrow();
  expect(f.docs.get(path).untilMs).toBe(START + 500);
 });
 it('does not recover an unreviewed profile or a different credential generation', async () => {
  const f = fixture(); await expect(f.setup.preview({ ...gatewayReviewFixture(), recoverHealth: true })).rejects.toThrow();
  await f.submit(); const path = gatewayCredentialHealthPath('glm', ['canonical-account-one'], gatewayTextCredentialBinding('synthetic-never-live-secret'));
  f.docs.set(path, { kind: 'gateway_credential_health', version: 1, untilMs: START + 100, credentialBinding: 'different' });
  await expect(f.setup.preview(renewal())).rejects.toThrow();
 });
});

it('reports canary audience count without exposing UIDs or treating rollout controls as credentials', async () => {
  const f = fixture(); f.setOn(); f.setEnv({ INFERENCE_GATEWAY_TEST_KEY: 'synthetic-never-live-secret', INFERENCE_GATEWAY_ROLLOUT_MODE: 'canary', INFERENCE_GATEWAY_CANARY_UIDS: 'private-owner-uid,second-private-uid' });
  const status = await f.setup.status(); expect(status.rollout).toEqual({ mode: 'canary', canaryCount: 2 });
  expect(status.credentialEnvironments).toEqual(['INFERENCE_GATEWAY_TEST_KEY']);
  expect(JSON.stringify(status)).not.toContain('private-owner-uid'); expect(JSON.stringify(status)).not.toContain('second-private-uid');
  f.setEnv({ INFERENCE_GATEWAY_ROLLOUT_MODE: 'bad' }); expect((await f.setup.status()).rollout).toEqual({ mode: 'invalid', canaryCount: 0 });
  f.setEnv({}); expect((await f.setup.status()).rollout).toEqual({ mode: 'canary', canaryCount: 0 }); expect(f.writes).toEqual([]);
});

it.each(['all', 'other-owner'])('rejects a setup preview when audience changes to %s before save', async change => {
  const f = fixture(); f.setOn(); const env = { INFERENCE_GATEWAY_TEST_KEY: 'synthetic-never-live-secret', INFERENCE_GATEWAY_ROLLOUT_MODE: 'canary', INFERENCE_GATEWAY_CANARY_UIDS: 'owner' };
  f.setEnv(env); const submission = gatewayReviewFixture(); const preview = await f.setup.preview(submission);
  f.setEnv({ ...env, ...(change === 'all' ? { INFERENCE_GATEWAY_ROLLOUT_MODE: 'all' } : { INFERENCE_GATEWAY_CANARY_UIDS: change }) });
  await expect(f.setup.submit(submission, preview.previewBinding, 'verified-admin')).rejects.toMatchObject({ code: 'preview-changed' });
  expect(f.writes).toEqual([]);
});
it.each([null, {}, [], { mode: 'all', canaryCount: -1 }, { mode: 'unknown', canaryCount: 0 }])('malformed cohort status returns false without throwing', async rollout => {
  const f = fixture(); expect(isGatewaySetupStatus({ ...await f.setup.status(), rollout })).toBe(false);
});
