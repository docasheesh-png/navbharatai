// Shared live health for every provider the existing ladders already call.
//
// Phase 1 of the traffic manager (owner t404u). It does not choose a rung and it does not replace a
// ladder. It remembers what real calls just did, and a ladder asks `shouldSkipProvider` before it
// spends another request on an account that has already said it is suspended or has stopped answering.
// Chat, the free chain and professionals already pass through `recordProviderLatency`; the builder
// chain, Qubax, vision and image generation call `noteProviderCall` at the same place they already
// handle the outcome. Prices, keys and the configured model come from the Test Chat status and the
// rate card — this module does not keep a second copy of either.
//
// Default on. `AGENTV3_TRAFFIC_HEALTH=off` stops the skip and the recording. Nothing here changes a
// quota, a price, or a wallet.

import { isFatalProviderError, isProviderBalanceError } from '../../AgentV3/providerErrorClass';
import { parseEnvFlag } from '../../lib/envFlag';

export type TrafficSurface = 'chat' | 'professional' | 'builder' | 'qubax' | 'vision' | 'image';
export type TrafficErrorKind = 'ok' | 'rate-limit' | 'invalid' | 'timeout' | 'suspended' | 'other';
export type TrafficState = 'up' | 'down' | 'suspended';

export interface TrafficSample {
  at: number;
  ok: boolean;
  kind: TrafficErrorKind;
  totalMs: number;
  firstByteMs?: number;
  model?: string;
  surface: TrafficSurface;
}

export interface TrafficCall {
  provider: string;
  model?: string | null;
  surface: TrafficSurface;
  ok: boolean;
  totalMs?: number;
  firstByteMs?: number;
  error?: unknown;
  at?: number;
}

const MAX_SAMPLES = 40;
/** How long a suspended or down provider stays skipped before one real call is allowed to recheck it. */
export const TRAFFIC_RECOVERY_MS = 5 * 60 * 1000;
/** This many recent failures of the same hard kind mark the provider down. */
const DOWN_AFTER = 3;

interface Row {
  samples: TrafficSample[];
  inFlight: number;
  state: TrafficState;
  reason: string | null;
  recoverAt: number;
  /** The one recovery call has been released and has not come back yet. */
  probing: boolean;
}

const rows = new Map<string, Row>();

/** Default on. Only an explicit off (`off` / `false` / `0`) stops it. */
export function trafficHealthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_TRAFFIC_HEALTH) !== false;
}

