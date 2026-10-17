// Autopsy ca99778e (2026-10-17 15:38Z, weak tier, "Mock test" chip + Hindi "UP Police constable", stopped at 5.6 min).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import {
  createProviderSilenceMemory, adaptiveSilenceWindowMs, silenceFieldFor, type SilenceHistoryStore,
} from '../src/server/AgentV3/providerSilenceMemory';
import { benchUntilAfterAbandon, silenceBenchIsSticky } from '../src/server/AgentV3/crawlBench';
import { makeMultiProviderTurnRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { SLOW_STREAM_MESSAGE, SILENT_OPEN_MARK } from '../src/server/AgentV3/turnDeadline';
import {
  isScreenPath, zeroPropExport, childrenOnlyProvider, autoWiredEntry, isAutoWiredEntry, AUTO_WIRED_MARK, importSpecifier,
} from '../src/server/AgentV3/entryAutoWire';
import { floorRuleFor, autoStyleSheet, withAutoStyleImport, AUTO_STYLE_PATH } from '../src/server/AgentV3/autoStyleFloor';
import { collectDefinedClasses } from '../src/server/AgentV3/CssConsistency';
import { nextTodoWithdrawal, toolsThisTurn } from '../src/server/AgentV3/todoOnlyTurn';
import { soloArchitectTools, soloArchitectNote, buildsSolo, soloInputOf, soloKeeps } from '../src/server/AgentV3/soloBuild';
import {
  chipExtensionFor, seedableScaffoldFor, goldenScaffoldForPrompt, goldenBuildPrompt, templateOnlyBuild, GOLDEN_SCAFFOLDS,
} from '../src/server/AgentV3/goldenScaffolds/registry';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';
import { STARTER_ENTRY_CONTENT } from '../src/server/AgentV3/stillTheStarterApp';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

const read = (p: string) => readFileSync(p, 'utf8');
const HINDI = 'मुझे यूपी पुलिस कांस्टेबल की तैयारी करनी है तो तुम हर कोश्चन से मोक टेस्ट बनाकर दो';
const MOCK_CHIP = STARTER_TEMPLATES.find((t) => t.id === 'exam-prep')!.prompt;
const envBackup = { ...process.env };
afterEach(() => { process.env = { ...envBackup }; });

describe('1 · GLM silence is remembered across instances and grows with repetition', () => {
  const KEY = 'GLM::glm-4.7-flashx';
  it('the window doubles per repeat in 24 h and is capped', () => {
    expect(adaptiveSilenceWindowMs(1, 180_000, 1_800_000)).toBe(180_000);
    expect(adaptiveSilenceWindowMs(2, 180_000, 1_800_000)).toBe(360_000);
    expect(adaptiveSilenceWindowMs(3, 180_000, 1_800_000)).toBe(720_000);
    expect(adaptiveSilenceWindowMs(9, 180_000, 1_800_000)).toBe(1_800_000);
    expect(adaptiveSilenceWindowMs(0, 180_000, 1_800_000)).toBe(0);
  });

  it('an answer lifts the verdict but keeps the history, so the next silence is judged as a repeat', () => {
    const m = createProviderSilenceMemory({ windowMs: () => 180_000, maxWindowMs: () => 1_800_000 });
    m.record(KEY, 0);
    expect(m.until(KEY, 1_000)).toBe(180_000);
    m.clear(KEY, 200_000);
    expect(m.until(KEY, 200_001)).toBe(0);
    m.record(KEY, 300_000);
    expect(m.until(KEY, 300_001)).toBe(300_000 + 360_000);
  });

  it('🔴 another instance\'s silence (the durable store) is used by this one — the 8¾ h / redeploy gap of the report', async () => {
    const appended: Array<[string, number]> = [];
    const store: SilenceHistoryStore = {
      load: async () => ({ [KEY]: [1_000, 2_000] }),
      append: async (k, at) => { appended.push([k, at]); },
    };
    const m = createProviderSilenceMemory({ store, windowMs: () => 180_000, maxWindowMs: () => 1_800_000, now: () => 5_000 });
    await m.refresh!(5_000);
    expect(m.until(KEY, 5_000)).toBe(2_000 + 360_000);
    m.record(KEY, 6_000);
    expect(appended).toEqual([[KEY, 6_000]]);
  });

  it('a store that hangs or throws never blocks or fails anything', async () => {
    const m = createProviderSilenceMemory({ store: { load: () => new Promise(() => {}), append: async () => { throw new Error('x'); } } });
    const t0 = Date.now();
    await m.refresh!();
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(() => m.record(KEY, Date.now())).not.toThrow();
    const bad = createProviderSilenceMemory({ store: { load: async () => { throw new Error('down'); }, append: async () => {} } });
    await expect(bad.refresh!()).resolves.toBeUndefined();
  });

  it('a rung key becomes a safe Firestore field name', () => {
    expect(silenceFieldFor(KEY)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(silenceFieldFor('a::b')).not.toBe(silenceFieldFor('a__b'));
  });
});

describe('4 · a rung silent once in a build is not re-probed inside it (no Kimi ↔ GLM flipping)', () => {
  it('pure: silence is sticky, a crawl keeps its window; the switch restores the window', () => {
    expect(benchUntilAfterAbandon({ abandonsOfThisRung: 1, nowMs: 0, windowMs: 180_000, silent: true, sticky: true })).toBe(Number.POSITIVE_INFINITY);
    expect(benchUntilAfterAbandon({ abandonsOfThisRung: 1, nowMs: 0, windowMs: 180_000, silent: false, sticky: true })).toBe(180_000);
    expect(silenceBenchIsSticky({ AGENTV3_SILENCE_STICKY: 'off' })).toBe(false);
    expect(silenceBenchIsSticky({})).toBe(true);
  });

  it('🔴 an hour later the silent GLM is still not called again in the same build', async () => {
    const clock = { t: 0 };
    let glmCalls = 0;
    const answer = { text: 'ok', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, rawContent: [], model: 'kimi-k2.7-code' };
    const chain = makeMultiProviderTurnRunner([
      { name: 'GLM', modelId: 'glm-4.7-flashx', runner: { runTurn: async () => { glmCalls++; clock.t += 15_000; throw new Error(`${SLOW_STREAM_MESSAGE} after 15000ms — ${SILENT_OPEN_MARK}`); } } },
      { name: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => answer } },
    ] as never, { now: () => clock.t } as never);
    await chain.runTurn({ messages: [], tools: [] } as never);
    clock.t += 60 * 60_000;
    await chain.runTurn({ messages: [], tools: [] } as never);
    await chain.runTurn({ messages: [], tools: [] } as never);
    expect(glmCalls).toBe(1);
  });
});

describe('2 · screens on disk, starter on screen → the platform wires the entry', () => {
  it('finds zero-prop screens; skips components that need props, hooks and providers', () => {
    expect(isScreenPath('src/pages/Home.tsx')).toBe(true);
    expect(isScreenPath('src/components/Test.tsx')).toBe(true);
    expect(isScreenPath('src/components/QuestionCard.tsx')).toBe(false);
    expect(isScreenPath('src/hooks/useTheme.tsx')).toBe(false);
    expect(isScreenPath('src/App.tsx')).toBe(false);
    expect(zeroPropExport('src/pages/Home.tsx', 'export default function Home() { return <div/>; }')).toEqual({ path: 'src/pages/Home.tsx', name: 'Home', kind: 'default' });
    expect(zeroPropExport('src/pages/Test.tsx', 'export function Test() { return null }')?.kind).toBe('named');
    expect(zeroPropExport('src/pages/R.tsx', 'const ResultPage = () => <p/>;\nexport default ResultPage;\n')?.name).toBe('ResultPage');
    expect(zeroPropExport('src/pages/Test.tsx', 'export default function Test({ onDone }: P) { return null }')).toBeNull();
    expect(childrenOnlyProvider('src/theme.tsx', 'export function ThemeProvider({ children }: { children: ReactNode }) {')?.name).toBe('ThemeProvider');
    expect(importSpecifier('src/App.tsx', 'src/pages/Home.tsx')).toBe('./pages/Home');
  });

  it('the shell is valid TSX and JSX, marked, and needs no stylesheet', () => {
    const code = autoWiredEntry([
      { path: 'src/pages/Home.tsx', name: 'Home', kind: 'default' },
      { path: 'src/pages/Test.tsx', name: 'Test', kind: 'named' },
    ], 'src/App.tsx', { path: 'src/theme.tsx', name: 'ThemeProvider', kind: 'named' });
    expect(isAutoWiredEntry(code)).toBe(true);
    expect(code).toContain("import Home from './pages/Home';");
    expect(code).toContain("import { Test } from './pages/Test';");
    expect(code).not.toMatch(/className=/);
    expect(() => transformSync(code, { loader: 'tsx' })).not.toThrow();
    expect(() => transformSync(code, { loader: 'jsx' })).not.toThrow();
  });

  it('🔴 the report\'s sequence: Home + Test written, App.tsx never → the dispatcher writes App.tsx itself', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('src/App.tsx', STARTER_ENTRY_CONTENT);
    act.files.set('src/main.tsx', "import App from './App';\n");
    await d.dispatch(toolCall('write_file', { path: 'src/hooks/useTheme.tsx', content: 'export function useTheme() { return "light"; }\n' }, 'a'), 'frontend');
    await d.dispatch(toolCall('write_file', { path: 'src/pages/Home.tsx', content: 'export default function Home() { return <h1>UP Police</h1>; }\n' }, 'b'), 'frontend');
    const r = await d.dispatch(toolCall('write_file', { path: 'src/pages/Test.tsx', content: 'export default function Test() { return <p>Q1</p>; }\n' }, 'c'), 'frontend');
    const app = act.files.get('src/App.tsx') ?? '';
    expect(app).toContain(AUTO_WIRED_MARK);
    expect(app).toContain("import Home from './pages/Home';");
    expect(app).toContain("import Test from './pages/Test';");
    expect(String(r.content)).toMatch(/platform wired src\/App\.tsx/);
  });

  it('never over a real entry the builder wrote, and the switch turns it off', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('src/App.tsx', 'export default function App() { return <main>mine</main>; }\n');
    await d.dispatch(toolCall('write_file', { path: 'src/pages/Home.tsx', content: 'export default function Home() { return null; }\n' }, 'a'), 'frontend');
    await d.dispatch(toolCall('write_file', { path: 'src/pages/Test.tsx', content: 'export default function Test() { return null; }\n' }, 'b'), 'frontend');
    expect(act.files.get('src/App.tsx')).toContain('mine');
    process.env.AGENTV3_ENTRY_AUTOWIRE = 'off';
    const off = makeDispatcher();
    off.act.files.set('src/App.tsx', STARTER_ENTRY_CONTENT);
    await off.d.dispatch(toolCall('write_file', { path: 'src/pages/Home.tsx', content: 'export default function Home() { return null; }\n' }, 'a'), 'frontend');
    await off.d.dispatch(toolCall('write_file', { path: 'src/pages/Test.tsx', content: 'export default function Test() { return null; }\n' }, 'b'), 'frontend');
    expect(off.act.files.get('src/App.tsx')).toBe(STARTER_ENTRY_CONTENT);
  });
});

