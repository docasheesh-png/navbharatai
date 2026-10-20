import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  postGreenWritesNote,
  groupPostGreenWrites,
  writerLabel,
  writerPhrase,
  BUILD_LOOP_LABEL,
  UNNAMED_PLATFORM_LABEL,
  UNNAMED_MODEL_REPAIR_LABEL,
  type PostGreenWrite,
} from '../src/server/AgentV3/postGreenWrites';
import {
  setWriteObserver,
  setGreenFreezeObserver,
  assertWriteAllowed,
  writeRefused,
  latchGreen,
  clearGreenLatch,
  runInPass,
  ALLOWED_PASSES,
} from '../src/server/AgentV3/greenFreeze';
import { runAsModelToolCall, modelToolOrigin, type ModelToolOrigin } from '../src/server/AgentV3/modelToolWrites';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

/**
 * A PLATFORM WRITER IS NEVER THE MODEL (autopsy 9c612cdb, 2026-10-12).
 *
 * The report, verbatim, at 454.4 s: "After the app first rendered 350s in, 12 file(s) were written by 3 writer(s):
 * production-defaults (6 files), build loop (5 files), design-consistency-heal (1 file). At the end the app still
 * rendered." The model (the architect) wrote its final summary at 348.4 s and made NO write after it. The five
 * "build loop" files were three platform finishing passes that named no pass:
 *   • the unused-import sweep — "🧹 Cleaned unused imports from 2 file(s)" (367.3 s)  → 2 files
 *   • the E2E scaffold — E2E_SCAFFOLDED: playwright.config.ts, e2e/smoke.spec.ts (368.4 s) → 2 files
 *   • the architecture note — docs/decisions/ADR-001.md (between 368.4 s and 372.8 s)  → 1 file
 * `postGreenWrites.ts` labelled every write with no pass "build loop", so a false finding read as "the model kept
 * editing a working app".
 *
 * THE CLASS: "who wrote?" was answered by ABSENCE. Any platform writer that forgot `runInPass` was the model by
 * default. This file locks both halves of the fix:
 *   1. "build loop" is POSITIVE evidence — a tool call `AgentRunner` dispatched for the user's build
 *      (modelToolWrites.ts). Neither named nor the model's ⇒ "unnamed platform step", never "build loop".
 *   2. every platform writer that can run after the first render names its pass — a census over the route's
 *      post-answer region, the dispatcher's platform-started methods and AgentRunner's dispatch, which fails on a NEW
 *      unnamed writer.
 * And the safety half: a new name is attribution ONLY — Green Freeze decides exactly as it did for no name.
 */

const T0 = 1_791_819_048_064; // the report's startedAt
const at = (s: number) => T0 + Math.round(s * 1000);

/**
 * The report's twelve post-render writes, as the choke point now sees them (each writer named). The report gives the
 * unused-import sweep's COUNT (2), not its files — the two hook paths below stand in for them; nothing reads which.
 */
const REPORT_9C612CDB_NOW: PostGreenWrite[] = [
  { path: 'src/index.css', pass: 'design-consistency-heal', model: null, at: at(366.3) },
  { path: 'src/hooks/usePlayer.ts', pass: 'unused-import-sweep', model: null, at: at(367.3) },
  { path: 'src/hooks/useVideoList.ts', pass: 'unused-import-sweep', model: null, at: at(367.3) },
  { path: 'playwright.config.ts', pass: 'e2e-scaffold', model: null, at: at(368.4) },
  { path: 'e2e/smoke.spec.ts', pass: 'e2e-scaffold', model: null, at: at(368.4) },
  { path: 'docs/decisions/ADR-001.md', pass: 'adr-note', model: null, at: at(369) },
  ...['index.html', 'public/manifest.webmanifest', 'public/robots.txt', 'public/icon.svg', 'public/sw.js', 'public/nbai-native.css']
    .map((path) => ({ path, pass: 'production-defaults', model: null, at: at(372.8) })),
];

