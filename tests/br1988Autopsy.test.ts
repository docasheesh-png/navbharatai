/**
 * BR1988: a build the USER stopped mid-generation, on a fresh build, still had its unfinished
 * stylesheet reported as CSS_CLASSES_UNDEFINED — a leftover warning of the app, opened in the issue
 * queue. The mismatch is a defect only of an app that was allowed to finish (Universal Remote).
 *
 * The downgrade is exact and fail-closed. It needs ALL of: the typed cause `'user-stop'`, the runner's
 * own `userStoppedBeforeReady` mark (its aborted ending, on a turn where the readiness check was
 * eligible, before any ready mark), `ok === false`, no `readyAt`, not an edit, not a module turn.
 * Every neighbour below keeps main's warning, byte for byte.
 *
 * Fixtures are independently written and synthetic. They do not copy a customer's request, class
 * names, file list, identifiers, or event timestamps.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import {
  cssClassesUndefinedRecord,
  cssConsistencyError,
  cssStopLeftTreeUnfinished,
  cssStoppedUnfinishedRecord,
  cssClassesUndefinedFields,
  findUndefinedClasses,
  undefinedClassesNote,
} from '../src/server/AgentV3/CssConsistency';
import { userStoppedBeforeReady } from '../src/server/AgentV3/doneSignal';
import { ALL_ABORT_CAUSES, abortBuild, type AbortCause } from '../src/server/AgentV3/buildAbortCause';
import { foldBuildFindings, queueableFindings, EMPTY_QUEUE } from '../src/server/AgentV3/changeEngine/issueQueue';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

const scaffoldCss = ':root { font-family: sans-serif; } body { margin: 0; }';

/** A mid-generation tree: screens exist, the stylesheet has only the scaffold rules. */
const unfinishedScreens: Record<string, string> = {
  'src/index.css': scaffoldCss,
  'src/components/OrderForm.tsx': `
    export function OrderForm() {
      return (
        <form className="order-form">
          <section className="form-block">
            <div className="rows-wrap">
              <header className="rows-heading">Lines</header>
              <ul className="rows-list" />
            </div>
          </section>
          <aside className="order-sums">
            <div className="sums-line"><span className="sum-figure">0</span></div>
          </aside>
        </form>
      );
    }
  `,
};

const ENGINE_CAUSES = ALL_ABORT_CAUSES.filter((c) => c !== 'user-stop');

/** The exact true positive, as the route sees it. */
const truePositive = {
  abortCause: 'user-stop',
  runStoppedBeforeReady: true,
  ok: false,
  readyAt: undefined as unknown,
  editingExistingApp: false,
  projectModule: null as string | null,
};

/** Main's record, as the route writes it on main. */
const mainWarning = (files: Record<string, string>) => ({
  severity: 'warning' as const,
  autoResolved: false,
  message: undefinedClassesNote(findUndefinedClasses(files)),
});

function queuedCssCodes(rec: { severity: 'warning' | 'info'; autoResolved: boolean; message: string }) {
  const d = new BuildDiagnostics({ now: () => 1_000 });
  d.record({ phase: 'build', severity: rec.severity, code: 'CSS_CLASSES_UNDEFINED', message: rec.message, autoResolved: rec.autoResolved });
  const report = d.report();
  const queued = queueableFindings(report.issues).filter((f) => f.code === 'CSS_CLASSES_UNDEFINED');
  const folded = foldBuildFindings(EMPTY_QUEUE, { findings: queued, changeId: 'chg-synthetic', now: 2_000, checksRan: true });
  return { unresolved: report.counts.unresolved, queued, opened: folded.opened };
}

