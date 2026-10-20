/**
 * P1 — BUILD-RELIABILITY BENCHMARK HARNESS (fix/build-reliability). PURE helpers.
 *
 * Every other change in this series is a hypothesis until it is measured on the same prompts, the same
 * tier and the same day as a baseline. The runner (scripts/agentv3-reliability-bench.ts) does the I/O
 * against a LIVE server; this module decides what counts as success and how two runs compare, so the
 * verdict is unit-tested and cannot drift between runs.
 *
 * Success (strict, deliberately): the build reported ok, wrote ≥1 real file, did not fall into the
 * describe-but-no-files trap, and did not error. A readiness score, when reported, must be ≥ 60.
 */
import type { BuildMetrics } from '../BakeoffMetrics';
import type { GateStateName, PreviewEvidence } from './benchEvidence';

export interface BenchPrompt {
  id: string;
  lang: 'hindi' | 'hinglish' | 'english';
  complexity: 'simple' | 'medium' | 'complex';
  smoke: boolean;
  prompt: string;
}

export interface BenchFixture {
  version: number;
  prompts: BenchPrompt[];
}

/** Validate the fixture file. Throws with every problem listed. */
export function validateBenchFixture(raw: unknown): BenchFixture {
  const problems: string[] = [];
  const obj = raw as { version?: unknown; prompts?: unknown };
  const prompts = Array.isArray(obj?.prompts) ? (obj.prompts as BenchPrompt[]) : [];
  if (!prompts.length) problems.push('no prompts');
  const ids = new Set<string>();
  for (const p of prompts) {
    if (!p || typeof p.id !== 'string' || !p.id) { problems.push('a prompt without an id'); continue; }
    if (ids.has(p.id)) problems.push(`duplicate id ${p.id}`);
    ids.add(p.id);
    if (!['hindi', 'hinglish', 'english'].includes(p.lang)) problems.push(`${p.id}: bad lang`);
    if (!['simple', 'medium', 'complex'].includes(p.complexity)) problems.push(`${p.id}: bad complexity`);
    if (typeof p.smoke !== 'boolean') problems.push(`${p.id}: smoke must be boolean`);
    if (typeof p.prompt !== 'string' || p.prompt.trim().length < 10) problems.push(`${p.id}: prompt too short`);
  }
  if (problems.length) throw new Error(`Invalid bench fixture: ${problems.join('; ')}`);
  return { version: Number(obj.version ?? 1), prompts };
}

export function selectBenchPrompts(fx: BenchFixture, set: 'smoke' | 'full', only: readonly string[] = []): BenchPrompt[] {
  const base = set === 'smoke' ? fx.prompts.filter((p) => p.smoke) : fx.prompts;
  return only.length ? base.filter((p) => only.includes(p.id)) : base;
}

export function buildSucceeded(m: BuildMetrics): boolean {
  if (!m.ok || m.errored || m.geminiTrap || m.filesCreated <= 0) return false;
  if (typeof m.readinessScore === 'number' && m.readinessScore < 60) return false;
  return true;
}

export interface BenchRun {
  id: string;
  lang: BenchPrompt['lang'];
  complexity: BenchPrompt['complexity'];
  attempt: number;
  /** Completed request duration; null while a checkpointed request is still in flight. */
  seconds: number | null;
  metrics: BuildMetrics;
  success: boolean;
  /** Independent repetitions, not repair attempts. Stable IDs permit server-side reconciliation. */
  requestId?: string;
  sessionId?: string;
  /** Transport failures leave the remote outcome and spend unknown. */
  failure?: string;
}

export interface BenchResultFile {
  label: string;
  set: 'smoke' | 'full';
  baseUrl: string;
  startedAt: string;
  /** Flags the operator says were on for this run (recorded, not verified — the server owns them). */
  flags: string[];
  runs: BenchRun[];
  /** Runner source/configuration, not a claim about the remote server's deployed commit or flags. */
  execution?: {
    status: 'running' | 'complete' | 'blocked';
    plannedRuns: number;
    sourceCommit: string;
    sourceDirty: boolean;
    fixtureSha256: string;
    promptIds: string[];
    repetitions: number;
    nodeVersion: string;
  };
}

