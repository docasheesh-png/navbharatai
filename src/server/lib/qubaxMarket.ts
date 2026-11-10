import type { Firestore } from 'firebase-admin/firestore';
import { civilDayKey } from '../AI/FreeChain/quota';
import { PAID_BUDGET_TIME_ZONE } from '../AI/FreeChain/spendCap';
import { QUBAX_PRICE_FEED_DOCUMENT } from './qubaxPriceFeedStore';
import { validQubaxPriceSnapshot, type QubaxObservedPrice, type QubaxPriceSnapshot } from './qubaxPriceFeed';

/** Automatic health evidence. This is not the reviewed 100-sample catalog. */
export const QUBAX_PROBE_LEDGER_DOCUMENT = 'qubax_probe_ledger/active';
export const QUBAX_PROBE_TTL_MS = 24 * 60 * 60_000;
export const QUBAX_PROBE_REFRESH_MS = 6 * 60 * 60_000;
export const QUBAX_PROBE_MAX_LATENCY_MS = 10_000;
export const QUBAX_DEFAULT_REQUEST_USD = '0.02';
export const QUBAX_DEFAULT_PROBE_DAILY_USD = '0.10';
const LEDGER_KIND = 'qubax-probe-ledger-v1';
const usdPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export interface QubaxProbeSample { ok: boolean; latencyMs: number; atMs: number }
export interface QubaxProbeModel {
  attempts: number;
  successes: number;
  hindi: QubaxProbeSample | null;
  english: QubaxProbeSample | null;
}
export interface QubaxProbeLedger {
  kind: typeof LEDGER_KIND;
  day: string;
  spentNanoUsd: number;
  models: Record<string, QubaxProbeModel>;
}
export interface QubaxMarketChoice {
  modelId: string;
  inputNanoUsdPerMillion: number;
  outputNanoUsdPerMillion: number;
  officialInputNanoUsdPerMillion: number | null;
  officialOutputNanoUsdPerMillion: number | null;
  discountBps: number | null;
  contextTokens: number;
  successRateBps: number;
  maxLatencyMs: number;
  probedAtMs: number;
  expiresAtMs: number;
  /** True only when no model is 90% below the official price and the optional backup id is used. */
  backup: boolean;
}
export interface QubaxMarketPlan { eligible: QubaxMarketChoice[]; backup: QubaxMarketChoice | null }
export const QUBAX_TRIES_PER_TURN = 3;
export const QUBAX_SWITCH_DOCUMENT = 'qubax_model_switches/active';
export type QubaxModelOverride = { mode: 'auto' } | { mode: 'pinned'; modelId: string } | { mode: 'invalid' };

const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): value is number => integer(value) && (value as number) > 0;
const modelId = (value: string) => value.length > 0 && value.length <= 200 && !/[\s,]/.test(value);

