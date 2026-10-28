import type { DiagnosticBudgetReview } from './providerDiagnosticStore';
import type { DiagnosticProvider } from '../../shared/providerDiagnostics';
import { SURPLUS_BASE_URL } from './surplusClient';
import { CHEAPERINFERENCE_BASE_URL } from './cheaperInferencePolicy';
import { freeChainConfig } from '../AI/FreeChain/config';

export const DIAGNOSTIC_EVIDENCE_ROOT = 'free_chat_chain/provider_diagnostics/evidence';
export class DiagnosticEvidenceMissing extends Error {
  readonly reason = 'budget_evidence_unavailable';
  constructor(readonly fields: string[]) { super('Diagnostic evidence unavailable'); }
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const ref = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(v);
export function diagnosticBillingLimits(env = process.env) {
  const config = freeChainConfig(env);
  return { daily: config.paidCapNanoUsd, monthly: config.features.monthlyCapNanoUsd };
}
export function diagnosticEvidenceBinding(provider: DiagnosticProvider, env = process.env) {
  // Deployment revisions change with secret/configuration releases; never key hashes.
  return { deploymentRevision: env.K_REVISION?.trim() || '', endpoint: provider === 'surplus' ? (env.SURPLUS_BASE_URL?.trim() || SURPLUS_BASE_URL).replace(/\/$/, '') : CHEAPERINFERENCE_BASE_URL };
}
/** Reads only server-owned evidence records, within the admission transaction. No seed,
 * credential read, external fetch, wallet charge inference or estimate-to-receipt conversion. */
export async function readDiagnosticEvidence(
  raw: unknown, provider: DiagnosticProvider, model: string, now: number,
  read: (path: string) => Promise<unknown>, binding = diagnosticEvidenceBinding(provider),
): Promise<DiagnosticBudgetReview> {
  const r = object(raw), p = object(object(r.providers)[provider]);
  const missing: string[] = [];
  const require = (ok: unknown, field: string) => { if (!ok) missing.push(field); };
  require(r.version === 1, 'review.version');
  require(integer(r.expiresAt) && Number(r.expiresAt) > now && Number(r.expiresAt) <= now + 86400000, 'review.expiresAt');
  require(integer(r.priorCommittedPaise), 'review.priorCommittedPaise');
  require(integer(r.totalBudgetPaise) && Number(r.totalBudgetPaise) > 0 && Number(r.totalBudgetPaise) <= 200000, 'review.totalBudgetPaise');
  require(integer(r.allInPaisePerUsdCeiling) && Number(r.allInPaisePerUsdCeiling) > 0, 'review.allInPaisePerUsdCeiling');
  require(integer(r.monthlyCapNanoUsd) && Number(r.monthlyCapNanoUsd) > 0, 'review.monthlyCapNanoUsd');
  require(ref(r.priorEvidenceRef), 'review.priorEvidenceRef');
  require(p.model === model, `providers.${provider}.model`);
  require(ref(p.rateEvidenceRef), `providers.${provider}.rateEvidenceRef`);
  require(integer(p.contextTokens) && Number(p.contextTokens) >= 2048 && Number(p.contextTokens) <= 2097152, `providers.${provider}.contextTokens`);
  for (const field of ['inputPerMillionNanoUsd', 'outputPerMillionNanoUsd']) require(integer(p[field]) && Number(p[field]) > 0, `providers.${provider}.${field}`);
  const prior = ref(r.priorEvidenceRef) ? object(await read(`${DIAGNOSTIC_EVIDENCE_ROOT}/${r.priorEvidenceRef}`)) : {};
  const tariff = ref(p.rateEvidenceRef) ? object(await read(`${DIAGNOSTIC_EVIDENCE_ROOT}/${p.rateEvidenceRef}`)) : {};
  for (const [name, value] of [['reconciliation', prior], ['tariff', tariff]] as const) {
    require(value.version === 1 && value.status === 'verified', `${name}.verifiedRecord`);
    require(ref(value.reviewId), `${name}.reviewId`);
    require(typeof value.artifactSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.artifactSha256), `${name}.artifactSha256`);
    require(integer(value.reviewedAt) && Number(value.reviewedAt) <= now && integer(value.expiresAt) && Number(value.expiresAt) >= Number(r.expiresAt) + 30000, `${name}.reviewWindow`);
  }
  require(prior.kind === 'benchmark-reconciliation' && prior.includesApiAndSandbox === true && prior.includesUnresolvedLiabilities === true, 'reconciliation.scope');
  require(integer(prior.committedPaise) && integer(prior.otherBenchmarkUpperBoundPaise) && Number(prior.committedPaise) + Number(prior.otherBenchmarkUpperBoundPaise) === r.priorCommittedPaise, 'reconciliation.committedPaise');
  require(integer(prior.concurrentLiabilityBoundThrough) && Number(prior.concurrentLiabilityBoundThrough) >= Number(r.expiresAt) + 30000 && prior.coversAllOtherBenchmarkDispatch === true && prior.coversAllOutstandingAuthorizedBenchmarkSpend === true, 'reconciliation.concurrentLiabilityBound');
  require(prior.allInPaisePerUsdCeiling === r.allInPaisePerUsdCeiling && prior.conversionIncludesFeesAndTaxes === true, 'reconciliation.conversionCeiling');
  require(tariff.kind === 'supplier-tariff' && tariff.provider === provider && tariff.model === model, 'tariff.providerModelBinding');
  require(tariff.credentialsPinnedToDeploymentRevision === true && ref(binding.deploymentRevision) && tariff.deploymentRevision === binding.deploymentRevision && tariff.endpoint === binding.endpoint, 'tariff.deploymentAccountBinding');
  require(tariff.ratesLockedForAdmittedRequest === true && tariff.ratesAreAllDimensionCeilings === true && tariff.coversAllServedModelVersions === true, 'tariff.allDimensionCeilings');
  require(tariff.accountSpecific === true && ref(tariff.accountReviewId), 'tariff.accountReviewId');
  require(tariff.currency === 'USD' && tariff.billingBasis === 'tokens-only' && tariff.additionalCharges === 'none' && tariff.outputCapIncludesReasoning === true, 'tariff.chargeDimensions');
  for (const field of ['contextTokens', 'inputPerMillionNanoUsd', 'outputPerMillionNanoUsd']) require(tariff[field] === p[field], `tariff.${field}`);
  let sourceOk = false;
  try { const u = new URL(String(tariff.sourceUrl)); sourceOk = u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash &&
    (provider === 'surplus' ? ['api.surplusintelligence.ai', 'surplusintelligence.ai', 'www.surplusintelligence.ai'] : ['api.cheaperinference.com', 'cheaperinference.com', 'www.cheaperinference.com']).includes(u.hostname); } catch { /* no raw URL escapes */ }
  require(sourceOk, 'tariff.officialSource');
  if (missing.length) throw new DiagnosticEvidenceMissing(missing);
  return raw as DiagnosticBudgetReview;
}