export interface RateWithCi { n: number; successes: number; rate: number; low: number; high: number }

/** Wilson 95% interval — honest about small n (15 smoke prompts cannot prove a 5-point gain). */
export function wilson(successes: number, n: number, z = 1.96): RateWithCi {
  if (n <= 0) return { n: 0, successes: 0, rate: 0, low: 0, high: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { n, successes, rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export function successRate(runs: readonly BenchRun[]): RateWithCi {
  return wilson(runs.filter((r) => r.success).length, runs.length);
}

export function breakdown(runs: readonly BenchRun[], key: 'lang' | 'complexity'): Record<string, RateWithCi> {
  const groups = new Map<string, BenchRun[]>();
  for (const r of runs) groups.set(r[key], [...(groups.get(r[key]) ?? []), r]);
  const out: Record<string, RateWithCi> = {};
  for (const [k, v] of [...groups.entries()].sort()) out[k] = successRate(v);
  return out;
}

export interface BenchComparison {
  baseline: RateWithCi;
  candidate: RateWithCi;
  deltaPoints: number;
  /** Prompts that failed in baseline and passed in candidate (majority over attempts), and the reverse. */
  fixed: string[];
  broke: string[];
  verdict: string;
}

/** Rates from different cohorts or interrupted batches cannot establish a gain. */
export function comparisonGaps(baseline: BenchResultFile, candidate: BenchResultFile): string[] {
  const gaps: string[] = [];
  if (baseline.set !== candidate.set) gaps.push('different prompt sets');
  const population = (file: BenchResultFile) => file.runs.map((r) => `${r.id}:${r.lang}:${r.complexity}:${r.attempt}`).sort();
  if (JSON.stringify(population(baseline)) !== JSON.stringify(population(candidate))) gaps.push('different prompts or repetition counts');
  for (const [label, file] of [['baseline', baseline], ['candidate', candidate]] as const) {
    if (file.execution && (file.execution.status !== 'complete' || file.execution.plannedRuns !== file.runs.length)) gaps.push(`${label} batch is incomplete`);
    if (file.runs.some((r) => r.failure)) gaps.push(`${label} has unreconciled transport/auth failures`);
  }
  if (baseline.execution && candidate.execution && baseline.execution.fixtureSha256 !== candidate.execution.fixtureSha256) gaps.push('different fixture contents');
  return gaps;
}

function perPrompt(runs: readonly BenchRun[]): Map<string, boolean> {
  const by = new Map<string, { s: number; n: number }>();
  for (const r of runs) {
    const c = by.get(r.id) ?? { s: 0, n: 0 };
    c.n += 1;
    if (r.success) c.s += 1;
    by.set(r.id, c);
  }
  return new Map([...by.entries()].map(([id, c]) => [id, c.s * 2 > c.n]));
}

export function compareBench(baseline: BenchResultFile, candidate: BenchResultFile): BenchComparison {
  const b = successRate(baseline.runs);
  const c = successRate(candidate.runs);
  const pb = perPrompt(baseline.runs);
  const pc = perPrompt(candidate.runs);
  const fixed: string[] = [];
  const broke: string[] = [];
  for (const [id, ok] of pc) {
    if (!pb.has(id)) continue;
    if (ok && !pb.get(id)) fixed.push(id);
    if (!ok && pb.get(id)) broke.push(id);
  }
  const deltaPoints = Math.round((c.rate - b.rate) * 1000) / 10;
  const separated = c.low > b.high || b.low > c.high;
  const gaps = comparisonGaps(baseline, candidate);
  const verdict = gaps.length ? `Not comparable — ${gaps.join('; ')}. Reconcile or rerun matching complete cohorts before claiming a gain.` : separated
    ? (c.rate > b.rate ? `Candidate is better (${deltaPoints} pts, 95% intervals do not overlap).` : `Candidate is WORSE (${deltaPoints} pts, 95% intervals do not overlap).`)
    : `Not distinguishable at this sample size (${deltaPoints} pts; intervals overlap) — run the full set or more attempts before deciding.`;
  return { baseline: b, candidate: c, deltaPoints, fixed: fixed.sort(), broke: broke.sort(), verdict };
}

export function formatComparison(cmp: BenchComparison, labels: { baseline: string; candidate: string }): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const line = (name: string, r: RateWithCi) => `${name.padEnd(12)} ${r.successes}/${r.n} = ${pct(r.rate)}  (95% CI ${pct(r.low)}–${pct(r.high)})`;
  return [
    'NavBharatAI — build-reliability comparison',
    line(labels.baseline, cmp.baseline),
    line(labels.candidate, cmp.candidate),
    `delta: ${cmp.deltaPoints >= 0 ? '+' : ''}${cmp.deltaPoints} points`,
    `fixed (${cmp.fixed.length}): ${cmp.fixed.join(', ') || '—'}`,
    `broke (${cmp.broke.length}): ${cmp.broke.join(', ') || '—'}`,
    `→ ${cmp.verdict}`,
  ].join('\n');
}


// ─────────────────────────────────────────────────────────────────────────────────────────────────
// P1-1 (audit 2026-10-16): what each build COST and what it PROVED. `buildSucceeded` above is deliberately left exactly
// as it was — a changed definition would make every earlier result file incomparable. The evidence is reported BESIDE
// it, so the same run can be read both ways and the gap between them is itself a number (the false-positive rate).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Does a real browser + the release gate back the build's own claim? */
export type VerifiedOutcome = 'proven' | 'contradicted' | 'unproven';

/**
 * - contradicted: the gate is RED, or the preview was seen NOT rendering — the evidence says the app is broken.
 * - proven: the gate is GREEN/YELLOW AND a real browser saw it render.
 * - unproven: anything else, including a build whose report carried no evidence at all. "We did not look" is never
 *   rounded up to "it works".
 */
export function verifiedOutcome(m: BuildMetrics): VerifiedOutcome {
  const ev = m.evidence;
  if (!ev) return 'unproven';
  if (ev.gateState === 'red' || ev.previewEvidence === 'failed') return 'contradicted';
  if ((ev.gateState === 'green' || ev.gateState === 'yellow') && ev.previewEvidence === 'rendered') return 'proven';
  return 'unproven';
}

/** A build `buildSucceeded` calls a success that its own evidence contradicts — the false success this series exists to find. */
export function falsePositive(m: BuildMetrics): boolean {
  return buildSucceeded(m) && verifiedOutcome(m) === 'contradicted';
}

export interface MetricStat { n: number; mean: number | null; total: number; p50?: number | null; p95?: number | null }
const stat = (xs: ReadonlyArray<number | null | undefined>): MetricStat => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const total = v.reduce((a, b) => a + b, 0);
  const sorted = [...v].sort((a, b) => a - b);
  // Nearest-rank: with fewer than 20 samples the p95 is normally the maximum. Keep n alongside it.
  const percentile = (p: number) => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
  return { n: v.length, mean: v.length ? total / v.length : null, total, p50: percentile(0.5), p95: percentile(0.95) };
};

export interface EvidenceSummary {
  runs: number;
  /** Per-run means. `n` is how many runs carried the figure — a mean over 3 of 15 is not a mean over 15, and says so. */
  llmCalls: MetricStat;
  llmCallsFailed: MetricStat;
  inputTokens: MetricStat;
  cachedInputTokens: MetricStat;
  outputTokens: MetricStat;
  /** Cache re-reads as a share of input, over the runs that carried BOTH figures. Null when none did. */
  cachedShare: number | null;
  buildSeconds: MetricStat;
  modelSeconds: MetricStat;
  /** The runner's own wall clock around the request. */
  wallSeconds: MetricStat;
  realCostUsd: MetricStat;
  sandboxCostUsd: MetricStat;
  billedUsd: MetricStat;
  gate: Record<GateStateName | 'missing', number>;
  preview: Record<PreviewEvidence | 'missing', number>;
  /** Among the runs `buildSucceeded` called successes: how many the evidence proves, contradicts, or cannot speak to. */
  successes: Record<VerifiedOutcome, number>;
  /** contradicted successes ÷ successes, with the same honest interval as the success rate. */
  falsePositiveRate: RateWithCi;
}

export function summarizeEvidence(runs: readonly BenchRun[]): EvidenceSummary {
  const ms = runs.map((r) => r.metrics);
  const withBoth = ms.filter((m) => typeof m.evidence?.inputTokens === 'number' && typeof m.evidence?.cachedInputTokens === 'number');
  const inSum = withBoth.reduce((s, m) => s + (m.evidence!.inputTokens as number), 0);
  const cachedSum = withBoth.reduce((s, m) => s + (m.evidence!.cachedInputTokens as number), 0);
  const gate: EvidenceSummary['gate'] = { green: 0, yellow: 0, red: 0, unknown: 0, missing: 0 };
  const preview: EvidenceSummary['preview'] = { rendered: 0, failed: 0, 'not-proven': 0, missing: 0 };
  for (const m of ms) {
    gate[m.evidence?.gateState ?? 'missing'] += 1;
    preview[m.evidence?.previewEvidence ?? 'missing'] += 1;
  }
  const successes: EvidenceSummary['successes'] = { proven: 0, contradicted: 0, unproven: 0 };
  let successCount = 0;
  for (const r of runs) {
    if (!r.success) continue;
    successCount += 1;
    successes[verifiedOutcome(r.metrics)] += 1;
  }
  const seconds = (pick: (e: NonNullable<BuildMetrics['evidence']>) => number | null): MetricStat => {
    const s = stat(ms.map((m) => (m.evidence ? pick(m.evidence) : null)));
    return { n: s.n, mean: s.mean === null ? null : s.mean / 1000, total: s.total / 1000,
      p50: s.p50 == null ? null : s.p50 / 1000, p95: s.p95 == null ? null : s.p95 / 1000 };
  };
  return {
    runs: runs.length,
    llmCalls: stat(ms.map((m) => m.evidence?.llmCalls)),
    llmCallsFailed: stat(ms.map((m) => m.evidence?.llmCallsFailed)),
    inputTokens: stat(ms.map((m) => m.evidence?.inputTokens)),
    cachedInputTokens: stat(ms.map((m) => m.evidence?.cachedInputTokens)),
    outputTokens: stat(ms.map((m) => m.evidence?.outputTokens)),
    cachedShare: inSum > 0 ? cachedSum / inSum : null,
    buildSeconds: seconds((e) => e.buildMs),
    modelSeconds: seconds((e) => e.modelMs),
    wallSeconds: stat(runs.map((r) => r.seconds)),
    realCostUsd: stat(ms.map((m) => m.evidence?.realCostUsd)),
    sandboxCostUsd: stat(ms.map((m) => m.evidence?.sandboxCostUsd)),
    billedUsd: stat(ms.map((m) => m.billedUsd)),
    gate,
    preview,
    successes,
    falsePositiveRate: wilson(successes.contradicted, successCount),
  };
}

export interface EvidenceRow { metric: string; baseline: number | null; candidate: number | null; deltaPct: number | null; nBaseline: number; nCandidate: number }

const ROWS: Array<[string, keyof EvidenceSummary]> = [
  ['model calls / build', 'llmCalls'], ['failed model calls / build', 'llmCallsFailed'],
  ['input tokens / build', 'inputTokens'], ['cached input tokens / build', 'cachedInputTokens'], ['output tokens / build', 'outputTokens'],
  ['build seconds (report)', 'buildSeconds'], ['model seconds (report)', 'modelSeconds'], ['wall seconds (runner)', 'wallSeconds'],
  ['provider cost USD / build', 'realCostUsd'], ['sandbox cost USD / build', 'sandboxCostUsd'], ['billed USD / build', 'billedUsd'],
];

/** Per-metric baseline vs candidate. A delta is only computed when both sides have a figure and the baseline is not zero. PURE. */
export function compareEvidence(baseline: BenchResultFile, candidate: BenchResultFile): { rows: EvidenceRow[]; baseline: EvidenceSummary; candidate: EvidenceSummary } {
  const b = summarizeEvidence(baseline.runs);
  const c = summarizeEvidence(candidate.runs);
  const rows: EvidenceRow[] = ROWS.map(([metric, key]) => {
    const bs = b[key] as MetricStat; const cs = c[key] as MetricStat;
    const deltaPct = bs.mean !== null && cs.mean !== null && bs.mean !== 0 ? Math.round(((cs.mean - bs.mean) / bs.mean) * 1000) / 10 : null;
    return { metric, baseline: bs.mean, candidate: cs.mean, deltaPct, nBaseline: bs.n, nCandidate: cs.n };
  });
  return { rows, baseline: b, candidate: c };
}

const fmt = (x: number | null): string => (x === null ? 'n/a' : Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : String(Math.round(x * 100) / 100));
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** One run's evidence, as the runner prints it. */
export function formatEvidenceSummary(s: EvidenceSummary, label: string): string {
  const l = [`Evidence — ${label} (${s.runs} builds):`];
  l.push(`  model calls ${fmt(s.llmCalls.mean)}/build (failed ${fmt(s.llmCallsFailed.mean)}) · input ${fmt(s.inputTokens.mean)} tok (cached ${s.cachedShare === null ? 'n/a' : pct(s.cachedShare)}) · output ${fmt(s.outputTokens.mean)} tok`);
  l.push(`  provider cost $${fmt(s.realCostUsd.mean)}/build (total $${fmt(s.realCostUsd.total)}, n=${s.realCostUsd.n}) · build ${fmt(s.buildSeconds.mean)}s · model time ${fmt(s.modelSeconds.mean)}s`);
  l.push(`  wall time p50 ${fmt(s.wallSeconds.p50 ?? null)}s / p95 ${fmt(s.wallSeconds.p95 ?? null)}s (n=${s.wallSeconds.n}) · provider cost p50 $${fmt(s.realCostUsd.p50 ?? null)} / p95 $${fmt(s.realCostUsd.p95 ?? null)} (n=${s.realCostUsd.n})`);
  l.push(`  gate: ${Object.entries(s.gate).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'} · preview: ${Object.entries(s.preview).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  const f = s.falsePositiveRate;
  l.push(`  of ${f.n} reported successes: ${s.successes.proven} proven · ${s.successes.contradicted} CONTRADICTED by the evidence (false-positive ${pct(f.rate)}, 95% CI ${pct(f.low)}–${pct(f.high)}) · ${s.successes.unproven} unproven`);
  const gaps = (['llmCalls', 'inputTokens', 'realCostUsd', 'buildSeconds'] as const).filter((k) => s[k].n < s.runs);
  if (gaps.length) l.push(`  ⚠️ not every build carried: ${gaps.map((k) => `${k} (${s[k].n}/${s.runs})`).join(', ')} — those means are over fewer builds`);
  l.push('  Render + gate evidence is not proof of every requested critical journey. First-attempt success, edit preservation and full critical-flow success remain unmeasured without those observations; repetitions are independent builds, not repairs.');
  return l.join('\n');
}

/** The side-by-side the compare script prints. */
export function formatEvidenceComparison(c: ReturnType<typeof compareEvidence>, labels: { baseline: string; candidate: string }): string {
  const lines = [`Evidence comparison — ${labels.baseline} → ${labels.candidate}`, `  ${'metric'.padEnd(30)} ${'baseline'.padStart(12)} ${'candidate'.padStart(12)} ${'delta'.padStart(9)}  n`];
  for (const r of c.rows) {
    lines.push(`  ${r.metric.padEnd(30)} ${fmt(r.baseline).padStart(12)} ${fmt(r.candidate).padStart(12)} ${(r.deltaPct === null ? 'n/a' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%`).padStart(9)}  ${r.nBaseline}/${r.nCandidate}`);
  }
  lines.push(`  cached share of input: ${c.baseline.cachedShare === null ? 'n/a' : pct(c.baseline.cachedShare)} → ${c.candidate.cachedShare === null ? 'n/a' : pct(c.candidate.cachedShare)}`);
  lines.push(`  false-positive success: ${pct(c.baseline.falsePositiveRate.rate)} (${c.baseline.successes.contradicted}/${c.baseline.falsePositiveRate.n}) → ${pct(c.candidate.falsePositiveRate.rate)} (${c.candidate.successes.contradicted}/${c.candidate.falsePositiveRate.n})`);
  lines.push('  Evidence means are per build over the builds that carried the figure (n = baseline/candidate); a delta is withheld when either side has none.');
  return lines.join('\n');
}