describe('3 · undefined classes get a readable floor at once — and the nets still ask for real rules', () => {
  it('the words decide; a name that says nothing gets nothing', () => {
    expect(floorRuleFor('question-card')).toMatch(/border-radius: 12px/);
    expect(floorRuleFor('submit-btn')).toMatch(/cursor: pointer/);
    expect(floorRuleFor('optionCorrect')).toMatch(/22c55e/);
    expect(floorRuleFor('card-title')).toMatch(/font-weight: 700/);
    expect(floorRuleFor('zorblax')).toBe('');
    expect(autoStyleSheet(['b-card', 'a-btn'])).toBe(autoStyleSheet(['a-btn', 'b-card']));
  });

  it('the floor sheet defines nothing for the undefined-class question', () => {
    const { defined } = collectDefinedClasses({ [AUTO_STYLE_PATH]: autoStyleSheet(['question-card']), 'src/index.css': '.real{}' });
    expect(defined.has('question-card')).toBe(false);
    expect(defined.has('real')).toBe(true);
  });

  it('imported FIRST from the mount (later sheets win), and only once', () => {
    const next = withAutoStyleImport("import './index.css';\nimport App from './App';\n")!;
    expect(next.indexOf('nb-autostyle.css')).toBeLessThan(next.indexOf('index.css'));
    expect(withAutoStyleImport(next)).toBeNull();
  });

  it('🔴 a screen written with undefined classes lays the floor through the dispatcher', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('src/main.tsx', "import './index.css';\nimport App from './App';\n");
    act.files.set('src/index.css', 'body { margin: 0 }\n.app-shell { padding: 4px }\n');
    await d.dispatch(toolCall('write_file', {
      path: 'src/pages/Test.tsx',
      content: 'export default function Test() { return <div className="question-card"><button className="submit-btn">Go</button><span className="timer-value">10</span></div>; }\n',
    }, 'a'), 'frontend');
    expect(act.files.get(AUTO_STYLE_PATH) ?? '').toMatch(/\.question-card \{/);
    expect(act.files.get('src/main.tsx')!.startsWith("import './nb-autostyle.css';")).toBe(true);
  });
});

