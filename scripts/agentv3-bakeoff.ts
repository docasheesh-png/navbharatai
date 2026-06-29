/**
 * NavBharatAI Pro v3.0 — cheap-model BAKE-OFF runner (PR2 of the cost-down plan).
 *
 * Runs N real builds per fixture prompt against a LIVE server and scores the candidate model on
 * OBJECTIVE signals (did it write real files / pass / how many fallbacks to Claude / cost) using the
 * pure helpers in src/server/AgentV3/BakeoffMetrics.ts. This is a manual ADMIN tool — it touches no
 * production code path and is never imported by the server. Run it with the server configured for
 * ONE candidate (e.g. AGENTV3_CHEAP_FLOOR=glm) and a v3.0-enabled test account, then re-run for the
 * next candidate. Compare the printed verdicts before trusting any model as the floor.
 *
 *   # 1) start the server with the candidate active (separate shell):
 *   AGENTV3_CHEAP_FLOOR=glm GLM_API_KEY=… E2B_API_KEY=… ANTHROPIC_API_KEY=… npm run dev
 *   # 2) run the bake-off against it:
 *   BAKEOFF_LABEL=glm BAKEOFF_USER_ID=<allowlisted-uid> BAKEOFF_EMAIL=<email> npm run bakeoff
 *
 * Env: BAKEOFF_BASE_URL (default http://localhost:8080), BAKEOFF_LABEL (candidate name),
 *      BAKEOFF_USER_ID / BAKEOFF_EMAIL (a v3.0-enabled account), BAKEOFF_RUNS (per prompt, default 1),
 *      BAKEOFF_ONLY (comma-separated prompt ids to include).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseNdjson, metricsFromEvents, aggregate, formatReport, type BuildMetrics } from '../src/server/AgentV3/BakeoffMetrics';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BAKEOFF_BASE_URL || 'http://localhost:8080';
const LABEL = process.env.BAKEOFF_LABEL || 'candidate';
const USER_ID = process.env.BAKEOFF_USER_ID || '';
const EMAIL = process.env.BAKEOFF_EMAIL || '';
const RUNS = Math.max(1, parseInt(process.env.BAKEOFF_RUNS || '1', 10) || 1);
const ONLY = (process.env.BAKEOFF_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

interface Fixture { id: string; complexity: string; prompt: string }

function loadPrompts(): Fixture[] {
  const raw = JSON.parse(readFileSync(join(HERE, 'fixtures/bakeoff-prompts.json'), 'utf8'));
  const all: Fixture[] = Array.isArray(raw?.prompts) ? raw.prompts : [];
  return ONLY.length ? all.filter((p) => ONLY.includes(p.id)) : all;
}

function newSessionId(): string {
  return `bakeoff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function runOneBuild(prompt: string): Promise<BuildMetrics> {
  const res = await fetch(`${BASE_URL}/api/agentv3/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      userId: USER_ID || undefined,
      email: EMAIL || undefined,
      sessionId: newSessionId(), // a FRESH build each time (never an edit of a prior one)
      planFirst: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from /api/agentv3/chat: ${body.slice(0, 300)}`);
  }
  const text = await res.text(); // full NDJSON once the build stream closes
  return metricsFromEvents(parseNdjson(text));
}

async function main(): Promise<void> {
  const prompts = loadPrompts();
  if (!prompts.length) { console.error('No prompts to run (check BAKEOFF_ONLY).'); process.exit(1); }
  console.log(`Bake-off "${LABEL}" → ${BASE_URL}  (${prompts.length} prompts × ${RUNS} run(s))\n`);

  const runs: BuildMetrics[] = [];
  for (const p of prompts) {
    for (let i = 0; i < RUNS; i++) {
      const tag = `${p.id}#${i + 1} (${p.complexity})`;
      try {
        const started = Date.now();
        const m = await runOneBuild(p.prompt);
        runs.push(m);
        const secs = Math.round((Date.now() - started) / 1000);
        console.log(
          `  ✓ ${tag}: files=${m.filesCreated} ok=${m.ok} readiness=${m.readinessScore ?? 'n/a'} ` +
          `fallbacks=${m.providerFallbacks} ${m.geminiTrap ? '⚠ GEMINI-TRAP' : ''} (${secs}s)`,
        );
      } catch (err) {
        console.log(`  ✗ ${tag}: ${err instanceof Error ? err.message : String(err)}`);
        runs.push({ filesCreated: 0, ok: false, readinessScore: null, billedUsd: null, toolCalls: 0, toolErrors: 0, providerFallbacks: 0, geminiTrap: false, errored: true });
      }
    }
  }

  const agg = aggregate(LABEL, runs);
  console.log('\n' + formatReport([agg]));
  const outFile = join(HERE, `bakeoff-results-${LABEL}-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify({ label: LABEL, baseUrl: BASE_URL, runs, aggregate: agg }, null, 2));
  console.log(`Raw results → ${outFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
