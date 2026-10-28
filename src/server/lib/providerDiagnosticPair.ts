import type { DiagnosticProvider } from '../../shared/providerDiagnostics';
import type { DiagnosticBudgetReview, DiagnosticPairAuthority } from './providerDiagnosticStore';
import { DiagnosticEvidenceMissing, diagnosticBillingLimits } from './providerDiagnosticEvidence';
import { readDiagnosticCatalog } from './providerDiagnosticPreflight';
import { usdInrRateHealth } from './UsdInrRate';

/** Owner approval 2026-10-28: a NEW ₹100 total, exactly one call per provider.
 * This does not reconcile, release or increase the historical ₹2000 benchmark.
 */
export const DIAGNOSTIC_PAIR_BUDGET_PAISE = 10000;
export const DIAGNOSTIC_PAIR_DISCOUNT = 0;
const SUPPLY = 'https://api.cheaperinference.com/v1/models/supply';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
function nanoRate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,9})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const n = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  return n >= 0n && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}
export interface DiagnosticPairInputs {
  catalog: typeof readDiagnosticCatalog;
  fetcher: typeof fetch;
  fx: typeof usdInrRateHealth;
  now(): number;
}
/** Read-only preflight. No arbitrary URL, credential issuer, seed record or inference call. */
export function diagnosticPairAuthority(env = process.env, inputs: DiagnosticPairInputs = {
  catalog: readDiagnosticCatalog, fetcher: fetch, fx: usdInrRateHealth, now: Date.now,
}): DiagnosticPairAuthority {
  const prepared = new Map<string, Promise<DiagnosticBudgetReview>>();
  const load = async (provider: DiagnosticProvider, model: string): Promise<DiagnosticBudgetReview> => {
    const catalog = await inputs.catalog(provider, model, env, inputs.fetcher);
    if (catalog.status !== 'observed') throw new DiagnosticEvidenceMissing([`${provider}.catalog.${catalog.reason ?? 'unavailable'}`]);
    if (provider === 'cheaperinference' && model !== 'beam') throw new DiagnosticEvidenceMissing(['cheaperinference.modelLimits: current configured model needs its published context/output limits.']);
    const key = env.CHEAPERINFERENCE_API_KEY?.trim();
    if (provider === 'cheaperinference' && !key) throw new DiagnosticEvidenceMissing(['cheaperinference.configuration']);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
    let raw: Record<string, unknown>;
    try {
      const response = await inputs.fetcher(provider === 'surplus' ? 'https://api.surplusintelligence.ai/v1/prices' : `${SUPPLY}?model=${encodeURIComponent(model)}&min_discount_percent=${DIAGNOSTIC_PAIR_DISCOUNT}`, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(provider === 'cheaperinference' ? { Authorization: `Bearer ${key}` } : {}) },
      });
      if (!response.ok) throw new DiagnosticEvidenceMissing([`${provider}.pricing.http_${response.status}`]);
      if (!response.body) throw new Error('body');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
        if (size > 2000000) throw new Error('size'); chunks.push(chunk.value); } }
      finally { await reader.cancel().catch(() => {}); }
      raw = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (error) {
      if (error instanceof DiagnosticEvidenceMissing) throw error;
      throw new DiagnosticEvidenceMissing([`${provider}.pricing.${controller.signal.aborted ? 'timeout' : 'unavailable'}`]);
    } finally { clearTimeout(timeout); }
    let input: number | null = null, output: number | null = null;
    // Exact Beam model card, checked 2026-10-28: https://www.cheaperinference.com/models/beam
    // 1,048,576 context; chat max_tokens and reasoning low supported. Never apply to other aliases.
    let contextTokens = Math.max(1048576, catalog.contextTokens ?? 0);
    if (provider === 'surplus') {
      contextTokens = catalog.contextTokens ?? 0;
      if (catalog.textOutput !== true || !catalog.maxCompletionTokens || catalog.maxCompletionTokens < 256) throw new DiagnosticEvidenceMissing(['surplus.modelLimits: text output and a 256-token output limit must be supported.']);
      const updated = typeof raw.updated_at === 'string' ? Date.parse(raw.updated_at) : raw.updated_at;
      if (typeof updated !== 'number' || !Number.isSafeInteger(updated) || updated > inputs.now() || inputs.now() - updated > 600000) throw new DiagnosticEvidenceMissing(['surplus.referencePricing: reference rates are missing a recent publication time.']);
      const models = Array.isArray(raw.models) ? raw.models.map(object).filter(row => row.model === model) : [];
      const rows = models.length === 1 && Array.isArray(models[0].providers) ? models[0].providers.map(object) : [];
      const inputRates: number[] = [], outputRates: number[] = [];
      for (const row of rows) {
        const rates = object(row.pricing);
        // Full reference rates across ALL returned providers; never best-offer or min90 discount.
        for (const [dimension, target] of [['input', inputRates], ['output', outputRates], ['cacheRead', inputRates], ['cacheWrite', inputRates], ['reasoning', outputRates]] as const) {
          if (rates[dimension] === undefined && !['input', 'output'].includes(dimension)) continue;
          const n = nanoRate(typeof rates[dimension] === 'number' ? String(rates[dimension]) : rates[dimension]);
          if (n === null || n === 0 && ['input', 'output'].includes(dimension)) throw new DiagnosticEvidenceMissing(['surplus.referencePricing: incomplete applicable token rates.']);
          target.push(n);
        }
      }
      if (!contextTokens || !rows.length || !inputRates.length || !outputRates.length) throw new DiagnosticEvidenceMissing(['surplus.referencePricing: model context or current reference rates unavailable.']);
      input = Math.max(...inputRates); output = Math.max(...outputRates);
    } else {
      input = nanoRate(raw.max_input_per_million); output = nanoRate(raw.max_output_per_million);
      if (raw.model !== model || raw.min_discount_percent !== DIAGNOSTIC_PAIR_DISCOUNT || input === null || output === null || input === 0 || output === 0
        || !Number.isSafeInteger(raw.candidate_count) || Number(raw.candidate_count) <= 0) {
        throw new DiagnosticEvidenceMissing(['cheaperinference.supply: no valid current rate-ceiling quote and eligible supply.']);
      }
    }
    const now = inputs.now(), fx = inputs.fx();
    if (fx.updatedAt <= 0 || fx.updatedAt > now || now - fx.updatedAt > 7200000 || !Number.isFinite(fx.rate) || fx.rate < 30 || fx.rate > 300 || fx.heldCandidate !== null) {
      throw new DiagnosticEvidenceMissing(['billing.exchangeRate: current verified billing exchange rate unavailable.']);
    }
    // A 100% FX/fee reserve buffer is a conservative planning provision, NOT a
    // provider monetary guarantee or an actual INR supplier receipt.
    const conversion = Math.ceil(fx.rate * 200);
    const rate = { model, contextTokens, inputPerMillionNanoUsd: input, outputPerMillionNanoUsd: output,
      rateEvidenceRef: provider === 'surplus' ? 'surplus-undiscounted-reference-estimate' : 'cheaperinference-supply-current' };
    return { version: 1, expiresAt: now + 30000, priorCommittedPaise: 0, priorEvidenceRef: 'separate-owner-authorized-two-tests',
      totalBudgetPaise: DIAGNOSTIC_PAIR_BUDGET_PAISE, allInPaisePerUsdCeiling: conversion,
      monthlyCapNanoUsd: diagnosticBillingLimits(env).monthly,
      providers: { surplus: rate, cheaperinference: rate } };
  };
  return { review(provider, model) {
    const key = `${provider}:${model}`;
    let value = prepared.get(key); if (!value) { value = load(provider, model); prepared.set(key, value); }
    return value;
  } };
}
