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
  seconds: number;
  metrics: BuildMetrics;
  success: boolean;
}

export interface BenchResultFile {
  label: string;
  set: 'smoke' | 'full';
  baseUrl: string;
  startedAt: string;
  /** Flags the operator says were on for this run (recorded, not verified — the server owns them). */
  flags: string[];
  runs: BenchRun[];
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
  const verdict = separated
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