describe('"build loop" is a fact the write carries, not the default for a missing name', () => {
  it('a write with no pass and no model is an UNNAMED PLATFORM STEP — never the build loop', () => {
    expect(writerLabel({ pass: null })).toBe(UNNAMED_PLATFORM_LABEL);
    expect(writerLabel({ pass: null, model: null })).toBe(UNNAMED_PLATFORM_LABEL);
    expect(writerLabel({ pass: null, model: null })).not.toBe(BUILD_LOOP_LABEL);
  });
  it('the build loop only when a model asked for the write in the user\'s own build', () => {
    expect(writerLabel({ pass: null, model: 'build' })).toBe(BUILD_LOOP_LABEL);
  });
  it('a repair the platform started is a model repair, not the build loop', () => {
    expect(writerLabel({ pass: null, model: 'platform-repair' })).toBe(UNNAMED_MODEL_REPAIR_LABEL);
  });
  it('a pass name wins over everything — it is the most specific fact there is', () => {
    expect(writerLabel({ pass: 'feature-presence-heal', model: 'platform-repair' })).toBe('feature-presence-heal');
    expect(writerLabel({ pass: 'e2e-scaffold', model: null })).toBe('e2e-scaffold');
  });
  it('the phrase a sentence uses names the same writer', () => {
    expect(writerPhrase({ pass: 'adr-note', model: null })).toBe('the adr-note pass');
    expect(writerPhrase({ pass: null, model: 'build' })).toBe('the build loop');
    expect(writerPhrase({ pass: null, model: null })).toBe('an unnamed platform step');
    expect(writerPhrase({ pass: null, model: 'platform-repair' })).toBe('an unnamed model repair');
  });
});

describe('🔴 the 9c612cdb line, replayed', () => {
  it('as the report SHOULD have read it: every writer named, and none of them the build loop', () => {
    const n = postGreenWritesNote({ writes: REPORT_9C612CDB_NOW, firstRenderAt: at(349.7), buildStartedAt: T0, end: 'rendered' });
    expect(n.message).toBe(
      'After the app first rendered 350s in, 12 file(s) were written by 5 writer(s): production-defaults (6 files), '
      + 'e2e-scaffold (2 files), unused-import-sweep (2 files), adr-note (1 file), design-consistency-heal (1 file). '
      + 'At the end the app still rendered.',
    );
    expect(n.message).not.toContain(BUILD_LOOP_LABEL);
  });
  it('the same five writes WITHOUT their names (the old route) are an unnamed platform step — never the model', () => {
    const unnamed = REPORT_9C612CDB_NOW.map((w) => (['unused-import-sweep', 'e2e-scaffold', 'adr-note'].includes(w.pass ?? '') ? { ...w, pass: null } : w));
    const n = postGreenWritesNote({ writes: unnamed, firstRenderAt: at(349.7), buildStartedAt: T0, end: 'rendered' });
    expect(n.message).toContain(`${UNNAMED_PLATFORM_LABEL} (5 files)`);
    expect(n.message).not.toContain(BUILD_LOOP_LABEL + ' (');
    expect(n.message).toContain(`"${UNNAMED_PLATFORM_LABEL}" writes came from platform code that named no pass`);
    expect(n.message).toMatch(/still rendered\.$/);
  });
  it('the model\'s own writes after the render are still the build loop', () => {
    const g = groupPostGreenWrites([{ path: 'src/App.tsx', pass: null, model: 'build', at: at(360) }]);
    expect(g).toEqual([{ pass: BUILD_LOOP_LABEL, files: 1, paths: ['src/App.tsx'] }]);
  });
});