/** One name for the same account, whatever the caller spelled. `GLM#2` and `glm` are GLM. */
export function canonProvider(name: string): string {
  const raw = String(name ?? '').trim().toUpperCase().replace(/#\d+$/, '');
  if (raw === 'GLM-BUILDER' || raw === 'GLM_BUILDER') return 'GLM';
  if (raw === 'ROUTER-ONE' || raw === 'ROUTER_ONE' || raw === 'ENGINE-R1') return 'ENGINE_R1';
  if (raw === 'BLUESMINDS' || raw === 'ENGINE-BM') return 'ENGINE_BM';
  if (raw === 'POLLINATIONS-IMAGE') return 'POLLINATIONS';
  if (raw === 'GLM-VISION' || raw === 'GLM_VISION') return 'GLM';
  return raw;
}

/**
 * What kind of failure a call was, from the words the provider already returned.
 * Suspension and an empty balance are one kind: the account will not answer until somebody recharges it.
 */
export function classifyTrafficError(error: unknown): TrafficErrorKind {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  const text = `${code} ${message}`.trim();
  if (!text) return 'other';
  if (isProviderBalanceError(error) || /account (?:is )?suspended/i.test(text) || (/suspended/i.test(text) && /balance|billing|quota/i.test(text))) return 'suspended';
  if (isFatalProviderError(error) && /key|auth|permission_error|authentication_error/i.test(text)) return 'suspended';
  if (/invalid_completion|\bstatus[=: ]*40[04]\b|\b40[04]\b/i.test(text)) return 'invalid';
  if (/\b429\b|rate limit|too many requests|overloaded/i.test(text)) return 'rate-limit';
  if (/timed? ?out|timeout|not started answering|ETIMEDOUT|first-token/i.test(text)) return 'timeout';
  return 'other';
}

function rowOf(provider: string): Row {
  const key = canonProvider(provider);
  let row = rows.get(key);
  if (!row) {
    row = { samples: [], inFlight: 0, state: 'up', reason: null, recoverAt: 0, probing: false };
    rows.set(key, row);
  }
  return row;
}

export function noteProviderCall(call: TrafficCall): void {
  if (!trafficHealthEnabled()) return;
  const provider = canonProvider(call.provider);
  if (!provider) return;
  const row = rowOf(provider);
  const kind: TrafficErrorKind = call.ok ? 'ok' : classifyTrafficError(call.error);
  const sample: TrafficSample = {
    at: call.at ?? Date.now(),
    ok: call.ok,
    kind,
    totalMs: Math.max(0, Number(call.totalMs) || 0),
    ...(typeof call.firstByteMs === 'number' && Number.isFinite(call.firstByteMs) ? { firstByteMs: Math.max(0, call.firstByteMs) } : {}),
    ...(call.model ? { model: String(call.model) } : {}),
    surface: call.surface,
  };
  row.samples.push(sample);
  if (row.samples.length > MAX_SAMPLES) row.samples.splice(0, row.samples.length - MAX_SAMPLES);
  if (call.ok) {
    row.state = 'up';
    row.reason = null;
    row.probing = false;
    row.recoverAt = 0;
    return;
  }
  if (kind === 'suspended') {
    row.state = 'suspended';
    row.reason = errorText(call.error);
    row.probing = false;
    row.recoverAt = sample.at + TRAFFIC_RECOVERY_MS;
    return;
  }
  const recent = row.samples.slice(-DOWN_AFTER);
  if (recent.length >= DOWN_AFTER && recent.every((s) => s.kind === 'timeout' || s.kind === 'invalid')) {
    row.state = 'down';
    row.reason = errorText(call.error);
    row.probing = false;
    row.recoverAt = sample.at + TRAFFIC_RECOVERY_MS;
  }
}

export function providerInFlight(provider: string, delta: number): void {
  if (!trafficHealthEnabled()) return;
  const row = rowOf(provider);
  row.inFlight = Math.max(0, row.inFlight + delta);
}

/**
 * True when the ladder should not call this provider. A suspended or down provider stays skipped
 * until its recovery time, then ONE call is allowed through. That call is the recovery check.
 */
export function shouldSkipProvider(provider: string, now = Date.now()): boolean {
  if (!trafficHealthEnabled()) return false;
  const row = rows.get(canonProvider(provider));
  // A rate-limit is the existing cooldown's job. Skip only an account that cannot answer
  // (suspended / empty balance) or one that has stopped answering (repeated timeout or rejection).
  if (!row || row.state === 'up') return false;
  if (now >= row.recoverAt && !row.probing) {
    row.probing = true;
    return false;
  }
  return true;
}

export function providerSkipReason(provider: string): string | null {
  const row = rows.get(canonProvider(provider));
  if (!row || row.state === 'up') return null;
  return row.reason;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function percentile(values: number[], p: number): number | null {
  const nums = values.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const index = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return nums[index];
}

export interface TrafficProviderView {
  provider: string;
  state: TrafficState;
  reason: string | null;
  inFlight: number;
  samples: number;
  errorRate: Partial<Record<TrafficErrorKind, number>>;
  totalP50: number | null;
  totalP95: number | null;
  firstByteP50: number | null;
  firstByteP95: number | null;
  model: string | null;
  recoverAt: number;
}

export function trafficProviderViews(now = Date.now()): TrafficProviderView[] {
  return [...rows.entries()].map(([provider, row]) => {
    const totals = row.samples.filter((s) => s.ok && s.totalMs > 0).map((s) => s.totalMs);
    const first = row.samples.filter((s) => s.ok && typeof s.firstByteMs === 'number').map((s) => s.firstByteMs as number);
    const errorRate: Partial<Record<TrafficErrorKind, number>> = {};
    for (const sample of row.samples) {
      if (sample.ok) continue;
      errorRate[sample.kind] = (errorRate[sample.kind] ?? 0) + 1;
    }
    const lastModel = [...row.samples].reverse().find((s) => s.model)?.model ?? null;
    return {
      provider, state: row.state, reason: row.reason, inFlight: row.inFlight, samples: row.samples.length,
      errorRate, totalP50: percentile(totals, 50), totalP95: percentile(totals, 95),
      firstByteP50: percentile(first, 50), firstByteP95: percentile(first, 95),
      model: lastModel, recoverAt: row.state === 'up' ? 0 : row.recoverAt,
    };
  }).sort((a, b) => a.provider.localeCompare(b.provider));
}

export function resetTrafficHealthForTests(): void {
  rows.clear();
}

/** Exposed so a test can prove the recovery window without waiting. */
export function _trafficRow(provider: string): { state: TrafficState; probing: boolean; recoverAt: number } | null {
  const row = rows.get(canonProvider(provider));
  return row ? { state: row.state, probing: row.probing, recoverAt: row.recoverAt } : null;
}