export function nanoUsdToDecimal(nano: number): string {
  const whole = Math.trunc(nano / 1_000_000_000);
  const fraction = String(Math.abs(nano % 1_000_000_000)).padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
export function parseUsdCeilingNano(raw: string): number | null {
  if (!usdPattern.test(raw)) return null;
  const usd = Number(raw);
  const ceilingNanoUsd = Math.round(usd * 1_000_000_000);
  if (!(usd >= 0.000001) || usd > 1 || !Number.isSafeInteger(ceilingNanoUsd) || ceilingNanoUsd <= 0) return null;
  return ceilingNanoUsd;
}
/** Missing cap uses the built-in $0.02 reserve. An explicit invalid cap authorizes nothing. */
export function qubaxRequestCeilingNanoUsd(env: Record<string, string | undefined>): number | null {
  if (env.QUBAX_ENABLED !== '1' || !env.QUBAX_API_KEY?.trim()) return null;
  const raw = env.QUBAX_MAX_USD_PER_REQUEST?.trim() || QUBAX_DEFAULT_REQUEST_USD;
  return parseUsdCeilingNano(raw);
}
export function qubaxProbeDailyCapNanoUsd(env: Record<string, string | undefined>): number | null {
  const raw = env.QUBAX_PROBE_DAILY_CAP_USD?.trim() || QUBAX_DEFAULT_PROBE_DAILY_USD;
  return parseUsdCeilingNano(raw);
}
/** Absent means automatic. A present but unusable value does not fall back to another model. */
export function qubaxModelOverride(env: Record<string, string | undefined>): QubaxModelOverride {
  const raw = env.QUBAX_MODEL?.trim() ?? '';
  if (!raw) return { mode: 'auto' };
  return modelId(raw) ? { mode: 'pinned', modelId: raw } : { mode: 'invalid' };
}
function sample(value: unknown, now: number, requireOk: boolean): value is QubaxProbeSample {
  if (!value || typeof value !== 'object') return false;
  const row = value as QubaxProbeSample;
  return typeof row.ok === 'boolean' && (!requireOk || row.ok) && positive(row.latencyMs) && row.latencyMs <= QUBAX_PROBE_MAX_LATENCY_MS
    && integer(row.atMs) && row.atMs <= now && now - row.atMs <= QUBAX_PROBE_TTL_MS;
}
export function istProbeDay(now: number): string {
  return civilDayKey(now, PAID_BUDGET_TIME_ZONE);
}
export function validProbeLedger(value: unknown, now: number): QubaxProbeLedger | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as QubaxProbeLedger;
  if (row.kind !== LEDGER_KIND || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !integer(row.spentNanoUsd)) return null;
  if (!row.models || typeof row.models !== 'object' || Array.isArray(row.models)) return null;
  const models: Record<string, QubaxProbeModel> = {};
  for (const [id, model] of Object.entries(row.models)) {
    if (!modelId(id) || !model || typeof model !== 'object') return null;
    const entry = model as QubaxProbeModel;
    if (!integer(entry.attempts) || !integer(entry.successes) || entry.successes > entry.attempts || entry.attempts > 100) return null;
    if (entry.hindi !== null && !sample(entry.hindi, now, false)) return null;
    if (entry.english !== null && !sample(entry.english, now, false)) return null;
    models[id] = { attempts: entry.attempts, successes: entry.successes, hindi: entry.hindi, english: entry.english };
  }
  return { kind: LEDGER_KIND, day: row.day, spentNanoUsd: row.spentNanoUsd, models };
}
export function emptyProbeLedger(now: number): QubaxProbeLedger {
  return { kind: LEDGER_KIND, day: istProbeDay(now), spentNanoUsd: 0, models: {} };
}
function passing(model: QubaxProbeModel, now: number): { successRateBps: number; maxLatencyMs: number; probedAtMs: number } | null {
  if (!sample(model.hindi, now, true) || !sample(model.english, now, true) || model.successes < 2 || model.attempts < 2) return null;
  return { successRateBps: Math.floor(model.successes * 10_000 / model.attempts),
    maxLatencyMs: Math.max(model.hindi.latencyMs, model.english.latencyMs), probedAtMs: Math.min(model.hindi.atMs, model.english.atMs) };
}
function priced(row: QubaxObservedPrice): row is QubaxObservedPrice & { contextTokens: number; inputNanoUsd: number; outputNanoUsd: number } {
  return (row.modality === 'text' || row.modality === 'multimodal') && positive(row.contextTokens)
    && positive(row.inputNanoUsd) && positive(row.outputNanoUsd);
}
/** Official page label and the Qubax market id are the same model only after this exact normalization.
 * A context-length note is not a different model. A suffix, prefix or nearby name is. */