describe('the write choke point reports WHO, from evidence', () => {
  const WS = 'ws-platform-writer-attribution';
  let dispose: (() => void) | null = null;
  afterEach(() => { dispose?.(); dispose = null; clearGreenLatch(WS); });

  const watch = () => {
    const seen: Array<{ path: string; pass: string | null; model: ModelToolOrigin | null }> = [];
    dispose = setWriteObserver(({ path, pass, model }) => seen.push({ path, pass, model }), WS);
    return seen;
  };

  it('outside any zone: no pass and no model', () => {
    const seen = watch();
    assertWriteAllowed(WS, 'src/a.ts');
    expect(seen).toEqual([{ path: 'src/a.ts', pass: null, model: null }]);
  });
  it('inside a model tool call: the build', async () => {
    const seen = watch();
    await runAsModelToolCall(async () => { assertWriteAllowed(WS, 'src/b.ts'); });
    expect(seen).toEqual([{ path: 'src/b.ts', pass: null, model: 'build' }]);
    expect(modelToolOrigin()).toBeNull(); // the zone does not leak out of the call
  });
  it('a platform repair stays a platform repair in every sub-agent it delegates to', async () => {
    const seen = watch();
    await runAsModelToolCall(async () => {
      await runAsModelToolCall(async () => { assertWriteAllowed(WS, 'src/c.ts'); }); // a child run with no flag
    }, { platformRequest: true });
    expect(seen).toEqual([{ path: 'src/c.ts', pass: null, model: 'platform-repair' }]);
  });
  it('a named pass around a model run keeps both facts — and the label is the pass', async () => {
    const seen = watch();
    await runInPass('integrity-repair', () => runAsModelToolCall(async () => { assertWriteAllowed(WS, 'src/d.ts'); }, { platformRequest: true }));
    expect(seen).toEqual([{ path: 'src/d.ts', pass: 'integrity-repair', model: 'platform-repair' }]);
    expect(writerLabel(seen[0])).toBe('integrity-repair');
  });
  it('a REFUSED write names its writer the same way (GREEN_FREEZE_DEFERRED reads it)', async () => {
    const refused: Array<{ pass: string | null; model: ModelToolOrigin | null }> = [];
    const d = setGreenFreezeObserver(({ pass, model }) => refused.push({ pass, model }), WS);
    try {
      latchGreen(WS, ['src/App.tsx']);
      expect(() => assertWriteAllowed(WS, 'src/App.tsx')).toThrow();
      await runAsModelToolCall(async () => { expect(() => assertWriteAllowed(WS, 'src/App.tsx')).toThrow(); });
      expect(refused).toEqual([{ pass: null, model: null }, { pass: null, model: 'build' }]);
    } finally { d(); }
  });
});

// ── The real engine pieces, driven — not a model of them ───────────────────────────────────────────────────────

/** A sandbox whose writes pass the real choke point, as E2BActuator's do. */
class FreezingActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(w: string, p: string, c: string): Promise<void> { assertWriteAllowed(w, p); this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

function scriptedClient(messages: unknown[]): MessagesCreateClient {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const m = messages[i] ?? { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' };
        i++;
        return m as never;
      },
    },
  };
}

function rig(ws: string) {
  const actuator = new FreezingActuator();
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  const dispatcher = new ToolDispatcher(actuator, ws, state, stream);
  return { actuator, stream, state, dispatcher };
}

