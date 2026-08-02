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
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 }, // normal billing: ~$18 Sonnet-equiv × 1.2 = $21.6/turn
    };
    // Cap chosen below the 3-turn total ($64.8) so the loop must stop on the budget, not run out of turns.
    const { runner } = buildRunner([looping, looping, looping], { maxBudgetUsd: 40 });
    const result = await runner.run('expensive build');
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Budget reached');
    expect(result.billedUsd).toBeGreaterThanOrEqual(40);
    // T1-budget-ux: a budget stop is flagged as a resumable pause (not a plain failure), so the client
    // can offer an honest "Continue" instead of a red error.
    expect(result.budgetReached).toBe(true);
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

  it('self-heals from a TRANSIENT store outage — no turns are skipped as poison', async () => {
    // The store rejects the first few writes entirely (outage), then recovers. The poison-skip
    // must NOT advance past those turns: the marker write also fails during the outage, so the
    // next persist retries the whole slice and the full transcript lands once the store is back.
    const inner = new InMemoryConversationStore();
    let failures = 0;
    const store = {
      ...inner,
      create: inner.create.bind(inner),
      get: inner.get.bind(inner),
      update: inner.update.bind(inner),
      listByUser: inner.listByUser.bind(inner),
      remove: inner.remove.bind(inner),
      appendMessages: async (id: string, msgs: unknown[], patch: { updatedAt: number }) => {
        if (failures < 3) { failures++; throw new Error('store unavailable'); } // outage window
        return inner.appendMessages(id, msgs, patch);
      },
    };
    const { runner } = buildRunner(twoTurn, {
      persistence: { store, conversationId: 'b7', userId: 'u1', workspaceId: 'ws-1', title: 'x', now: () => 1 },
    });
    const result = await runner.run('build through an outage');
    expect(result.ok).toBe(true);
    const rec = await inner.get('b7');
    expect(rec?.status).toBe('complete');
    const texts = JSON.stringify(rec?.messages);
    // Every turn eventually persisted — nothing skipped, no omission marker.
    expect(texts).toContain('Done — the app is built.');
    expect(texts).toContain('Creating the entry file.');
    expect(texts).not.toContain('omitted from the saved transcript');
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

  it('AP-4 flag: frontend/backend writer sub-agents are parallel-eligible ONLY when parallelBuild is on', () => {
    const fe = { id: 'a', name: 'task', input: { role: 'frontend' } } as const;
    const be = { id: 'b', name: 'task', input: { role: 'backend' } } as const;
    // default (flag off) — writers stay serial, exactly as before
    expect(isParallelSafeToolUse(fe)).toBe(false);
    expect(isParallelSafeToolUse(be, { parallelBuild: false })).toBe(false);
    // flag on — the two writer roles become parallel-eligible
    expect(isParallelSafeToolUse(fe, { parallelBuild: true })).toBe(true);
    expect(isParallelSafeToolUse(be, { parallelBuild: true })).toBe(true);
    // a NON-partitioned writer role (tester) stays serial even with the flag on (only FE/BE are gated)
    expect(isParallelSafeToolUse({ id: 'c', name: 'task', input: { role: 'tester' } }, { parallelBuild: true })).toBe(false);
    // read-only roles are unaffected by the flag
    expect(isParallelSafeToolUse({ id: 'd', name: 'task', input: { role: 'qa' } }, { parallelBuild: false })).toBe(true);
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

describe('AgentRunner — evidence-based step-limit verdict (working app ≠ failure)', () => {
  const looping = {
    content: [{ type: 'tool_use', id: 'tu', name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1 },
  };

  function cappedRunner(opts: { readiness?: boolean; readinessGate?: boolean; expectsArtifacts?: boolean }, events?: AgentEvent[]) {
    const stream = new AgentEventStream();
    if (events) stream.subscribe((e) => events.push(e), false);
    const state = new WorkspaceState(stream);
    const dispatcher = {
      dispatch: async (tu: { id: string }) => ({ tool_use_id: tu.id, content: 'ok', is_error: false }),
      assessBuildReadiness: async () =>
        opts.readiness
          ? { score: 92, ready: true, blockers: [] as string[], warnings: [] as string[] }
          : { score: 35, ready: false, blockers: ['blank preview — the app does not render'], warnings: [] as string[] },
    };
    const client = new ClaudeClient(scriptedClient(Array.from({ length: 6 }, () => looping)));
    return new AgentRunner({
      client, dispatcher: dispatcher as never, state, events: stream,
      model: 'm', system: 's', tools: defaultToolCatalog(),
      maxSteps: 2,
      expectsArtifacts: opts.expectsArtifacts ?? true,
      readinessGate: opts.readinessGate ?? false,
    });
  }

  it('a build that WROTE files and then hit the cap is ok:true (files saved, resumable) — no gate', async () => {
    const result = await cappedRunner({}).run('build an app');
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Step limit');
    expect(result.summary).toMatch(/saved/i);
  });

  it('with the readiness gate ON, the cap verdict is EARNED: ready → ok:true with the health card', async () => {
    const events: AgentEvent[] = [];
    const result = await cappedRunner({ readiness: true, readinessGate: true }, events).run('build an app');
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('READY');
    const done = events.find((e) => e.type === 'done') as { readiness?: { ready: boolean; score: number } } | undefined;
    expect(done?.readiness?.ready).toBe(true);
    expect(done?.readiness?.score).toBe(92);
  });

  it('with the readiness gate ON, a NOT-ready capped build stays an honest ok:false', async () => {
    process.env.AGENTV3_STEP_RESUME = 'off'; // this test pins the CAP VERDICT wording; Slice 3's resume has its own suite
    try {
      const result = await cappedRunner({ readiness: false, readinessGate: true }).run('build an app');
      expect(result.ok).toBe(false); // the core invariant — an unready capped build is never a fake success
      // User-facing summary is short + plain now (admin 2026-08-02); the raw blockers ride the health card.
      expect(result.summary).toMatch(/isn't fully working|still need fixing/i);
    } finally {
      delete process.env.AGENTV3_STEP_RESUME;
    }
  });

  it('a capped NON-build run (no artifacts expected) keeps the old honest failure', async () => {
    const result = await cappedRunner({ expectsArtifacts: false }).run('chat that loops');
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Stopped without completing');
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

  it('downgrades a NOT-READY build to ok:false with a SHORT, plain user summary (admin 2026-08-02)', async () => {
    const result = await gateRunner(gateDispatcher(false), { readinessGate: true }).run('build an app');
    expect(result.ok).toBe(false); // the core invariant — never a fake success
    // The user sees ONE calm, plain-language headline — not the technical blocker dump or the model's prose.
    expect(result.summary).toMatch(/isn't fully working|still need fixing/i);
    expect(result.summary).not.toContain('unresolved import'); // raw blockers ride the health card / admin report, not the user summary
    expect(result.summary).not.toContain('may overstate');    // the overstating agent prose is not dumped on the user
  });

  it('keeps a READY build as a genuine success', async () => {
    const result = await gateRunner(gateDispatcher(true), { readinessGate: true }).run('build an app');
    expect(result.ok).toBe(true);
  });

  it('AGENTV3_VERBOSE_READINESS=on restores the detailed verdict-first summary (App #7/#8 honesty, debug mode)', async () => {
    // With the debug flag on, the summary must OPEN with the honest NOT-READY verdict (not the scripted
    // "Build complete." false claim) and demote the model's prose below a clear "may overstate" label.
    const prev = process.env.AGENTV3_VERBOSE_READINESS;
    process.env.AGENTV3_VERBOSE_READINESS = 'on';
    try {
      const result = await gateRunner(gateDispatcher(false), { readinessGate: true }).run('build an app');
      expect(result.ok).toBe(false);
      expect(result.summary.split('\n')[0]).toContain('NOT READY');
      expect(result.summary.indexOf('NOT READY')).toBeLessThan(result.summary.indexOf('Build complete.'));
      expect(result.summary).toContain('may overstate');
      expect(result.summary).toContain('unresolved import'); // the detailed blockers are present in verbose mode
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_VERBOSE_READINESS;
      else process.env.AGENTV3_VERBOSE_READINESS = prev;
    }
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

describe('AgentRunner — LintGate (U-1, default-OFF)', () => {
  function lintDispatcher(blocked: boolean) {
    return {
      dispatch: async (tu: { id: string; name: string; input: Record<string, unknown> }) =>
        ({ tool_use_id: tu.id, content: 'ok', is_error: false }),
      // readiness is always fine here so we isolate the lint gate's own ok-downgrade.
      assessBuildReadiness: async () => ({ score: 100, ready: true, blockers: [] as string[], warnings: [] as string[] }),
      assessLintGate: async () => blocked
        ? { blocked: true, errorCount: 2, blockers: ['src/a.ts:3 no-undef — foo is not defined'], summary: 'Lint gate: 2 ESLint errors block the build.' }
        : { blocked: false, errorCount: 0, blockers: [] as string[], summary: 'Lint gate: no blocking ESLint errors.' },
    };
  }

  function runner(dispatcher: unknown, opts: Partial<AgentRunnerOptions>) {
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const client = new ClaudeClient(scriptedClient([
      { content: [{ type: 'tool_use', id: 'w', name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } },
      { content: [{ type: 'text', text: 'Build complete.' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } },
    ]));
    return new AgentRunner({
      client, dispatcher: dispatcher as never, state, events: stream,
      model: 'm', system: 's', tools: defaultToolCatalog(), expectsArtifacts: true, ...opts,
    });
  }

  it('with the lint gate ON, ESLint errors downgrade the build to ok:false', async () => {
    const result = await runner(lintDispatcher(true), { lintGate: true }).run('build an app');
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('ESLint error');
    expect(result.summary).toContain('no-undef');
  });

  it('with the lint gate ON but no ESLint errors, the build stays ok:true', async () => {
    const result = await runner(lintDispatcher(false), { lintGate: true }).run('build an app');
    expect(result.ok).toBe(true);
  });

  it('with the lint gate OFF (default), ESLint errors do NOT fail the build', async () => {
    const result = await runner(lintDispatcher(true), { lintGate: false }).run('build an app');
    expect(result.ok).toBe(true);
  });
});

// ── E4 (audit Batch 3): per-turn / per-tool hard timeouts ──────────────────────────────────────
// A hung provider call must NOT block the build until the 30-min watchdog (which is only checked
// BETWEEN turns and so never even runs while a single turn hangs). Same for a stuck tool.
describe('AgentRunner — E4 hard timeouts (no hung call blocks the build)', () => {
  const NEVER: Promise<never> = new Promise(() => { /* never settles */ });
  const mkTurn = (p: Partial<import('./ClaudeClient').TurnResult>): import('./ClaudeClient').TurnResult => ({
    text: '', toolUses: [], stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    rawContent: [], ...p,
  });

  /** A TurnRunner that plays a scripted list of per-turn thunks (each gets the live params). */
  class ProgrammableRunner implements import('./ClaudeClient').TurnRunner {
    calls: import('./ClaudeClient').RunTurnParams[] = [];
    private i = 0;
    constructor(private turns: Array<(p: import('./ClaudeClient').RunTurnParams) => Promise<import('./ClaudeClient').TurnResult>>) {}
    async runTurn(p: import('./ClaudeClient').RunTurnParams): Promise<import('./ClaudeClient').TurnResult> {
      this.calls.push(p);
      const fn = this.turns[this.i++] ?? (() => Promise.resolve(mkTurn({ text: 'done' })));
      return fn(p);
    }
  }

  function e4Runner(
    turns: Array<(p: import('./ClaudeClient').RunTurnParams) => Promise<import('./ClaudeClient').TurnResult>>,
    opts: Partial<AgentRunnerOptions> & { actuator?: ActuatorPort } = {},
  ) {
    const actuator = opts.actuator ?? new FakeActuator();
    const stream = new AgentEventStream();
    const events: AgentEvent[] = [];
    stream.subscribe((e) => events.push(e), false);
    const state = new WorkspaceState(stream);
    const dispatcher = new ToolDispatcher(actuator, 'ws-1', state, stream);
    const runner = new AgentRunner({
      client: new ProgrammableRunner(turns),
      dispatcher, state, events: stream,
      model: 'test', system: 'sys', tools: defaultToolCatalog(),
      ...opts,
    });
    return { runner, actuator, events };
  }

  it('a hung MODEL turn with nothing built stops honestly (ok:false), it does not block forever', async () => {
    const { runner } = e4Runner([() => NEVER], { turnTimeoutMs: 40 });
    const result = await runner.run('build something');
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/stalled|didn't respond|did not respond/i);
    expect(result.steps).toBe(1);
  });

  it('a hung MODEL turn AFTER files were written stops as ok:true (work saved, resumable)', async () => {
    const wrote = mkTurn({
      stopReason: 'tool_use',
      toolUses: [{ id: 'w1', name: 'write_file', input: { path: 'index.html', content: '<h1>hi</h1>' } }],
      rawContent: [{ type: 'tool_use', id: 'w1', name: 'write_file', input: { path: 'index.html', content: '<h1>hi</h1>' } }],
      usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    const { runner, actuator } = e4Runner([() => Promise.resolve(wrote), () => NEVER], { turnTimeoutMs: 40, expectsArtifacts: true });
    const result = await runner.run('build a page');
    expect(actuator.files.get('index.html')).toBe('<h1>hi</h1>'); // the real work survived
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/saved/i);
  });

  it('a hung TOOL yields an is_error result to the model (build survives), then ends honestly', async () => {
    // A sandbox command that never returns → dispatch hangs → per-tool cap must fire.
    class HangingActuator extends FakeActuator {
      async runCommand() { return NEVER as unknown as { exitCode: number; stdout: string; stderr: string }; }
    }
    const bashTurn = mkTurn({
      stopReason: 'tool_use',
      toolUses: [{ id: 'b1', name: 'bash', input: { command: 'echo hi' } }],
      rawContent: [{ type: 'tool_use', id: 'b1', name: 'bash', input: { command: 'echo hi' } }],
      usage: { inputTokens: 5, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    let toolResultSeen: string | undefined;
    const turn2 = (p: import('./ClaudeClient').RunTurnParams) => {
      // The tool_result fed back on turn 2 must be the honest timeout is_error, not a hang.
      const last = (p.messages as Array<{ role: string; content: unknown }>).at(-1);
      const blocks = Array.isArray(last?.content) ? last!.content as Array<Record<string, unknown>> : [];
      const tr = blocks.find((b) => b.type === 'tool_result');
      toolResultSeen = typeof tr?.content === 'string' ? tr.content : JSON.stringify(tr?.content);
      return Promise.resolve(mkTurn({ text: 'ok, I will try a smaller step' }));
    };
    const { runner } = e4Runner([() => Promise.resolve(bashTurn), turn2], { toolTimeoutMs: 40, actuator: new HangingActuator() });
    const result = await runner.run('run a command');
    expect(toolResultSeen).toMatch(/did not finish|skipped/i);
    expect(result.steps).toBe(2); // it did NOT hang on the tool — it reached turn 2 and finished
  });

  it('the `task` sub-agent tool is EXEMPT from the per-tool cap (its own watchdog bounds it)', async () => {
    // spawnSubAgent resolves AFTER the tiny tool cap would have fired — proving `task` is not capped.
    const CAP = 20;
    const spawn = async () => {
      await new Promise((r) => setTimeout(r, CAP * 4)); // 4× the cap — a short cap would have killed it
      return { ok: true, summary: 'sub-agent finished the work' };
    };
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const dispatcher = new ToolDispatcher(new FakeActuator(), 'ws-1', state, stream, spawn);
    const taskTurn = mkTurn({
      stopReason: 'tool_use',
      toolUses: [{ id: 'k1', name: 'task', input: { role: 'frontend', instruction: 'build the UI' } }],
      rawContent: [{ type: 'tool_use', id: 'k1', name: 'task', input: { role: 'frontend', instruction: 'build the UI' } }],
      usage: { inputTokens: 5, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    let taskResultSeen: string | undefined;
    const turn2 = (p: import('./ClaudeClient').RunTurnParams) => {
      const last = (p.messages as Array<{ role: string; content: unknown }>).at(-1);
      const blocks = Array.isArray(last?.content) ? last!.content as Array<Record<string, unknown>> : [];
      const tr = blocks.find((b) => b.type === 'tool_result');
      taskResultSeen = typeof tr?.content === 'string' ? tr.content : JSON.stringify(tr?.content);
      return Promise.resolve(mkTurn({ text: 'great, continuing' }));
    };
    const runner = new AgentRunner({
      client: new ProgrammableRunner([() => Promise.resolve(taskTurn), turn2]),
      dispatcher, state, events: stream, model: 'test', system: 'sys', tools: defaultToolCatalog(),
      toolTimeoutMs: CAP,
    });
    const result = await runner.run('delegate to a sub-agent');
    // The sub-agent's real result flowed through — NOT a "did not finish" timeout error.
    expect(taskResultSeen).toMatch(/sub-agent finished/i);
    expect(taskResultSeen).not.toMatch(/did not finish/i);
    expect(result.steps).toBe(2);
  });
});

describe('AgentRunner — Full Team mid-build steering (Fix 60)', () => {
  it('drains steerPoll at the step boundary: injects the message as a REAL user turn + emits the pickup ack', async () => {
    // Capture every model call's messages so we can PROVE the steered text reached the model.
    const seenCalls: Array<Array<{ role: string; content: unknown }>> = [];
    const client = new ClaudeClient({
      messages: {
        create: async (args: { messages: Array<{ role: string; content: unknown }> }) => {
          seenCalls.push(args.messages);
          return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' } as never;
        },
      },
    } as unknown as MessagesCreateClient);
    const actuator = new FakeActuator();
    const stream = new AgentEventStream();
    const events: AgentEvent[] = [];
    stream.subscribe((e) => events.push(e), false);
    const state = new WorkspaceState(stream);
    const dispatcher = new ToolDispatcher(actuator, 'ws-steer', state, stream);
    let drained = 0;
    const runner = new AgentRunner({
      client,
      dispatcher,
      state,
      events: stream,
      model: 'claude-opus-test',
      system: 'You are the Architect.',
      tools: defaultToolCatalog(),
      maxSteps: 2,
      // First boundary delivers one live message; afterwards the queue is empty (drained).
      steerPoll: () => (drained++ === 0 ? ['make the header red'] : []),
    });
    const result = await runner.run('build a notes app');
    expect(result.ok).toBe(true);
    // The steered text reached the FIRST model call as a user turn (not lost, not delayed a turn).
    const firstCall = seenCalls[0] ?? [];
    const steeredTurn = firstCall.find((m) => m.role === 'user' && JSON.stringify(m.content).includes('make the header red'));
    expect(steeredTurn).toBeTruthy();
    // And the user saw the honest "picked up" ack.
    const ack = events.find((e) => e.type === 'narration' && 'text' in e && String((e as { text: string }).text).includes('picked up your message'));
    expect(ack).toBeTruthy();
  });

  it('no steerPoll (every non-max tier) → zero behavior change (no ack, transcript untouched)', async () => {
    const { runner, events } = buildRunner([
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    ]);
    await runner.run('build a notes app');
    expect(events.some((e) => e.type === 'narration' && 'text' in e && String((e as { text: string }).text).includes('picked up your message'))).toBe(false);
  });
});

// === Slice 3 (QuizArena autopsy 2026-07-17) — step-limit AUTO-RESUME: pause, not death =============
describe('AgentRunner — step-limit auto-resume', () => {
  function resumeRunner(script: unknown[], opts: Partial<AgentRunnerOptions> = {}) {
    const actuator = new FakeActuator();
    const stream = new AgentEventStream();
    const events: AgentEvent[] = [];
    stream.subscribe((e) => events.push(e), false);
    const state = new WorkspaceState(stream);
    const dispatcher = new ToolDispatcher(actuator, 'ws-1', state, stream);
    // Deterministic gates: readiness says NOT ready (so the cap verdict is ok:false), and the
    // endgame's tsc is clean (so the endgame itself neither rescues nor interferes).
    let readinessCalls = 0;
    (dispatcher as unknown as { assessBuildReadiness: () => Promise<unknown> }).assessBuildReadiness =
      async () => (++readinessCalls === 1
        ? { score: 40, ready: false, blockers: ['1 broken import(s)'], warnings: [] } // at the cap
        : { score: 90, ready: true, blockers: [], warnings: [] }); // the extension fixed them
    (dispatcher as unknown as { endgameIo: () => unknown }).endgameIo = () => ({
      runTsc: async () => '',
      readFiles: async () => ({}),
      writeFile: async () => {},
    });
    const client = new ClaudeClient(scriptedClient(script));
    const runner = new AgentRunner({
      client, dispatcher, state, events: stream,
      model: 'claude-sonnet-test', system: 'You are the Architect.', tools: defaultToolCatalog(),
      maxSteps: 1, expectsArtifacts: true, readinessGate: true,
      ...opts,
    });
    return { runner, events };
  }
  const TOOL_TURN = {
    content: [{ type: 'text', text: 'Building.' }, { type: 'tool_use', id: 'tu1', name: 'write_file', input: { path: 'src/App.tsx', content: 'export default () => null;' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  const DONE_TURN = { content: [{ type: 'text', text: 'Finished the blockers.' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } };

  it('a NOT-ready build at the cap EXTENDS once, is steered at the blockers, and finishes', async () => {
    const { runner, events } = resumeRunner([TOOL_TURN, DONE_TURN]);
    const res = await runner.run('build an app');
    expect(res.ok).toBe(true); // died at the 1-step cap before this slice — now it finishes
    expect(res.steps).toBe(2); // one extra turn on the extension
    const resumeNote = events.find((e) => e.type === 'narration' && String((e as { text?: string }).text).includes('extending once'));
    expect(resumeNote).toBeTruthy();
  });

  it('AGENTV3_STEP_RESUME=off restores the old behavior byte-for-byte (dies at the cap)', async () => {
    process.env.AGENTV3_STEP_RESUME = 'off';
    try {
      const { runner } = resumeRunner([TOOL_TURN, DONE_TURN]);
      const res = await runner.run('build an app');
      expect(res.ok).toBe(false);
      // Dies at the cap (no auto-resume) — steps pinned to the cap; the user-facing summary is the short
      // plain message now (admin 2026-08-02) instead of the "Step limit reached" jargon.
      expect(res.summary).toMatch(/isn't fully working|still need fixing/i);
      expect(res.steps).toBe(1);
    } finally {
      delete process.env.AGENTV3_STEP_RESUME;
    }
  });

  it('a build that produced NOTHING never extends (chat-shaped failure stays a failure)', async () => {
    process.env.AGENTV3_STEP_RESUME = '2';
    try {
      const noTool = { content: [{ type: 'text', text: 'just chatting' }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } };
      const { runner } = resumeRunner([noTool, DONE_TURN]);
      const res = await runner.run('build an app');
      expect(res.ok).toBe(false); // builtSomething=false → no extension, honest failure
      expect(res.steps).toBe(1);
    } finally {
      delete process.env.AGENTV3_STEP_RESUME;
    }
  });
});

// Quiz-app autopsy 2026-07-17: the report said `builtBy: GLM` while every llmCalls row was labelled
// "claude-haiku…" — because onLlmCall recorded the REQUESTED model id, not the one that answered
// (TurnResult.model from the multi-provider chain). The two telemetry channels must agree.
describe('onLlmCall — actual-model attribution', () => {
  function runnerWith(client: { runTurn: (p: unknown) => Promise<unknown> }, onLlmCall: (c: { model: string }) => void) {
    const actuator = new FakeActuator();
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const dispatcher = new ToolDispatcher(actuator, 'ws-llm', state, stream);
    return new AgentRunner({
      client: client as never,
      dispatcher,
      state,
      events: stream,
      model: 'claude-haiku-test',
      system: 'You are the Architect.',
      tools: defaultToolCatalog(),
      onLlmCall: onLlmCall as never,
    });
  }

  it('records the model that ACTUALLY answered (a GLM rung), not the requested claude id', async () => {
    const models: string[] = [];
    const client = {
      runTurn: async () => ({
        text: 'done', toolUses: [], stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        rawContent: [{ type: 'text', text: 'done' }],
        model: 'glm-4.7', // the chain's cheap rung answered — this is what the report must say
      }),
    };
    await runnerWith(client, (c) => models.push(c.model)).run('build');
    expect(models).toEqual(['glm-4.7']);
  });

  it('falls back to the requested id when the runner does not report its model', async () => {
    const models: string[] = [];
    const client = {
      runTurn: async () => ({
        text: 'done', toolUses: [], stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        rawContent: [{ type: 'text', text: 'done' }],
      }),
    };
    await runnerWith(client, (c) => models.push(c.model)).run('build');
    expect(models).toEqual(['claude-haiku-test']);
  });
});

// ShopKhata autopsy 2026-07-17: a Vertex turn hit max_tokens (LLM_TRUNCATED) and its truncated
// write shipped a broken-brace controller — the warning was recorded but nothing ACTED on it, and the
// builder later burned minutes hand-hunting the brace with tail/wc/cat -A. The guard parses every
// file a truncated turn wrote and hands the exact parse failure back with the tool results.
describe('truncation guard — a max_tokens turn syntax-checks its own writes', () => {
  const BROKEN_JS = 'export async function createOrder(req, res) {\n  const x = 1;\n'; // missing braces
  const VALID_JS = 'export const ok = 1;\n';

  function turnWriting(content: string) {
    return {
      content: [
        { type: 'text', text: 'Writing the controller…' },
        { type: 'tool_use', id: 'tw1', name: 'write_file', input: { path: 'backend/src/controllers/orderController.js', content } },
      ],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 10, output_tokens: 10 },
    };
  }
  const DONE = { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };

  it('a BROKEN file written in a truncated turn triggers the rewrite steer', async () => {
    const { runner, events } = buildRunner([turnWriting(BROKEN_JS), DONE]);
    await runner.run('build the backend');
    const steer = events.find((e) => e.type === 'narration' && /cut off at the token limit/.test((e as { text?: string }).text ?? ''));
    expect(steer).toBeTruthy();
  });

  it('a VALID file written in a truncated turn stays silent (no false alarm)', async () => {
    const { runner, events } = buildRunner([turnWriting(VALID_JS), DONE]);
    await runner.run('build the backend');
    const steer = events.find((e) => e.type === 'narration' && /cut off at the token limit/.test((e as { text?: string }).text ?? ''));
    expect(steer).toBeUndefined();
  });
});
