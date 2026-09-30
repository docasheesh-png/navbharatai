// AUTOPSY 6a5fb04b + dfd81a3a (2026-09-30) — "Mohakor Voice AI", Weak tier, two builds.
//
// Build 1 was decomposed into TWELVE Software-Project-Mode modules for a one-screen voice assistant, its
// roadmap planner reasoned its whole 4,000-token allowance away, and its report filed "no error" as a
// warning. Build 2's report carried four Green Freeze lines about ANOTHER user's inventory app, filed our
// own ℹ️ notice as an error, and the model ran `tsc` by hand eight times because a clean write-time
// typecheck said nothing. Each block below locks one of those, against the report's own words.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { countEnumeratedFeatures, enumeratedFeatureItems } from '../src/server/AgentV3/enumeratedFeatures';
import { detectMegaProject } from '../src/server/AgentV3/ProjectPlan';
import { setGreenFreezeObserver, setWriteObserver, latchGreen, clearGreenLatch, assertWriteAllowed } from '../src/server/AgentV3/greenFreeze';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import type { AgentEvent } from '../src/server/AgentV3/types';
import { withAnswerNotDeliberation } from '../src/server/AgentV3/answerNotDeliberate';
import { writeTypecheckCleanNote } from '../src/server/AgentV3/writeTimeTypecheck';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const read = (p: string) => readFileSync(p, 'utf8');

const VOICE_APP = `Software Name:
Mohakor Voice AI

Software Type:
AI Voice Assistant

Main Features:

- Voice input
- AI conversation
- Voice response
- Bengali language support
- Hindi language support
- English language support
- Conversation history
- Microphone button
- Speaker/voice output
- Settings
- New conversation
- Clear conversation

Design:
Simple, clean, modern AI assistant interface. মোবাইল ফোনের জন্য responsive design।

Platform:
Android`;

describe('a voice assistant is not a mega project', () => {
  it('the report\'s own prompt no longer reaches the fourteen-part line', () => {
    expect(countEnumeratedFeatures(VOICE_APP)).toBe(10);
    expect(detectMegaProject(VOICE_APP)).toBe(false);
  });

  it('how the app should LOOK is not something it should DO', () => {
    const items = enumeratedFeatureItems(VOICE_APP);
    expect(items).not.toContain('simple');
    expect(items).not.toContain('clean');
  });

  it('one feature listed per language counts once; two different buttons stay two', () => {
    const items = enumeratedFeatureItems(VOICE_APP);
    expect(items.filter((i) => i.endsWith('language support'))).toEqual(['bengali language support']);
    expect(items).toContain('new conversation');
    expect(items).toContain('clear conversation');
  });

  it('a real system still fires: an ERP naming its modules keeps its count', () => {
    const erp = 'Build a school ERP with students, teachers, attendance, fees, exams, timetable, library, transport, hostel, payroll';
    expect(countEnumeratedFeatures(erp)).toBeGreaterThanOrEqual(8);
    expect(detectMegaProject(erp)).toBe(true);
  });
});

describe('a build hears only its own workspace', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => { while (disposers.length) disposers.pop()!(); clearGreenLatch('ws-voice'); clearGreenLatch('ws-stock'); });

  it('the voice build never records the inventory app\'s refused writes', () => {
    const voice: string[] = [];
    const stock: string[] = [];
    disposers.push(setGreenFreezeObserver(({ path }) => voice.push(path), 'ws-voice'));
    disposers.push(setGreenFreezeObserver(({ path }) => stock.push(path), 'ws-stock'));
    latchGreen('ws-stock', ['src/lib/stock.ts']);
    expect(() => assertWriteAllowed('ws-stock', 'src/lib/stock.ts')).toThrow();
    expect(voice).toEqual([]);
    expect(stock).toEqual(['src/lib/stock.ts']);
  });

  it('two builds registered at once both keep hearing — the second no longer evicts the first', () => {
    const a: string[] = [];
    const b: string[] = [];
    disposers.push(setWriteObserver(({ path }) => a.push(path), 'ws-voice'));
    disposers.push(setWriteObserver(({ path }) => b.push(path), 'ws-stock'));
    assertWriteAllowed('ws-voice', 'src/App.tsx');
    assertWriteAllowed('ws-stock', 'src/pages/AddStock.tsx');
    expect(a).toEqual(['src/App.tsx']);
    expect(b).toEqual(['src/pages/AddStock.tsx']);
  });

  it('disposing one build leaves the other registered', () => {
    const a: string[] = [];
    const disposeB = setWriteObserver(() => { /* build B */ }, 'ws-stock');
    disposers.push(setWriteObserver(({ path }) => a.push(path), 'ws-voice'));
    disposeB();
    assertWriteAllowed('ws-voice', 'src/x.ts');
    expect(a).toEqual(['src/x.ts']);
  });

  it('the route registers both observers with its own workspace', () => {
    const route = read('src/server/routes/agentv3.ts');
    const freeze = route.indexOf('disposeGreenFreezeObserver = setGreenFreezeObserver(');
    const freezeEnd = route.indexOf('}, workspaceId);', freeze);
    expect(freezeEnd).toBeGreaterThan(freeze);
    expect(freezeEnd - freeze).toBeLessThan(2500);
    const write = route.indexOf('disposeWriteObserver = setWriteObserver(');
    expect(route.slice(write, write + 300)).toContain('}, workspaceId);');
  });
});