describe('AgentRunner marks the model\'s tool calls — the build loop is earned there and nowhere else', () => {
  const WS = 'ws-runner-attribution';
  let dispose: (() => void) | null = null;
  afterEach(() => { dispose?.(); dispose = null; });

  const runOnce = async (platformRequest: boolean) => {
    const { actuator, stream, state, dispatcher } = rig(WS);
    const seen: Array<{ path: string; pass: string | null; model: ModelToolOrigin | null }> = [];
    dispose = setWriteObserver(({ path, pass, model }) => seen.push({ path, pass, model }), WS);
    const runner = new AgentRunner({
      client: new ClaudeClient(scriptedClient([
        { content: [{ type: 'tool_use', id: 'tu1', name: 'write_file', input: { path: 'index.html', content: '<h1>Hi</h1>' } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } },
        { content: [{ type: 'text', text: 'All done.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } },
      ])),
      dispatcher, state, events: stream,
      model: 'claude-sonnet-test', system: 'You are the Architect.', tools: defaultToolCatalog(),
      platformRequest,
    });
    await runner.run('Build a hello page');
    expect(actuator.files.get('index.html')).toBe('<h1>Hi</h1>');
    return seen.filter((s) => s.path === 'index.html');
  };

  it('the user\'s build: the model\'s write_file is the build loop', async () => {
    const seen = await runOnce(false);
    expect(seen).toEqual([{ path: 'index.html', pass: null, model: 'build' }]);
    expect(writerLabel(seen[0])).toBe(BUILD_LOOP_LABEL);
  });
  it('a repair the platform started: a model repair, not the build loop', async () => {
    const seen = await runOnce(true);
    expect(seen).toEqual([{ path: 'index.html', pass: null, model: 'platform-repair' }]);
    expect(writerLabel(seen[0])).toBe(UNNAMED_MODEL_REPAIR_LABEL);
  });
  it('the PLATFORM calling the same dispatcher door (the fast lane, the gate fixers) is not the model', async () => {
    const { dispatcher } = rig(WS);
    const seen: Array<{ pass: string | null; model: ModelToolOrigin | null }> = [];
    dispose = setWriteObserver(({ pass, model }) => seen.push({ pass, model }), WS);
    await dispatcher.dispatch({ id: 'platform-w0', name: 'write_file', input: { path: 'src/x.ts', content: 'export const x = 1;\n' } }, 'frontend');
    expect(seen).toEqual([{ pass: null, model: null }]);
    expect(writerLabel(seen[0])).toBe(UNNAMED_PLATFORM_LABEL);
  });
});

describe('the dispatcher\'s platform-started heals name themselves — and keep an outer pass\'s permission', () => {
  const WS = 'ws-dispatcher-heal-attribution';
  let dispose: (() => void) | null = null;
  afterEach(() => { dispose?.(); dispose = null; clearGreenLatch(WS); });
  const LEAK = `export function useAuth() {\n  const login = (email, password) => {\n    console.log('login', email, password);\n    return api.login(email, password);\n  };\n  return { login };\n}`;

  it('healCredentialLogs (run by AgentRunner after the model ends) writes as heal-credential-logs', async () => {
    const { actuator, dispatcher } = rig(WS);
    actuator.files.set('src/hooks/useAuth.ts', LEAK);
    const seen: Array<string | null> = [];
    dispose = setWriteObserver(({ pass }) => seen.push(pass), WS);
    expect(await dispatcher.healCredentialLogs()).toContain('Redacted');
    expect(seen).toEqual(['heal-credential-logs']);
  });
  it('under an allowlisted pass it keeps THAT name, so its Green Freeze permission is unchanged', async () => {
    const { actuator, dispatcher } = rig(WS);
    actuator.files.set('src/hooks/useAuth.ts', LEAK);
    latchGreen(WS, ['src/hooks/useAuth.ts']);
    const seen: Array<string | null> = [];
    dispose = setWriteObserver(({ pass }) => seen.push(pass), WS);
    await runInPass('feature-presence-heal', () => dispatcher.healCredentialLogs());
    expect(seen).toEqual(['feature-presence-heal']);
    expect(actuator.files.get('src/hooks/useAuth.ts')).not.toBe(LEAK); // allowed, exactly as before
  });
  it('the evaluate tool\'s own .gitignore heal is the evaluate heal — even when a model (or the reviewer) called evaluate', async () => {
    const { actuator, dispatcher } = rig(WS);
    actuator.files.set('.env', 'API_KEY=live-secret\n');
    actuator.files.set('package.json', '{"name":"x","dependencies":{}}');
    actuator.files.set('index.html', '<!doctype html><div id="root"></div>');
    const seen: Array<{ path: string; pass: string | null; model: ModelToolOrigin | null }> = [];
    dispose = setWriteObserver(({ path, pass, model }) => seen.push({ path, pass, model }), WS);
    await runAsModelToolCall(() => dispatcher.dispatch({ id: 'ev1', name: 'evaluate', input: {} }, 'reviewer'));
    expect(actuator.files.get('.gitignore')).toMatch(/\.env/);
    expect(seen.filter((s) => s.path === '.gitignore')).toEqual([{ path: '.gitignore', pass: 'evaluate-heal', model: 'build' }]);
  });
  it('with no outer pass on a latched app it is refused, exactly as the unnamed write was', async () => {
    const { actuator, dispatcher } = rig(WS);
    actuator.files.set('src/hooks/useAuth.ts', LEAK);
    latchGreen(WS, ['src/hooks/useAuth.ts']);
    expect(await dispatcher.healCredentialLogs()).toBe('');
    expect(actuator.files.get('src/hooks/useAuth.ts')).toBe(LEAK);
  });
});

// ── The safety half: a name is attribution, never permission ───────────────────────────────────────────────────

const ROUTE_PATH = 'src/server/routes/agentv3.ts';
const DISPATCHER_PATH = 'src/server/AgentV3/ToolDispatcher.ts';
const RUNNER_PATH = 'src/server/AgentV3/AgentRunner.ts';
const read = (p: string) => readFileSync(p, 'utf8');
const parse = (p: string) => ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Every string-literal pass name the engine uses, from `runInPass('x', …)` and the dispatcher's `inPlatformPass('x', …)`. */
function passNamesIn(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(/\b(?:runInPass|inPlatformPass)\(\s*'([a-z0-9-]+)'/g)) names.add(m[1]);
  return names;
}

/**
 * The names a freeze decision legitimately depends on: the allowlist, plus the create-only pair greenFreeze.ts
 * documents. Adding a name HERE is the deliberate act greenFreeze.ts asks for; every other name must behave as none.
 */
const FREEZE_MEANINGFUL = new Set<string>([...ALLOWED_PASSES, 'starter-tests', 'production-defaults']);

describe('🔒 every attribution-only pass name is refused EXACTLY as no name is — byte-identical freeze', () => {
  const WS = 'ws-name-is-not-permission';
  afterEach(() => clearGreenLatch(WS));
  const names = [...new Set([...passNamesIn(read(ROUTE_PATH)), ...passNamesIn(read(DISPATCHER_PATH))])].filter((n) => !FREEZE_MEANINGFUL.has(n));
  const PATHS = ['src/App.tsx', 'src/Brand.tsx', '.env', '.env.local', 'src/App.test.tsx', 'e2e/smoke.spec.ts', 'docs/decisions/ADR-001.md', 'node_modules/x/i.js'];

  it('the census found the names this fix added (so the list below is not vacuous)', () => {
    // 'architecture-note', not 'adr-note': #3698 (Q-977) named the ADR writer first, and its name is the one kept.
    //
    // 'design-heal-revert' WAS on this list and is deliberately off it now (Q-1013, 2026-10-15). It was
    // attribution-only, and that was the defect: `design-consistency-heal` may write to a latched app while
    // its own undo could not, so a page the heal BROKE stayed broken and the freeze protected the breakage.
    // It is now in ALLOWED_PASSES, so `FREEZE_MEANINGFUL` excludes it from `names` automatically and the
    // "decides as no name does" assertions below correctly no longer cover it. Seven names remain here, so
    // this vacuity check still bites.
    for (const n of ['unused-import-sweep', 'e2e-scaffold', 'architecture-note', 'reviewer-autofix', 'integrity-repair', 'heal-credential-logs', 'vaccine-repair-unlatched']) {
      expect(names).toContain(n);
    }
    // And the move is asserted, not assumed: the name must now be freeze-meaningful rather than ignored.
    expect(FREEZE_MEANINGFUL.has('design-heal-revert')).toBe(true);
    expect(names).not.toContain('design-heal-revert');
  });
  it('none of them collides with a freeze-meaningful name', () => {
    for (const n of names) expect(FREEZE_MEANINGFUL.has(n)).toBe(false);
  });
  it('latched and unlatched, on every kind of path, each name decides as no name does', async () => {
    const decide = async (name: string | null) => {
      const out: boolean[] = [];
      for (const latched of [false, true]) {
        clearGreenLatch(WS);
        if (latched) latchGreen(WS, ['src/App.tsx', '.env', 'src/App.test.tsx']);
        for (const p of PATHS) out.push(name ? await runInPass(name, async () => writeRefused(WS, p)) : writeRefused(WS, p));
      }
      return out;
    };
    const none = await decide(null);
    expect(none.some(Boolean)).toBe(true); // the latch really refuses something, so equality below means something
    for (const n of names) expect({ n, d: await decide(n) }).toEqual({ n, d: none });
  });
  it('the model-tool zone never changes a freeze decision either — it is read by the ledgers only', async () => {
    latchGreen(WS, ['src/App.tsx', '.env']);
    const outside = PATHS.map((p) => writeRefused(WS, p));
    for (const platformRequest of [false, true]) {
      const inside = await runAsModelToolCall(async () => PATHS.map((p) => writeRefused(WS, p)), { platformRequest });
      expect(inside).toEqual(outside);
    }
    const freeze = read('src/server/AgentV3/greenFreeze.ts');
    const decision = freeze.slice(freeze.indexOf('export function writeRefused'), freeze.indexOf('export function assertWriteAllowed'));
    expect(decision.length).toBeGreaterThan(200);
    expect(decision).not.toContain('modelToolOrigin');
  });
});

// ── The census: a NEW platform writer that names no pass fails here ─────────────────────────────────────────────

function calleeText(sf: ts.SourceFile, call: ts.CallExpression): string {
  return call.expression.getText(sf);
}

/** Is `node` (lexically) inside the function argument of a call to one of `namers`? */
function insideCallTo(sf: ts.SourceFile, node: ts.Node, namers: ReadonlySet<string>): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && namers.has(calleeText(sf, p)) && p.arguments.some((a) => a.pos <= node.pos && node.end <= a.end)) return true;
  }
  return false;
}

function walk(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
}

const POST_ANSWER_START = 'if (!result) result = await runner.run(buildPrompt);';
const POST_ANSWER_END = 'try { disposeWriteObserver?.(); } catch';

/**
 * A write-capable call that is deliberately NOT a named pass, keyed by its exact text, with the reason. A stale entry
 * (the call is gone) fails the census too, so this list cannot rot into a blanket pass.
 */
const ROUTE_EXCEPTIONS: Record<string, string> = {
  'retryRunner.run(buildPrompt)':
    'the build loop ITSELF, re-run when the first attempt wrote nothing — its writes are the model\'s tool calls, '
    + 'which AgentRunner marks as the build (modelToolWrites.ts); a pass name here would hide that.',
};

describe('🔒 census — every write the route makes after the model answers names its pass', () => {
  const sf = parse(ROUTE_PATH);
  const text = sf.getFullText();
  // After the build loop's own last call: everything from here on runs once the model has answered.
  const start = text.indexOf(POST_ANSWER_START) + POST_ANSWER_START.length;
  const end = text.indexOf(POST_ANSWER_END);
  const runnerVars = new Set<string>(['runner']);
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isNewExpression(n.initializer) && n.initializer.expression.getText(sf) === 'AgentRunner') runnerVars.add(n.name.text);
  });
  const sites: Array<{ line: number; call: string; named: boolean }> = [];
  let sharedRestore: ts.ArrowFunction | undefined;
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'applyGreenSnapshotRestore' && n.initializer && ts.isArrowFunction(n.initializer)) sharedRestore = n.initializer;
  });
  const restoreSites: Array<{ line: number; named: boolean }> = [];
  const restorePasses: string[] = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const c = calleeText(sf, n);
    if (sharedRestore && n.pos >= sharedRestore.pos && n.end <= sharedRestore.end && /^actuator\.(writeFile|writeBinaryFile)$/.test(c)) {
      restoreSites.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, named: insideCallTo(sf, n, new Set(['runInPass'])) });
    }
    if (c === 'applyGreenSnapshotRestore') {
      const pass = n.arguments[3];
      restorePasses.push(pass && ts.isStringLiteral(pass) ? pass.text : pass ? '<dynamic pass>' : 'green-guard-restore');
    }
  });
  const dispatcherMethods = new Set<string>();
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || n.pos < start || n.end > end) return;
    const c = calleeText(sf, n);
    const isRunnerRun = ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'run'
      && ts.isIdentifier(n.expression.expression) && runnerVars.has(n.expression.expression.text);
    if (/^dispatcher\.\w+$/.test(c) && c !== 'dispatcher.dispatch') dispatcherMethods.add(c.slice('dispatcher.'.length));
    if (!(/^actuator\.(writeFile|writeBinaryFile)$/.test(c) || /^(writeWorkspaceFiles|restoreWorkspaceAssets)$/.test(c) || c === 'dispatcher.dispatch' || isRunnerRun)) return;
    sites.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, call: n.getText(sf).replace(/\s+/g, ' '), named: insideCallTo(sf, n, new Set(['runInPass'])) });
  });

  it('the region exists and the census sees the writers in it (a broken anchor must not pass silently)', () => {
    expect(start).toBeGreaterThan(POST_ANSWER_START.length);
    expect(end).toBeGreaterThan(start);
    // Three per-site restore writers moved to ONE shared door before this region (46 → 43).
    // Keep an exact count plus that door's census below, so deleting a writer or moving one out of
    // the checked region cannot silently weaken the invariant.
    expect(sites).toHaveLength(43);
    expect(runnerVars.size).toBeGreaterThanOrEqual(10);
  });
  it('the shared automatic restore is named and every caller uses an allowlisted restore pass', () => {
    expect(sharedRestore).toBeDefined();
    expect(sharedRestore!.end).toBeLessThan(start);
    expect(sharedRestore!.parameters[3].initializer?.getText(sf)).toBe("'green-guard-restore'");
    expect(ts.isCallExpression(sharedRestore!.body)).toBe(true);
    const zone = sharedRestore!.body as ts.CallExpression;
    expect(zone.expression.getText(sf)).toBe('runInPass');
    expect(zone.arguments[0].getText(sf)).toBe('pass');
    expect(restoreSites).toHaveLength(1);
    expect(restoreSites[0].named).toBe(true);
    expect(restorePasses.sort()).toEqual(['design-heal-revert', 'green-guard-restore', 'green-guard-restore', 'green-guard-restore']);
    for (const pass of restorePasses) expect(ALLOWED_PASSES.has(pass), pass).toBe(true);
    expect(sharedRestore!.parameters[1].initializer?.getText(sf)).toContain('snapshotRestoreStopped(abort.signal)');
  });
  it('every one is inside runInPass — or is a listed exception with its reason', () => {
    const unnamed = sites.filter((s) => !s.named && !(s.call in ROUTE_EXCEPTIONS)).map((s) => `${ROUTE_PATH}:${s.line} ${s.call.slice(0, 120)}`);
    expect(unnamed).toEqual([]);
  });
  it('no exception is stale', () => {
    for (const call of Object.keys(ROUTE_EXCEPTIONS)) expect(sites.some((s) => s.call === call)).toBe(true);
  });

  const dsf = parse(DISPATCHER_PATH);
  const methods = new Map<string, ts.MethodDeclaration>();
  walk(dsf, (n) => {
    if (ts.isMethodDeclaration(n) && n.body && ts.isIdentifier(n.name) && ts.isClassDeclaration(n.parent) && n.parent.name?.text === 'ToolDispatcher') methods.set(n.name.text, n);
  });
  const DISPATCHER_WRITERS = /^this\.(guardedWrite|actuator\.writeFile|actuator\.writeBinaryFile|run)$/;
  // `inPlatformPass` (greenFreeze.ts) is the ONE keep-the-outer-name helper since the merge with #3698; the dispatcher's
  // private method delegates to it.
  const DISPATCHER_NAMERS = new Set(['runInPass', 'inPlatformPass', 'this.inPlatformPass']);
  /**
   * Methods that name their own writes by `landHealWrite`'s idiom (`currentPass() ? go() : runInPass(name, go)`),
   * which hands the writer to runInPass by reference, so no lexical census can see it. Each must still say runInPass.
   */
  const SELF_NAMING = new Set(['landHealWrite']);

  /** Unnamed writes a platform-started dispatcher method can reach, following `this.x()` calls through the class. */
  function unnamedWritesFrom(method: string, seen = new Set<string>()): string[] {
    if (seen.has(method) || SELF_NAMING.has(method)) return [];
    seen.add(method);
    const m = methods.get(method);
    if (!m) return [];
    const out: string[] = [];
    walk(m.body!, (n) => {
      if (!ts.isCallExpression(n)) return;
      const c = calleeText(dsf, n);
      if (insideCallTo(dsf, n, DISPATCHER_NAMERS)) return;
      if (DISPATCHER_WRITERS.test(c)) { out.push(`${method} → ${c} (${DISPATCHER_PATH}:${dsf.getLineAndCharacterOfPosition(n.getStart(dsf)).line + 1})`); return; }
      const self = /^this\.(\w+)$/.exec(c);
      if (self && methods.has(self[1])) out.push(...unnamedWritesFrom(self[1], seen));
    });
    return out;
  }

  it('the self-naming methods really name themselves', () => {
    for (const m of SELF_NAMING) expect(methods.get(m)?.body?.getText(dsf)).toMatch(/(?:runInPass|inPlatformPass)\('[a-z-]+', go\)/);
  });
  it('every dispatcher method the route calls after the answer names what it writes', () => {
    expect(dispatcherMethods.has('assessBuildReadiness')).toBe(true);
    const leaks = [...dispatcherMethods].flatMap((m) => unnamedWritesFrom(m));
    expect(leaks).toEqual([]);
  });

  const rsf = parse(RUNNER_PATH);
  const runnerCalls: string[] = [];
  const modelDispatches: Array<{ line: number; marked: boolean }> = [];
  walk(rsf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const c = calleeText(rsf, n);
    if (c === 'dispatcher.dispatch') modelDispatches.push({ line: rsf.getLineAndCharacterOfPosition(n.getStart(rsf)).line + 1, marked: insideCallTo(rsf, n, new Set(['asModel', 'runAsModelToolCall'])) });
    else if (/^dispatcher\.\w+$/.test(c)) runnerCalls.push(c.slice('dispatcher.'.length));
  });

  it('every dispatcher method AgentRunner runs on its own (the end-of-turn heals and gates) names what it writes', () => {
    expect(runnerCalls).toEqual(expect.arrayContaining(['healOrphanPages', 'healCredentialLogs', 'assessBuildReadiness', 'injectObservability']));
    const leaks = [...new Set(runnerCalls)].flatMap((m) => unnamedWritesFrom(m));
    expect(leaks).toEqual([]);
  });
  it('every tool call AgentRunner dispatches for the model is marked as the model\'s', () => {
    expect(modelDispatches.length).toBeGreaterThanOrEqual(2);
    expect(modelDispatches.filter((d) => !d.marked)).toEqual([]);
    expect(read(RUNNER_PATH)).toMatch(/const asModel = <T>\(fn: \(\) => Promise<T>\): Promise<T> => runAsModelToolCall\(fn, \{ platformRequest: this\.opts\.platformRequest === true \}\);/);
  });
});

