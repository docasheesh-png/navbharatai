// NavBharatAI Pro v3.0 — cheap-model BAKE-OFF metrics (PR2 of the cost-down plan).
//
// Pure, dependency-free helpers that turn a build's NDJSON event stream into OBJECTIVE metrics, so a
// candidate cheap model (GLM/Kimi) is judged on what it REALLY did — not on vibes. The decisive
// signal is the "Gemini trap": a model that says "creating files…" but calls no tools finishes with
// ZERO real files. We also track build-pass, readiness, tool-call success, provider-fallbacks
// (cheap→Claude escapes — the higher, the weaker the floor and the smaller the saving), and billed
// cost. The runner (scripts/agentv3-bakeoff.ts) does the I/O and feeds raw stream text here.

/** One build's objective outcome, derived from its NDJSON stream + attached diagnostics report. */
export interface BuildMetrics {
  /** Distinct files the build actually wrote (via file_changed events). 0 = the Gemini trap. */
  filesCreated: number;
  /** Final build result ok flag (result/done event). */
  ok: boolean;
  /** Objective readiness score 0–100 (done.readiness), or null if not reported. */
  readinessScore: number | null;
  /** Billed USD for the build (Opus/Sonnet-equiv markup), or null. */
  billedUsd: number | null;
  /** Tool calls attempted (from the diagnostics timeline). */
  toolCalls: number;
  /** Tool calls that failed. */
  toolErrors: number;
  /** Times the provider chain fell back to the next provider (cheap → Claude). */
  providerFallbacks: number;
  /** The build claimed completion but wrote ZERO files — the describe-but-no-files trap. */
  geminiTrap: boolean;
  /** An error event was emitted. */
  errored: boolean;
}

/** Parse a raw NDJSON stream body into JSON event objects (skips blank / non-JSON lines). */
export function parseNdjson(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of (text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object') out.push(o as Record<string, unknown>);
    } catch { /* skip non-JSON (e.g. an HTML error page) */ }
  }
  return out;
}

/** Reduce a build's events into objective metrics. Pure — same input, same output. */
export function metricsFromEvents(events: Array<Record<string, unknown>>): BuildMetrics {
  const files = new Set<string>();
  let ok = false;
  let errored = false;
  let readinessScore: number | null = null;
  let billedUsd: number | null = null;
  let toolCalls = 0;
  let toolErrors = 0;
  let providerFallbacks = 0;

  for (const e of events) {
    switch (e.type) {
      case 'file_changed': {
        const change = e.change as { path?: unknown } | undefined;
        if (change && typeof change.path === 'string') files.add(change.path);
        break;
      }
      case 'result': {
        if (typeof e.ok === 'boolean') ok = e.ok;
        if (typeof e.billedUsd === 'number') billedUsd = e.billedUsd as number;
        const diag = e.diagnostics as { issues?: Array<{ code?: unknown }> } | undefined;
        for (const issue of diag?.issues ?? []) {
          if (issue.code === 'TOOL_CALL') toolCalls++;
          else if (issue.code === 'TOOL_ERROR') toolErrors++;
          else if (issue.code === 'PROVIDER_FALLBACK') providerFallbacks++;
        }
        break;
      }
      case 'done': {
        if (typeof e.ok === 'boolean') ok = ok || (e.ok as boolean);
        const readiness = e.readiness as { score?: unknown } | undefined;
        if (readiness && typeof readiness.score === 'number') readinessScore = readiness.score as number;
        break;
      }
      case 'error':
        errored = true;
        break;
    }
  }

  const filesCreated = files.size;
  return {
    filesCreated,
    ok,
    readinessScore,
    billedUsd,
    toolCalls,
    toolErrors,
    providerFallbacks,
    geminiTrap: ok && filesCreated === 0,
    errored,
  };
}

