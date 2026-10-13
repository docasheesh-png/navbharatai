// AUTOPSY db07e0af (2026-10-12) — "Banao", Weak tier: a made-up todo app, a dead dark-mode button, ₹96.93.
//
// The intent and theme items have their own files (aWordThatNamesNothingIsAskedAbout, theDarkModeButtonSwitchesTheKit,
// anOlderStarterIsStillOurs). This file locks the rest of the ledger:
//   P3  the shared contract declared `enum FilterType`, and `import type { FilterType }` was healed at write time —
//       the fourth build to need that heal. Option sets are union types now, in both lanes.
//   P4  the end-of-turn hand-back's only item was a component nothing imported; its closing example said "Every
//       screen is now fully styled.", and the model — calling no tool — answered with exactly that, shown to the user.
//   P9  `import './index.css'` in App.tsx beside the starter's main.tsx, removed after the app had first rendered.
//       It is settled at the write now.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractSystemPrompt, contractUserPrompt } from '../src/server/AgentV3/SimpleBuilder';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { decideStyleResume, styleResumeNote, closingExample } from '../src/server/AgentV3/stylePolishResume';
import { repairClaimWithoutChange, claimsAChange, handBackIgnoredNote, NO_CHANGE_LINE } from '../src/server/AgentV3/repairClaim';
import { PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { FakeActuator, toolCall } from './helpers/dispatcherHarness';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('P3 · an option set is a union type, so `import type` is always right', () => {
  it('the contract call is told to write unions and never an enum', () => {
    const p = contractSystemPrompt('vite-react');
    expect(p).toContain('string-literal UNION TYPE');
    expect(p).toContain('An ENUM is FORBIDDEN here');
    expect(p).not.toMatch(/Every ENUM with its EXACT member names/);
    expect(contractUserPrompt('a todo app', [{ path: 'src/App.tsx', purpose: 'the app' }])).toContain('no enums');
  });
  it('the architect is told the same, and how to import an enum if one exists', () => {
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain('A FIXED SET OF OPTIONS IS A UNION TYPE, NOT AN ENUM');
    expect(p).toContain('never `import type`');
  });
  it('the write-time heal stays as the last line of defence', () => {
    expect(read('src/server/AgentV3/writeTimeTypecheck.ts')).toContain('export function typeOnlyHealNote');
  });
});

describe('P4 · a hand-back\'s example is about what was handed back, and its reply is checked', () => {
  const orphanOnly = decideStyleResume({ text: 'Done.', missing: [], orphans: ['src/components/LoadingSpinner.tsx'], resumesUsed: 0, producedFiles: true });

  it('🔴 the real message: only an unimported component — the example no longer says "fully styled"', () => {
    expect(orphanOnly.resume).toBe(true);
    expect(orphanOnly.message).toContain('src/components/LoadingSpinner.tsx');
    expect(orphanOnly.message).not.toContain('Every screen is now fully styled.');
    expect(orphanOnly.message).toContain('Every part of the app I built is now on screen.');
    expect(orphanOnly.message).toContain('if you changed nothing, say so plainly');
  });
  it('each kind of item gets its own example; classes keep the old one', () => {
    expect(closingExample({ missing: ['card'], pages: [], a11y: [], orphans: [] })).toBe('Every screen is now fully styled.');
    expect(closingExample({ missing: [], pages: [{}], a11y: [], orphans: [] })).toMatch(/page/);
    expect(closingExample({ missing: [], pages: [], a11y: [{}], orphans: [] })).toMatch(/button/);
  });
  it('the admin note never reports a count of zero (the orphan-only sibling 68f0a486 missed)', () => {
    const note = styleResumeNote(0, 0, 1, 0);
    expect(note).not.toMatch(/\b0 class name\(s\)|\b0 page\(s\)/);
    expect(note).toContain('1 component file(s) this build wrote and nothing imports');
  });
  it('the reply "Every screen is now fully styled." claims a change', () => {
    expect(claimsAChange('✅ Every screen is now fully styled.')).toBe(true);
    expect(claimsAChange('The app is ready to use.')).toBe(false);
  });
  it('after a hand-back with no change since, a final reply claiming a change is withheld; with a change, it stands', () => {
    const text = '✅ Every screen is now fully styled.';
    expect(repairClaimWithoutChange({ platformRequest: false, finalTurn: true, changesThisRun: 7, changesSinceHandBack: 0, text })).toBe(true);
    expect(repairClaimWithoutChange({ platformRequest: false, finalTurn: true, changesThisRun: 8, changesSinceHandBack: 1, text })).toBe(false);
    expect(repairClaimWithoutChange({ platformRequest: false, finalTurn: false, changesThisRun: 7, changesSinceHandBack: 0, text })).toBe(false);
    expect(repairClaimWithoutChange({ platformRequest: false, finalTurn: true, changesThisRun: 7, changesSinceHandBack: null, text })).toBe(false);
  });
  it('an ignored hand-back is an engine note, never an app finding', () => {
    expect(PROCESS_ONLY_CODES.has('HANDBACK_IGNORED')).toBe(true);
    expect(handBackIgnoredNote('style', 'x')).toContain('without changing anything');
  });
});

describe('P4 · in the runner: the build of db07e0af, replayed', () => {
  const use = { input_tokens: 5, output_tokens: 5 };
  const write = (id: string) => ({ content: [{ type: 'tool_use', id, name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } }], stop_reason: 'tool_use', usage: use });
  const say = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: use });

  function run(script: unknown[]) {
    let i = 0;
    let changes = 0;
    let handedBack = false;
    const sent: unknown[][] = [];
    const narrations: string[] = [];
    const notes: Array<{ code: string; message: string }> = [];
    const client: MessagesCreateClient = {
      messages: {
        create: async (req: unknown) => {
          sent.push(JSON.parse(JSON.stringify((req as { messages: unknown[] }).messages)));
          const m = script[i] ?? say('fallback end');
          i++;
          return m as never;
        },
      },
    };
    const dispatcher = {
      dispatch: async (tu: { id: string }) => { changes++; return { tool_use_id: tu.id, content: 'ok', is_error: false }; },
      changeCount: () => changes,
      assessBuildReadiness: async () => ({ score: 100, ready: true, blockers: [] as string[], warnings: [] as string[], tier: 'ok' }),
      undefinedClassesNow: async () => {
        const first = !handedBack;
        handedBack = true;
        return { missing: [], pages: [], orphans: first ? ['src/components/LoadingSpinner.tsx'] : [] };
      },
    };
    const stream = new AgentEventStream();
    stream.subscribe((e) => { const ev = e as { type?: string; text?: string }; if (ev.type === 'narration' && ev.text) narrations.push(ev.text); });
    const runner = new AgentRunner({
      client: new ClaudeClient(client), dispatcher: dispatcher as never, state: new WorkspaceState(stream), events: stream,
      model: 'm', system: 's', tools: defaultToolCatalog(), expectsArtifacts: true, readinessGate: true,
      onNote: (n: { code: string; message: string }) => { notes.push(n); },
    } as never);
    return { result: runner.run('Banao'), sent, narrations, notes };
  }

  it('🔴 the model answers the hand-back with no tool call: its claim is withheld and the ignore is recorded', async () => {
    const r = run([write('a'), say('✅ I have built a complete, working task manager app for you.'), say('✅ Every screen is now fully styled.')]);
    const result = await r.result;
    expect(result.ok).toBe(true);
    expect(JSON.stringify(r.sent[2] ?? [])).toContain('src/components/LoadingSpinner.tsx');
    expect(r.narrations).not.toContain('✅ Every screen is now fully styled.');
    expect(r.narrations).toContain(NO_CHANGE_LINE);
    expect(r.notes.map((n) => n.code)).toContain('HANDBACK_IGNORED');
    expect(r.notes.map((n) => n.code)).toContain('REPAIR_CLAIM_WITHHELD');
  });

  it('a model that really acts on the hand-back is shown as it spoke, and nothing is recorded against it', async () => {
    const r = run([write('a'), say('✅ I have built a complete, working task manager app for you.'), write('b'), say('The loading indicator is now shown while tasks load.')]);
    await r.result;
    expect(r.narrations).toContain('The loading indicator is now shown while tasks load.');
    expect(r.notes.map((n) => n.code)).not.toContain('HANDBACK_IGNORED');
    expect(r.notes.map((n) => n.code)).not.toContain('REPAIR_CLAIM_WITHHELD');
  });
});