describe('BR1988 · route predicate: only the exact true positive is an unfinished tree', () => {
  it('the synthetic tree is a real mismatch at the ordinary threshold', () => {
    expect(cssConsistencyError(unfinishedScreens)).not.toBeNull();
    expect(findUndefinedClasses(unfinishedScreens).length).toBeGreaterThanOrEqual(3);
  });

  it('true positive: fresh build, user-stop, mid-generation → unfinished', () => {
    expect(cssStopLeftTreeUnfinished(truePositive)).toBe(true);
  });

  it.each(ENGINE_CAUSES)('engine abort %s with no readyAt keeps main', (cause) => {
    expect(cssStopLeftTreeUnfinished({ ...truePositive, abortCause: cause })).toBe(false);
  });

  it('an unrecognised cause string keeps main', () => {
    expect(cssStopLeftTreeUnfinished({ ...truePositive, abortCause: 'something-else' })).toBe(false);
  });

  it('edit turn with user-stop keeps main (readyAt is never set on an edit)', () => {
    expect(cssStopLeftTreeUnfinished({ ...truePositive, editingExistingApp: true })).toBe(false);
  });

  it('project-module turn with user-stop keeps main (readyAt is never set on a module turn)', () => {
    expect(cssStopLeftTreeUnfinished({ ...truePositive, projectModule: 'inventory' })).toBe(false);
    expect(cssStopLeftTreeUnfinished({ ...truePositive, projectModule: '  ' })).toBe(true);
  });

  it('advisory-cap after success keeps main', () => {
    expect(cssStopLeftTreeUnfinished({ ...truePositive, abortCause: 'advisory-cap', ok: true, runStoppedBeforeReady: false })).toBe(false);
    expect(cssStopLeftTreeUnfinished({ ...truePositive, abortCause: 'advisory-cap' })).toBe(false);
  });

  it('a build that ended ok (e.g. a later rescue) keeps main, even after a user-stop', () => {
    expect(cssStopLeftTreeUnfinished({ ...truePositive, ok: true })).toBe(false);
  });

  it('gate skipped / crashed / run never reached its aborted ending (no runner mark) keeps main', () => {
    expect(cssStopLeftTreeUnfinished({ ...truePositive, runStoppedBeforeReady: false })).toBe(false);
  });

  it('a ready mark keeps main (Stop after the app was judged finished)', () => {
    expect(cssStopLeftTreeUnfinished({ ...truePositive, readyAt: { step: 9, elapsedMs: 1, score: 100 } })).toBe(false);
  });
});

describe('BR1988 · runner mark: userStoppedBeforeReady', () => {
  const base = { cause: 'user-stop' as AbortCause, readyMarked: false, doneSignalEnabled: true, editingExistingApp: false, projectModule: null };

  it('true only for the user-stop on an eligible fresh build with no ready mark', () => {
    expect(userStoppedBeforeReady(base)).toBe(true);
  });
  it.each(ENGINE_CAUSES)('engine cause %s → false', (cause) => {
    expect(userStoppedBeforeReady({ ...base, cause })).toBe(false);
  });
  it('edit, module, done signal off, or an existing mark → false', () => {
    expect(userStoppedBeforeReady({ ...base, editingExistingApp: true })).toBe(false);
    expect(userStoppedBeforeReady({ ...base, projectModule: 'billing' })).toBe(false);
    expect(userStoppedBeforeReady({ ...base, doneSignalEnabled: false })).toBe(false);
    expect(userStoppedBeforeReady({ ...base, readyMarked: true })).toBe(false);
  });
});