describe('5 · a plan-only turn cannot be repeated: the plan tool is withdrawn', () => {
  it('pure: withdrawn until work, then for the run after a second plan-only turn', () => {
    expect(nextTodoWithdrawal('offered', { todoOnly: true, didOtherWork: false, plannedOnlyBefore: false })).toBe('until-work');
    expect(nextTodoWithdrawal('until-work', { todoOnly: false, didOtherWork: true, plannedOnlyBefore: true })).toBe('offered');
    expect(nextTodoWithdrawal('offered', { todoOnly: true, didOtherWork: false, plannedOnlyBefore: true })).toBe('for-run');
    expect(nextTodoWithdrawal('for-run', { todoOnly: false, didOtherWork: true, plannedOnlyBefore: true })).toBe('for-run');
    expect(nextTodoWithdrawal('until-work', { todoOnly: true, didOtherWork: false, plannedOnlyBefore: true }, { AGENTV3_TODO_WITHDRAW: 'off' } as NodeJS.ProcessEnv)).toBe('offered');
    const tools = [{ name: 'update_todo' }, { name: 'write_file' }];
    expect(toolsThisTurn(tools, 'until-work').map((t) => t.name)).toEqual(['write_file']);
    expect(toolsThisTurn([{ name: 'update_todo' }], 'for-run').map((t) => t.name)).toEqual(['update_todo']); // plan lane keeps it
  });

  it('🔴 the runner: after a plan-only turn the next call is not offered update_todo; after work it is again', async () => {
    const use = { input_tokens: 5, output_tokens: 7 };
    const script = [
      { content: [{ type: 'tool_use', id: 't1', name: 'update_todo', input: { todos: [] } }], stop_reason: 'tool_use', usage: use },
      { content: [{ type: 'tool_use', id: 'w1', name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } }], stop_reason: 'tool_use', usage: use },
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: use },
    ];
    const offered: string[][] = [];
    let n = 0;
    const client: MessagesCreateClient = { messages: { create: async (p: { tools?: Array<{ name: string }> }) => { offered.push((p.tools ?? []).map((t) => t.name)); return script[n++] as never ?? script[2] as never; } } };
    const stream = new AgentEventStream();
    await new AgentRunner({
      client: new ClaudeClient(client), dispatcher: { dispatch: async (tu: { id: string }) => ({ tool_use_id: tu.id, content: 'ok', is_error: false }) } as never,
      state: new WorkspaceState(stream), events: stream, model: 'm', system: 's', tools: defaultToolCatalog(),
    } as never).run('build');
    expect(offered[0]).toContain('update_todo');
    expect(offered[1]).not.toContain('update_todo');
    expect(offered[2]).toContain('update_todo');
  });
});