describe('P9 · a global stylesheet is imported once, at the entry — settled at the write', () => {
  const APP = "import { useState } from 'react';\nimport './index.css';\nimport type { Todo } from './types';\nexport default function App() { return <main className=\"container\">Tasks</main>; }\n";
  const make = () => {
    const act = new FakeActuator();
    act.files.set('src/main.tsx', "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nimport './index.css';\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);\n");
    act.files.set('src/index.css', ':root { --bg: #fff; }\n');
    act.files.set('src/App.tsx', 'export default function App() { return null; }\n');
    const s = new AgentEventStream();
    return { act, d: new ToolDispatcher(act, 'ws-sheet-once', new WorkspaceState(s), s) };
  };

  it('🔴 the real App.tsx: its `./index.css` import is removed before the file lands, and the model is told', async () => {
    const { act, d } = make();
    const res = await d.dispatch(toolCall('write_file', { path: 'src/App.tsx', content: APP }), 'architect');
    expect(act.files.get('src/App.tsx')).not.toContain("import './index.css'");
    expect(act.files.get('src/App.tsx')).toContain("import type { Todo } from './types';");
    expect(String(res.content)).toContain('Removed the import of `./index.css` from src/App.tsx — src/main.tsx already imports it');
  });
  it('the entry itself keeps its import, and a component\'s own stylesheet is left alone', async () => {
    const { act, d } = make();
    await d.dispatch(toolCall('write_file', { path: 'src/main.tsx', content: act.files.get('src/main.tsx')! + '// touched\n' }), 'architect');
    expect(act.files.get('src/main.tsx')).toContain("import './index.css'");
    const card = "import './TodoCard.css';\nexport function TodoCard() { return <div className=\"card\" />; }\n";
    await d.dispatch(toolCall('write_file', { path: 'src/components/TodoCard.tsx', content: card }), 'architect');
    expect(act.files.get('src/components/TodoCard.tsx')).toContain("import './TodoCard.css'");
  });
  it('the end-of-build dedupe stays as the last line of defence; the architect is told to import it once', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain('const deduped = dedupeStylesheetImports(integrityFiles);');
    expect(architectSystemPrompt('vite-react')).toContain('ONLY there: the starter\'s main.tsx already does');
  });
});

