import type { AgentEventStream } from './AgentEventStream';
import type { WorkspaceState } from './WorkspaceState';
import type { ClaudeToolDef, TurnRunner, TurnUsage, ToolUse } from './ClaudeClient';
import type { ToolDispatcher } from './ToolDispatcher';
import type { AgentRole } from './types';
import type { ConversationStore, ConversationStatus } from './ConversationStore';
import { billedAmountUsd } from './pricing';

/**
 * AgentRunner — the native tool-use loop (RC-1), the heart of P1.
 *
 * One run() drives a full build: call Claude → if it returns tool_use blocks,
 * execute them via the ToolDispatcher and feed the tool_results back → repeat
 * until the model ends its turn with no tools (task complete), or a guardrail
 * trips (step cap / budget cap). The transcript grows across turns (RC-2): the
 * assistant's raw blocks and the tool_results are appended verbatim so the model
 * always sees its own prior actions.
 *
 * Honest by construction: completion is the model ending its turn, a budget stop
 * is reported as ok:false with a clear reason, and tool failures flow back to the
 * model as is_error results — never a fake "done".
 */
export interface AgentRunnerOptions {
  client: TurnRunner;
  dispatcher: ToolDispatcher;
  state: WorkspaceState;
  events: AgentEventStream;
  model: string;
  system: string;
  tools: ClaudeToolDef[];
  /** Max model turns before the loop stops (backstop). Default 50. */
  maxSteps?: number;
  maxTokensPerTurn?: number;
  /** D6 — bill at the Only-Opus 5× rate instead of the standard 2.5×. */
  onlyOpus?: boolean;
  /** Enable Anthropic adaptive thinking (streams a thinking summary to the UI). */
  thinking?: boolean;
  /** Optional hard budget (USD billed to the user). Stops honestly when reached. */
  maxBudgetUsd?: number;
  /** Which agent this loop represents (for event attribution). Default 'architect'. */
  agentRole?: AgentRole;
  /**
   * True when this run is expected to PRODUCE artifacts (a build/edit), not just chat. When
   * set, a turn that ends with NO tool calls and where the run NEVER called a single tool is
   * reported as ok:false — a build that wrote nothing is a FAILED build, not a success. This
   * stops the "model replied instead of building, but it was billed as done" fake-success bug.
   */
  expectsArtifacts?: boolean;
  /** When aborted (e.g. the user pressed Stop), the loop stops between turns. */
  signal?: AbortSignal;
  /**
   * Optional durable persistence of the transcript (D7). When provided, the build is created
   * in the store at the start, the new transcript turns are appended as the loop runs, and the
   * final status/usage/billing is written when it ends — so the build survives a reconnect.
   * Persistence is ALWAYS best-effort: a store error is swallowed and never breaks the build.
   */
  persistence?: {
    store: ConversationStore;
    conversationId: string;
    userId: string;
    workspaceId: string;
    title: string;
    /** Injected clock (defaults to Date.now) — lets tests assert timestamps deterministically. */
    now?: () => number;
  };
  /**
   * Max tool calls to run CONCURRENTLY within a single turn's parallel-safe group (read-only
   * tools + review-only sub-agents). Default 4 — keeps concurrent Claude calls within rate
   * limits while still parallelising the review/test phase. Mutating tools always run serially.
   */
  toolConcurrency?: number;
}

// ── Parallel tool execution (capped) ───────────────────────────────────────────
// Read-only / side-effect-free tools — safe to run concurrently with each other.
const PARALLEL_SAFE_TOOLS = new Set<string>([
  'read_file', 'grep', 'glob', 'recall', 'evaluate', 'second_opinion', 'consensus',
]);
// Sub-agent (task) roles that only READ and REPORT (no write_file/edit) — safe to run in
// parallel. Builder/fixer roles (frontend, debugger, tester, …) WRITE, so they stay serial to
// avoid two agents editing the same file at once ("find in parallel, fix serially").
const PARALLEL_SAFE_TASK_ROLES = new Set<string>([
  'qa', 'security', 'performance', 'accessibility', 'reviewer', 'researcher', 'monitor',
]);

/**
 * A tool call is parallel-safe when it cannot mutate shared sandbox state: a read-only tool, or
 * a `task` spawn of a review-only specialist. Everything else (write/edit/bash, todo/preview
 * updates, generators, and builder sub-agents) runs serially.
 */
