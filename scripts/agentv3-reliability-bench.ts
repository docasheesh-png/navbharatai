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
 *      BENCH_TIMEOUT_S (per build, default 1800), BENCH_AUTH_TOKEN (current ID token),
 *      BENCH_OUTPUT_DIR (optional artifact directory), BENCH_CONFIRM=yes (actually run).
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseNdjson, metricsFromEvents, type BuildMetrics } from '../src/server/AgentV3/BakeoffMetrics';
import { breakdown, buildSucceeded, formatEvidenceSummary, selectBenchPrompts, successRate, summarizeEvidence, validateBenchFixture, verifiedOutcome, type BenchResultFile, type BenchRun } from '../src/server/AgentV3/reliability/benchHarness';
import { benchmarkEndpoint, benchmarkRequest, benchmarkToken } from './lib/reliabilityRequest';

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

const FAILED: BuildMetrics = { filesCreated: 0, ok: false, readinessScore: null, billedUsd: null, toolCalls: 0, toolErrors: 0, providerFallbacks: 0, geminiTrap: false, errored: true };

async function runOneBuild(request: ReturnType<typeof benchmarkRequest>, endpoint: string): Promise<BuildMetrics> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      ...request.init,
      signal: ctrl.signal,
    });
    // Do not echo arbitrary server response bodies (or credentials) into shared benchmark artifacts.
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return metricsFromEvents(parseNdjson(await res.text()));
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const fixtureBytes = readFileSync(join(HERE, 'fixtures/reliability-bench-prompts.json'), 'utf8');
  const fx = validateBenchFixture(JSON.parse(fixtureBytes));
  const prompts = selectBenchPrompts(fx, SET, ONLY);
  if (!prompts.length) { console.error('No prompts selected (check BENCH_ONLY).'); process.exit(1); }
  const endpoint = benchmarkEndpoint(BASE_URL);
  console.log(`Reliability bench "${LABEL}" — ${SET} set, ${prompts.length} prompts × ${RUNS} → ${BASE_URL}`);
  if (!CONFIRMED) {
    console.log('\nDRY RUN (no build started). These would be sent:');
    for (const p of prompts) console.log(`  - [${p.lang}/${p.complexity}] ${p.id}: ${p.prompt}`);
    console.log('\nSet BENCH_AUTH_TOKEN and BENCH_CONFIRM=yes to run them for real (costs provider money).');
    return;
  }
  const token = benchmarkToken(env.BENCH_AUTH_TOKEN);
  const startedAt = new Date().toISOString();
  const runs: BenchRun[] = [];
  const dir = env.BENCH_OUTPUT_DIR || join(HERE, 'bench-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${LABEL}-${SET}-${Date.now()}-${randomUUID()}.json`);
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(HERE, '..'), encoding: 'utf8' }).trim();
  const sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: join(HERE, '..'), encoding: 'utf8' }).trim().length > 0;
  const out: BenchResultFile = {
    label: LABEL, set: SET, baseUrl: new URL(endpoint).origin, startedAt, flags: FLAGS, runs,
    execution: { status: 'running', plannedRuns: prompts.length * RUNS, sourceCommit, sourceDirty,
      fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
      promptIds: prompts.map((p) => p.id), repetitions: RUNS, nodeVersion: process.version },
  };
  // Checkpoint before submission AND after completion: a crash during fetch must retain the IDs
  // needed to reconcile a possibly-running paid build. Distinct filenames isolate concurrent runs.
  const save = () => { writeFileSync(`${file}.tmp`, JSON.stringify(out, null, 2)); renameSync(`${file}.tmp`, file); };
  save();
  for (const p of prompts) {
    for (let attempt = 1; attempt <= RUNS; attempt++) {
      const t0 = Date.now();
      const request = benchmarkRequest(p.prompt, token, env.BENCH_USER_ID, env.BENCH_EMAIL);
      const row = runs.length;
      runs.push({ id: p.id, lang: p.lang, complexity: p.complexity, attempt, seconds: null,
        metrics: FAILED, success: false, requestId: request.requestId, sessionId: request.sessionId,
        failure: 'request-in-progress' });
      save();
      let metrics: BuildMetrics;
      let failure: BenchRun['failure'];
      try { metrics = await runOneBuild(request, endpoint); } catch (err) {
        // A timeout does not cancel the remote build or prove it was free. Never retry it automatically.
        const message = err instanceof Error && /^HTTP \d{3}$/.test(err.message) ? err.message : 'transport-or-timeout';
        failure = message;
        console.log(`  ✗ ${p.id}#${attempt}: ${message} (remote outcome/cost may be unknown)`);
        metrics = FAILED;
      }
      const run: BenchRun = { id: p.id, lang: p.lang, complexity: p.complexity, attempt, seconds: (Date.now() - t0) / 1000, metrics, success: buildSucceeded(metrics),
        requestId: request.requestId, sessionId: request.sessionId, ...(failure ? { failure } : {}) };
      runs[row] = run;
      save();
      if (failure === 'HTTP 401' || failure === 'HTTP 403') {
        out.execution!.status = 'blocked';
        save();
        throw new Error(`Benchmark authorization failed; refresh BENCH_AUTH_TOKEN. Partial evidence: ${file}`);
      }
      const ev = metrics.evidence;
      console.log(`  ${run.success ? '✓' : '✗'} ${p.id}#${attempt} files=${metrics.filesCreated} ok=${metrics.ok} readiness=${metrics.readinessScore ?? 'n/a'} (${run.seconds}s) gate=${ev?.gateState ?? 'n/a'} preview=${ev?.previewEvidence ?? 'n/a'} calls=${ev?.llmCalls ?? 'n/a'} in=${ev?.inputTokens ?? 'n/a'} cached=${ev?.cachedInputTokens ?? 'n/a'} out=${ev?.outputTokens ?? 'n/a'} cost=$${ev?.realCostUsd ?? 'n/a'} → ${verifiedOutcome(metrics)}`);
    }
  }
  const total = successRate(runs);
  console.log(`\nSuccess: ${total.successes}/${total.n} = ${(total.rate * 100).toFixed(1)}% (95% CI ${(total.low * 100).toFixed(1)}–${(total.high * 100).toFixed(1)}%)`);
  console.log('By complexity:', JSON.stringify(breakdown(runs, 'complexity')));
  console.log('By language:', JSON.stringify(breakdown(runs, 'lang')));
  console.log(formatEvidenceSummary(summarizeEvidence(runs), LABEL));
  out.execution!.status = 'complete';
  save();
  console.log(`Results → ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