export function canonicalModelLabel(label: string): string {
  return label.toLowerCase().replace(/\s*\([^)]*context length\)\s*/gi, '').replace(/_/g, '-').replace(/[^a-z0-9.-]/g, '');
}
function atLeast90Cheaper(qubaxNano: number, officialNano: number): boolean {
  return officialNano > 0 && BigInt(qubaxNano) * 10n <= BigInt(officialNano);
}
function discountBps(qubaxNano: number, officialNano: number): number {
  return Number((BigInt(officialNano) - BigInt(qubaxNano)) * 10_000n / BigInt(officialNano));
}
/** Cheapest complete official band for that exact model. Qubax's own discount_pct is never read. */
export function officialRatesByModel(rows: QubaxObservedPrice[]): Map<string, { inputNanoUsd: number; outputNanoUsd: number }> {
  const rates = new Map<string, { inputNanoUsd: number; outputNanoUsd: number }>();
  for (const row of rows) {
    if (!positive(row.inputNanoUsd) || !positive(row.outputNanoUsd)) continue;
    const id = canonicalModelLabel(row.sourceModelLabel);
    if (!id) continue;
    const current = rates.get(id);
    if (!current || row.outputNanoUsd < current.outputNanoUsd || (row.outputNanoUsd === current.outputNanoUsd && row.inputNanoUsd < current.inputNanoUsd)) {
      rates.set(id, { inputNanoUsd: row.inputNanoUsd, outputNanoUsd: row.outputNanoUsd });
    }
  }
  return rates;
}
function choiceFor(row: QubaxObservedPrice & { contextTokens: number; inputNanoUsd: number; outputNanoUsd: number }, quality: NonNullable<ReturnType<typeof passing>>, official: { inputNanoUsd: number; outputNanoUsd: number } | null, expiresAtMs: number, backup: boolean): QubaxMarketChoice {
  const qualified = !!official && atLeast90Cheaper(row.inputNanoUsd, official.inputNanoUsd) && atLeast90Cheaper(row.outputNanoUsd, official.outputNanoUsd);
  return { modelId: row.sourceModelLabel, inputNanoUsdPerMillion: row.inputNanoUsd, outputNanoUsdPerMillion: row.outputNanoUsd,
    officialInputNanoUsdPerMillion: official?.inputNanoUsd ?? null, officialOutputNanoUsdPerMillion: official?.outputNanoUsd ?? null,
    discountBps: qualified && official ? Math.min(discountBps(row.inputNanoUsd, official.inputNanoUsd), discountBps(row.outputNanoUsd, official.outputNanoUsd)) : null,
    contextTokens: row.contextTokens, ...quality, expiresAtMs: Math.min(expiresAtMs, quality.probedAtMs + QUBAX_PROBE_TTL_MS), backup };
}
/** Eligible models are at least 90% below the official price of the same model. Rank is probe performance, never price. */
export function rankQubaxMarkets(input: {
  rows: QubaxObservedPrice[];
  officialRows: QubaxObservedPrice[];
  expiresAtMs: number;
  ledger: QubaxProbeLedger | null;
  now: number;
  override: Exclude<QubaxModelOverride, { mode: 'invalid' }>;
}): QubaxMarketPlan {
  const empty = { eligible: [], backup: null };
  if (!integer(input.now) || !integer(input.expiresAtMs) || input.expiresAtMs <= input.now || !input.ledger) return empty;
  const official = officialRatesByModel(input.officialRows);
  const seen = new Map<string, number>();
  for (const row of input.rows) if (priced(row)) seen.set(row.sourceModelLabel, (seen.get(row.sourceModelLabel) ?? 0) + 1);
  const eligible: QubaxMarketChoice[] = [];
  let backup: QubaxMarketChoice | null = null;
  for (const row of input.rows) {
    if (!priced(row) || seen.get(row.sourceModelLabel) !== 1) continue;
    const quality = passing(input.ledger.models[row.sourceModelLabel] ?? { attempts: 0, successes: 0, hindi: null, english: null }, input.now);
    if (!quality) continue;
    const rate = official.get(canonicalModelLabel(row.sourceModelLabel)) ?? null;
    const qualified = !!rate && atLeast90Cheaper(row.inputNanoUsd, rate.inputNanoUsd) && atLeast90Cheaper(row.outputNanoUsd, rate.outputNanoUsd);
    if (qualified) eligible.push(choiceFor(row, quality, rate, input.expiresAtMs, false));
    else if (input.override.mode === 'pinned' && row.sourceModelLabel === input.override.modelId) backup = choiceFor(row, quality, rate, input.expiresAtMs, true);
  }
  eligible.sort((a, b) => b.successRateBps - a.successRateBps || a.maxLatencyMs - b.maxLatencyMs || a.modelId.localeCompare(b.modelId));
  return { eligible, backup: eligible.length ? null : backup };
}
export function dueQubaxProbe(rows: QubaxObservedPrice[], officialRows: QubaxObservedPrice[], ledger: QubaxProbeLedger, now: number, pin: string | null = null): { modelId: string; language: 'hi' | 'en' } | null {
  const official = officialRatesByModel(officialRows);
  const candidates = rows.filter(row => priced(row) && (pin === row.sourceModelLabel || (() => {
    const rate = official.get(canonicalModelLabel(row.sourceModelLabel));
    return !!rate && atLeast90Cheaper(row.inputNanoUsd, rate.inputNanoUsd) && atLeast90Cheaper(row.outputNanoUsd, rate.outputNanoUsd);
  })()));
  const ranked = candidates.slice().sort((a, b) => {
    const age = (id: string) => Math.max(ledger.models[id]?.english?.atMs ?? 0, ledger.models[id]?.hindi?.atMs ?? 0);
    return age(a.sourceModelLabel) - age(b.sourceModelLabel) || a.sourceModelLabel.localeCompare(b.sourceModelLabel);
  });
  let fallback: { modelId: string; language: 'hi' | 'en' } | null = null;
  for (const row of ranked) {
    const model = ledger.models[row.sourceModelLabel];
    for (const language of ['english', 'hindi'] as const) {
      const latest = model?.[language] ?? null;
      const fresh = latest?.ok === true && integer(latest.atMs) && now - latest.atMs < QUBAX_PROBE_REFRESH_MS;
      if (fresh) continue;
      const due = { modelId: row.sourceModelLabel, language: language === 'hindi' ? 'hi' as const : 'en' as const };
      if (!latest) return due;
      fallback ??= due;
    }
  }
  return fallback;
}
export async function readQubaxMarketPlan(db: Pick<Firestore, 'doc'>, override: Exclude<QubaxModelOverride, { mode: 'invalid' }>, now = Date.now()): Promise<QubaxMarketPlan> {
  try {
    const [priceSnap, ledgerSnap] = await Promise.all([
      db.doc(QUBAX_PRICE_FEED_DOCUMENT).get(),
      db.doc(QUBAX_PROBE_LEDGER_DOCUMENT).get(),
    ]);
    const snapshot: unknown = priceSnap.data()?.snapshot;
    if (!validQubaxPriceSnapshot(snapshot, now)) return { eligible: [], backup: null };
    const sources = (snapshot as QubaxPriceSnapshot).sources;
    return rankQubaxMarkets({ rows: sources.find(s => s.source === 'qubax')?.rows ?? [],
      officialRows: sources.filter(s => s.source !== 'qubax').flatMap(s => s.rows),
      expiresAtMs: (snapshot as QubaxPriceSnapshot).expiresAtMs, ledger: validProbeLedger(ledgerSnap.data(), now), now, override });
  } catch { return { eligible: [], backup: null }; }
}
export interface QubaxSwitchEntry {
  atMs: number; fromModel: string | null; toModel: string; reason: string;
  qubaxInputNanoUsd: number; qubaxOutputNanoUsd: number;
  officialInputNanoUsd: number | null; officialOutputNanoUsd: number | null; discountBps: number | null; backup: boolean;
}
export function qubaxSwitchReason(previousId: string | null, next: QubaxMarketChoice, plan: QubaxMarketPlan, pricedIds: ReadonlySet<string>, probedIds: ReadonlySet<string>): string {
  if (next.backup) return 'backup-no-eligible';
  if (!previousId) return 'initial';
  if (previousId === next.modelId) return 'unchanged';
  if (!pricedIds.has(previousId) || !plan.eligible.some(row => row.modelId === previousId) && pricedIds.has(previousId) && probedIds.has(previousId)) return 'discount-below-90';
  if (!probedIds.has(previousId)) return 'probe-failed';
  return 'higher-performance';
}
export async function noteQubaxModelSwitch(db: Pick<Firestore, 'doc' | 'runTransaction'>, entry: QubaxSwitchEntry): Promise<void> {
  try {
    const ref = db.doc(QUBAX_SWITCH_DOCUMENT);
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as { currentModel?: string; entries?: QubaxSwitchEntry[] } | undefined;
      if (current?.currentModel === entry.toModel) return;
      tx.set(ref, { kind: 'qubax-model-switches-v1', currentModel: entry.toModel, entries: [entry, ...(current?.entries ?? [])].slice(0, 20) });
    });
  } catch { /* The answer does not wait on the switch log. */ }
  console.info('[QUBAX_SWITCH]', JSON.stringify({ from: entry.fromModel, to: entry.toModel, reason: entry.reason,
    qubaxInputNanoUsd: entry.qubaxInputNanoUsd, qubaxOutputNanoUsd: entry.qubaxOutputNanoUsd,
    officialInputNanoUsd: entry.officialInputNanoUsd, officialOutputNanoUsd: entry.officialOutputNanoUsd, discountBps: entry.discountBps }));
}