describe('BR1988 · record: the info line only on the true positive; otherwise main exactly', () => {
  it('true positive → info, auto-resolved, not unresolved, not queued', () => {
    const rec = cssClassesUndefinedRecord(unfinishedScreens, { stoppedUnfinished: true })!;
    expect(rec.severity).toBe('info');
    expect(rec.autoResolved).toBe(true);
    expect(rec.message).toMatch(/stopped before the app was judged finished/);
    expect(rec.message).not.toMatch(/render unstyled/);
    const q = queuedCssCodes(rec);
    expect(q.unresolved).toBe(0);
    expect(q.queued).toEqual([]);
    expect(q.opened).toEqual([]);
  });

  it('not stopped-unfinished → exactly main\'s warning text, unresolved and queued, with no stop wording', () => {
    const rec = cssClassesUndefinedRecord(unfinishedScreens, { stoppedUnfinished: false })!;
    expect(rec).toEqual(mainWarning(unfinishedScreens));
    expect(rec.message).not.toMatch(/stopped|user/i);
    const q = queuedCssCodes(rec);
    expect(q.unresolved).toBeGreaterThanOrEqual(1);
    expect(q.queued).toEqual([expect.objectContaining({ code: 'CSS_CLASSES_UNDEFINED', severity: 'warning' })]);
    expect(q.opened).toHaveLength(1);
  });

  it('the route helper returns the info record only for the true positive, null (main) otherwise', () => {
    const run = { ok: false, userStoppedBeforeReady: true as const };
    const facts = { abortCause: 'user-stop', result: run, editingExistingApp: false, projectModule: null };
    expect(cssStoppedUnfinishedRecord(unfinishedScreens, facts)?.severity).toBe('info');
    for (const cause of ENGINE_CAUSES) expect(cssStoppedUnfinishedRecord(unfinishedScreens, { ...facts, abortCause: cause })).toBeNull();
    expect(cssStoppedUnfinishedRecord(unfinishedScreens, { ...facts, editingExistingApp: true })).toBeNull();
    expect(cssStoppedUnfinishedRecord(unfinishedScreens, { ...facts, projectModule: { name: 'reports' } })).toBeNull();
    expect(cssStoppedUnfinishedRecord(unfinishedScreens, { ...facts, result: { ok: false } })).toBeNull();
    expect(cssStoppedUnfinishedRecord(unfinishedScreens, { ...facts, result: { ...run, ok: true } })).toBeNull();
    expect(cssStoppedUnfinishedRecord(unfinishedScreens, { ...facts, result: { ...run, readyAt: { step: 3, elapsedMs: 1, score: 99 } } })).toBeNull();
    expect(cssStoppedUnfinishedRecord({ 'src/index.css': scaffoldCss }, facts)).toBeNull();
    // a fault is main's behaviour, never a throw into the route
    expect(cssStoppedUnfinishedRecord(unfinishedScreens, { ...facts, result: null as never })).toBeNull();
    expect(cssStoppedUnfinishedRecord(null as unknown as Record<string, string>, facts)).toBeNull();
  });

  it('record fields: null → main\'s warning with main\'s own fields, untouched; a stop record → the info line', () => {
    const mainObs = { autoResolved: false, message: undefinedClassesNote(findUndefinedClasses(unfinishedScreens)) };
    expect(cssClassesUndefinedFields(null, () => mainObs)).toEqual({ severity: 'warning', ...mainObs });
    const observation = { autoResolved: true, observation: true, message: '[observation] x' };
    expect(cssClassesUndefinedFields(null, () => observation)).toEqual({ severity: 'warning', ...observation });
    let called = false;
    const stop = cssClassesUndefinedRecord(unfinishedScreens, { stoppedUnfinished: true });
    expect(cssClassesUndefinedFields(stop, () => { called = true; return mainObs; })).toEqual({ severity: 'info', message: stop!.message, autoResolved: true });
    expect(called).toBe(false);
  });

  it('below the threshold stays silent either way', () => {
    const two = { 'src/index.css': scaffoldCss, 'src/A.tsx': '<div className="alpha-x"><p className="beta-y" /></div>' };
    expect(cssClassesUndefinedRecord(two, { stoppedUnfinished: true })).toBeNull();
    expect(cssClassesUndefinedRecord(two, { stoppedUnfinished: false })).toBeNull();
  });

  it('end to end: every neighbour, fed through the predicate, gets main\'s record', () => {
    const neighbours = [
      ...ENGINE_CAUSES.map((c) => ({ ...truePositive, abortCause: c })),
      { ...truePositive, editingExistingApp: true },
      { ...truePositive, projectModule: 'reports' },
      { ...truePositive, abortCause: 'advisory-cap', ok: true, runStoppedBeforeReady: false },
      { ...truePositive, runStoppedBeforeReady: false },
      { ...truePositive, readyAt: { step: 4, elapsedMs: 1, score: 96 } },
    ];
    for (const n of neighbours) {
      const rec = cssClassesUndefinedRecord(unfinishedScreens, { stoppedUnfinished: cssStopLeftTreeUnfinished(n) });
      expect(rec).toEqual(mainWarning(unfinishedScreens));
    }
  });
});

