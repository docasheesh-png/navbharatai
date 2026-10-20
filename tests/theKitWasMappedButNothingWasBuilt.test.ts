import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import {
  advanceExplorationProgress, initialExplorationProgress, EXPLORATION_TURNS, EXPLORATION_PROBES,
  MAX_EXPLORATION_STEERS,
} from '../src/server/AgentV3/explorationProgress';

afterEach(() => vi.unstubAllEnvs());

const usage = { input_tokens: 10, output_tokens: 10 };
const readTurn = (n: number, two = false) => ({
  content: [
    { type: 'tool_use', id: `read-${n}`, name: 'read_file', input: { path: 'src/game/Game.ts', start_line: n * 20 + 1, end_line: n * 20 + 20 } },
    ...(two ? [{ type: 'tool_use', id: `grep-${n}`, name: 'grep', input: { pattern: `api${n}`, path: 'src/game' } }] : []),
  ], stop_reason: 'tool_use', usage,
});
const writeTurn = {
  content: [{ type: 'tool_use', id: 'write', name: 'write_file', input: { path: 'src/game/mission.ts', content: 'export const targetScore = 10;' } }],
  stop_reason: 'tool_use', usage,
};
const endTurn = { content: [{ type: 'text', text: 'Finished.' }], stop_reason: 'end_turn', usage };

async function run(options: {
  turns?: number; expectsArtifacts?: boolean; writer?: boolean; editing?: boolean;
  initialChanges?: number; writeWhenSteered?: boolean; rejectedReads?: boolean; rejectedWrite?: boolean;
  noChangeEvidence?: boolean; writeAt?: number; continueAfterWrite?: boolean;
} = {}) {
  const requests: unknown[][] = [];
  const dispatched: string[] = [];
  const narrations: string[] = [];
  const notes: { code: string; message: string }[] = [];
  let changes = options.initialChanges ?? 32; // the platform's game kit already exists before the run
  let calls = 0;
  let wrote = false;
  const sdk: MessagesCreateClient = { messages: { create: async (request: unknown) => {
    const messages = structuredClone((request as { messages: unknown[] }).messages);
    requests.push(messages);
    const latest = JSON.stringify(messages.at(-1));
    calls++;
    // This builder really acts on the hand-back received through AgentRunner's next provider request.
    if (options.writeWhenSteered && latest.includes('[BUILD PROGRESS') && !wrote) return writeTurn as never;
    if (options.writeAt === calls) return writeTurn as never;
    if (wrote && !options.continueAfterWrite || calls > (options.turns ?? EXPLORATION_TURNS)) return endTurn as never;
    return readTurn(calls) as never;
  } } };
  const dispatcher = {
    dispatch: async (tu: { id: string; name: string }) => {
      dispatched.push(tu.name);
      const failed = tu.name === 'read_file' && options.rejectedReads || tu.name === 'write_file' && options.rejectedWrite;
      if (tu.name === 'write_file') {
        wrote = true;
        if (!failed) changes++;
      }
      return { tool_use_id: tu.id, content: failed ? 'Not run — stopped or rejected.' : tu.name === 'read_file' ? 'The requested range is here in full.' : 'Saved.', is_error: !!failed };
    },
    changeCount: options.noChangeEvidence ? undefined : () => changes,
    wroteAnything: () => wrote && !options.rejectedWrite,
  };
  const stream = new AgentEventStream();
  stream.subscribe((event) => { const e = event as { type: string; text?: string }; if (e.type === 'narration' && e.text) narrations.push(e.text); });
  const tools = defaultToolCatalog().filter((tool) => options.writer !== false || !['write_file', 'edit_file'].includes(tool.name));
  const result = await new AgentRunner({
    client: new ClaudeClient(sdk), dispatcher: dispatcher as never, state: new WorkspaceState(stream), events: stream,
    model: 'test-model', system: 'Build the requested game.', tools, expectsArtifacts: options.expectsArtifacts ?? true,
    editingExistingApp: options.editing, maxSteps: 30, onNote: (note) => notes.push(note),
  }).run(options.editing ? 'Add the requested mission to my existing game.' : 'Build a 3D game on the provided kit.');
  return { result, requests, dispatched, narrations, notes, changes };
}