describe('a success is not a problem, in any language', () => {
  const say = (d: BuildDiagnostics, text: string) => d.ingestEvent({ type: 'narration', agent: 'architect', text, ts: 1 } as AgentEvent);
  const codeFor = (text: string) => {
    const d = new BuildDiagnostics({ now: () => 1 });
    say(d, text);
    const hit = d.report().issues.find((i) => i.message === text.slice(0, 400));
    return hit ? `${hit.code}/${hit.severity}` : 'none';
  };

  it('"no error" said in Bengali, Hindi or Hinglish is a step, not a warning', () => {
    expect(codeFor('TypeScript কম্পাইল সফলভাবে সম্পন্ন হয়েছে, কোনো error নেই।')).toBe('AGENT_STEP/info');
    expect(codeFor('TypeScript compile ho gaya, koi error nahi')).toBe('AGENT_STEP/info');
    expect(codeFor('Build safal hua, कोई error नहीं')).toBe('AGENT_STEP/info');
    expect(codeFor('Compiled with no error')).toBe('AGENT_STEP/info');
  });

  it('our own ℹ️ notice is never an error, even when it quotes a failed module', () => {
    expect(codeFor('ℹ️ Handling this message normally (project plan stays paused at Project plan: 0/12 modules done — 1 failed). Say "continue" to resume the next module.')).toBe('AGENT_STEP/info');
  });

  it('a real failure is still an error', () => {
    expect(codeFor('The dev server failed to start — port 5173 error.')).toBe('AGENT_NOTE/error');
  });
});

describe('a planner or a repair is asked for an answer', () => {
  type P = { thinking?: boolean; model: string };
  const capture = () => {
    const seen: Array<boolean | undefined> = [];
    const runner = withAnswerNotDeliberation({ runTurn: async (p: P) => { seen.push(p.thinking); return 'ok'; } });
    return { runner, seen };
  };

  it('a call that says nothing about thinking is sent thinking:false — which is what turns GLM reasoning off', async () => {
    const { runner, seen } = capture();
    await runner.runTurn({ model: 'glm-4.7-flashx' });
    expect(seen).toEqual([false]);
  });

  it('an explicit choice is kept', async () => {
    const { runner, seen } = capture();
    await runner.runTurn({ model: 'x', thinking: true });
    await runner.runTurn({ model: 'x', thinking: false });
    expect(seen).toEqual([true, false]);
  });

  it('both text-runner factories are wrapped, so the roadmap, blueprint, Project Mode and repair calls inherit it', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('const makeFastTextRunner = (onUsed?: (used: string) => void): TurnRunner => withAnswerNotDeliberation(withStopSignal(buildTurnRunner({');
    expect(route).toContain('const makePlanTextRunner = (onUsed?: (used: string) => void): TurnRunner => withAnswerNotDeliberation(withStopSignal(buildTurnRunner({');
  });
});

describe('a clean write-time typecheck is said, so the model does not run tsc to find out', () => {
  const make = (tscOutput: string) => {
    class Act implements ActuatorPort {
      files = new Map<string, string>([['tsconfig.json', '{}']]);
      async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
      async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
      async listFiles() { return [...this.files.keys()]; }
      async runCommand(_w: string, cmd: string) { return /\btsc\b/.test(cmd) ? { exitCode: 0, stdout: tscOutput, stderr: '' } : { exitCode: 0, stdout: '', stderr: '' }; }
      async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
    }
    const stream = new AgentEventStream();
    return new ToolDispatcher(new Act(), 'ws-clean', new WorkspaceState(stream), stream);
  };

  it('a silent compile after a write tells the model the project is clean', async () => {
    const out = await make('').dispatch({ id: 'w1', name: 'write_file', input: { path: 'src/lib/storage.ts', content: 'export const x = 1;\n' } }, 'architect');
    expect(String(out.content)).toContain('the whole project compiles with no errors');
    expect(String(out.content)).toContain('You do not need to run tsc yourself');
  });

  it('output that is not a clean compile — a missing compiler — is NEVER reported as clean', async () => {
    const out = await make('sh: 1: node_modules/.bin/tsc: not found').dispatch({ id: 'w1', name: 'write_file', input: { path: 'src/lib/storage.ts', content: 'export const x = 1;\n' } }, 'architect');
    expect(String(out.content)).not.toContain('compiles with no errors');
  });

  it('the note names the files it checked', () => {
    expect(writeTypecheckCleanNote(['./src/a.ts', 'src/b.tsx'])).toContain('(src/a.ts, src/b.tsx)');
  });
});