// ── P6 · the suggest-only review stops in front of a reasoning engine, and its timeout line is true ──────────────
import { reviewScopeWords, reviewEngineWords, reviewStoppedAtReasoningRung } from '../src/server/AgentV3/ReviewerAgent';
import { ReasoningRungStopError } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

describe('P6 · a suggestion is not worth a reasoning engine\'s minute', () => {
  it('the timeout line names what the review was handed, not the project listing', () => {
    expect(reviewScopeWords(11, 30)).toBe('11 changed file(s) handed in one call (the project has 30)');
    expect(reviewScopeWords(null, 30)).toBe('30 files');
    expect(reviewEngineWords('kimi-k2.7-code')).toBe("; the build's last engine was kimi-k2.7-code");
    expect(reviewEngineWords(null)).toBe('');
  });
  it('the engine the build last ran on is read from its own calls', () => {
    const d = new BuildDiagnostics('b', 'ws');
    expect(d.lastServedModel()).toBeNull();
    d.recordLlmCall({ model: 'glm-4.7-flashx', ok: true } as never);
    d.recordLlmCall({ model: 'kimi-k2.7-code', ok: true } as never);
    d.recordLlmCall({ model: 'unknown', ok: false, error: 'x' } as never);
    expect(d.lastServedModel()).toBe('kimi-k2.7-code');
  });
  it('a review that stopped in front of a reasoning rung is recognised from the words it ended with', () => {
    const stop = new ReasoningRungStopError('kimi-k2.7-code', ['GLM']);
    expect(reviewStoppedAtReasoningRung([`Error: ${stop.message}`])).toBe('kimi-k2.7-code');
    expect(reviewStoppedAtReasoningRung(['[PASS] Score: 90'])).toBeNull();
  });
  it('the runner asks the chain to stop there only when told to', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const client = { runTurn: async (p: Record<string, unknown>) => { seen.push(p); return { text: 'done', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [{ type: 'text', text: 'done' }] }; } };
    for (const stopAtReasoningRung of [true, undefined]) {
      const stream = new AgentEventStream();
      await new AgentRunner({ client: client as never, dispatcher: { dispatch: async () => ({}) } as never, state: new WorkspaceState(stream), events: stream, model: 'm', system: 's', tools: [], ...(stopAtReasoningRung ? { stopAtReasoningRung } : {}) }).run('review');
    }
    expect(seen[0].stopAtReasoningRung).toBe(true);
    expect('stopAtReasoningRung' in seen[1]).toBe(false);
  });
  it('the sub-agent passes it on, and the route sets it for the suggest-only one-call review alone', () => {
    expect(read('src/server/AgentV3/SubAgent.ts')).toContain("...(deps.stopAtReasoningRung ? { stopAtReasoningRung: true } : {}),");
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("...(reviewPlan.mode === 'suggest' && reviewOneCall ? { stopAtReasoningRung: true } : {}),");
    expect(route).toContain("code: 'REVIEW_NOT_RUN_REASONING_ENGINE'");
    expect(PROCESS_ONLY_CODES.has('REVIEW_NOT_RUN_REASONING_ENGINE')).toBe(true);
  });
});

