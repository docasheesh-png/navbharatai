/**
 * Owner t362u (2026-11-16): a user sees only the TOTAL charged in rupees — never token counts, a USD
 * amount, the USD→INR rate, or anything else that shows how a charge was worked out. This module is
 * the one place that turns the server's full billing facts into what a user's browser receives.
 *
 * It is a VIEW only: it never changes what was billed, debited or recorded. The server keeps the full
 * `UserCostBreakdown`, the persisted record keeps `billedUsd` / `usage` / `finalState` for admin views,
 * and the wallet debit is computed before any of this runs. Everything here is PURE and total: absent,
 * malformed or legacy fields are dropped, never thrown on.
 *
 * The build report riding on a `result`/`error` event (and on the persisted record's `finalState.report`)
 * is the full admin report — billing block, model, provider delivery, `adminDetail`. A user's copy is the
 * provider-free `userFacingReport`; admins keep the full report via the diagnostics route, which already
 * chooses by the verified viewer.
 */
import { userFacingReport, type BuildDiagnosticsReport } from './BuildDiagnostics';

/** The user's copy of a build report, or `undefined` (dropped, fail closed) when it cannot be read. PURE. */
export function userReport(report: unknown): BuildDiagnosticsReport | undefined {
  if (!report || typeof report !== 'object') return undefined;
  const r = report as Partial<BuildDiagnosticsReport>;
  if (!Array.isArray(r.issues) || !Array.isArray(r.problems) || !r.counts || typeof r.counts !== 'object') return undefined;
  try { return userFacingReport(r as BuildDiagnosticsReport); } catch { return undefined; }
}

/** The only cost facts a user's browser receives for a build. All money is in rupees. */
export interface UserCharge {
  billedInr: number;
  tier?: string;
  engine?: string;
  livePreviewSeconds?: number;
  livePreviewInr?: number;
  sandboxFeeInr?: number;
  sandboxFeePct?: number;
  preSandboxSubtotalInr?: number;
  listInr?: number;
  discountInr?: number;
  discountPct?: number;
}

const NUMBER_FIELDS = ['livePreviewSeconds', 'livePreviewInr', 'sandboxFeeInr', 'sandboxFeePct', 'preSandboxSubtotalInr', 'listInr', 'discountInr', 'discountPct'] as const;
const STRING_FIELDS = ['tier', 'engine'] as const;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Keep only the rupee-facing fields of a cost breakdown (allow-list). `null` when there is no ₹ total. PURE. */
export function userCharge(breakdown: unknown): UserCharge | null {
  if (!breakdown || typeof breakdown !== 'object') return null;
  const b = breakdown as Record<string, unknown>;
  if (!finite(b.billedInr)) return null;
  const out: UserCharge = { billedInr: b.billedInr };
  for (const k of STRING_FIELDS) if (typeof b[k] === 'string') out[k] = b[k] as string;
  for (const k of NUMBER_FIELDS) if (finite(b[k])) out[k] = b[k] as number;
  return out;
}

/** Fields a `result` event may carry that reveal how a charge was worked out. */
const RESULT_METHOD_FIELDS = ['billedUsd', 'tokens', 'usdInrRate', 'inputTokens', 'outputTokens', 'costBreakdown'] as const;

/**
 * The user's copy of a build event. Only `result` and `error` events change. On a `result`, the USD amount,
 * token counts and rate are removed, and the cost breakdown is sent as `charge` (rupees only). On both,
 * the build report becomes the user's copy and `adminDetail` is dropped. `costBreakdown` is not sent at
 * all, so an older client that read `costBreakdown.inputTokens` simply shows no breakdown panel instead
 * of crashing; it still shows the ₹ total from `billedInr`. Every other event is returned as is. PURE.
 */
export function userResultEvent<T>(event: T): T {
  if (!event || typeof event !== 'object') return event;
  const type = (event as { type?: unknown }).type;
  if (type !== 'result' && type !== 'error') return event;
  const e = event as Record<string, unknown>;
  const touchesCost = type === 'result' && (RESULT_METHOD_FIELDS.some((k) => k in e) || 'charge' in e);
  if (!touchesCost && !('diagnostics' in e) && !('adminDetail' in e)) return event;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'diagnostics' || k === 'adminDetail') continue;
    if (type === 'result' && ((RESULT_METHOD_FIELDS as readonly string[]).includes(k) || k === 'charge')) continue;
    out[k] = v;
  }
  if (type === 'result') {
    const charge = userCharge(e.charge ?? e.costBreakdown);
    if (charge) out.charge = charge;
  }
  const report = 'diagnostics' in e ? userReport(e.diagnostics) : undefined;
  if (report) out.diagnostics = report;
  return out as T;
}

/** Terminal facts persisted for the done-footer, as a user may see them on reopen. PURE. */
export function userFinalState(finalState: unknown): Record<string, unknown> | undefined {
  if (!finalState || typeof finalState !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(finalState as Record<string, unknown>)) {
    if (k === 'billedUsd' || k === 'tokens' || k === 'usdInrRate' || k === 'costBreakdown' || k === 'adminDetail' || k === 'report') continue;
    out[k] = v;
  }
  const report = userReport((finalState as Record<string, unknown>).report);
  if (report) out.report = report;
  return out;
}

/**
 * A persisted conversation as its owner receives it: the record's USD bill and token usage stay on the
 * server (admin-only); the reopened done-footer shows the ₹ total from `finalState.billedInr`. PURE.
 */
export function userConversationView<T>(rec: T): T {
  if (!rec || typeof rec !== 'object') return rec;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
    if (k === 'billedUsd' || k === 'usage' || k === 'finalState') continue;
    out[k] = v;
  }
  const fs = userFinalState((rec as Record<string, unknown>).finalState);
  if (fs) out.finalState = fs;
  return out as T;
}