describe('6 · a simple new app is built by one agent', () => {
  it('task is withdrawn only for a new, non-complex, non-project build', () => {
    const tools = ['write_file', 'task', 'read_file'] as const;
    expect(soloArchitectTools(tools, soloInputOf(false, false, 'new_build', false))).toEqual(['write_file', 'read_file']);
    expect(soloArchitectTools(tools, soloInputOf(true, false, 'new_build', false))).toContain('task');
    expect(soloArchitectTools(tools, soloInputOf(false, true, 'new_build', false))).toContain('task');
    expect(soloArchitectTools(tools, soloInputOf(false, false, 'edit_existing', true))).toContain('task');
    expect(buildsSolo(soloInputOf(false, false, 'new_build', false), { AGENTV3_SOLO_SIMPLE: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(soloArchitectNote(soloInputOf(false, false, 'new_build', false))).toMatch(/SOLO BUILD/);
    expect([{ name: 'write_file' }, { name: 'task' }].filter(soloKeeps(soloInputOf(false, false, 'new_build', false))).map((t) => t.name)).toEqual(['write_file']);
    expect([{ name: 'task' }].filter(soloKeeps(soloInputOf(true, false, 'new_build', false)))).toHaveLength(1);
  });

  it('🔴 a task call from a run not offered the tool spawns nothing', async () => {
    const use = { input_tokens: 5, output_tokens: 7 };
    const script = [
      { content: [{ type: 'tool_use', id: 'k1', name: 'task', input: { agent: 'frontend', prompt: 'build it' } }], stop_reason: 'tool_use', usage: use },
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: use },
    ];
    let n = 0;
    const dispatched: string[] = [];
    const client: MessagesCreateClient = { messages: { create: async () => (script[n++] ?? script[1]) as never } };
    const stream = new AgentEventStream();
    await new AgentRunner({
      client: new ClaudeClient(client),
      dispatcher: { dispatch: async (tu: { id: string; name: string }) => { dispatched.push(tu.name); return { tool_use_id: tu.id, content: 'ok', is_error: false }; } } as never,
      state: new WorkspaceState(stream), events: stream, model: 'm', system: 's', tools: defaultToolCatalog().filter((t) => t.name !== 'task'), soloBuild: true,
    } as never).run('build');
    expect(dispatched).not.toContain('task');
  });

  it('the route wires it in both tool lists and the system prompt', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route.match(/\.filter\(soloKeeps\(soloInputOf\(buildIsComplex, appScope\.projectMode, intent, isEditMode\)\)\)/g)?.length).toBe(2);
    expect(route).toContain('system: architectSystem + soloArchitectNote(soloInputOf(');
    expect(route).toContain('soloBuild: buildsSolo(soloInputOf(');
  });
});

