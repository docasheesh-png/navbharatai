// Autopsy d382b398 (2026-10-01, "Create app like a electrical testing", Weak). The app was built and
// rendered; the report carried seven defects of the engine and its words, each locked here.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  makeMultiProviderTurnRunner, createBuildBenchRegistry, compactFallbackPath, ReasoningRungStopError,
  type NamedRunner,
} from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { SLOW_STREAM_MESSAGE, isReasoningRungHandoff } from '../src/server/AgentV3/turnDeadline';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { ensureReactValueImport } from '../src/server/AgentV3/EndgameRepair';
import { simulatedDataIssues, simulatedDataNotice, simulatedDataSubjectLabel } from '../src/server/AgentV3/AuthenticityAnalysis';
import { decideStyleResume } from '../src/server/AgentV3/stylePolishResume';
import { liveEtaTick } from '../src/server/lib/BuildTimeEstimator';

const params = { model: 'x', system: '', messages: [], tools: [], maxTokens: 10 } as never;
const ok = (who: string) => ({ text: `from ${who}`, toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } });

// ── 1 · a crawl is weather, and the timeout bench must not turn it into a verdict ────────────────────
describe('1 · two crawls do not bench every rung of the family for the whole build', () => {
  function ladder(calls: string[], kimiFails: () => boolean): NamedRunner[] {
    return [
      {
        name: 'GLM', reportAs: 'GLM', modelId: 'glm-4.7-flashx',
        runner: { runTurn: async (p: { canAbandonSlowStream?: () => boolean }) => {
          calls.push('GLM:flashx');
          if (p.canAbandonSlowStream?.()) throw new Error(`${SLOW_STREAM_MESSAGE} after 15000ms`);
          return ok('flashx');
        } },
      },
      {
        name: 'KIMI', reportAs: 'KIMI', modelId: 'kimi-k2.7-code',
        runner: { runTurn: async () => { calls.push('KIMI'); if (kimiFails()) throw new Error('500 internal error'); return ok('KIMI'); } },
      },
      { name: 'GLM53', reportAs: 'GLM', modelId: 'glm-5.3', runner: { runTurn: async () => { calls.push('GLM:5.3'); return ok('glm-5.3'); } } },
    ] as unknown as NamedRunner[];
  }

  it('🔴 a crawl and its re-probe crawl — glm-5.3 (which never crawled) is still on the ladder', async () => {
    let t = 0;
    let kimiDown = false;
    const calls: string[] = [];
    const benched: string[] = [];
    const r = makeMultiProviderTurnRunner(ladder(calls, () => kimiDown), { bench: createBuildBenchRegistry(), now: () => t, onProviderBenched: (_f, why) => benched.push(why) });
    expect((await r.runTurn(params)).text).toBe('from KIMI'); // flashx crawled and was abandoned
    t = 181_000;
    expect((await r.runTurn(params)).text).toBe('from KIMI'); // its re-probe crawled again
    // Before the fix the two abandons were ALSO "2 consecutive timeouts", so GLM — every key and every
    // model, glm-5.3 included — was benched for the rest of the run.
    expect(benched.some((b) => /consecutive timeouts/.test(b))).toBe(false);
    kimiDown = true;
    t = 10_000_000;
    expect((await r.runTurn(params)).text).toBe('from glm-5.3');
  });

  it('🔴 two calls crawling at the same moment: only ONE walks away, the other rides it out', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let arrived = 0;
    const abandoned: boolean[] = [];
    const chain = [
      {
        name: 'GLM', reportAs: 'GLM', modelId: 'glm-4.7-flashx',
        runner: { runTurn: async (p: { canAbandonSlowStream?: () => boolean }) => {
          arrived += 1;
          if (arrived === 2) release();
          await gate; // both streams are crawling now — neither abandon has been counted yet
          const yes = p.canAbandonSlowStream?.() === true;
          abandoned.push(yes);
          if (yes) throw new Error(`${SLOW_STREAM_MESSAGE} after 15000ms`);
          return ok('GLM');
        } },
      },
      { name: 'KIMI', reportAs: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => ok('KIMI') } },
    ] as unknown as NamedRunner[];
    const r = makeMultiProviderTurnRunner(chain, { bench: createBuildBenchRegistry(), now: () => 0 });
    const out = await Promise.all([r.runTurn(params), r.runTurn(params)]);
    expect(abandoned.filter(Boolean)).toHaveLength(1);
    expect(out.map((o) => o.text).sort()).toEqual(['from GLM', 'from KIMI']);
  });

  it('asking with { peek: true } never claims the abandon', async () => {
    const answers: boolean[] = [];
    const chain = [
      {
        name: 'GLM', reportAs: 'GLM', modelId: 'glm-4.7-flashx',
        runner: { runTurn: async (p: { canAbandonSlowStream?: (o?: { peek?: boolean }) => boolean }) => {
          answers.push(p.canAbandonSlowStream!({ peek: true }), p.canAbandonSlowStream!({ peek: true }));
          return ok('GLM');
        } },
      },
      { name: 'KIMI', reportAs: 'KIMI', runner: { runTurn: async () => ok('KIMI') } },
    ] as unknown as NamedRunner[];
    const bench = createBuildBenchRegistry();
    await makeMultiProviderTurnRunner(chain, { bench, now: () => 0 }).runTurn(params);
    expect(answers).toEqual([true, true]);
    expect([...bench.crawlAbandons.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('the stream reader asks only once it has judged the stream crawling (asking claims)', () => {
    const runner = readFileSync('src/server/AgentV3/providers/OpenAiToolRunner.ts', 'utf8');
    expect(runner).not.toContain('opts.canAbandon?.() && streamIsCrawling(');
    expect(runner).toContain('params.canAbandonSlowStream?.({ peek: true })');
  });

  it('the bench line no longer claims "for the rest of this build" for a 180 s bench', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('message: `${family} benched: ${reason}`');
    expect(route).not.toContain('benched for the rest of this build: ${reason}');
  });
});

// ── 2 · a planned handoff is not a failed call, and a key pool is not fifty-one providers ─────────────
describe('2 · the fast lane handing off before a reasoning rung', () => {
  const POOL = ['GLM', ...Array.from({ length: 50 }, (_, i) => `GLM#${i + 2}`)];

  it('a key pool reads as one family with a key count', () => {
    expect(compactFallbackPath(POOL)).toBe('GLM ×51 keys');
    expect(compactFallbackPath(['GLM', 'GLM#2', 'KIMI', 'GLM53'])).toBe('GLM ×2 keys → KIMI → GLM53');
    expect(compactFallbackPath([])).toBe('');
  });

  it('🔴 the report: the handoff error names the pool once', () => {
    const err = new ReasoningRungStopError('kimi-k2.7-code', POOL);
    expect(err.message).toContain('(after GLM ×51 keys)');
    expect(err.message).not.toContain('GLM#2');
    expect(isReasoningRungHandoff(err)).toBe(true);
  });

  it('🔴 recorded as INFO and resolved — never an unresolved ERROR, never the root cause of a successful build', () => {
    const d = new BuildDiagnostics({ buildId: 'b', workspaceId: 'w', sessionId: 's', prompt: 'p', startedAt: 1 });
    d.recordLlmCall({ ts: 2, provider: 'unknown', model: 'unknown', ok: false, error: new ReasoningRungStopError('kimi-k2.7-code', POOL).message, promptChars: 1, responseChars: 0, toolCalls: 0 } as never);
    const issues = d.report().issues;
    expect(issues.some((i) => i.code === 'LLM_CALL_FAILED')).toBe(false);
    const handed = issues.find((i) => i.code === 'LLM_CALL_HANDED_OFF');
    expect(handed?.severity).toBe('info');
    expect(handed?.autoResolved).toBe(true);
  });

  it('a genuinely failed call is still an error', () => {
    const d = new BuildDiagnostics({ buildId: 'b', workspaceId: 'w', sessionId: 's', prompt: 'p', startedAt: 1 });
    d.recordLlmCall({ ts: 2, provider: 'glm', model: 'glm-5.3', ok: false, error: '500 internal error', promptChars: 1, responseChars: 0, toolCalls: 0 } as never);
    expect(d.report().issues.some((i) => i.code === 'LLM_CALL_FAILED' && i.severity === 'error')).toBe(true);
  });
});

// ── 3 · a lane with no tool loop gets its React import before anything compiles ───────────────────
describe('3 · React namespace values without an import', () => {
  const HOOK = "import { useState } from 'react';\nexport function useDevices() {\n  const start = React.useCallback(() => {}, []);\n  return start;\n}\n";

  it('🔴 the report: the hook used React.useCallback with only a named import — React is added beside it', () => {
    const out = ensureReactValueImport('src/hooks/useDeviceState.ts', HOOK);
    expect(out.startsWith("import React, { useState } from 'react';")).toBe(true);
  });

  it('no import at all gets the default import on top', () => {
    expect(ensureReactValueImport('a.tsx', 'export const A = () => <React.Fragment />;')).toBe("import React from 'react';\nexport const A = () => <React.Fragment />;");
  });

  it('🔒 a TYPE-only use, an existing import, and a stylesheet are left exactly as they are', () => {
    const typeOnly = 'export const A: React.FC = () => null;';
    expect(ensureReactValueImport('a.tsx', typeOnly)).toBe(typeOnly);
    const imported = "import * as React from 'react';\nconst x = React.useMemo(() => 1, []);";
    expect(ensureReactValueImport('a.tsx', imported)).toBe(imported);
    expect(ensureReactValueImport('a.css', '.a { color: red } /* React.useState */')).toBe('.a { color: red } /* React.useState */');
  });

  it('both no-tool lanes apply it to every file they accept', () => {
    expect(readFileSync('src/server/AgentV3/SimpleBuilder.ts', 'utf8')).toContain('content: ensureReactValueImport(spec.path, match.content)');
    expect(readFileSync('src/server/AgentV3/OneShotBuilder.ts', 'utf8')).toContain('content: ensureReactValueImport(f.path, f.content)');
  });
});

// ── 4 · the summary describes the app, not our instruction ─────────────────────────────────────────
describe('4 · after the style touch-up, the summary is still the app description', () => {
  it('🔴 the reply that answered the style resume no longer replaces the summary', () => {
    const src = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
    expect(src).toMatch(/styleResumes\+\+;\n\s+summaryBeforeStyleResume = turn\.text\.trim\(\) \|\| null;/);
    expect(src).toContain(": (summaryBeforeStyleResume ?? (turn.text.trim() || 'Build complete.'));");
  });

  it('the resume tells the model the user never saw it, and to close in one sentence about the app', () => {
    const d = decideStyleResume({ text: 'Your app is ready.', missing: ['app-header'], sheet: 'src/index.css', pages: [], resumesUsed: 0, producedFiles: true });
    expect(d.resume).toBe(true);
    expect(d.message).toMatch(/The user did not see this message/);
    expect(d.message).toMatch(/do not mention class names, stylesheets or file names/);
  });
});

// ── 5 · a simulated device is not a person or a place ──────────────────────────────────────────────
describe('5 · the demo-data notice names what is simulated', () => {
  const REPORT_LINE = ' * Used to generate consistent names for simulated devices.';

  it('🔴 the report: simulated devices are disclosed as devices, not as "people or places"', () => {
    const issues = simulatedDataIssues({ 'src/hooks/useDeviceState.ts': REPORT_LINE });
    expect(issues).toHaveLength(1);
    expect(issues[0].subject).toBe('devices');
    const note = simulatedDataNotice(issues);
    expect(note).toContain('simulated devices and readings');
    expect(note).not.toMatch(/people or places|nearby shops|other users/);
    expect(note).not.toMatch(/GLM|Kimi|Claude|Gemini|Grok/i);
    expect(simulatedDataSubjectLabel(issues)).toBe('devices and their readings');
  });

  it('🔒 made-up people are still disclosed as people, exactly as before', () => {
    const issues = simulatedDataIssues({ 'src/useNearby.ts': 'const fakeVendors = [];' });
    expect(issues[0].subject).toBe('people');
    expect(simulatedDataNotice(issues)).toContain('makes up people or places');
    expect(simulatedDataSubjectLabel(issues)).toBe('other people or places');
  });

  it('both in one app: both are named', () => {
    const issues = simulatedDataIssues({ 'a.ts': 'const fakeVendors = [];', 'b.ts': '// simulated devices' });
    expect(simulatedDataNotice(issues)).toMatch(/makes up people or places[\s\S]*also shows simulated devices/);
    expect(simulatedDataSubjectLabel(issues)).toBe('other people, places and devices');
  });

  it('the admin line reads the same subject', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('made-up data about ${simulatedDataSubjectLabel(invented)} in');
  });
});

// ── 6 · the reviewer is not told how to write AI into the app ──────────────────────────────────────
describe('6 · a read-only role does not get the writers\' AI rule', () => {
  it('🔴 the reviewer read src/lib/ai.ts because the rule that names it was handed to every role', () => {
    const src = readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8');
    expect(src).toContain("roleExpectsArtifacts(deps.toolsOverride ?? cfg.tools) ? (deps.aiRule?.() ?? '') : ''");
  });
});

// ── 7 · an overrun is not "this app is bigger than expected" ──────────────────────────────────────
describe('7 · the ETA overrun line', () => {
  it('🔴 at minute 6 of a 6–8 min promise the app was not bigger — the line no longer says so', () => {
    const tick = liveEtaTick(6 * 60_000, 5 * 60_000, 5 * 60_000, 0);
    expect(tick.text).not.toContain('bigger than expected');
    expect(tick.text).toContain('taking longer than I estimated');
  });
});
