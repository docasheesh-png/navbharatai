/**
 * AUTOPSY — the Study-Racer session, PART 2 (admin, 2026-09-26: "sab karo, ETA dikhao andaaza label ke saath").
 *
 * Part 1 (theStudyRacerAutopsy.test.ts) closed six root causes and named five open items. The admin
 * asked for all five, and decided the one that was a product question: show the estimate, labelled a
 * guess. This file locks those five:
 *
 * 1. The fast lane hands off the moment its chain falls to an engine that reasons before every
 *    answer — the decision `fastLaneRungDecision` takes once at the OPENER, taken again on every fall.
 * 2. Two classifiers disagreeing is a fact, not a tie the dearer one wins: a famous name used (not
 *    cloned) + a simple complexity score + a small-app noun stands the roadmap planner down.
 * 3. `REQUIREMENT_GAPS` is recorded on a fresh build only, never on an edit turn.
 * 4. An unevidenced ETA is SHOWN as a rough estimate, labelled a guess — first line, tick and report.
 * 5. The architect is told what the platform verifies after its turn, so it stops repeating it; and a
 *    refused post-green write by the engine's own pass no longer invites the user to "reply".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { analyzeAppScope, scopeDispute } from '../src/server/lib/appScopeAnalyzer';
import { unevidencedFirstEtaLine, unevidencedEtaTickLine, etaEvidenceNote, roughEstimateBand, ROUGH_ESTIMATE_LABEL } from '../src/server/AgentV3/etaEvidence';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MIN = 60_000;

// ── 1. the lane stops when its chain falls to a reasoning rung ──────────────────────────────────

describe('1 · the fast lane hands off when told its engine now reasons before every answer', () => {
  const manifestText = [
    'src/types.ts :: shared types',
    'src/hooks/useGame.ts :: game hook',
    'src/components/Board.tsx :: board',
    'src/App.tsx :: root',
  ].join('\n');
  const fileBlock = (p: string) => `<<<FILE ${p}>>>\nexport const x_${p.replace(/\W/g, '_')} = 1;\n<<<ENDFILE>>>`;

  function deps(stopAfterCalls: number) {
    let calls = 0;
    const written: string[] = [];
    let stopReason: string | null = null;
    return {
      calls: () => calls,
      written,
      run: () => runSimpleBuild({
        prompt: 'a small game', framework: 'vite-react', scaffoldPaths: ['src/App.tsx', 'src/main.tsx'],
        generate: async (system: string, user: string) => {
          calls += 1;
          if (calls > stopAfterCalls) stopReason = 'the lane\'s engine fell to kimi-k2.7-code, which reasons before every answer';
          if (user.includes('Plan the file list')) return manifestText;
          if (system.includes('SHARED CONTRACT')) return 'export type X = 1;';
          const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/x.ts';
          return fileBlock(path);
        },
        writeFiles: async (files) => { written.push(...files.map((f) => f.path)); },
        stopLane: () => stopReason,
        depOrder: true,
        maxRepairs: 0,
      } as never),
    };
  }

  it('🔴 without a stop the lane runs to the end; with a stop mid-lane it hands off and salvages', async () => {
    const free = deps(Number.POSITIVE_INFINITY);
    const okRun = await free.run();
    expect(okRun.ok).toBe(true);

    const stopped = deps(3); // plan + contract + first file, then the engine "falls"
    const r = await stopped.run();
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toMatch(/stopped early/);
    expect(String(r.reason)).toMatch(/reasons before every answer/);
    // Files finished before the fall reached the workspace (the salvage path), later ones were never asked for.
    expect(stopped.calls()).toBeLessThan(free.calls());
  });

  it('🔒 the route answers stopLane from the model that served the last call, under the same kill switch as the opener gate', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).toContain("if (!fastLaneReasoningRung && fastLaneReasoningGateEnabled() && modelAlwaysReasons(servedBy.model)) {");
    expect(route).toContain("code: 'FAST_LANE_FELL_TO_REASONING_RUNG'");
    expect(route).toContain('stopLane: () => (fastLaneReasoningRung');
    const sb = strip(src('src/server/AgentV3/SimpleBuilder.ts'));
    expect(sb).toContain('const stop = deps.stopLane?.();');
    expect(sb).toContain('if (laneStopReason) throw new Error(`simple-build fast lane stopped early — ${laneStopReason}`);');
  });

  it('the new code is a fact about the engine, never a finding against the app', () => {
    const d = new BuildDiagnostics('ws', 'sess');
    d.record({ phase: 'build', severity: 'info', code: 'FAST_LANE_FELL_TO_REASONING_RUNG', message: 'x', autoResolved: true });
    expect(d.shippingIssueCount('error')).toBe(0);
    expect(strip(src('src/server/AgentV3/BuildDiagnostics.ts'))).toMatch(/'FAST_LANE_FELL_TO_REASONING_RUNG',/);
  });
});

// ── 2. a disputed scope builds direct ───────────────────────────────────────────────────────────

describe('2 · when the scope analyzer and the complexity router disagree, the dearer one no longer wins by default', () => {
  it('a famous name USED in a small app, scored simple, stands the planner down', () => {
    // A prompt the tool-mention fix does not catch — the name stands alone — but the other two facts do.
    const scope = analyzeAppScope('ek quiz app banao, instagram, jisme mere sawal ho');
    expect(scope.decision).toBe('analyze');
    expect(scope.famousApp).toBe('Instagram');
    expect(scope.smallHint).toBe(true);
    const reason = scopeDispute(scope, { complex: false });
    expect(reason).toMatch(/Instagram/);
    expect(reason).toMatch(/used, not cloned/);
  });
  it('🔒 the dispute is NARROW: a complex score, heavy infra, a feature list or no small noun all keep the roadmap', () => {
    const smallName = analyzeAppScope('ek quiz app banao, instagram, jisme mere sawal ho');
    expect(scopeDispute(smallName, { complex: true })).toBeNull();
    expect(scopeDispute(analyzeAppScope('pubg banao'), { complex: false })).toBeNull(); // no small hint
    expect(scopeDispute(analyzeAppScope('instagram jaisa app with real-time chat between users'), { complex: false })).toBeNull(); // heavy infra
    expect(scopeDispute(analyzeAppScope('a todo app'), { complex: false })).toBeNull(); // not 'analyze' at all
  });
  it('🔒 the route records APP_SCOPE_DISPUTED and skips the planner on a dispute', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).toContain('const dispute = scopeDispute(scope, { complex: buildIsComplex });');
    expect(route).toContain("code: 'APP_SCOPE_DISPUTED'");
    expect(route).toContain("if (scope.decision === 'analyze' && !dispute) {");
  });
});

// ── 3. REQUIREMENT_GAPS only on a fresh build ───────────────────────────────────────────────────

describe('3 · requirement gaps are recorded on a fresh build only', () => {
  it('🔒 the gate names both the intent and the edit flag', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).toContain("if (intent === 'new_build' && !isEditMode && shouldSurfaceRequirementGaps(reqGaps)) {");
  });
});

// ── 4. a rough estimate, labelled ───────────────────────────────────────────────────────────────

describe('4 · an unevidenced ETA is shown as a rough estimate and says so', () => {
  const est = { estimateMs: 3.1 * MIN, lowMs: 2.2 * MIN, highMs: 4.7 * MIN, historyWeight: 0, basis: 'heuristic' as const };
  it('the first line carries the band AND the label', () => {
    const line = unevidencedFirstEtaLine(est);
    expect(line).toMatch(/Rough estimate: ~2–5 min|Rough estimate: ~2–4 min/);
    expect(line).toContain(ROUGH_ESTIMATE_LABEL);
    expect(line).toMatch(/real figure/i);
  });
  it('the tick carries it too, still labelled, with the budget clause intact', () => {
    const band = roughEstimateBand(est)!;
    const line = unevidencedEtaTickLine(2 * MIN, 30 * MIN, band);
    expect(line).toContain(`rough estimate ${band}`);
    expect(line).toContain(ROUGH_ESTIMATE_LABEL);
    expect(line).toContain('up to 28 min left');
  });
  it('🔒 without a band the phase-only sentences are byte-identical to before', () => {
    expect(unevidencedFirstEtaLine()).toContain("I don't have a reliable time for this one yet");
    expect(unevidencedEtaTickLine(4 * MIN)).toContain('still working out how big this one is');
    expect(unevidencedEtaTickLine(4 * MIN, 30 * MIN, null)).toBe(unevidencedEtaTickLine(4 * MIN, 30 * MIN));
    expect(roughEstimateBand(null)).toBeNull();
    expect(roughEstimateBand({ estimateMs: 0, lowMs: 0, highMs: 0 })).toBeNull();
  });
  it('the admin report says what the user really saw', () => {
    expect(etaEvidenceNote(est)).toMatch(/Shown as a ROUGH ESTIMATE \(~2–[45] min\), labelled a guess/);
    expect(etaEvidenceNote({ historyWeight: 0, basis: 'heuristic' })).toContain('No number shown');
  });
  it('🔒 the route passes the estimate to the first line and the band to the tick, and the accuracy line reads the shown text', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).toContain('unevidencedFirstEtaLine(est)');
    expect(route).toContain('etaRoughBand = etaEvidenced ? null : roughEstimateBand(est);');
    expect(route).toContain('unevidencedEtaTickLine(elapsedMs, effectiveBuildSeconds * 1000, etaRoughBand)');
    const bd = strip(src('src/server/AgentV3/BuildDiagnostics.ts'));
    expect(bd).toContain('The user was shown a ROUGH ESTIMATE, labelled a guess (unevidenced)');
  });
});

// ── 5. the prompt and the freeze wording ────────────────────────────────────────────────────────

describe('5 · the architect is told what the platform verifies, and a refused engine write stops inviting a reply', () => {
  it('build mode names the platform checks and forbids the closing ritual', () => {
    const sp = src('src/server/AgentV3/systemPrompt.ts');
    expect(sp).toContain('WHAT THE PLATFORM VERIFIES FOR YOU, after your turn');
    expect(sp).toContain('call update_preview ONCE after your last write');
    expect(sp).toContain('Do not re-run tsc / npm run build / a second dev server / screenshot / console_errors as a');
  });
  it('edit mode keeps "prove it still works" and drops the screenshot ritual', () => {
    const sp = src('src/server/AgentV3/systemPrompt.ts');
    expect(sp).toContain('prove it still works');
    expect(sp).not.toContain('re-run update_preview + screenshot + console_errors');
    expect(sp).toContain('you do not need to screenshot it yourself');
  });
  it('a refused post-green write says it is the engine being held to the freeze, not a request of the user', () => {
    const route = strip(src('src/server/routes/agentv3.ts'));
    expect(route).toContain("This is the engine's own follow-up being refused by the freeze, not something the user asked for; nothing to do.");
    expect(route).not.toContain('Reply if you want this change made.`');
  });
});