describe('7 · a chip plus the user\'s own words seeds the template and puts the words first', () => {
  const prompt = `${MOCK_CHIP} ${HINDI}`;
  it('the report\'s prompt seeds exam-prep and keeps the Hindi as the customisation', () => {
    expect(goldenScaffoldForPrompt(prompt)).toBeNull(); // the exact match is unchanged
    const ext = chipExtensionFor(prompt)!;
    expect(ext.scaffold.id).toBe('exam-prep');
    expect(ext.extension).toBe(HINDI);
    expect(seedableScaffoldFor(prompt)?.id).toBe('exam-prep');
    expect(templateOnlyBuild(true, prompt)).toBe(false);
    expect(templateOnlyBuild(true, MOCK_CHIP)).toBe(true);
  });

  it('the exact chip, an edited chip, and punctuation alone are unchanged', () => {
    expect(chipExtensionFor(MOCK_CHIP)).toBeNull();
    expect(chipExtensionFor(`${MOCK_CHIP} !!`)).toBeNull();
    expect(chipExtensionFor(MOCK_CHIP.replace('General Knowledge', 'GK'))).toBeNull();
    expect(seedableScaffoldFor(MOCK_CHIP)?.id).toBe('exam-prep');
  });

  it('the builder reads a CUSTOMISE head, never "make NO edits"', () => {
    const golden = GOLDEN_SCAFFOLDS.find((g) => g.id === 'exam-prep')!;
    const out = goldenBuildPrompt(golden, prompt, HINDI);
    expect(out.startsWith('[CUSTOMISE THIS WORKING TEMPLATE')).toBe(true);
    expect(out).toContain(HINDI);
    expect(out).not.toContain('make NO edits');
    expect(goldenBuildPrompt(golden, MOCK_CHIP)).toContain('make NO edits');
  });

  it('the route seeds with it', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('const golden = seedableScaffoldFor(prompt);');
    expect(route).toContain('buildPrompt = goldenBuildPrompt(golden, buildPrompt, chipExtensionTextOf(prompt));');
  });
});