export function isParallelSafeToolUse(toolUse: ToolUse): boolean {
  if (toolUse.name === 'task') {
    const role = typeof toolUse.input?.role === 'string' ? toolUse.input.role : '';
    return PARALLEL_SAFE_TASK_ROLES.has(role);
  }
  return PARALLEL_SAFE_TOOLS.has(toolUse.name);
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(lanes);
  return results;
}

export interface AgentRunResult {
  ok: boolean;
  summary: string;
  steps: number;
  usage: TurnUsage;
  /** Amount billed to the user (D5/D6) for the whole run. */
  billedUsd: number;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  // A string, OR an Anthropic content-block array (used to attach a screenshot image so the
  // model can actually SEE the page it captured/drove — vision feedback for browser tools).
  content: string | Array<Record<string, unknown>>;
  is_error: boolean;
}

export class AgentRunner {
  constructor(private readonly opts: AgentRunnerOptions) {}

  async run(userPrompt: string): Promise<AgentRunResult> {
    const {
      client,
      dispatcher,
      events,
      model,
      system,
      tools,
      maxTokensPerTurn,
      onlyOpus,
      thinking,
      maxBudgetUsd,
    } = this.opts;
    const maxSteps = this.opts.maxSteps ?? 50;
    const agentRole: AgentRole = this.opts.agentRole ?? 'architect';
    const toolConcurrency = Math.max(1, this.opts.toolConcurrency ?? 4);
    const expectsArtifacts = this.opts.expectsArtifacts === true;
    // Total tool calls across the whole run — a build that never called a tool built nothing.
    let totalToolUses = 0;

    const messages: unknown[] = [{ role: 'user', content: userPrompt }];
    const usage: TurnUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };

