// 🔴 A PASS THAT RAN OUT OF TIME LEAVES NOTHING BEHIND IT (autopsy aba63ead, failedbr #2475, 2026-11-19).
//
// The real run: the click explorer's repair pass (150 s budget) delegated to a `debugger` specialist through
// the `task` tool. At 592 s the budget ended, the pass was aborted with 'repair-budget' and its files were put
// back. The specialist kept going — five more edits and an `npm run build`, until 660 s — and the build saved
// those unchecked edits as "the project's verified version". The repair runner's own `done` then became the
// BUILD's: `ok: false`, summary "This repair had used its time…", on a build that had delivered.
//
// Two classes, both locked here:
//   1. A delegated child stops when the runner that SPAWNED it stops, not only when the whole build does —
//      and a write from inside a runner whose pass budget ended is refused at the write choke point.
//   2. A pass-budget ending is never a terminal `done` on the build's stream.
// Reversion: put `signal: deps.signal` back in SubAgent.ts, or emit `done` for a pass budget in
// AgentRunner.endAborted, and the matching block below fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { abortBuild, abortCauseOf } from '../src/server/AgentV3/buildAbortCause';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort, type SubAgentSpawn } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import type { AgentEvent } from '../src/server/AgentV3/types';
import { assertWriteAllowed } from '../src/server/AgentV3/greenFreeze';
import {
  childStopSignal, currentRunnerSignal, runWithRunnerSignal, stoppedPassCause, StoppedPassWriteError,
} from '../src/server/AgentV3/runnerSignal';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(w: string, p: string, c: string): Promise<void> {
    assertWriteAllowed(w, p); // the real actuators' choke point
    this.files.set(p, c);
  }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

function scripted(messages: unknown[]): MessagesCreateClient {
  let i = 0;
  return { messages: { create: async () => (messages[i++] ?? { content: [{ type: 'text', text: 'end' }], stop_reason: 'end_turn' }) as never } };
}

const writeTurn = (path: string) => ({
  content: [{ type: 'tool_use', id: `w-${path}`, name: 'write_file', input: { path, content: 'export const x = 1;\n' } }],
  stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
});

describe('runnerSignal — the child stops with the runner that spawned it', () => {
  it('a pass budget that ends reaches the child, carrying its own cause', async () => {
    const build = new AbortController();
    const pass = new AbortController();
    let child: AbortSignal | undefined;
    await runWithRunnerSignal(pass.signal, async () => { child = childStopSignal(build.signal); });
    expect(child?.aborted).toBe(false);
    abortBuild(pass, 'repair-budget');
    expect(child?.aborted).toBe(true);
    expect(abortCauseOf(child)).toBe('repair-budget');
    expect(build.signal.aborted).toBe(false); // the build itself goes on
  });

  it("the build's own Stop still ends the child (nothing the old wiring did is lost)", async () => {
    const build = new AbortController();
    const pass = new AbortController();
    let child: AbortSignal | undefined;
    await runWithRunnerSignal(pass.signal, async () => { child = childStopSignal(build.signal); });
    abortBuild(build, 'user-stop');
    expect(abortCauseOf(child)).toBe('user-stop');
  });

  it('outside any runner, or spawned by the build-level runner itself, it is the build signal unchanged', async () => {
    const build = new AbortController();
    expect(childStopSignal(build.signal)).toBe(build.signal);
    await runWithRunnerSignal(build.signal, async () => { expect(childStopSignal(build.signal)).toBe(build.signal); });
  });

  it('the kill switch restores the old wiring exactly', async () => {
    const build = new AbortController();
    const pass = new AbortController();
    await runWithRunnerSignal(pass.signal, async () => {
      expect(childStopSignal(build.signal, { AGENTV3_CHILD_INHERITS_RUNNER_STOP: 'off' } as NodeJS.ProcessEnv)).toBe(build.signal);
    });
  });
});

