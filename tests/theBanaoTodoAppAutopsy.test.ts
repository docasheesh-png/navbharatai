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