/** Aggregate stats for one candidate model across N runs. */
export interface BakeoffAggregate {
  label: string;
  runs: number;
  /** Fraction of runs that wrote ≥1 file (the floor for trusting a model at all). */
  filesPassRate: number;
  /** Fraction of runs whose build result was ok. */
  buildPassRate: number;
  /** Fraction hitting the describe-but-0-files trap (lower is better; >0 disqualifies a floor). */
  geminiTrapRate: number;
  avgFilesCreated: number;
  avgReadiness: number | null;
  avgBilledUsd: number | null;
  /** Avg provider-fallbacks per run (cheap→Claude escapes; higher = weaker floor = less saving). */
  avgProviderFallbacks: number;
  /** Tool-call success across all runs, or null when no tool calls were recorded. */
  toolCallSuccessRate: number | null;
}

export function aggregate(label: string, runs: BuildMetrics[]): BakeoffAggregate {
  const n = runs.length || 1;
  const frac = (pred: (m: BuildMetrics) => boolean): number => runs.filter(pred).length / n;
  const avg = (sel: (m: BuildMetrics) => number): number => runs.reduce((s, m) => s + sel(m), 0) / n;
  const nums = (sel: (m: BuildMetrics) => number | null): number[] =>
    runs.map(sel).filter((x): x is number => typeof x === 'number');
  const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const totalCalls = runs.reduce((s, m) => s + m.toolCalls, 0);
  const totalErrors = runs.reduce((s, m) => s + m.toolErrors, 0);
  return {
    label,
    runs: runs.length,
    filesPassRate: frac((m) => m.filesCreated > 0),
    buildPassRate: frac((m) => m.ok),
    geminiTrapRate: frac((m) => m.geminiTrap),
    avgFilesCreated: avg((m) => m.filesCreated),
    avgReadiness: mean(nums((m) => m.readinessScore)),
    avgBilledUsd: mean(nums((m) => m.billedUsd)),
    avgProviderFallbacks: avg((m) => m.providerFallbacks),
    toolCallSuccessRate: totalCalls > 0 ? (totalCalls - totalErrors) / totalCalls : null,
  };
}

/** Render a human-readable comparison table + an honest verdict per candidate. */
export function formatReport(aggs: BakeoffAggregate[]): string {
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  const num = (x: number | null, d = 1): string => (x === null ? 'n/a' : x.toFixed(d));
  const lines: string[] = [];
  lines.push('NavBharatAI v3.0 — Cheap-model Bake-off');
  lines.push('='.repeat(60));
  for (const a of aggs) {
    lines.push(`\n● ${a.label}  (${a.runs} run${a.runs === 1 ? '' : 's'})`);
    lines.push(`  files written   : ${pct(a.filesPassRate)}   (avg ${num(a.avgFilesCreated)} files)`);
    lines.push(`  Gemini-trap     : ${pct(a.geminiTrapRate)}   ← MUST be 0% to be a floor`);
    lines.push(`  build passed    : ${pct(a.buildPassRate)}`);
    lines.push(`  readiness (0-100): ${num(a.avgReadiness, 0)}`);
    lines.push(`  tool-call success: ${a.toolCallSuccessRate === null ? 'n/a' : pct(a.toolCallSuccessRate)}`);
    lines.push(`  fallbacks→Claude : ${num(a.avgProviderFallbacks, 2)} /run   (higher = weaker floor = less saving)`);
    lines.push(`  avg billed       : $${num(a.avgBilledUsd, 4)}`);
    const verdict = a.geminiTrapRate > 0
      ? 'DISQUALIFIED as a floor — hallucinates the tool loop (0-file builds).'
      : a.filesPassRate >= 0.9 && a.buildPassRate >= 0.8
        ? 'Viable floor candidate — verify cost vs Claude before rollout.'
        : 'Weak — fails too often; escalation cost may erase the saving.';
    lines.push(`  → ${verdict}`);
  }
  return lines.join('\n') + '\n';
}
