/**
 * P1-1 — WHAT A BENCHMARK BUILD ACTUALLY COST AND WHAT IT ACTUALLY PROVED (audit 2026-10-16, admin-approved).
 *
 * The benchmark scored a build on `ok`, files written and a readiness number, and recorded only the bill. That could
 * not answer the questions the A/B exists for: how many tokens did the build send, how many were cache re-reads (69% of
 * the money in the audited 111-call build), how many model calls and how long, did a real browser render the app, and
 * what did the release gate say. It also could not see a false success — `ok: true` beside a RED gate.
 *
 * Everything here is READ from the build's own final report (`result.diagnostics`, which the stream already carries),
 * never estimated. A field the report did not carry is `null`, NEVER 0: a user-scoped report has no per-call ledger, and
 * a zero there would read as "that build was free".
 *
 * ⚠️ TOKEN SEMANTICS, stated so nobody over-reads a ratio. `inputTokens` and `cachedInputTokens` are summed exactly as
 * each provider reported them. For the OpenAI-compatible engines (Kimi, GLM) cached tokens are a SUBSET of input; for a
 * Claude call they are additive. So `cachedShare` is exact for a Weak-tier run (no Claude except a planner call that
 * reports no cache) and approximate otherwise — the summary says which providers were in the sum.
 *
 * PURE. No I/O, no clock.
 */

export type PreviewEvidence = 'rendered' | 'failed' | 'not-proven';
export type GateStateName = 'green' | 'yellow' | 'red' | 'unknown';

export interface BuildEvidence {
  /** Every model call the build made, failed ones included (a failed call still cost clock and often money). */
  llmCalls: number | null;
  llmCallsFailed: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  /** Wall clock the build itself recorded (endedAt - startedAt). */
  buildMs: number | null;
  /** Sum of the model calls' own latencies — how much of the clock was spent inside a provider. */
  modelMs: number | null;
  /** Did a REAL browser see the app render? From the platform's own observation, never from the model's prose. */
  previewEvidence: PreviewEvidence | null;
  /** The release gate's final word, read from the report's own `RELEASE_GATE` line. */
  gateState: GateStateName | null;
  /** What the providers really charged NavBharatAI for this build (the report's own settled figure), USD. The A/B's spend cap reads this. */
  realCostUsd: number | null;
  sandboxCostUsd: number | null;
  /** The provider families whose tokens are in the sums above. */
  providers: string[];
}

const EMPTY: BuildEvidence = {
  llmCalls: null, llmCallsFailed: null, inputTokens: null, cachedInputTokens: null, outputTokens: null,
  buildMs: null, modelMs: null, previewEvidence: null, gateState: null, realCostUsd: null, sandboxCostUsd: null, providers: [],
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Codes that mean the app was seen NOT rendering (the preview heal gave up, or the page never painted). */
const PREVIEW_FAILED_CODES = new Set(['OUTCOME_PREVIEW_FAILED', 'PREVIEW_NOT_RENDERED']);
/** Codes the platform records only after a real browser rendered the app. */
const PREVIEW_RENDERED_CODES = new Set(['IN_BUILD_GREEN']);

/** The gate's final word from the report's own line: "Release gate: RED — …". The LAST such line wins (a re-run replaces it). */
export function gateStateFromIssues(issues: unknown): GateStateName | null {
  if (!Array.isArray(issues)) return null;
  let state: GateStateName | null = null;
  for (const i of issues) {
    const r = rec(i);
    if (!r || r.code !== 'RELEASE_GATE' || typeof r.message !== 'string') continue;
    const m = /^Release gate:\s*(GREEN|YELLOW|RED|UNKNOWN)\b/.exec(r.message);
    if (m) state = m[1].toLowerCase() as GateStateName;
  }
  return state;
}

export function previewEvidenceFrom(result: Record<string, unknown>, issues: unknown): PreviewEvidence | null {
  const codes = new Set<string>();
  if (Array.isArray(issues)) for (const i of issues) { const r = rec(i); if (r && typeof r.code === 'string') codes.add(r.code); }
  if ([...PREVIEW_FAILED_CODES].some((c) => codes.has(c))) return 'failed'; // a failure at the end outranks an earlier render
  if (result.appRendered === true || [...PREVIEW_RENDERED_CODES].some((c) => codes.has(c))) return 'rendered';
  if (result.appRendered === false || codes.size > 0) return 'not-proven';
  return null; // the result carried neither the flag nor a report: we do not know
}

/** Read the evidence out of one `result` stream event. Missing pieces stay null. PURE. */
export function evidenceFromResult(result: Record<string, unknown> | null | undefined): BuildEvidence {
  if (!result) return { ...EMPTY };
  const diag = rec(result.diagnostics);
  const issues = diag?.issues;
  const out: BuildEvidence = { ...EMPTY, providers: [] };

  if (diag) {
    const calls = Array.isArray(diag.llmCalls) ? diag.llmCalls.map(rec).filter((c): c is Record<string, unknown> => !!c) : null;
    if (calls) {
      out.llmCalls = calls.length;
      out.llmCallsFailed = calls.filter((c) => c.ok === false).length;
      out.modelMs = calls.reduce((s, c) => s + (num(c.latencyMs) ?? 0), 0);
    }
    // The settled per-provider ledger is the better token source (it is what the bill is built from); the per-call
    // ledger is the fallback, and it carries no cache figure.
    const pt = rec(diag.providerTokens);
    if (pt && Object.keys(pt).length > 0) {
      let input = 0; let output = 0; let cached = 0; let sawCache = false;
      for (const [family, v] of Object.entries(pt)) {
        const r = rec(v);
        if (!r) continue;
        out.providers.push(family);
        input += num(r.inputTokens) ?? 0;
        output += num(r.outputTokens) ?? 0;
        const c = num(r.cacheReadInputTokens);
        if (c !== null) { cached += c; sawCache = true; }
      }
      out.inputTokens = input; out.outputTokens = output; out.cachedInputTokens = sawCache ? cached : null;
    } else if (calls && calls.length > 0) {
      out.inputTokens = calls.reduce((s, c) => s + (num(c.inputTokens) ?? 0), 0);
      out.outputTokens = calls.reduce((s, c) => s + (num(c.outputTokens) ?? 0), 0);
      const top = num(diag.cacheReadInputTokens);
      out.cachedInputTokens = top;
    }
    const start = num(diag.startedAt); const end = num(diag.endedAt);
    if (start !== null && end !== null && end >= start) out.buildMs = end - start;
    out.gateState = gateStateFromIssues(issues);
    const billing = rec(diag.billing);
    if (billing) { out.realCostUsd = num(billing.realCostUsd); out.sandboxCostUsd = num(billing.sandboxCostUsd); }
  }
  out.previewEvidence = previewEvidenceFrom(result, issues);
  return out;
}
