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
    const result = await cappedRunner({ readiness: false, readinessGate: true }).run('build an app');
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('NOT ready');
    expect(result.summary).toContain('blank preview');
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