describe('a write from a runner whose pass budget ended is refused at the choke point', () => {
  it.each(['repair-budget', 'review-budget', 'recheck-budget'] as const)('%s ⇒ refused', async (cause) => {
    const pass = new AbortController();
    abortBuild(pass, cause);
    await runWithRunnerSignal(pass.signal, async () => {
      expect(stoppedPassCause()).toBe(cause);
      expect(() => assertWriteAllowed('ws-pass', 'src/components/BattlegroundGame.tsx')).toThrow(StoppedPassWriteError);
    });
  });

  it("the user's Stop and the build-level causes keep today's contract (a write in flight lands)", async () => {
    for (const cause of ['user-stop', 'watchdog', 'cost-cap'] as const) {
      const c = new AbortController();
      abortBuild(c, cause);
      await runWithRunnerSignal(c.signal, async () => {
        expect(stoppedPassCause()).toBeNull();
        expect(() => assertWriteAllowed('ws-pass', 'src/App.tsx')).not.toThrow();
      });
    }
  });

  it('a pass still running, and code outside every runner, write as before', async () => {
    expect(currentRunnerSignal()).toBeUndefined();
    expect(() => assertWriteAllowed('ws-pass', 'src/App.tsx')).not.toThrow();
    const pass = new AbortController();
    await runWithRunnerSignal(pass.signal, async () => {
      expect(() => assertWriteAllowed('ws-pass', 'src/App.tsx')).not.toThrow();
    });
  });
});

describe('end to end: the #2475 shape — a repair pass delegates, its budget ends mid-delegation', () => {
  it('the specialist writes nothing after the pass is undone, and the build stream gets no terminal done', async () => {
    const actuator = new FakeActuator();
    const stream = new AgentEventStream();
    const events: AgentEvent[] = [];
    stream.subscribe((e) => events.push(e), false);
    const state = new WorkspaceState(stream);
    const build = new AbortController();
    const pass = new AbortController();

    // The spawn closure is built ONCE per build with the build's signal, exactly as the route does; the child
    // runner is wired the way SubAgent.ts wires it (`childStopSignal(deps.signal)`).
    const spawn: SubAgentSpawn = async () => {
      abortBuild(pass, 'repair-budget'); // the pass's 150 s budget ends while the specialist is starting
      const child = new AgentRunner({
        client: new ClaudeClient(scripted([writeTurn('src/components/MiniMap.tsx'), writeTurn('src/index.css')])),
        dispatcher: new ToolDispatcher(actuator, 'ws-2475', state, stream),
        state, events: stream, model: 'test', system: 'debugger', tools: defaultToolCatalog(),
        agentRole: 'debugger', signal: childStopSignal(build.signal),
      });
      const r = await child.run('fix the covered buttons');
      return { ok: r.ok, summary: r.summary, written: [] };
    };

    const repair = new AgentRunner({
      client: new ClaudeClient(scripted([{
        content: [{ type: 'tool_use', id: 't1', name: 'task', input: { role: 'debugger', instruction: 'fix the covered buttons' } }],
        stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
      }])),
      dispatcher: new ToolDispatcher(actuator, 'ws-2475', state, stream, spawn),
      state, events: stream, model: 'test', system: 'repair', tools: defaultToolCatalog(),
      signal: pass.signal,
    });
    const result = await repair.run('2 buttons did not work');

    expect(result.ok).toBe(false);
    expect([...actuator.files.keys()]).toEqual([]);           // no zombie write
    expect(build.signal.aborted).toBe(false);
    expect(events.filter((e) => e.type === 'done')).toEqual([]); // the BUILD did not end here
    expect(events.some((e) => e.type === 'agent_done' && /repair had used its time/i.test(e.summary))).toBe(true);
  });
});

describe('source guards — the wiring stays where the class is closed', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  it('SubAgent hands its child the joined signal, never the build signal alone', () => {
    const src = read('src/server/AgentV3/SubAgent.ts');
    expect(src).toContain('signal: childStopSignal(deps.signal)');
    expect(src).not.toMatch(/^\s*signal: deps\.signal,/m);
  });
  it('AgentRunner.run opens the runner zone, and a pass budget ends with agent_done', () => {
    const src = read('src/server/AgentV3/AgentRunner.ts');
    expect(src).toMatch(/return runWithRunnerSignal\(this\.opts\.signal/);
    expect(src).toMatch(/if \(isPassBudgetCause\(cause\)\) \{[\s\S]{0,120}type: 'agent_done'/);
  });
});
