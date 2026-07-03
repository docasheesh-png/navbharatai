import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRunner, isParallelSafeToolUse, buildTimedOut, type AgentRunnerOptions } from './AgentRunner';

describe('buildTimedOut (watchdog wall-clock cap)', () => {
  it('is false when no cap is set', () => {
    expect(buildTimedOut(0, undefined, 999_999)).toBe(false);
    expect(buildTimedOut(0, 0, 999_999)).toBe(false);
  });
  it('is false before the cap and true at/after it', () => {
    expect(buildTimedOut(1000, 5000, 1000 + 4999)).toBe(false);
    expect(buildTimedOut(1000, 5000, 1000 + 5000)).toBe(true);
    expect(buildTimedOut(1000, 5000, 1000 + 9999)).toBe(true);
  });
});
import { ClaudeClient, type MessagesCreateClient } from './ClaudeClient';
import { ToolDispatcher, type ActuatorPort } from './ToolDispatcher';
import { WorkspaceState } from './WorkspaceState';
import { AgentEventStream } from './AgentEventStream';
import { defaultToolCatalog } from './ToolCatalog';
import { InMemoryConversationStore } from './ConversationStore';
import type { AgentEvent } from './types';

/** In-memory fake sandbox (ActuatorPort slice). */
class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string): Promise<void> {
    this.files.set(p, c);
  }
  async listFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async runCommand() {
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

/** A mock Anthropic client that replays a scripted list of raw messages. */
function scriptedClient(messages: unknown[]): MessagesCreateClient {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const m = messages[i] ?? { content: [{ type: 'text', text: 'fallback end' }], stop_reason: 'end_turn' };
        i++;
        return m as never;
      },
    },
  };
}

function buildRunner(
  script: unknown[],
  opts: { maxSteps?: number; maxBudgetUsd?: number; signal?: AbortSignal; persistence?: AgentRunnerOptions['persistence']; expectsArtifacts?: boolean } = {},
) {
  const actuator = new FakeActuator();
  const stream = new AgentEventStream();
  const events: AgentEvent[] = [];
  stream.subscribe((e) => events.push(e), false);
  const state = new WorkspaceState(stream);
  const dispatcher = new ToolDispatcher(actuator, 'ws-1', state, stream);
  const client = new ClaudeClient(scriptedClient(script));
  const runner = new AgentRunner({
    client,
    dispatcher,
    state,
    events: stream,
    model: 'claude-sonnet-test',
    system: 'You are the Architect.',
    tools: defaultToolCatalog(),
    ...opts,
  });
  return { runner, actuator, state, events };
}

