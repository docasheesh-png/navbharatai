/**
 * AUTOPSY 6ae30b33 (2026-09-30) — "Make question" built an app.
 *
 * The user asked for two hard GK questions in Hindi, got them in chat, then typed "Make question". The
 * classifier hard-locked the build verb "make" to `new_build` at HIGH confidence, the planning context
 * pulled the earlier CHAT turns ("Dona 2888 shbd swimming ka fayde pr", "History") in as the app's spec,
 * and a Weak build spent 6.9 minutes and ₹88.15 on a "GK & Study Helper" nobody ordered. On the way:
 * an `edit_file` on `src/index.css` came back "fetch failed" and was never retried, the done steer was
 * attached to that same failed step, the fast lane's files disagreed on the names of shared constants,
 * and the app shipped `<title>App</title>` with meta tags made from the prompt.
 *
 * Each describe block below locks one CLASS, not the instance.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyIntentWithConfidence, ordersWrittenContent } from '../src/server/AgentV3/IntentClassifier';
import { planningRequest, wasBuildRequest } from '../src/server/AgentV3/planningRequest';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { shouldCheckDone, type DoneSignalConfig } from '../src/server/AgentV3/doneSignal';
import { isDeadSandboxError } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/sandboxHealth';
import {
  contractValueExports, valueOwnerFor, valueOwnerNote, contractModule, type SimpleFileSpec,
} from '../src/server/AgentV3/SimpleBuilder';
import { headingFromAppSource, resolveAppDisplayName, descriptionFromPrompt } from '../src/server/AgentV3/appDisplayName';
import { planAppDefaults } from '../src/server/AgentV3/appDefaults';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── S1 · an order for WRITTEN CONTENT is chat ───────────────────────────────────────────────────────
describe('an order for written content is answered in chat, not built', () => {
  const CONTENT = [
    'Make question',
    'make notes on history',
    'create a poem',
    'make a summary of chapter 3',
    '5 question bana do',
    'nibandh likho swimming par',
    'create 10 questions on gk',
    'make 10 mcqs on photosynthesis',
  ];
  for (const p of CONTENT) {
    it(`"${p}" → chat, LOW, content-request`, () => {
      const r = classifyIntentWithConfidence(p);
      expect(r.intent).toBe('chat');
      expect(r.confidence).toBe('low');
      expect(r.signal).toBe('content-request');
    });
  }

  // Precision: an app, a screen part, or a pointed reference to something in the app stays a build.
  const STILL_BUILD = [
    'make a quiz app',
    'make the question card bigger',
    'create a quiz game with 10 questions',
    'make my resume',
    'build a notes app',
  ];
  for (const p of STILL_BUILD) {
    it(`"${p}" is NOT read as a content order`, () => {
      expect(ordersWrittenContent(p.toLowerCase())).toBe(false);
      expect(classifyIntentWithConfidence(p).intent).not.toBe('chat');
    });
  }
});

// ── S2 · a chat turn is never the app's spec ────────────────────────────────────────────────────────
describe('the planner reads only earlier BUILD requests', () => {
  it('a turn answered in chat is not a build request; a build turn is', () => {
    expect(wasBuildRequest({ text: 'build a todo app', lane: 'chat' })).toBe(false);
    expect(wasBuildRequest({ text: 'History', lane: 'build' })).toBe(true);
  });

  it('an untagged (older) turn is judged by the classifier', () => {
    expect(wasBuildRequest({ text: 'Make question' })).toBe(false);
    expect(wasBuildRequest({ text: 'build a billing app for my shop' })).toBe(true);
  });

  it("the report's chat turns never reach the planning text", () => {
    const r = planningRequest({
      prompt: 'Make question',
      recentTurns: [
        { text: 'Dona 2888 shbd swimming ka fayde pr', lane: 'chat' },
        { text: '2 Hard question answer on gk ssc hindi m', lane: 'chat' },
        { text: 'History', lane: 'chat' },
      ],
      userAppExists: false,
      env: {},
    });
    expect(r.text).toBe('Make question');
    expect(r.sources).not.toContain('earlier-requests');
  });

  it('an earlier BUILD request still reaches the planner', () => {
    const r = planningRequest({
      prompt: 'add a login page',
      recentTurns: [{ text: 'what is GST?', lane: 'chat' }, { text: 'build a billing app for my shop', lane: 'build' }],
      userAppExists: false,
      env: {},
    });
    expect(r.text).toContain('build a billing app for my shop');
    expect(r.text).not.toContain('what is GST?');
  });

  it('the lane survives the memory and a snapshot replay', () => {
    const mem = new WorkspaceMemory();
    mem.recordRequest('what is GST?', 1, 'chat');
    mem.recordRequest('build a billing app', 2, 'build');
    mem.recordRequest('old untagged turn', 3);
    const snap = mem.snapshot();
    const replayed = new WorkspaceMemory();
    for (const ep of snap.episodes) if (ep.kind === 'request') replayed.recordRequest(ep.text, ep.ts, ep.lane);
    expect(replayed.recentRequestTurns(6)).toEqual([
      { text: 'what is GST?', lane: 'chat' },
      { text: 'build a billing app', lane: 'build' },
      { text: 'old untagged turn' },
    ]);
  });

  it('the durable restore and every recording lane carry the lane (source guard)', () => {
    expect(stripComments(src('src/server/AgentV3/FirestoreWorkspaceMemoryStore.ts'))).toMatch(/recordRequest\(ep\.text, ep\.ts, ep\.lane\)/);
    const route = stripComments(src('src/server/routes/agentv3.ts'));
    expect(route).toMatch(/recordRequest\([^)]*'chat'\)/);
    expect(route).toMatch(/recordRequest\([^)]*'build'\)/);
    expect(route).toMatch(/planningRequest\(\{[^}]*recentTurns/);
    // An unlabelled recordRequest call is a new lane that forgot to say which it is.
    const unlabelled = route.match(/\.recordRequest\((?:(?!\)).)*\)/g)?.filter((c) => !/'chat'|'build'/.test(c)) ?? [];
    expect(unlabelled).toEqual([]);
  });
});

// ── S3b · a fast dead-connection error is retried; the done steer waits for a clean step ───────────
describe('a lost file operation is retried, and "you are done" never rides a failed step', () => {
  it('"fetch failed" is a dead-sandbox signal', () => {
    expect(isDeadSandboxError('fetch failed')).toBe(true);
  });

  it('fileOp retries a fast dead error once on a fresh handle, never a timeout (source guard)', () => {
    const s = stripComments(src('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'));
    const body = s.slice(s.indexOf('private async fileOp<T>'), s.indexOf('async writeFile('));
    expect(body).toMatch(/isDeadSandboxError\(e\.message\) && !\/ timed out after \/\.test\(e\.message\)/);
    expect(body).toMatch(/const fresh = await this\.getSandbox\(workspaceId\);\s*return await withTimeout\(op\(fresh\)/);
  });

  const cfg: DoneSignalConfig = { enabled: true, everyN: 10, minStep: 8 };
  it('a due check is skipped on a failed step', () => {
    expect(shouldCheckDone({ cfg, step: 20, toolUses: 12, alreadySignalled: false })).toBe(true);
    expect(shouldCheckDone({ cfg, step: 20, toolUses: 12, alreadySignalled: false, lastStepFailed: true })).toBe(false);
  });

  it('…and runs on the next clean step instead of waiting a whole window', () => {
    expect(shouldCheckDone({ cfg, step: 21, toolUses: 12, alreadySignalled: false })).toBe(false);
    expect(shouldCheckDone({ cfg, step: 21, toolUses: 12, alreadySignalled: false, missedAt: 20 })).toBe(true);
  });

  it('the runner passes the failed step and the missed step (source guard)', () => {
    const r = stripComments(src('src/server/AgentV3/AgentRunner.ts'));
    expect(r).toMatch(/shouldCheckDone\(\{[^}]*lastStepFailed[^}]*missedAt: doneMissedAt/);
  });
});

// ── S3c · shared constants have ONE owner and ONE name ──────────────────────────────────────────────
describe('the fast lane pins every shared constant to one owner file', () => {
  const contract = [
    'export interface GKQuestion { q: string; a: string }',
    'export enum Level { Easy, Hard }',
    'export declare const gkQuestions: GKQuestion[];',
    'export const enum Mode { A, B }',
    'declare const studyTopics: string[];',
  ].join('\n');

  it('reads the constants and skips `const enum`', () => {
    expect(contractValueExports(contract)).toEqual(['gkQuestions', 'studyTopics']);
    expect(contractValueExports('export interface X { a: string }')).toEqual([]);
  });

  it('a planned data file owns them; otherwise a new data.ts beside the contract', () => {
    const withData: SimpleFileSpec[] = [
      { path: 'src/types.ts', purpose: 'types' },
      { path: 'src/App.tsx', purpose: 'screen' },
      { path: 'src/constants.ts', purpose: 'config' },
    ] as SimpleFileSpec[];
    expect(valueOwnerFor(withData, ['gkQuestions'], 'src/types.ts')).toEqual({ path: 'src/constants.ts', added: false });
    const none = [{ path: 'src/types.ts', purpose: 'types' }, { path: 'src/App.tsx', purpose: 'screen' }] as SimpleFileSpec[];
    const owner = valueOwnerFor(none, ['gkQuestions'], 'src/types.ts');
    expect(owner?.path).toBe('src/data.ts');
    expect(owner?.added).toBe(true);
    expect(valueOwnerFor(none, [], 'src/types.ts')).toBeNull();
  });

  it('the constants never go into the types module, and the note names their owner', () => {
    const mod = contractModule(contract);
    expect(mod?.source ?? '').not.toMatch(/gkQuestions|studyTopics/);
    expect(valueOwnerNote(['gkQuestions'], 'src/data.ts')).toContain('src/data.ts');
  });
});

// ── S3d · the app is named by what its screen says ──────────────────────────────────────────────────
describe('the installed name comes from the app, not from a placeholder or the prompt', () => {
  const app = `export default function App() {\n  return (<div><header><span className="brand">GK &amp; Study Helper</span></header><h1>Welcome to GK Quiz!</h1></div>);\n}`;

  it('reads the brand, else the first static h1', () => {
    expect(headingFromAppSource(app)).toMatch(/GK/);
    expect(headingFromAppSource('<h1>Welcome to Shop Ledger!</h1>')).toBe('Shop Ledger');
    expect(headingFromAppSource('<h1>{title}</h1>')).toBeNull();
    expect(headingFromAppSource('<h1>App</h1>')).toBeNull();
  });

  it('a placeholder <title> loses to the heading; a real one wins', () => {
    const r = resolveAppDisplayName({ indexHtml: '<title>App</title>', prompt: 'Make question', appSource: '<h1>GK Study Helper</h1>' });
    expect(r).toMatchObject({ name: 'GK Study Helper', source: 'app-heading' });
    const real = resolveAppDisplayName({ indexHtml: '<title>Ledger Pro</title>', prompt: 'x', appSource: '<h1>Other</h1>' });
    expect(real.source).toBe('index-title');
  });

  it('a two-word prompt is not a description', () => {
    expect(descriptionFromPrompt('Make question', 'GK Study Helper')).toBe('GK Study Helper');
  });

  it('a placeholder <title> in index.html is replaced; a real one is untouched', () => {
    const html = '<!doctype html><html><head><title>App</title></head><body><div id="root"></div></body></html>';
    const out = planAppDefaults(html, 'GK Study Helper');
    expect(out.indexHtml ?? '').toContain('<title>GK Study Helper</title>');
    const kept = planAppDefaults(html.replace('App', 'Ledger Pro'), 'GK Study Helper');
    expect(kept.indexHtml ?? '').toContain('<title>Ledger Pro</title>');
  });

  it('both callers hand the app source to the resolver (source guard)', () => {
    expect(stripComments(src('src/server/routes/agentv3.ts'))).toMatch(/resolveAppDisplayName\(\{[^}]*appSource/);
    expect(stripComments(src('src/server/AgentV3/ToolDispatcher.ts'))).toMatch(/resolveAppDisplayName\(\{[^}]*appSource/);
  });
});
