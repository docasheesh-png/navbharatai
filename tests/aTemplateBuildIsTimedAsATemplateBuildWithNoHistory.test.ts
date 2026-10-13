// AUTOPSY 303e8a6f (2026-10-12), item I — the AI-image chip seeded a tested template and its ETA was "~3–6 min ·
// basis heuristic · No past builds to learn from yet". Q-060 (autopsy 4a1c0157) had taught the ETA's HISTORY path
// that a seeded template is its own kind ('scaffold' slice). When that slice is empty, the fallback still sized the
// build by the chip's WORDING, as if the app were built from scratch — across the seeded chips the same
// verify-and-polish turn was priced 2.6–5.5 min to 7.3–15.5 min, and the login-page chip's band excluded its own
// measured build. And the admin line could not tell an empty 'scaffold' slice from a regressed key: it said
// "No past builds" for a filter that only proves "no day with two finished builds".
//
// Found beside it: the ETA the admin decided to show (2026-09-26) never reached the main chat — the timeline drops
// every '⏱' line as progress noise — while the report said "Shown to the user".
//
// ⚠️ CORRECTED BY THE ADVERSARIAL REVIEW: the first fix priced every simple template at one constant calibrated on
// two builds, which LOWERED seven unmeasured chips (wedding-rsvp 10.5 → 4 min) — the optimistic direction, which
// breaks a promise instead of arriving early. That constant is gone. The template learns from MEASUREMENT: its
// slice is split by tier (a pro template is extended, a simple one polished — one slice averaged the two), and a
// failed telemetry read is said as a failure. Whether big simple templates finish in ~4 min stays open until the
// slice has data (queue row) — it is never asserted in a test.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';
import { goldenScaffoldForPrompt } from '../src/server/AgentV3/goldenScaffolds/registry';
import { estimateBuildTime, complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';
import { fleetHistoryFromTelemetry, fleetEmptyBasisNote, etaSliceWords, etaTaskKey, SCAFFOLD_TASK_KEY, SCAFFOLD_PRO_TASK_KEY, FLEET_MIN_BUILDS_PER_DAY } from '../src/server/AgentV3/etaHistory';
import { unevidencedFirstEtaLine, etaEvidenceNote, ROUGH_ESTIMATE_LABEL } from '../src/server/AgentV3/etaEvidence';
import { BuildDiagnostics, etaAccuracy } from '../src/server/AgentV3/BuildDiagnostics';
import { latestLiveStatusText, ETA_LINE_ID } from '../src/lib/liveStatusLine';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const MIN = 60_000;

const SEEDED = STARTER_TEMPLATES
  .map((t) => ({ t, g: goldenScaffoldForPrompt(t.prompt) }))
  .filter((x) => !!x.g);

describe('1 · 🔒 a seeded build learns from builds of its own TIER — and is never priced below its wording by a guess', () => {
  it('there are seeded chips of both tiers to read (the census is reading something)', () => {
    expect(SEEDED.filter((x) => x.g!.tier === 'simple').length).toBeGreaterThanOrEqual(15);
    expect(SEEDED.filter((x) => x.g!.tier === 'pro').length).toBeGreaterThanOrEqual(5);
  });

  it('every seeded chip keys the slice of its tier; a pro template never pours into the simple slice', () => {
    for (const { t, g } of SEEDED) {
      const key = etaTaskKey('simple_app', true, false, null, g!.tier);
      expect(key, t.id).toBe(g!.tier === 'pro' ? SCAFFOLD_PRO_TASK_KEY : SCAFFOLD_TASK_KEY);
    }
    expect(etaTaskKey('complex_app', true)).toBe(SCAFFOLD_TASK_KEY); // an old caller with no tier keeps its slice
    expect(etaSliceWords(SCAFFOLD_PRO_TASK_KEY)).toMatch(/extend a tested pro template/);
  });

  it('🔒 the reader and the writer key a seeded build the same way, tier included', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('etaKeyForBuild(scaffoldWillSeed, seededScaffold?.tier ?? null)');
    expect(route).toContain('taskType: etaKeyForBuild(goldenPreseeded, goldenPreseededTier),');
    expect(route).toContain('goldenPreseededTier = golden.tier;');
    expect(route.match(/etaKeyForBuild\(/g)!.length).toBe(2); // the reader and the writer — one helper
  });

  it('🔒 no constant re-sizes a seeded build: an unmeasured chip keeps its wording estimate (the over-estimate side)', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).not.toMatch(/templateSizedComplexity|TEMPLATE_POLISH_COMPLEXITY/);
    expect(route).toMatch(/const etaComplexity = etaByProject\s*\? projectSizedComplexity\(complexityFromPrompt\(planning\.sizing\), projectFilePaths\)\s*: complexityFromPrompt\(planning\.sizing\);/);
    const wedding = SEEDED.find((x) => x.t.id === 'wedding-rsvp');
    if (wedding) expect(estimateBuildTime(complexityFromPrompt(wedding.t.prompt), []).estimateMs).toBeGreaterThan(5 * MIN);
  });
});