// ── P8 · a platform write runs no typecheck and spends no note ───────────────────────────────────────────────────
import { runAsUnreadWrites, writesAreUnread } from '../src/server/AgentV3/unreadWrites';

describe('P8 · a write nobody reads the answer to is not steered', () => {
  it('the context is scoped to the call', async () => {
    expect(writesAreUnread()).toBe(false);
    expect(await runAsUnreadWrites(async () => writesAreUnread())).toBe(true);
    expect(writesAreUnread()).toBe(false);
  });
  it('🔴 the lane\'s save: no typecheck runs, and the same write from the model still gets one', async () => {
    const make = () => {
      const act = new FakeActuator();
      act.files.set('tsconfig.json', '{"compilerOptions":{}}');
      act.files.set('package.json', '{"name":"x"}');
      const s = new AgentEventStream();
      return { act, d: new ToolDispatcher(act, 'ws-unread', new WorkspaceState(s), s) };
    };
    const file = { path: 'src/utils/dateFormatter.ts', content: "import type { formatter } from '../data';\nexport const dateFormatter: formatter = {};\n" };
    const lane = make();
    await runAsUnreadWrites(() => lane.d.dispatch(toolCall('write_file', file), 'frontend'));
    const model = make();
    await model.d.dispatch(toolCall('write_file', file), 'architect');
    const tsc = (cmds: string[]) => cmds.filter((c) => /tsc/.test(c)).length;
    expect(tsc(lane.act.commands)).toBe(0);
    expect(tsc(model.act.commands)).toBeGreaterThan(0);
    expect(lane.act.files.get(file.path)).toBe(file.content); // the write itself landed
  });
  it('every platform write in the route is marked — a new one fails here', () => {
    // UPDATED 2026-10-13 (build report 9c612cdb, Q-912). The route's ten platform writes each dispatched
    // `write_file` themselves, each wrapped in `runAsUnreadWrites`, and each threw the per-file answer away. They
    // now all go through ONE writer, `writePlatformFiles` (writeOutcomes.ts), which marks every write unread AND
    // returns its outcome — so the lock moved with the code: no write_file is dispatched in the route at all, the
    // route's one door calls that writer, and that writer wraps every dispatch in `runAsUnreadWrites`.
    const route = read('src/server/routes/agentv3.ts');
    expect(route.split('\n').filter((l) => /name: 'write_file'/.test(l))).toEqual([]);
    expect(route.match(/writePlatformFiles\(\(call\) => dispatcher\.dispatch\(call, 'frontend'\)/g)?.length).toBe(1);
    expect(route.match(/\bwritePlatform\(/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
    const writer = read('src/server/AgentV3/writeOutcomes.ts');
    expect(writer).toMatch(/runAsUnreadWrites\(\(\) => dispatch\(\{ id: `\$\{opts\.idPrefix\}\$\{i\}`, name: 'write_file'/);
  });
});

// ── P12 · plan only what a screen shows ─────────────────────────────────────────────────────────────────────────
import { dropProvidedTwins, manifestSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';

describe('P12 · a second copy of a provided component is left out of the plan', () => {
  it('🔴 the real plan: src/components/ErrorBoundary.tsx beside the provided src/ErrorBoundary.tsx', () => {
    const plan = [{ path: 'src/App.tsx', purpose: '' }, { path: 'src/components/ErrorBoundary.tsx', purpose: 'Error boundary' }, { path: 'src/components/TodoItem.tsx', purpose: '' }];
    const { kept, dropped } = dropProvidedTwins(plan, ['src/ErrorBoundary.tsx', 'tsconfig.json', 'src/vite-env.d.ts']);
    expect(kept.map((k) => k.path)).toEqual(['src/App.tsx', 'src/components/TodoItem.tsx']);
    expect(dropped).toEqual([{ path: 'src/components/ErrorBoundary.tsx', provided: 'src/ErrorBoundary.tsx' }]);
  });
  it('the provided file itself, and non-component twins, are not touched', () => {
    expect(dropProvidedTwins([{ path: 'src/ErrorBoundary.tsx' }], ['src/ErrorBoundary.tsx']).dropped).toEqual([]);
    expect(dropProvidedTwins([{ path: 'src/lib/vite-env.d.ts' }], ['src/vite-env.d.ts']).dropped).toEqual([]);
  });
  it('both planners are told not to plan speculative pieces', () => {
    expect(manifestSystemPrompt('vite-react')).toContain('Plan ONLY what a screen of THIS app shows');
    expect(architectSystemPrompt('vite-react')).toContain('WRITE ONLY WHAT A SCREEN SHOWS');
  });
});

// ── P13 · a capability of the kit is not a feature of the app ───────────────────────────────────────────────────
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';

describe('P13 · "skeleton loading" in the summary of an app that has none', () => {
  const SUMMARY = '- **Design:** clean, card-based layout with the design kit from the scaffold (buttons, fields, empty states, skeleton loading), fully responsive and dark-mode aware.';
  const facts = (sourceText: string) => ({ consoleCaptured: true, screenshotTaken: true, previewVerified: true, sourceText });
  it('🔴 the real sentence, against an app whose source has no skeleton: corrected', () => {
    const c = auditSummaryClaims(SUMMARY, facts('export default function App(){ return <div className="nb-empty">No tasks</div>; }'));
    expect(c.map((x) => x.kind)).toContain('kit-feature-claimed');
    expect(c.find((x) => x.kind === 'kit-feature-claimed')?.claimed).toBe('that the app has skeleton loading');
  });
  it('an app that really uses the kit\'s skeleton is left alone', () => {
    const c = auditSummaryClaims(SUMMARY, facts('<div className="nb-skeleton" />'));
    expect(c.map((x) => x.kind)).not.toContain('kit-feature-claimed');
  });
  it('a turn whose written files are not the app is never judged', () => {
    const c = auditSummaryClaims(SUMMARY, { ...facts('{}'), sourceIsWholeApp: false });
    expect(c.map((x) => x.kind)).not.toContain('kit-feature-claimed');
  });
  it('the architect is told to name only what the app shows', () => {
    expect(architectSystemPrompt('vite-react')).toContain('never a capability of the design kit it does not use');
  });
});