// ── Runner level: the mark is set by the runner's own aborted ending, and nowhere else ──────────────
class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
function scripted(messages: unknown[]): MessagesCreateClient {
  let i = 0;
  return { messages: { create: async () => (messages[i++] ?? { content: [{ type: 'text', text: 'end' }], stop_reason: 'end_turn' }) as never } };
}
function runnerWith(opts: { signal?: AbortSignal; editingExistingApp?: boolean; projectModule?: () => string | null }) {
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  const dispatcher = new ToolDispatcher(new FakeActuator(), 'ws-synthetic', state, stream);
  return new AgentRunner({
    client: new ClaudeClient(scripted([
      { content: [{ type: 'tool_use', id: 't1', name: 'write_file', input: { path: 'index.html', content: '<p>hi</p>' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
      { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
    ])),
    dispatcher, state, events: stream, model: 'synthetic-model', system: 'sys', tools: defaultToolCatalog(),
    ...opts,
  });
}
const stopped = (cause: AbortCause) => { const c = new AbortController(); abortBuild(c, cause); return c.signal; };

describe('BR1988 · AgentRunner sets userStoppedBeforeReady only on the exact case', () => {
  const prev = process.env.AGENTV3_DONE_SIGNAL;
  afterEach(() => { if (prev === undefined) delete process.env.AGENTV3_DONE_SIGNAL; else process.env.AGENTV3_DONE_SIGNAL = prev; });

  it('true positive: fresh build, user-stop before any ready mark', async () => {
    delete process.env.AGENTV3_DONE_SIGNAL;
    const r = await runnerWith({ signal: stopped('user-stop') }).run('build a synthetic form');
    expect(r.ok).toBe(false);
    expect(r.readyAt).toBeUndefined();
    expect(r.userStoppedBeforeReady).toBe(true);
  });

  it.each(ENGINE_CAUSES)('engine cause %s: no mark', async (cause) => {
    const r = await runnerWith({ signal: stopped(cause) }).run('build a synthetic form');
    expect(r.ok).toBe(false);
    expect(r.userStoppedBeforeReady).toBeUndefined();
  });

  it('edit turn with user-stop: no mark', async () => {
    const r = await runnerWith({ signal: stopped('user-stop'), editingExistingApp: true }).run('change a synthetic form');
    expect(r.userStoppedBeforeReady).toBeUndefined();
  });

  it('module turn with user-stop: no mark', async () => {
    const r = await runnerWith({ signal: stopped('user-stop'), projectModule: () => 'reports' }).run('build a synthetic module');
    expect(r.userStoppedBeforeReady).toBeUndefined();
  });

  it('readiness gate disabled (done signal off) with user-stop: no mark', async () => {
    process.env.AGENTV3_DONE_SIGNAL = 'off';
    const r = await runnerWith({ signal: stopped('user-stop') }).run('build a synthetic form');
    expect(r.userStoppedBeforeReady).toBeUndefined();
  });

  it('a run that was not stopped: no mark', async () => {
    const r = await runnerWith({}).run('build a synthetic page');
    expect(r.userStoppedBeforeReady).toBeUndefined();
  });
});

describe('BR1988 · route wiring', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('uses the typed cause and the runner mark, never abort.signal.aborted, for the downgrade', () => {
    expect(route).toMatch(/cssStoppedUnfinishedRecord\(projectForCss, \{ abortCause: abortCauseOf\(abort\.signal\), result, editingExistingApp: isEditMode, projectModule: projectModuleRef \}\)/);
    expect(route).not.toMatch(/aborted: abort\.signal\.aborted === true, appJudgedFinished/);
  });

  it('otherwise the one record carries main\'s fields: phase, code, warning, obs(undefinedClassesNote(…))', () => {
    expect(route).toMatch(/if \(cssErr\) \{[\s\S]{0,400}buildDiag\.record\(\{\s*phase: 'build', code: 'CSS_CLASSES_UNDEFINED',\s*\.\.\.cssClassesUndefinedFields\(\s*cssStoppedUnfinishedRecord\([^\n]*\),\s*\(\) => obs\(undefinedClassesNote\(findUndefinedClasses\(projectForCss\)\)\),\s*\),\s*\}\);\s*\}/);
  });

  it('the heal gate is unchanged', () => {
    expect(route).toMatch(/const cssRepair = !!cssErr && cssHealEnabled\(\) && result\.ok && expectsArtifacts && !abort\.signal\.aborted;/);
  });
});
