// GAME ENGINE ULTRA — PHASE 4: THE GAME BENCHMARK'S OWN READINGS. PURE.
//
// The reliability bench (scripts/agentv3-reliability-bench.ts) already runs a prompt set against a live
// server on an explicit tier and reads what the build cost from its own report (BakeoffMetrics →
// benchEvidence). With BENCH_FIXTURE=game it runs the game corpus (scripts/fixtures/game-bench-prompts.json)
// and this module adds what only a game build reports: the playtest outcome and Game Quality Score, the
// structured defects (Phase 2), the scope match (Phase 1), the repair and the gate (Phase 3).
//
// Every value is READ from the build's own diagnostics. A code that was never recorded leaves its field
// null — "not measured", never "passed". Nothing here estimates a cost or a rate.

export interface GameBenchSignals {
  kitSeeded: boolean | null;
  playtest: 'passed' | 'failed' | 'not-run' | null;
  /** Game Quality Score read from the playtest's own line, 0–100, or null. */
  gqs: number | null;
  defects: string[];
  scope: 'ok' | 'gap' | null;
  repair: 'repaired' | 'unrepaired' | 'skipped' | null;
  gateBlocked: boolean;
}

export type GameFailClass =
  | 'ok' | 'transport' | 'build-failed' | 'no-files' | 'errored'
  | 'not-playable' | 'scope-gap' | 'not-played';

type Issue = { code?: unknown; message?: unknown };

function issuesOf(events: ReadonlyArray<Record<string, unknown>>): Issue[] {
  let last: Issue[] = [];
  for (const e of events) {
    if (e.type !== 'result') continue;
    const d = e.diagnostics as { issues?: unknown } | undefined;
    if (Array.isArray(d?.issues)) last = d!.issues as Issue[];
  }
  return last;
}

export function gameSignalsFromEvents(events: ReadonlyArray<Record<string, unknown>>): GameBenchSignals {
  const out: GameBenchSignals = { kitSeeded: null, playtest: null, gqs: null, defects: [], scope: null, repair: null, gateBlocked: false };
  for (const i of issuesOf(events)) {
    const code = String(i.code ?? '');
    const msg = String(i.message ?? '');
    if (code === 'GAME_KIT_SEEDED') out.kitSeeded = true;
    else if (code === 'GAME_KIT_NOT_SEEDED') out.kitSeeded = false;
    else if (code === 'GAME_PLAYTEST_OK') out.playtest = 'passed';
    else if (code === 'GAME_PLAYTEST_ISSUES') out.playtest = 'failed';
    else if (code === 'GAME_PLAYTEST_NOT_RUN' && out.playtest === null) out.playtest = 'not-run';
    else if (code === 'GAME_SCOPE_OK') out.scope = 'ok';
    else if (code === 'GAME_SCOPE_GAP') out.scope = 'gap';
    else if (code === 'GAME_REPAIRED') out.repair = 'repaired';
    else if (code === 'GAME_REPAIR_UNREPAIRED') out.repair = 'unrepaired';
    else if (code === 'GAME_REPAIR_SKIPPED') out.repair = 'skipped';
    else if (code === 'GAME_COMPLETE_GATE_BLOCKED') out.gateBlocked = true;
    else if (code === 'GAME_DEFECTS') for (const m of msg.matchAll(/GAME_DEFECT_[A-Z_]+/g)) if (!out.defects.includes(m[0])) out.defects.push(m[0]);
    if (code.startsWith('GAME_PLAYTEST_') && out.gqs === null) {
      const m = /Game Quality Score (\d{1,3})\/100/.exec(msg);
      if (m) out.gqs = Math.min(100, Number(m[1]));
    }
  }
  return out;
}

const HARD = new Set(['GAME_DEFECT_BLANK', 'GAME_DEFECT_INPUT_IGNORED', 'GAME_DEFECT_START_STUCK', 'GAME_DEFECT_RUNTIME_ERROR', 'GAME_DEFECT_MISSING_LAYER']);

/** One class per run, worst first. `success` is the reliability bench's own strict verdict. PURE. */
export function gameFailClass(run: { failure?: string; success: boolean; metrics: { ok: boolean; filesCreated: number; errored: boolean } }, g: GameBenchSignals | null): GameFailClass {
  if (run.failure) return 'transport';
  if (run.metrics.errored) return 'errored';
  if (run.metrics.filesCreated <= 0) return 'no-files';
  if (!run.success || !run.metrics.ok) return 'build-failed';
  if (g && (g.defects.some((d) => HARD.has(d)) || g.gateBlocked)) return 'not-playable';
  if (g?.scope === 'gap') return 'scope-gap';
  if (!g || g.playtest === null || g.playtest === 'not-run') return 'not-played';
  return 'ok';
}

export interface GameBenchSummary {
  runs: number;
  byClass: Record<string, number>;
  /** Mean GQS over runs that reported one, with how many did. */
  gqs: { n: number; mean: number | null };
  /** Seconds and real cost over runs that REPORTED them; n says how many. */
  seconds: { n: number; total: number };
  realCostUsd: { n: number; total: number };
  defects: Record<string, number>;
}

export function summarizeGameBench(rows: ReadonlyArray<{ seconds: number | null; realCostUsd: number | null; cls: GameFailClass; game: GameBenchSignals | null }>): GameBenchSummary {
  const s: GameBenchSummary = { runs: rows.length, byClass: {}, gqs: { n: 0, mean: null }, seconds: { n: 0, total: 0 }, realCostUsd: { n: 0, total: 0 }, defects: {} };
  let gsum = 0;
  for (const r of rows) {
    s.byClass[r.cls] = (s.byClass[r.cls] ?? 0) + 1;
    if (r.game?.gqs != null) { s.gqs.n++; gsum += r.game.gqs; }
    if (r.seconds != null && Number.isFinite(r.seconds)) { s.seconds.n++; s.seconds.total += r.seconds; }
    if (r.realCostUsd != null && Number.isFinite(r.realCostUsd)) { s.realCostUsd.n++; s.realCostUsd.total += r.realCostUsd; }
    for (const d of r.game?.defects ?? []) s.defects[d] = (s.defects[d] ?? 0) + 1;
  }
  s.gqs.mean = s.gqs.n ? gsum / s.gqs.n : null;
  return s;
}

/** The fixture path for BENCH_FIXTURE. Only two known corpora; anything else is refused. PURE. */
export function benchFixtureFile(value: string | undefined): string {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === '' || v === 'reliability') return 'fixtures/reliability-bench-prompts.json';
  if (v === 'game') return 'fixtures/game-bench-prompts.json';
  throw new Error('BENCH_FIXTURE must be "reliability" (default) or "game".');
}