// The real shape of a week where template builds finished, one a day — below the per-day floor every day.
const ONE_A_DAY = Array.from({ length: 7 }, (_, i) => ({
  date: `2026-10-0${i + 1}`,
  byTaskType: { [SCAFFOLD_TASK_KEY]: { builds: 3, okBuilds: 1, okDurationMs: 4 * MIN, durationMs: 5 * MIN } },
}));

describe('2 · an empty slice is reported as what it is', () => {
  it('a week of one finished template build a day: no history, but the window is counted', () => {
    const f = fleetHistoryFromTelemetry(ONE_A_DAY, SCAFFOLD_TASK_KEY, { moduleCount: 1, featureCount: 9 });
    expect(f.history).toEqual([]);
    expect(f.seenOk).toBe(7);
    expect(f.daysRead).toBe(7);
  });

  it('the admin line names the slice and the reason, never "no past builds"', () => {
    const line = fleetEmptyBasisNote(SCAFFOLD_TASK_KEY, 7, 7);
    expect(line).toContain('tested template');
    expect(line).toContain('finished 7');
    expect(line).toContain(`never ${FLEET_MIN_BUILDS_PER_DAY} on one day`);
    expect(line).not.toMatch(/no past builds to learn from/i);
    expect(fleetEmptyBasisNote(SCAFFOLD_TASK_KEY, 0, 7)).toContain('none of NavBharatAI\'s builds that start from a tested template (verify and polish) finished');
    expect(fleetEmptyBasisNote('complex_app', 0, 0)).toContain('returned no days');
    expect(fleetEmptyBasisNote('complex_app', 0, 0)).toContain('a read that failed without saying so');
    // A read that timed out is said as a failure, never as "no days".
    const failed = fleetEmptyBasisNote(SCAFFOLD_TASK_KEY, 0, 0, { readFailed: true });
    expect(failed).toContain('could not be read in time');
    expect(failed).not.toContain('returned no days');
    // A template build and a from-scratch complex app no longer read the same.
    expect(fleetEmptyBasisNote(SCAFFOLD_TASK_KEY, 0, 7)).not.toBe(fleetEmptyBasisNote('complex_app', 0, 7));
  });

  it('🔒 census: every slice the ETA can ask for has words', () => {
    // Every TaskType, read from the union itself, plus the kinds etaTaskKey adds.
    const analyser = read('src/server/AgentV3/RequestAnalyser.ts');
    const union = analyser.slice(analyser.indexOf('export type TaskType ='), analyser.indexOf(';', analyser.indexOf('export type TaskType =')));
    const taskTypes = [...union.matchAll(/\|\s*'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(taskTypes.length).toBeGreaterThan(8);
    const keys = new Set([
      ...taskTypes.map((t) => etaTaskKey(t, false)),
      etaTaskKey('simple_app', true), etaTaskKey('simple_app', true, false, null, 'pro'), etaTaskKey('simple_app', false, false, 'game'), etaTaskKey('simple_app', false, false, 'image_app'),
      etaTaskKey('simple_app', false, true), etaTaskKey(null, false),
    ]);
    for (const k of keys) expect(etaSliceWords(k), k).not.toMatch(/^"/);
  });

  it('🔒 the route uses the empty-slice line whenever a slice was asked and taught nothing', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("etaSource === 'heuristic' && etaFleetKey\n              ? fleetEmptyBasisNote(etaFleetKey, fleet.seenOk, fleet.daysRead, { readFailed: fleetReadFailed })");
    expect(route).toContain('catch { fleetReadFailed = true;');
    expect(route).not.toMatch(/fleet\.history\.length > 0 && etaFleetKey \? fleetEtaBasisNote\(etaFleetKey, fleet\.builds, fleet\.days\) : etaBasisNote\(past\)/);
  });

  it('the cold evidence sentence claims only what was measured', () => {
    const note = etaEvidenceNote({ historyWeight: 0, basis: 'heuristic', estimateMs: 4 * MIN, lowMs: 3 * MIN, highMs: 6 * MIN });
    expect(note).toContain('no past builds of this kind were measured');
    expect(note).not.toContain('there are no past builds');
  });
});

describe('3 · the user is told why the figure is a guess — truthfully', () => {
  it('the rough estimate keeps its one honest label (no template-sized figure exists to describe differently)', () => {
    expect(unevidencedFirstEtaLine({ estimateMs: 4 * MIN, lowMs: 2.8 * MIN, highMs: 5.8 * MIN })).toContain(ROUGH_ESTIMATE_LABEL);
  });
});

describe('4 · the promise names its kind, so accuracy can be read per kind', () => {
  it('the slice and source ride from the promise into the accuracy record', () => {
    const d = new BuildDiagnostics();
    d.setEtaPromise({ estimateMs: 4 * MIN, lowMs: 2.8 * MIN, highMs: 5.8 * MIN, evidenced: false, shown: 'Rough estimate: ~3–6 min', key: SCAFFOLD_TASK_KEY, source: 'heuristic' });
    const acc = etaAccuracy({ estimateMs: 4 * MIN, lowMs: 2.8 * MIN, highMs: 5.8 * MIN, evidenced: false, key: SCAFFOLD_TASK_KEY, source: 'heuristic' }, 0, 4 * MIN);
    expect(acc).toMatchObject({ key: SCAFFOLD_TASK_KEY, source: 'heuristic', withinBand: true });
    // An old promise without a kind still judges, and simply carries none.
    expect(etaAccuracy({ estimateMs: 4 * MIN, lowMs: 3 * MIN, highMs: 6 * MIN, evidenced: false }, 0, 4 * MIN)).not.toHaveProperty('key');
  });

  it('🔒 the route records the key and the source with the promise', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('...(etaFleetKey ? { key: etaFleetKey } : {}), source: etaSource,');
    // …and the admin list row carries it, so within-band can be read per kind.
    expect(read('src/server/AgentV3/AdminBuildReportStore.ts')).toMatch(/etaKey: typeof trimmed\.etaAccuracy\?\.key === 'string'/);
  });
});

describe('5 · the ETA the report says was shown is on the screen', () => {
  it('the status line reads the newest ETA line, by its id', () => {
    const lines = [
      { id: ETA_LINE_ID, text: '⏱️ Rough estimate: ~3–6 min — a guess.' },
      { id: 'turn-1', text: 'Writing src/App.tsx' },
      { id: ETA_LINE_ID, text: '⏱️ Still building… 2 min in · rough estimate ~3–6 min' },
    ];
    expect(latestLiveStatusText(lines, ETA_LINE_ID)).toBe('⏱️ Still building… 2 min in · rough estimate ~3–6 min');
    expect(latestLiveStatusText([{ text: 'Writing' }], ETA_LINE_ID)).toBeNull();
  });

  it('🔒 the chat still hides ⏱ lines — and the build\'s status line shows the ETA instead', () => {
    expect(read('src/components/agentv3/activityTimeline.ts')).toContain("if (t.startsWith('⏱')) return true;");
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('etaLine={running ? latestLiveStatusText(state.narration, ETA_LINE_ID) : null}');
    expect(panel).toMatch(/\{running && etaLine && \(\s*<div[^>]*>\{etaLine\.replace\(/);
  });

  it('every ETA line the route emits carries the id the status line reads', () => {
    const route = read('src/server/routes/agentv3.ts');
    const etaEmits = [...route.matchAll(/events\.emit\(\{ type: 'narration'[^\n]*(?:EtaLine|EtaTickLine|etaShown|liveEtaTick|tick\.text)[^\n]*\}\)/g)].map((m) => m[0]);
    expect(etaEmits.length).toBeGreaterThan(0);
    for (const e of etaEmits) expect(e).toContain("id: 'eta-live'");
  });
});
