/**
 * NavBharatAI — BUILD-RELIABILITY BENCHMARK runner (fix/build-reliability).
 *
 * Runs the 15-prompt SMOKE set or the 50-prompt FULL set (scripts/fixtures/reliability-bench-prompts.json)
 * against a LIVE server, scores each build with the pure helpers in
 * src/server/AgentV3/reliability/benchHarness.ts, and writes one JSON result file. Compare two result
 * files with scripts/agentv3-reliability-compare.ts.
 *
 * ⚠️ EVERY BUILD IS A REAL BUILD — it spends real provider money and sandbox time. The runner therefore
 * does a DRY RUN (lists what it would send) unless BENCH_CONFIRM=yes is set.
 *
 *   # baseline: server with every AGENTV3_* reliability flag OFF
 *   BENCH_LABEL=baseline BENCH_SET=smoke BENCH_USER_ID=<uid> BENCH_EMAIL=<email> BENCH_CONFIRM=yes npm run bench:reliability
 *   # candidate: restart the server with the flags ON, then
 *   BENCH_LABEL=flags-on BENCH_FLAGS=AGENTV3_STICKY_RUNG,AGENTV3_QUALITY_ESCALATE BENCH_SET=smoke … npm run bench:reliability
 *   npm run bench:compare -- scripts/bench-results/<baseline>.json scripts/bench-results/<candidate>.json
 *
 * Env: BENCH_BASE_URL (default http://localhost:8080), BENCH_LABEL, BENCH_SET (smoke|full, default smoke),
 *      BENCH_USER_ID / BENCH_EMAIL (a v3-enabled test account on the tier under test),
 *      BENCH_RUNS (attempts per prompt, default 1), BENCH_ONLY (comma ids), BENCH_FLAGS (comma, recorded only),
 *      BENCH_TIMEOUT_S (per build, default 1800), BENCH_CONFIRM=yes (actually run),
 *      BENCH_POWER_LEVEL (weak|off|mini|medium|max, default weak — sent as `powerLevel`; compare refuses mixed tiers).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseNdjson, metricsFromEvents, type BuildMetrics } from '../src/server/AgentV3/BakeoffMetrics';
import { benchPowerLevel, benchRequestBody, breakdown, buildSucceeded, selectBenchPrompts, successRate, validateBenchFixture, type BenchResultFile, type BenchRun } from '../src/server/AgentV3/reliability/benchHarness';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const BASE_URL = env.BENCH_BASE_URL || 'http://localhost:8080';
const LABEL = (env.BENCH_LABEL || 'candidate').replace(/[^a-z0-9._-]/gi, '_');
const SET: 'smoke' | 'full' = env.BENCH_SET === 'full' ? 'full' : 'smoke';
const RUNS = Math.max(1, parseInt(env.BENCH_RUNS || '1', 10) || 1);
const ONLY = (env.BENCH_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const FLAGS = (env.BENCH_FLAGS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TIMEOUT_MS = Math.max(60, parseInt(env.BENCH_TIMEOUT_S || '1800', 10) || 1800) * 1000;
const CONFIRMED = env.BENCH_CONFIRM === 'yes';
const POWER_LEVEL = benchPowerLevel(env); // default 'weak' — sent as powerLevel on every build

const FAILED: BuildMetrics = { filesCreated: 0, ok: false, readinessScore: null, billedUsd: null, toolCalls: 0, toolErrors: 0, providerFallbacks: 0, geminiTrap: false, errored: true };

async function runOneBuild(prompt: string): Promise<BuildMetrics> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/agentv3/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify(benchRequestBody(prompt, {
        userId: env.BENCH_USER_ID,
        email: env.BENCH_EMAIL,
        sessionId: `relbench-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        powerLevel: POWER_LEVEL,
      })),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    return metricsFromEvents(parseNdjson(await res.text()));
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const fx = validateBenchFixture(JSON.parse(readFileSync(join(HERE, 'fixtures/reliability-bench-prompts.json'), 'utf8')));
  const prompts = selectBenchPrompts(fx, SET, ONLY);
  if (!prompts.length) { console.error('No prompts selected (check BENCH_ONLY).'); process.exit(1); }
  console.log(`Reliability bench "${LABEL}" — ${SET} set, ${prompts.length} prompts × ${RUNS}, tier ${POWER_LEVEL} → ${BASE_URL}`);
  if (!CONFIRMED) {
    console.log('\nDRY RUN (no build started). These would be sent:');
    for (const p of prompts) console.log(`  - [${p.lang}/${p.complexity}] ${p.id}: ${p.prompt}`);
    console.log('\nSet BENCH_CONFIRM=yes to run them for real (costs provider money).');
    return;
  }
  const startedAt = new Date().toISOString();
  const runs: BenchRun[] = [];
  for (const p of prompts) {
    for (let attempt = 1; attempt <= RUNS; attempt++) {
      const t0 = Date.now();
      let metrics: BuildMetrics;
      try { metrics = await runOneBuild(p.prompt); } catch (err) {
        console.log(`  ✗ ${p.id}#${attempt}: ${err instanceof Error ? err.message : String(err)}`);
        metrics = FAILED;
      }
      const run: BenchRun = { id: p.id, lang: p.lang, complexity: p.complexity, attempt, seconds: Math.round((Date.now() - t0) / 1000), metrics, success: buildSucceeded(metrics) };
      runs.push(run);
      console.log(`  ${run.success ? '✓' : '✗'} ${p.id}#${attempt} files=${metrics.filesCreated} ok=${metrics.ok} readiness=${metrics.readinessScore ?? 'n/a'} (${run.seconds}s)`);
    }
  }
  const total = successRate(runs);
  console.log(`\nSuccess: ${total.successes}/${total.n} = ${(total.rate * 100).toFixed(1)}% (95% CI ${(total.low * 100).toFixed(1)}–${(total.high * 100).toFixed(1)}%)`);
  console.log('By complexity:', JSON.stringify(breakdown(runs, 'complexity')));
  console.log('By language:', JSON.stringify(breakdown(runs, 'lang')));
  const out: BenchResultFile = { label: LABEL, powerLevel: POWER_LEVEL, set: SET, baseUrl: BASE_URL, startedAt, flags: FLAGS, runs };
  const dir = join(HERE, 'bench-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${LABEL}-${SET}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Results → ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
