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
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';
import { goldenScaffoldForPrompt } from '../src/server/AgentV3/goldenScaffolds/registry';
import { estimateBuildTime, complexityFromPrompt, templateSizedComplexity, TEMPLATE_POLISH_COMPLEXITY } from '../src/server/lib/BuildTimeEstimator';
import { fleetHistoryFromTelemetry, fleetEmptyBasisNote, etaSliceWords, etaTaskKey, SCAFFOLD_TASK_KEY, FLEET_MIN_BUILDS_PER_DAY } from '../src/server/AgentV3/etaHistory';
import { unevidencedFirstEtaLine, unevidencedEtaTickLine, etaEvidenceNote, ROUGH_ESTIMATE_LABEL, TEMPLATE_ROUGH_ESTIMATE_LABEL } from '../src/server/AgentV3/etaEvidence';
import { BuildDiagnostics, etaAccuracy } from '../src/server/AgentV3/BuildDiagnostics';
import { latestLiveStatusText, ETA_LINE_ID } from '../src/lib/liveStatusLine';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const MIN = 60_000;
// The two clean measured template builds (PROGRESS.md: 4a1c0157 login page 3.8 min, 8257ca59 calculator 4.3 min).
const MEASURED_TEMPLATE_BUILDS_MS = [3.8 * MIN, 4.3 * MIN];

const SIMPLE_SEEDED = STARTER_TEMPLATES
  .map((t) => ({ t, g: goldenScaffoldForPrompt(t.prompt) }))
  .filter((x) => x.g?.tier === 'simple');

describe('1 · 🔒 census: a seeded simple template is priced as a template, whatever the chip says', () => {
  it('there are seeded simple chips to read (the census is reading something)', () => {
    expect(SIMPLE_SEEDED.length).toBeGreaterThanOrEqual(15);
  });

  it('every one gets the SAME estimate, and its band holds both measured template builds', () => {
    const estimates = SIMPLE_SEEDED.map(({ t, g }) => estimateBuildTime(templateSizedComplexity(complexityFromPrompt(t.prompt), g!.tier), []));
    const first = estimates[0]!;
    for (const [i, e] of estimates.entries()) expect([e.lowMs, e.highMs], SIMPLE_SEEDED[i]!.t.id).toEqual([first.lowMs, first.highMs]);
    for (const ms of MEASURED_TEMPLATE_BUILDS_MS) {
      expect(ms).toBeGreaterThanOrEqual(first.lowMs);
      expect(ms).toBeLessThanOrEqual(first.highMs);
    }
  });

  it('the wording-sized fallback this replaces excluded the login page\'s own measured build', () => {
    const login = SIMPLE_SEEDED.find((x) => x.t.id === 'login-page');
    expect(login).toBeTruthy();
    const byWording = estimateBuildTime(complexityFromPrompt(login!.t.prompt), []);
    expect(byWording.lowMs).toBeGreaterThan(3.8 * MIN); // the defect, stated
    const byTemplate = estimateBuildTime(templateSizedComplexity(complexityFromPrompt(login!.t.prompt), 'simple'), []);
    expect(byTemplate.lowMs).toBeLessThanOrEqual(3.8 * MIN);
  });

  it('a pro template is an architecture the request extends — the request still sizes it', () => {
    const base = complexityFromPrompt('Build a CRM with leads, deals, a pipeline board, reports and email reminders');
    expect(templateSizedComplexity(base, 'pro')).toEqual(base);
    expect(templateSizedComplexity(base, 'simple')).toMatchObject(TEMPLATE_POLISH_COMPLEXITY);
  });

  it('🔒 the route prices a seeded build by its template', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/: seededScaffold\s*\? templateSizedComplexity\(complexityFromPrompt\(planning\.sizing\), seededScaffold\.tier\)/);
    expect(route).toMatch(/const scaffoldWillSeed = !!seededScaffold;/);
  });
});

// The real shape of a week where template builds finished, one a day — below the per-day floor every day.
const ONE_A_DAY = Array.from({ length: 7 }, (_, i) => ({
  date: `2026-10-0${i + 1}`,
  byTaskType: { [SCAFFOLD_TASK_KEY]: { builds: 3, okBuilds: 1, okDurationMs: 4 * MIN, durationMs: 5 * MIN } },
}));

describe('2 · an empty slice is reported as what it is', () => {
  it('a week of one finished template build a day: no history, but the window is counted', () => {
    const f = fleetHistoryFromTelemetry(ONE_A_DAY, SCAFFOLD_TASK_KEY, TEMPLATE_POLISH_COMPLEXITY);
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
      etaTaskKey('simple_app', true), etaTaskKey('simple_app', false, false, 'game'), etaTaskKey('simple_app', false, false, 'image_app'),
      etaTaskKey('simple_app', false, true), etaTaskKey(null, false),
    ]);
    for (const k of keys) expect(etaSliceWords(k), k).not.toMatch(/^"/);
  });

  it('🔒 the route uses the empty-slice line whenever a slice was asked and taught nothing', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("etaSource === 'heuristic' && etaFleetKey\n              ? fleetEmptyBasisNote(etaFleetKey, fleet.seenOk, fleet.daysRead)");
    expect(route).not.toMatch(/fleet\.history\.length > 0 && etaFleetKey \? fleetEtaBasisNote\(etaFleetKey, fleet\.builds, fleet\.days\) : etaBasisNote\(past\)/);
  });

  it('the cold evidence sentence claims only what was measured', () => {
    const note = etaEvidenceNote({ historyWeight: 0, basis: 'heuristic', estimateMs: 4 * MIN, lowMs: 3 * MIN, highMs: 6 * MIN });
    expect(note).toContain('no past builds of this kind were measured');
    expect(note).not.toContain('there are no past builds');
  });
});

describe('3 · the user is told why the figure is a guess — truthfully', () => {
  const est = { estimateMs: 4 * MIN, lowMs: 2.8 * MIN, highMs: 5.8 * MIN };
  it('a template build\'s rough estimate does not claim to come from the size of the request', () => {
    expect(unevidencedFirstEtaLine(est, { fromTemplate: true })).toContain(TEMPLATE_ROUGH_ESTIMATE_LABEL);
    expect(unevidencedFirstEtaLine(est, { fromTemplate: true })).not.toContain(ROUGH_ESTIMATE_LABEL);
    expect(unevidencedEtaTickLine(MIN, 30 * MIN, '~3–6 min', 6 * MIN, true)).toContain(TEMPLATE_ROUGH_ESTIMATE_LABEL);
    // Every other build reads exactly as before.
    expect(unevidencedFirstEtaLine(est)).toContain(ROUGH_ESTIMATE_LABEL);
  });

  it('🔒 the route labels it only when the template — not real history — sized it', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("etaFromTemplate = seededScaffold?.tier === 'simple' && past.length === 0 && fleet.history.length === 0;");
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