describe('🔒 the ledgers read the evidence the choke point now carries', () => {
  const route = read(ROUTE_PATH);
  it('POST_GREEN_WRITES records whether a model asked for each write', () => {
    expect(route).toContain('disposeWriteObserver = setWriteObserver(({ path, pass, model }) => {');
    expect(route).toContain('postGreenWrites.push({ path, pass, model, at: Date.now() })');
  });
  it('GREEN_FREEZE_DEFERRED names the writer the same way, never leaving it blank', () => {
    expect(route).toContain('disposeGreenFreezeObserver = setGreenFreezeObserver(({ path, pass, model }) => {');
    expect(route).toContain('a later write to "${path}" by ${writerPhrase({ pass, model })} was NOT applied');
  });
  it('postGreenWrites.ts groups by the earned label, not by `pass ?? "build loop"`', () => {
    const src = read('src/server/AgentV3/postGreenWrites.ts');
    expect(src).toContain('const key = writerLabel(w);');
    expect(src).not.toMatch(/pass \?\? BUILD_LOOP_LABEL/);
  });
});

describe('🔒 one keep-the-outer-name helper, and the fast lane is named with it', () => {
  it('inPlatformPass names a step only when no pass is active — an outer name (and its freeze permission) is kept', async () => {
    const { inPlatformPass, runInPass, currentPass } = await import('../src/server/AgentV3/greenFreeze');
    expect(await inPlatformPass('fast-lane', async () => currentPass())).toBe('fast-lane');
    expect(await runInPass('feature-presence-heal', () => inPlatformPass('fast-lane', async () => currentPass()))).toBe('feature-presence-heal');
  });
  it('no copy of the idiom outside greenFreeze.ts', () => {
    const dispatcher = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(dispatcher).not.toMatch(/currentPass\(\) \? /);
  });
  it('every fast-lane platform write is named (a fast-lane write after a first render is the fast lane\'s, never the model\'s)', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    const bare = route.split('\n').filter((l) => /\bwritePlatform\(/.test(l) && !/const writePlatform = /.test(l) && !/(?:runInPass|inPlatformPass)\('[\w-]+', \(\) => writePlatform\(/.test(l));
    expect(bare).toEqual([]);
  });
});