describe('AgentRunner (native tool-use loop)', () => {
  it('runs a real two-turn build: tool_use then end_turn', async () => {
    const { runner, actuator, state, events } = buildRunner([
      {
        content: [
          { type: 'text', text: 'Creating the entry file.' },
          { type: 'tool_use', id: 'tu1', name: 'write_file', input: { path: 'index.html', content: '<h1>Hi</h1>' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 200, output_tokens: 50 },
      },
      {
        content: [{ type: 'text', text: 'All done — the app is ready.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 60, output_tokens: 20 },
      },
    ]);

    const result = await runner.run('Build a hello page');

    expect(result.ok).toBe(true);
    expect(result.steps).toBe(2);
    expect(actuator.files.get('index.html')).toBe('<h1>Hi</h1>');
    expect(state.snapshot().files).toEqual([{ path: 'index.html', kind: 'create' }]);
    // Aggregated tokens across both turns.
    expect(result.usage.inputTokens).toBe(260);
    expect(result.usage.outputTokens).toBe(70);
    // Billed at the standard 2.5x Opus-equivalent → strictly positive.
    expect(result.billedUsd).toBeGreaterThan(0);
    // Events: narration + tool_call + tool_result + file_changed + done(ok).
    expect(events.find((e) => e.type === 'done' && e.ok)).toBeTruthy();
    expect(events.find((e) => e.type === 'file_changed')).toBeTruthy();
    expect(events.filter((e) => e.type === 'narration').length).toBeGreaterThanOrEqual(1);
  });

  it('feeds tool errors back to the model (honest is_error, no fake success)', async () => {
    const { runner, events } = buildRunner([
      {
        content: [{ type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'missing.ts' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      { content: [{ type: 'text', text: 'I see the file is missing; stopping.' }], stop_reason: 'end_turn' },
    ]);
    const result = await runner.run('read a missing file');
    expect(result.ok).toBe(true); // model chose to end after seeing the error
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult && toolResult.type === 'tool_result' && toolResult.ok).toBe(false);
  });

  it('stops honestly at the step limit', async () => {
    // Always returns a tool_use → never ends on its own.
    const looping = [
      {
        content: [{ type: 'tool_use', id: 'tu', name: 'write_file', input: { path: 'a.ts', content: 'x' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ];
    const { runner } = buildRunner(
      Array.from({ length: 10 }, () => looping[0]),
      { maxSteps: 3 },
    );
    const result = await runner.run('loop forever');
    expect(result.ok).toBe(false);
    expect(result.steps).toBe(3);
    expect(result.summary).toContain('Step limit');
  });

  it('stops between turns when the abort signal fires (user pressed Stop)', async () => {
    const looping = [{
      content: [{ type: 'tool_use', id: 'tu', name: 'write_file', input: { path: 'a.ts', content: 'x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    }];
    const controller = new AbortController();
    controller.abort(); // already aborted → the loop stops on its first turn
    const { runner, events } = buildRunner(
      Array.from({ length: 10 }, () => looping[0]),
      { signal: controller.signal },
    );
    const result = await runner.run('build something big');
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/stopped by the user/i);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('stops honestly when the budget cap is reached', async () => {
    const looping = {
      content: [{ type: 'tool_use', id: 'tu', name: 'write_file', input: { path: 'a.ts', content: 'x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 }, // ~ $90 Opus-equiv × 2.5 = $225/turn
    };
    const { runner } = buildRunner([looping, looping, looping], { maxBudgetUsd: 100 });
    const result = await runner.run('expensive build');
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Budget reached');
    expect(result.billedUsd).toBeGreaterThanOrEqual(100);
  });
});

describe('AgentRunner persistence (D7)', () => {
  const twoTurn = [
    {
      content: [
        { type: 'text', text: 'Creating the entry file.' },
        { type: 'tool_use', id: 'tu1', name: 'write_file', input: { path: 'index.html', content: '<h1>Hi</h1>' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 200, output_tokens: 50 },
    },
    { content: [{ type: 'text', text: 'Done — the app is built.' }], stop_reason: 'end_turn', usage: { input_tokens: 80, output_tokens: 20 } },
  ];

  it('persists the build: create → running checkpoint → complete, with the full transcript', async () => {
    const store = new InMemoryConversationStore();
    const { runner } = buildRunner(twoTurn, {
      persistence: { store, conversationId: 'b1', userId: 'u1', workspaceId: 'ws-1', title: 'todo app', now: () => 5000 },
    });
    const result = await runner.run('build a todo app');
    expect(result.ok).toBe(true);

    const rec = await store.get('b1');
    expect(rec).not.toBeNull();
    expect(rec?.status).toBe('complete');
    expect(rec?.userId).toBe('u1');
    // user prompt + assistant(turn1) + tool_results + assistant(turn2) = 4 messages.
    expect(rec?.messages).toHaveLength(4);
    expect((rec?.messages[0] as { role: string }).role).toBe('user');
    expect(rec?.usage.inputTokens).toBe(280); // 200 + 80
    expect(rec?.billedUsd).toBeGreaterThan(0);
    expect(rec?.billedUsd).toBeCloseTo(result.billedUsd, 10);
    expect(rec?.createdAt).toBe(5000);
  });

  it('records a stopped status when the user aborts', async () => {
    const store = new InMemoryConversationStore();
    const ctrl = new AbortController();
    ctrl.abort();
    const { runner } = buildRunner(twoTurn, {
      signal: ctrl.signal,
      persistence: { store, conversationId: 'b2', userId: 'u1', workspaceId: 'ws-1', title: 'x', now: () => 1 },
    });
    await runner.run('build something');
    expect((await store.get('b2'))?.status).toBe('stopped');
  });

  it('is best-effort: a throwing store never breaks the build', async () => {
    const brokenStore = {
      create: async () => { throw new Error('db down'); },
      get: async () => null,
      appendMessages: async () => { throw new Error('db down'); },
      update: async () => { throw new Error('db down'); },
      listByUser: async () => [],
      remove: async () => {},
    };
    const { runner } = buildRunner(twoTurn, {
      persistence: { store: brokenStore, conversationId: 'b3', userId: 'u1', workspaceId: 'ws-1', title: 'x' },
    });
    const result = await runner.run('build despite a broken store');
    expect(result.ok).toBe(true); // the build completes regardless of persistence failures
  });

  it('does not touch any store when no persistence is configured (back-compat)', async () => {
    const { runner } = buildRunner(twoTurn);
    const result = await runner.run('plain build');
    expect(result.ok).toBe(true);
  });

  it('recovers from an oversized turn via aggressive compaction (second-chance write)', async () => {
    // The store rejects writes over a size limit — like Firestore's 1MB/doc. The build writes a
    // file large enough that NORMAL compaction stays over the limit but AGGRESSIVE fits.
    const inner = new InMemoryConversationStore();
    const store = {
      ...inner,
      create: inner.create.bind(inner),
      get: inner.get.bind(inner),
      update: inner.update.bind(inner),
      listByUser: inner.listByUser.bind(inner),
      remove: inner.remove.bind(inner),
      appendMessages: async (id: string, msgs: unknown[], patch: { updatedAt: number }) => {
        if (JSON.stringify(msgs).length > 6_000) throw new Error('payload too large');
        return inner.appendMessages(id, msgs, patch);
      },
    };
    const bigTurn = [
      {
        content: [
          { type: 'text', text: 'Writing a big file.' },
          { type: 'tool_use', id: 'tu1', name: 'write_file', input: { path: 'big.ts', content: 'x'.repeat(50_000) } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 10 },
      },
      { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } },
    ];
    const { runner } = buildRunner(bigTurn, {
      persistence: { store, conversationId: 'b5', userId: 'u1', workspaceId: 'ws-1', title: 'x', now: () => 1 },
    });
    const result = await runner.run('build with a big write');
    expect(result.ok).toBe(true);
    const rec = await inner.get('b5');
    expect(rec?.status).toBe('complete');
    // All 4 transcript messages landed — the oversized turn was persisted in compacted form.
    expect(rec?.messages).toHaveLength(4);
    expect(JSON.stringify(rec?.messages)).toContain('truncated for storage');
  });

  it('skips a poison turn with an honest marker so the transcript and final status still land', async () => {
    const inner = new InMemoryConversationStore();
    const store = {
      ...inner,
      create: inner.create.bind(inner),
      get: inner.get.bind(inner),
      update: inner.update.bind(inner),
      listByUser: inner.listByUser.bind(inner),
      remove: inner.remove.bind(inner),
      // Rejects ANY payload carrying a tool_use — both compaction attempts fail for that turn.
      appendMessages: async (id: string, msgs: unknown[], patch: { updatedAt: number }) => {
        if (JSON.stringify(msgs).includes('"tool_use"')) throw new Error('unwritable turn');
        return inner.appendMessages(id, msgs, patch);
      },
    };
    const { runner } = buildRunner(twoTurn, {
      persistence: { store, conversationId: 'b6', userId: 'u1', workspaceId: 'ws-1', title: 'x', now: () => 1 },
    });
    const result = await runner.run('build with an unwritable turn');
    expect(result.ok).toBe(true);
    const rec = await inner.get('b6');
    // Seed + omission marker + final assistant turn — persistence never stalled, status landed.
    expect(rec?.status).toBe('complete');
    const texts = JSON.stringify(rec?.messages);
    expect(texts).toContain('omitted from the saved transcript');
    expect(texts).toContain('Done — the app is built.');
  });
});

describe('AgentRunner parallel tool execution (capped)', () => {
  function trackingDispatcher() {
    let inFlight = 0;
    let serialInFlight = 0;
    const max = { all: 0, serial: 0 };
    const order: string[] = [];
    const dispatcher = {
      dispatch: async (tu: { id: string; name: string; input: Record<string, unknown> }) => {
        const parallel = isParallelSafeToolUse(tu);
        inFlight++; if (inFlight > max.all) max.all = inFlight;
        if (!parallel) { serialInFlight++; if (serialInFlight > max.serial) max.serial = serialInFlight; }
        await new Promise((r) => setTimeout(r, 15));
        order.push(tu.id);
        if (!parallel) serialInFlight--;
        inFlight--;
        return { tool_use_id: tu.id, content: 'ok', is_error: false };
      },
    };
    return { dispatcher, max, order };
  }

  function runnerWith(dispatcher: unknown, script: unknown[], toolConcurrency = 3) {
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const client = new ClaudeClient(scriptedClient(script));
    return new AgentRunner({
      client,
      dispatcher: dispatcher as never,
      state,
      events: stream,
      model: 'm',
      system: 's',
      tools: defaultToolCatalog(),
      toolConcurrency,
    });
  }

  const task = (id: string, role: string) => ({ type: 'tool_use', id, name: 'task', input: { role, instruction: 'check' } });
  const end = { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };

  it('runs review sub-agents concurrently (capped) while the write stays serial', async () => {
    const { dispatcher, max, order } = trackingDispatcher();
    const turn1 = {
      content: [
        { type: 'tool_use', id: 'w', name: 'write_file', input: { path: 'a.ts', content: 'x' } },
        task('qa', 'qa'), task('sec', 'security'), task('perf', 'performance'),
        task('a11y', 'accessibility'), task('rev', 'reviewer'),
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const result = await runnerWith(dispatcher, [turn1, end], 3).run('build then review');
    expect(result.ok).toBe(true);
    expect(max.all).toBeGreaterThan(1);     // review agents really ran in parallel
    expect(max.all).toBeLessThanOrEqual(3); // …but never above the cap
    expect(max.serial).toBe(1);             // the write never overlapped anything
    expect(order).toHaveLength(6);          // every tool was dispatched exactly once
  });

  it('keeps a pure-write turn fully serial regardless of the cap', async () => {
    const { dispatcher, max } = trackingDispatcher();
    const writes = {
      content: [
        { type: 'tool_use', id: 'w1', name: 'write_file', input: { path: 'a', content: '1' } },
        { type: 'tool_use', id: 'w2', name: 'write_file', input: { path: 'b', content: '2' } },
        { type: 'tool_use', id: 'w3', name: 'write_file', input: { path: 'c', content: '3' } },
      ],
      stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
    };
    await runnerWith(dispatcher, [writes, end], 4).run('write three');
    expect(max.all).toBe(1); // never more than one mutating tool at a time
  });

  it('classifies builder sub-agents + writes as serial, read-only ones as parallel', () => {
    expect(isParallelSafeToolUse({ id: '1', name: 'task', input: { role: 'qa' } })).toBe(true);
    expect(isParallelSafeToolUse({ id: '2', name: 'task', input: { role: 'reviewer' } })).toBe(true);
    expect(isParallelSafeToolUse({ id: '3', name: 'task', input: { role: 'frontend' } })).toBe(false);
    expect(isParallelSafeToolUse({ id: '4', name: 'task', input: { role: 'tester' } })).toBe(false);
    expect(isParallelSafeToolUse({ id: '5', name: 'read_file', input: {} })).toBe(true);
    expect(isParallelSafeToolUse({ id: '6', name: 'grep', input: {} })).toBe(true);
    expect(isParallelSafeToolUse({ id: '7', name: 'write_file', input: {} })).toBe(false);
    expect(isParallelSafeToolUse({ id: '8', name: 'bash', input: {} })).toBe(false);
  });
});

describe('AgentRunner — empty-build detection (fake-success fix)', () => {
  it('reports ok:false when a BUILD replies with no tool calls and creates nothing', async () => {
    // The cheap model "replies" instead of building — the exact production bug.
    const { runner, actuator, events } = buildRunner(
      [{ content: [{ type: 'text', text: "I'm preparing a plan so we can build this app." }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 30 } }],
      { expectsArtifacts: true },
    );
    const result = await runner.run('Build an analog clock');
    expect(result.ok).toBe(false); // NOT a fake success
    expect(actuator.files.size).toBe(0); // nothing built
    expect(result.summary.toLowerCase()).toContain('no files');
    const done = events.find((e) => e.type === 'done') as { ok?: boolean } | undefined;
    expect(done?.ok).toBe(false);
  });

  it('NUDGES a build that only narrated a plan, then succeeds when it builds on the next turn', async () => {
    // Turn 1: the model just describes its plan / delegation (NO tool call) — the exact
    // "model replied without building" symptom. Turn 2 (after the nudge): it actually writes
    // the file. Without the nudge the run would have terminated as builtNothing after turn 1.
    const { runner, actuator } = buildRunner(
      [
        { content: [{ type: 'text', text: "Here's my plan. Now I'll assign the frontend expert to create index.html." }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 30 } },
        { content: [{ type: 'tool_use', id: 'tu1', name: 'write_file', input: { path: 'index.html', content: '<h1>Search</h1>' } }], stop_reason: 'tool_use', usage: { input_tokens: 120, output_tokens: 40 } },
        { content: [{ type: 'text', text: 'Done — the page is ready.' }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 15 } },
      ],
      { expectsArtifacts: true },
    );
    const result = await runner.run('ek simple search engine page banao');
    expect(result.ok).toBe(true); // the nudge let it actually build
    expect(actuator.files.get('index.html')).toBe('<h1>Search</h1>');
  });

  it('still reports ok:true for a CHAT turn with no tool calls (chat unaffected)', async () => {
    const { runner } = buildRunner(
      [{ content: [{ type: 'text', text: 'Hello! How can I help you today?' }], stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 10 } }],
      { expectsArtifacts: false },
    );
    const result = await runner.run('hi');
    expect(result.ok).toBe(true);
  });

  it('reports ok:true for a real build that DID write a file then wrapped up', async () => {
    const { runner, actuator } = buildRunner(
      [
        { content: [{ type: 'tool_use', id: 'tu1', name: 'write_file', input: { path: 'index.html', content: '<h1>Clock</h1>' } }], stop_reason: 'tool_use', usage: { input_tokens: 200, output_tokens: 50 } },
        { content: [{ type: 'text', text: 'Done — your clock is ready.' }], stop_reason: 'end_turn', usage: { input_tokens: 60, output_tokens: 20 } },
      ],
      { expectsArtifacts: true },
    );
    const result = await runner.run('Build an analog clock');
    expect(result.ok).toBe(true); // real work happened → genuine success
    expect(actuator.files.get('index.html')).toBe('<h1>Clock</h1>');
  });
});

describe('AgentRunner — mandatory readiness gate (R2 §1.1)', () => {
  // A stub dispatcher with a controllable readiness verdict, isolating the gate's
  // ok-downgrade logic from the full evaluate scan.
  function gateDispatcher(ready: boolean) {
    return {
      dispatch: async (tu: { id: string; name: string; input: Record<string, unknown> }) =>
        ({ tool_use_id: tu.id, content: 'ok', is_error: false }),
      assessBuildReadiness: async () =>
        ready
          ? { score: 100, ready: true, blockers: [] as string[], warnings: [] as string[] }
          : { score: 40, ready: false, blockers: ['1 unresolved import(s) — the build will fail'], warnings: [] as string[] },
    };
  }

  function gateRunner(dispatcher: unknown, opts: Partial<AgentRunnerOptions>, events?: AgentEvent[]) {
    const stream = new AgentEventStream();
    if (events) stream.subscribe((e) => events.push(e), false);
    const state = new WorkspaceState(stream);
    const client = new ClaudeClient(scriptedClient([
      { content: [{ type: 'tool_use', id: 'w', name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } },
      { content: [{ type: 'text', text: 'Build complete.' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } },
    ]));
    return new AgentRunner({
      client, dispatcher: dispatcher as never, state, events: stream,
      model: 'm', system: 's', tools: defaultToolCatalog(),
      expectsArtifacts: true, ...opts,
    });
  }

  it('downgrades a NOT-READY build to ok:false instead of a fake success', async () => {
    const result = await gateRunner(gateDispatcher(false), { readinessGate: true }).run('build an app');
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('NOT READY');
    expect(result.summary).toContain('unresolved import');
  });

  it('keeps a READY build as a genuine success', async () => {
    const result = await gateRunner(gateDispatcher(true), { readinessGate: true }).run('build an app');
    expect(result.ok).toBe(true);
  });

  it('does NOT gate when readinessGate is off (default) — a not-ready scan cannot fail the build', async () => {
    const result = await gateRunner(gateDispatcher(false), { readinessGate: false }).run('build an app');
    expect(result.ok).toBe(true);
  });

  it('emits the build-health readiness in the done event (R2 §4.6)', async () => {
    const events: AgentEvent[] = [];
    await gateRunner(gateDispatcher(false), { readinessGate: true }, events).run('build an app');
    const done = events.find((e) => e.type === 'done') as { readiness?: { score: number; ready: boolean; blockers: string[] } } | undefined;
    expect(done?.readiness).toBeTruthy();
    expect(done?.readiness?.ready).toBe(false);
    expect(done?.readiness?.score).toBe(40);
    expect(done?.readiness?.blockers?.length).toBeGreaterThan(0);
  });
});