describe('the varied-read game autopsies reach a real model hand-back', () => {
  it('different ranges avoid the exact-call guard, but the builder receives this steer and writes before a futility stop', async () => {
    const out = await run({ writeWhenSteered: true });
    expect(out.dispatched.filter((name) => name === 'read_file')).toHaveLength(EXPLORATION_TURNS);
    expect(out.dispatched).toContain('write_file');
    expect(out.changes).toBe(33);
    const nextCall = JSON.stringify(out.requests[EXPLORATION_TURNS]);
    expect(nextCall).toContain('[BUILD PROGRESS]');
    expect(nextCall).toContain('8 model turn(s) made 8 file/search calls');
    expect(nextCall).toContain('The requested range is here in full.');
    expect(out.notes.filter((note) => note.code === 'EXPLORATION_WITHOUT_CHANGE')).toHaveLength(1);
    expect(out.narrations.filter((line) => line.includes('inspecting files without changing'))).toHaveLength(1);
  });

  it('continued exploration receives a firmer second steer and no further noise', async () => {
    const out = await run({ turns: 24 });
    expect(out.dispatched).toHaveLength(24); // no distinct legitimate read was refused
    expect(out.notes.filter((note) => note.code === 'EXPLORATION_WITHOUT_CHANGE')).toHaveLength(MAX_EXPLORATION_STEERS);
    expect(JSON.stringify(out.requests[16])).toContain('[BUILD PROGRESS — STILL EXPLORING]');
    expect(out.narrations.filter((line) => line.includes('inspecting files without changing'))).toHaveLength(1);
  });

  it.each([
    { expectsArtifacts: false }, // chat, analysis and imported-project survey use this existing flag
    { writer: false }, // a researcher cannot follow an instruction to edit
    { rejectedReads: true }, // stopped/rejected tools delivered no new file context
    { noChangeEvidence: true },
  ])('no hand-back when the run cannot establish writer exploration: %j', async (options) => {
    const out = await run({ turns: 20, ...options });
    expect(out.notes.filter((note) => note.code === 'EXPLORATION_WITHOUT_CHANGE')).toHaveLength(0);
    expect(JSON.stringify(out.requests)).not.toContain('[BUILD PROGRESS');
  });

  it('an existing app is asked for a focused edit, without an instruction to recreate its entry', async () => {
    const out = await run({ editing: true, writeWhenSteered: true });
    const handed = JSON.stringify(out.requests[EXPLORATION_TURNS].at(-1));
    expect(handed).toContain('smallest focused change the user requested in the existing app');
    expect(handed).not.toContain('start by writing the entry');
  });

  it('the real runner resets on a saved change, while a rejected write does not erase its evidence', async () => {
    const saved = await run({ turns: 9, writeAt: 5, continueAfterWrite: true });
    expect(saved.changes).toBe(33);
    expect(saved.notes.filter((note) => note.code === 'EXPLORATION_WITHOUT_CHANGE')).toHaveLength(0);
    const rejected = await run({ turns: 9, writeAt: 5, continueAfterWrite: true, rejectedWrite: true });
    expect(rejected.changes).toBe(32);
    expect(rejected.notes.filter((note) => note.code === 'EXPLORATION_WITHOUT_CHANGE')).toHaveLength(1);
    expect(JSON.stringify(rejected.requests[9].at(-1))).toContain('[BUILD PROGRESS]');
  });

  it('has an explicit kill switch', async () => {
    vi.stubEnv('AGENTV3_EXPLORATION_STEER', 'off');
    const out = await run({ turns: 20 });
    expect(out.notes.filter((note) => note.code === 'EXPLORATION_WITHOUT_CHANGE')).toHaveLength(0);
  });
});

describe('the observation is tied to real changes, not attempted calls or preseeded file counts', () => {
  const input = (changes: number, toolNames: string[] = ['read_file']) => ({ writingRun: true, changes, toolNames, editingExistingApp: false });

  it('sixteen different probes in fewer turns trigger before all eight turns have elapsed', () => {
    let state = initialExplorationProgress(32);
    for (let n = 0; n < EXPLORATION_PROBES / 4 - 1; n++) {
      const out = advanceExplorationProgress(state, input(32, ['read_file', 'read_file', 'grep', 'glob']), {});
      expect(out.steer).toBeNull(); state = out.state;
    }
    const out = advanceExplorationProgress(state, input(32, ['read_file', 'read_file', 'grep', 'glob']), {});
    expect(out.steer?.observation).toContain('4 model turn(s) made 16 file/search calls');
  });

  it('a successful real write resets the exploration streak, while an attempted write without a change does not', () => {
    let state = initialExplorationProgress(32);
    for (let n = 0; n < 7; n++) state = advanceExplorationProgress(state, input(32), {}).state;
    state = advanceExplorationProgress(state, input(33, ['write_file']), {}).state;
    expect(state.turns).toBe(0);
    for (let n = 0; n < 7; n++) {
      const out = advanceExplorationProgress(state, input(33), {});
      expect(out.steer).toBeNull(); state = out.state;
    }
    state = advanceExplorationProgress(state, input(33, ['write_file']), {}).state; // rejected: same count
    expect(advanceExplorationProgress(state, input(33), {}).steer).not.toBeNull();
  });

  it('verification, browser actions and connected tools are never mistaken for file exploration', () => {
    for (const name of ['typecheck', 'run_tests', 'browser_action', 'evaluate', 'bash', 'task', 'external_tool']) {
      const out = advanceExplorationProgress(initialExplorationProgress(32), input(32, [name]), {});
      expect(out.state.turns).toBe(0);
      expect(out.steer).toBeNull();
    }
  });
});