    const billed = (): number =>
      billedAmountUsd({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, onlyOpus);

    // ── Durable persistence (D7), all best-effort — a store error never breaks the build. ──
    const persistence = this.opts.persistence;
    const now = persistence?.now ?? (() => Date.now());
    let persistedCount = 0;
    const persistCreate = async (): Promise<void> => {
      if (!persistence) return;
      try {
        await persistence.store.create({
          id: persistence.conversationId,
          userId: persistence.userId,
          workspaceId: persistence.workspaceId,
          title: persistence.title,
          messages: messages.slice(),
          createdAt: now(),
        });
        persistedCount = messages.length;
      } catch {
        /* persistence is best-effort */
      }
    };
    // Persist any transcript turns added since the last call, plus the latest usage/billing and
    // (optionally) a terminal status. Uses appendMessages when there are new turns, else update.
    const persist = async (status?: ConversationStatus): Promise<void> => {
      if (!persistence) return;
      try {
        const fresh = messages.slice(persistedCount);
        const patch = { usage: { ...usage }, billedUsd: billed(), updatedAt: now(), ...(status ? { status } : {}) };
        if (fresh.length) await persistence.store.appendMessages(persistence.conversationId, fresh, patch);
        else await persistence.store.update(persistence.conversationId, patch);
        persistedCount = messages.length;
      } catch {
        /* persistence is best-effort */
      }
    };
    await persistCreate();

    let steps = 0;
    try {
      while (steps < maxSteps) {
        steps++;

        // User pressed Stop (or the build was cancelled) — end honestly between turns.
        if (this.opts.signal?.aborted) {
          const summary = 'Build stopped by the user.';
          await persist('stopped');
          events.emit({ type: 'done', ok: false, summary, ts: Date.now() });
          return { ok: false, summary, steps, usage, billedUsd: billed() };
        }

        // A unique id for this turn — ties the streamed deltas to their final
        // narration line so the client can finalize (not duplicate) the line.
        const turnId = `t${steps}-${Date.now()}`;

        const turn = await client.runTurn({
          model,
          system,
          messages,
          tools,
          maxTokens: maxTokensPerTurn,
          thinking,
          onText: (delta) =>
            events.emit({ type: 'stream_delta', agent: agentRole, id: turnId, kind: 'text', delta, ts: Date.now() }),
          onThinking: (delta) =>
            events.emit({ type: 'stream_delta', agent: agentRole, id: turnId, kind: 'thinking', delta, ts: Date.now() }),
        });

        usage.inputTokens += turn.usage.inputTokens;
        usage.outputTokens += turn.usage.outputTokens;
        usage.cacheCreationInputTokens += turn.usage.cacheCreationInputTokens;
        usage.cacheReadInputTokens += turn.usage.cacheReadInputTokens;

        if (turn.text.trim()) {
          events.emit({ type: 'narration', agent: agentRole, text: turn.text, ts: Date.now(), id: turnId });
        }

        // Record the assistant turn verbatim so tool_use ids resolve next turn.
        messages.push({ role: 'assistant', content: turn.rawContent });

        // No tools requested → the model has finished its turn.
        if (turn.toolUses.length === 0) {
          // A build/edit that NEVER called a single tool produced nothing — that is a FAILED
          // build, not a success. Reporting ok:true here is the fake-success bug (the model
          // replies "I'm preparing a plan…" instead of building, and gets billed as done).
          // Only treat a no-tool turn as success for chat, or when real work already happened.
          const builtNothing = expectsArtifacts && totalToolUses === 0;
          const ok = !builtNothing;
          const summary = builtNothing
            ? (turn.text.trim()
                ? `${turn.text.trim()}\n\n(No files were created — the build did not run. Retrying with a stronger model…)`
                : 'The build did not produce any files — the model replied without building.')
            : (turn.text.trim() || 'Build complete.');
          await persist(ok ? 'complete' : 'error');
          events.emit({ type: 'done', ok, summary, ts: Date.now() });
          return { ok, summary, steps, usage, billedUsd: billed() };
        }
        totalToolUses += turn.toolUses.length;

        // Execute the requested tools and gather results (in the original order, so tool_use
        // ids resolve). Mutating tools (write/edit/bash, builder sub-agents) run SERIALLY and
        // first; independent read-only work and review-only sub-agents then run in a
        // concurrency-capped PARALLEL group — so the review/test phase finishes far faster
        // ("find in parallel, fix serially"). Each is dispatched once; order is preserved.
        const resultBlocks: ToolResultBlock[] = new Array(turn.toolUses.length);
        const toBlock = (r: { tool_use_id: string; content: string; is_error: boolean; image?: { base64: string; mimeType: string } }): ToolResultBlock => ({
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          // When a browser tool returns a screenshot, feed it back as an image block so the
          // model can SEE the result (vision), alongside the text summary.
          content: r.image
            ? [
                { type: 'text', text: r.content },
                { type: 'image', source: { type: 'base64', media_type: r.image.mimeType, data: r.image.base64 } },
              ]
            : r.content,
          is_error: r.is_error,
        });
        const serialIdx: number[] = [];
        const parallelIdx: number[] = [];
        turn.toolUses.forEach((tu, i) => (isParallelSafeToolUse(tu) ? parallelIdx : serialIdx).push(i));
        for (const i of serialIdx) {
          resultBlocks[i] = toBlock(await dispatcher.dispatch(turn.toolUses[i], agentRole));
        }
        if (parallelIdx.length > 0) {
          await mapWithConcurrency(parallelIdx, toolConcurrency, async (i) => {
            resultBlocks[i] = toBlock(await dispatcher.dispatch(turn.toolUses[i], agentRole));
          });
        }
        messages.push({ role: 'user', content: resultBlocks });

        // Budget guardrail (CostGuard / D5) — stop honestly, never silently.
        if (maxBudgetUsd !== undefined && billed() >= maxBudgetUsd) {
          const summary = `Budget reached ($${billed().toFixed(4)} of $${maxBudgetUsd.toFixed(2)}). Stopped.`;
          await persist('stopped');
          events.emit({ type: 'done', ok: false, summary, ts: Date.now() });
          return { ok: false, summary, steps, usage, billedUsd: billed() };
        }

        // Mid-build checkpoint: the turn (assistant + tool results) is persisted so a reconnect
        // resumes from here, not from the start.
        await persist('running');
      }

      const summary = `Step limit reached (${maxSteps}). Stopped without completing.`;
      await persist('stopped');
      events.emit({ type: 'done', ok: false, summary, ts: Date.now() });
      return { ok: false, summary, steps, usage, billedUsd: billed() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await persist('error');
      events.emit({ type: 'error', message, ts: Date.now() });
      return { ok: false, summary: `Error: ${message}`, steps, usage, billedUsd: billed() };
    }
  }
}
