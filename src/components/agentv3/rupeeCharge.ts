import type { CostBreakdown } from './agentV3Types';

/**
 * Owner t362u (2026-11-16): the browser keeps and shows only rupee facts about a build's charge. A newer
 * server sends `charge` already in this shape; an older server (or a replayed older event) sent
 * `costBreakdown` with token counts, a USD amount and the USD→INR rate. Both go through this allow-list,
 * so nothing but rupees, the tier and the engine label reaches client state. Absent or malformed input
 * returns `undefined` — never throws, so an old record can never crash the panel. PURE.
 */
export function rupeeCharge(input: unknown): CostBreakdown | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const b = input as Record<string, unknown>;
  const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const billedInr = n(b.billedInr);
  if (billedInr === undefined) return undefined;
  const out: CostBreakdown = { billedInr };
  if (typeof b.tier === 'string') out.tier = b.tier;
  if (typeof b.engine === 'string') out.engine = b.engine;
  for (const k of ['livePreviewSeconds', 'livePreviewInr', 'sandboxFeeInr', 'sandboxFeePct', 'preSandboxSubtotalInr', 'listInr', 'discountInr', 'discountPct'] as const) {
    const v = n(b[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
