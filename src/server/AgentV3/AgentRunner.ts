import type { AgentEventStream } from './AgentEventStream';
import type { WorkspaceState } from './WorkspaceState';
import type { ClaudeToolDef, TurnRunner, TurnUsage, ToolUse, TurnResult } from './ClaudeClient';
import type { ToolDispatcher } from './ToolDispatcher';
import type { AgentRole } from './types';
import type { ConversationStore, ConversationStatus } from './ConversationStore';
import { compactMessagesForPersist, compactTranscriptForModel } from './SessionTimeline';
import { billedAmountUsd } from './pricing';
import type { UsageSink } from './UsageSink';
import { withTimeout } from './asyncUtils';
import { weakCheckpointConfig, shouldRunWeakCheckpoint, weakCheckpointSteer } from './weakBuildCheckpoint';
import { endgameRepairEnabled, runEndgameRepair, errorTrendConfig, shouldTriggerMidBuildRepair, parseTscErrors, stepResumeBudget } from './EndgameRepair';
import { PARALLEL_WRITER_ROLES } from './parallelBuild';
import { repairSystemPrompt, repairUserPrompt } from './SimpleBuilder';
import { parseFileBlocks } from './OneShotBuilder';
import { findSyntaxErrors } from './SyntaxCheck';
import { textMarkerFilePaths, truncationRecoverySteer, truncationRecoveryNarration } from './TruncationRecovery';
import { newRepeatProbeState, collectRepeatProbeSteer, loopGuardEnabled, loopGuardThreshold } from './RepeatProbeGuard';
import { envFlag, envKillSwitch } from '../lib/envFlag';
import { missingFeatureNotice } from './missingFeatureNotice';

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
  /** AP-4 (flag-gated, default off): allow frontend/backend WRITER sub-agents to run in parallel. Safe
   *  only when the actuator is wrapped with the per-path write lock (lockedActuator) — the caller pairs
   *  the two. When false/unset, writer sub-agents dispatch serially exactly as before. */
  parallelBuild?: boolean;
  /** D6 — bill at the Only-Opus rate instead of the standard rate. Legacy boolean. */
  onlyOpus?: boolean;
  /**
   * Power level for billing + Opus reasoning effort (admin override 2026-06-27):
   * 'off' (Sonnet×3.5) | 'mini' (Opus low, ×5) | 'medium' (Opus medium, ×10) |
   * 'max' (Opus max, ×20). When set it takes precedence over `onlyOpus` for billing.
   */
  powerLevel?: 'weak' | 'off' | 'mini' | 'medium' | 'max';
  /** Opus reasoning effort (output_config.effort) for every turn. Omitted → model default. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /**
   * Full Team mid-build steering (Fix 60, admin 2026-07-13). Polled at every step boundary; returns
   * (and drains) the user messages sent WHILE the build runs. Each is injected as a REAL user turn so
   * the very next model call acts on it — the Claude-Code-style "talk to the team while it builds".
   * The route wires this only for the FULL TEAM ('max') tier; omitted elsewhere (no behavior change).
   */
  steerPoll?: () => string[];
  /** Enable Anthropic adaptive thinking (streams a thinking summary to the UI). */
  thinking?: boolean;
  /** Optional hard budget (USD billed to the user). Stops honestly when reached. */
  maxBudgetUsd?: number;
  /**
   * WATCHDOG — optional hard WALL-CLOCK cap (ms) on the whole build. Checked between turns: once a
   * build has run this long it stops honestly with whatever it produced, instead of looping for
   * 20-30 minutes (e.g. when a broken preview can't be verified). 0/undefined = no time cap.
   */
  maxBuildMs?: number;
  /**
   * E4 — per-model-turn hard timeout (ms). The wall-clock watchdog above is only checked BETWEEN
   * turns, so a single provider call that hangs (connection open, no bytes, no error) would block the
   * whole build indefinitely — the watchdog never even gets to run. This caps every `runTurn` so a
   * stalled provider stops the build honestly (respecting whatever was already built) instead of
   * hanging. Default 8 min — comfortably above any legitimate single turn. 0/undefined disables it.
   */
  turnTimeoutMs?: number;
  /**
   * E4 — per-tool hard timeout (ms). A single stuck tool call (a hung sandbox command, a stalled
   * provider-backed review) can otherwise block a turn forever. On timeout the tool returns an honest
   * is_error result to the model (never a throw) so the build survives and can route around it. The
   * `task` sub-agent tool is EXEMPT — it is self-bounded by its own runner's watchdog/budget, and a
   * cap here would wrongly kill a legitimate long sub-agent build. Default 10 min. 0/undefined disables it.
   */
  toolTimeoutMs?: number;
  /** Which agent this loop represents (for event attribution). Default 'architect'. */
  agentRole?: AgentRole;
  /**
   * True when this run is expected to PRODUCE artifacts (a build/edit), not just chat. When
   * set, a turn that ends with NO tool calls and where the run NEVER called a single tool is
   * reported as ok:false — a build that wrote nothing is a FAILED build, not a success. This
   * stops the "model replied instead of building, but it was billed as done" fake-success bug.
   */
  expectsArtifacts?: boolean;
  /**
   * Slice 2 (weak-tier checkpoint) — true on a WEAK / cheap-only build (the route threads its
   * `noClaudeBuild` signal here). When set AND AGENTV3_WEAK_CHECKPOINT=on, the loop runs the free
   * deterministic readiness scan every N steps and injects ONE corrective steer for a
   * completeness-independent build-breaker (server-only Node lib in the browser, high-severity
   * security) so the weak model fixes it mid-build instead of drifting to the step cap. Off / non-weak
   * builds never run it, so behaviour is unchanged. See weakBuildCheckpoint.ts.
   */
  weakBuild?: boolean;
  /**
   * R2 §1.1 — when true (top-level build only, never sub-agents), the loop runs the objective
   * `evaluate` readiness scan before reporting a successful build, and DOWNGRADES ok:true →
   * ok:false if the verdict is not ready (a build-breaker, secret leak, fake code, or an app
   * that cannot run). Makes the quality gate MANDATORY instead of "only if the agent calls it",
   * so "done" means verified. Off by default; never applied to sub-agents.
   */
  readinessGate?: boolean;
  /**
   * U-1 — when true, run the project's ESLint after a successful build and downgrade to ok:false if it
   * reports real ERRORS (warnings/formatting never block). Default-OFF (admin flag AGENTV3_LINT_GATE),
   * so the default build is byte-identical. Top-level builds only; never applied to sub-agents.
   */
  lintGate?: boolean;
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
  /**
   * AI Diagnosis Bundle #4 — called after EVERY model turn with that turn's I/O shape (model,
   * prompt/response sizes + a head preview, finish reason, tokens, latency, ok/error). The
   * composition root forwards it to BuildDiagnostics.recordLlmCall so a truncated (max_tokens)
   * or failed model turn is captured. Best-effort; a throw here never breaks the build.
   */
  onLlmCall?: (call: {
    model: string;
    promptPreview: string;
    promptChars: number;
    responsePreview: string;
    responseChars: number;
    finishReason: string | null;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    ok: boolean;
    error?: string;
  }) => void;
  /**
   * Build-level token accumulator (billing accounting fix). When provided, EVERY turn's tokens are
   * added here as well as to this runner's own `usage`. The SAME sink is shared across the main
   * runner, every sub-agent, and every heal/fix/escalation runner so the final charge reflects the
   * whole build's real spend — not just one runner's turns. Best-effort; never affects the run.
   */
  usageSink?: UsageSink;
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
 * updates, generators) runs serially.
 *
 * AP-4 (opts.parallelBuild, flag-gated): when parallel building is enabled, the WRITER task roles
 * (frontend/backend) also become parallel-eligible — their same-path file writes are serialized by the
 * lockedActuator write-lock and disjoint paths run concurrently, so two builder sub-agents can work at
 * once safely. Default OFF ⇒ writers stay serial exactly as before.
 */
export function isParallelSafeToolUse(toolUse: ToolUse, opts?: { parallelBuild?: boolean }): boolean {
  if (toolUse.name === 'task') {
    const role = typeof toolUse.input?.role === 'string' ? toolUse.input.role : '';
    if (PARALLEL_SAFE_TASK_ROLES.has(role)) return true;
    return opts?.parallelBuild === true && PARALLEL_WRITER_ROLES.has(role);
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

/** WATCHDOG — true once a build has run past its wall-clock cap (pure, testable). */
export function buildTimedOut(startMs: number, maxBuildMs: number | undefined, nowMs: number): boolean {
  return typeof maxBuildMs === 'number' && maxBuildMs > 0 && nowMs - startMs >= maxBuildMs;
}

export interface AgentRunResult {
  ok: boolean;
  summary: string;
  steps: number;
  usage: TurnUsage;
  /** Amount billed to the user (D5/D6) for the whole run. */
  billedUsd: number;
  /** T1-budget-ux: the run stopped ONLY because it hit the per-build budget cap (work is saved and the
   *  build can be continued — a fresh run gets a fresh budget window). Lets the client show an honest
   *  "budget reached — continue" state instead of a hard failure. */
  budgetReached?: boolean;
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
      powerLevel,
      effort,
      thinking,
      maxBudgetUsd,
    } = this.opts;
    // Bill by explicit power level when set; else fall back to the legacy onlyOpus boolean.
    const billingPower = powerLevel ?? onlyOpus;
    const maxSteps = this.opts.maxSteps ?? 50;
    const agentRole: AgentRole = this.opts.agentRole ?? 'architect';
    const toolConcurrency = Math.max(1, this.opts.toolConcurrency ?? 4);
    const expectsArtifacts = this.opts.expectsArtifacts === true;
    const readinessGate = this.opts.readinessGate === true;
    const lintGate = this.opts.lintGate === true;
    // P-PIPE — build-end dependency-health advisory (OSV/CVE + strong-copyleft). Default-OFF admin flag
    // (AGENTV3_DEPHEALTH_GATE=on); read here directly (self-contained) rather than threaded via opts since it
    // is advisory-only and never influences build control flow. When on, it appends an advisory block to a
    // successful build's summary — it NEVER blocks or fails a build.
    const depHealthGate = envFlag('AGENTV3_DEPHEALTH_GATE');
    // Cap-4 injection — deterministically add a /health route to an Express entry that lacks one, at
    // build-end. Default-OFF admin flag (AGENTV3_OBSERVABILITY_INJECT=on); read here directly (self-contained,
    // advisory-adjacent). Purely additive + persisted via the durable write path; it NEVER blocks a build.
    const observabilityInject = envFlag('AGENTV3_OBSERVABILITY_INJECT');
    // P-PIPE — build-end PRETTIER advisory. Default-OFF admin flag (AGENTV3_PRETTIER_GATE=on); read here
    // directly (self-contained, advisory-only). When on, it appends a non-blocking "N file(s) need
    // formatting" note to a successful build's summary — it NEVER blocks or fails a build.
    const prettierGate = envFlag('AGENTV3_PRETTIER_GATE');
    const maxBuildMs = this.opts.maxBuildMs;
    // E4 — per-turn / per-tool hard caps so a single hung call can't block the build. Defaults are
    // generous ceilings (no legitimate turn/tool reaches them); 0 disables an individual cap.
    const turnTimeoutMs = this.opts.turnTimeoutMs ?? 8 * 60_000;
    const toolTimeoutMs = this.opts.toolTimeoutMs ?? 10 * 60_000;
    // A1 — model-side transcript compaction knobs (env-tunable). keepRecent messages go verbatim;
    // older large tool_results are head+tail trimmed to maxOldToolResultChars. Generous defaults so
    // in-flight work is never touched and only genuinely-stale large file dumps shrink.
    const modelKeepRecent = Math.max(2, parseInt(process.env.AGENTV3_MODEL_COMPACT_KEEP_RECENT || '', 10) || 6);
    const modelMaxOldToolResultChars = Math.max(500, parseInt(process.env.AGENTV3_MODEL_COMPACT_MAX_CHARS || '', 10) || 2_000);
    const buildStartMs = Date.now();
    // Total tool calls across the whole run — a build that never called a tool built nothing.
    let totalToolUses = 0;
    // How many times we've nudged a build that only NARRATED (described its plan / said it would
    // "assign the frontend expert") without calling a single tool. The model often plans out loud
    // on its first turn; terminating there is the "model replied without building" bug. We instead
    // push it to ACT, up to this cap (then give up honestly to avoid an endless narration loop).
    let noBuildNudges = 0;
    const MAX_BUILD_NUDGES = 2;

    const messages: unknown[] = [{ role: 'user', content: userPrompt }];
    // Wall-clock CREATION time of each message, parallel to `messages` (which stays exactly the
    // Claude-API shape — never mutated). Persisted copies are stamped from this so a reopened
    // session interleaves prose with the timeline in the LIVE order: the assistant message is
    // created BEFORE its tools run, but the whole turn is only written AFTER they finish — an
    // end-of-write stamp made every reopened turn read backwards (action rows above their prose).
    const messageTs: number[] = [Date.now()];
    const usage: TurnUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };

    const billed = (): number =>
      billedAmountUsd({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, billingPower);

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
          messages: compactMessagesForPersist(messages).map((m, i) =>
            m && typeof m === 'object' && (m as { ts?: unknown }).ts === undefined ? { ...m, ts: messageTs[i] ?? now() } : m,
          ),
          createdAt: now(),
        });
        persistedCount = messages.length;
      } catch {
        /* persistence is best-effort */
      }
    };
    // Stamp persisted message COPIES with their real creation time (from messageTs) so a reopened
    // session interleaves prose with the durable timeline in the LIVE order. The live `messages`
    // array is never touched — it stays exactly the Claude-API shape the model consumes.
    const stampForPersist = (msgs: unknown[], startIdx: number, fallback: number): unknown[] =>
      msgs.map((m, i) =>
        m && typeof m === 'object' && (m as { ts?: unknown }).ts === undefined
          ? { ...m, ts: messageTs[startIdx + i] ?? fallback }
          : m,
      );
    // Persist any transcript turns added since the last call, plus the latest usage/billing and
    // (optionally) a terminal status. Uses appendMessages when there are new turns, else update.
    // Every persisted turn is COMPACTED first (base64 screenshots stripped, giant tool payloads
    // truncated) so a single turn can't exceed the store's per-write limit — and if a write still
    // fails, an unwritable (poison) slice is SKIPPED with an honest marker instead of stalling
    // persistence forever. A tiny marker write is the discriminator between "this slice is
    // unwritable" and "the store is down": if even the marker fails, persistedCount is NOT
    // advanced, so the next persist retries the whole slice — a transient outage self-heals
    // exactly like it did before this hardening.
    const persist = async (status?: ConversationStatus): Promise<void> => {
      if (!persistence) return;
      const startIdx = persistedCount;
      const fresh = messages.slice(startIdx);
      const patch = { usage: { ...usage }, billedUsd: billed(), updatedAt: now(), ...(status ? { status } : {}) };
      const append = async (payload: unknown[]): Promise<void> => {
        if (payload.length) await persistence.store.appendMessages(persistence.conversationId, stampForPersist(payload, startIdx, patch.updatedAt), patch);
        else await persistence.store.update(persistence.conversationId, patch);
        persistedCount = messages.length;
      };
      try {
        await append(compactMessagesForPersist(fresh));
      } catch {
        try {
          // Second chance: much smaller payload bounds.
          await append(compactMessagesForPersist(fresh, { aggressive: true }));
        } catch {
          if (fresh.length) {
            try {
              await persistence.store.appendMessages(
                persistence.conversationId,
                [{ role: 'assistant', content: `[${fresh.length} build step(s) were too large to save and were omitted from the saved transcript]`, ts: patch.updatedAt }],
                patch,
              );
              // The store accepted a write → the slice itself is the problem. Skip it so the
              // transcript keeps growing and the final status lands.
              persistedCount = messages.length;
            } catch { /* store unreachable — keep persistedCount so the next persist retries */ }
          }
        }
      }
    };
    await persistCreate();

    // Slice 2 — weak-tier mid-build checkpoint state. Config is read once (env is stable per build);
    // the counters advance in the loop. Inert unless this is a weak build AND AGENTV3_WEAK_CHECKPOINT=on.
    const weakBuild = this.opts.weakBuild === true;
    const weakCkptCfg = weakCheckpointConfig();
    let checkpointNudges = 0;
    // Slice 2 — mid-build ERROR-TREND checkpoint (QuizArena autopsy, admin-mandated): every
    // `interval` steps peek at the tsc error count; two flat/rising non-zero peeks = the builder is
    // grinding, not converging → fire the endgame repair NOW (once per run) instead of at the cap.
    const trendCfg = errorTrendConfig();
    const trendCounts: number[] = [];
    let trendFired = false;
    // Slice 3 — step-limit AUTO-RESUME ("pause, not death"): a NOT-ready build at the cap gets a
    // bounded extension (default 1 × half the base cap; AGENTV3_STEP_RESUME=off disables) instead of
    // dying. The wall-clock watchdog still rules over everything, so this can never run away.
    let stepCap = maxSteps;
    let stepResumesLeft = stepResumeBudget();
    // ONE bounded batch repair call, shared by the trend checkpoint and the step-cap endgame.
    const endgameBatchRepair = async (errorText: string, files: Array<{ path: string; content: string }>) => {
      const turn = await client.runTurn({
        model,
        system: repairSystemPrompt(dispatcher.frameworkId),
        messages: [{ role: 'user', content: repairUserPrompt(userPrompt, errorText, files) }],
        maxTokens: maxTokensPerTurn,
      });
      return parseFileBlocks(turn.text ?? '');
    };

    let steps = 0;
    // LOOP BREAKER (repeated-probe autopsy 2026-07-21): one state per build run. When the model re-issues
    // the EXACT same non-progressing tool call to the threshold, inject a corrective steer so it changes
    // approach instead of looping to the step cap (a weak build ran the same empty grep ~6 times → ok:None).
    const repeatProbe = newRepeatProbeState();
    const loopGuardOn = loopGuardEnabled();
    const loopThreshold = loopGuardThreshold();
    try {
      // eslint-disable-next-line no-labels
      stepResumeLoop: for (;;) {
      while (steps < stepCap) {
        steps++;

        // User pressed Stop (or the build was cancelled) — end honestly between turns.
        if (this.opts.signal?.aborted) {
          const summary = 'Build stopped by the user.';
          await persist('stopped');
          events.emit({ type: 'done', ok: false, summary, ts: Date.now() });
          return { ok: false, summary, steps, usage, billedUsd: billed() };
        }

        // WATCHDOG — wall-clock cap. Once the build has run past its time limit, stop honestly with
        // whatever was produced instead of looping for 20-30 minutes. A build that DID write files is
        // reported ok:true (the work is real and resumable); one that produced nothing is ok:false.
        if (buildTimedOut(buildStartMs, maxBuildMs, Date.now())) {
          const minutes = Math.round((maxBuildMs as number) / 60000);
          const builtSomething = totalToolUses > 0;
          const summary = builtSomething
            ? `I stopped after about ${minutes} min to avoid an endless loop. Your files so far are saved — send another message and I'll continue from here.`
            : `I stopped after about ${minutes} min — the build wasn't making progress (often a preview that won't come up). Nothing was lost; try again or rephrase.`;
          await persist(builtSomething ? 'complete' : 'stopped');
          events.emit({ type: 'done', ok: builtSomething, summary, ts: Date.now() });
          return { ok: builtSomething, summary, steps, usage, billedUsd: billed() };
        }

        // Full Team mid-build steering (Fix 60): drain the messages the user sent while the team was
        // working and inject each as a REAL user turn, so this very model call acts on them. The
        // narration ack is the honest "picked up" signal (the route already acked "queued" instantly).
        const steered = this.opts.steerPoll?.() ?? [];
        for (const sm of steered) {
          messages.push({ role: 'user', content: `[USER MESSAGE — sent live during the build. Fold this into the current work without discarding progress.]\n${sm}` });
          events.emit({ type: 'narration', agent: agentRole, text: `📨 The team picked up your message: “${sm.slice(0, 160)}${sm.length > 160 ? '…' : ''}”`, ts: Date.now() });
        }

        // A unique id for this turn — ties the streamed deltas to their final
        // narration line so the client can finalize (not duplicate) the line.
        const turnId = `t${steps}-${Date.now()}`;

        // #4 — what we're about to ask: a head preview of the prompt (system + the latest turn).
        const lastMsg = messages[messages.length - 1] as { content?: unknown } | undefined;
        const lastMsgText = typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content ?? '');
        const promptPreview = `${system ?? ''}\n---\n${lastMsgText}`;
        const llmStartedAt = Date.now();
        let turn: TurnResult;
        try {
          // E4 — cap the model call so a hung provider (socket open, no bytes, no error) can't block
          // the whole build. The wall-clock watchdog only runs BETWEEN turns, so without this a single
          // stalled turn would never return control to it.
          // A1 — bound the transcript SENT to the model (recent turns verbatim, older large
          // tool_results head+tail trimmed). The full `messages` array is untouched (persistence +
          // the next turn's own compaction both read from it), so this only shrinks the network
          // payload — the fix for the 233KB prompt that timed out the cheap floor. No-op on a small
          // build. Disabled by setting transcriptKeepRecent to 0 turns is not offered; instead
          // AGENTV3_MODEL_COMPACT=off bypasses entirely for a clean A/B if ever needed.
          const modelMessages = envKillSwitch('AGENTV3_MODEL_COMPACT')
            ? messages
            : compactTranscriptForModel(messages, { keepRecentMessages: modelKeepRecent, maxOldToolResultChars: modelMaxOldToolResultChars });
          const turnCall = client.runTurn({
            model,
            system,
            messages: modelMessages,
            tools,
            maxTokens: maxTokensPerTurn,
            thinking,
            effort,
            onText: (delta) =>
              events.emit({ type: 'stream_delta', agent: agentRole, id: turnId, kind: 'text', delta, ts: Date.now() }),
            onThinking: (delta) =>
              events.emit({ type: 'stream_delta', agent: agentRole, id: turnId, kind: 'thinking', delta, ts: Date.now() }),
          });
          turn = turnTimeoutMs > 0
            ? await withTimeout(turnCall, turnTimeoutMs, `model turn ${steps}`)
            : await turnCall;
        } catch (err) {
          // #4 — capture the FAILED model turn before it propagates (provider error, timeout, …).
          try {
            this.opts.onLlmCall?.({
              model, promptPreview, promptChars: promptPreview.length,
              responsePreview: '', responseChars: 0, finishReason: null, toolCalls: 0,
              inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - llmStartedAt,
              ok: false, error: err instanceof Error ? err.message : String(err),
            });
          } catch { /* diagnostics capture is best-effort */ }
          // E4 — a per-turn TIMEOUT is a stalled provider, not a code error: stop honestly (respecting
          // whatever was already built, exactly like the wall-clock watchdog) instead of blocking or
          // reporting a hard crash. Any other error keeps the existing propagate → outer-catch path.
          const isTurnTimeout = err instanceof Error && /timed out after/.test(err.message);
          if (isTurnTimeout) {
            const minutes = Math.max(1, Math.round(turnTimeoutMs / 60000));
            const builtSomething = totalToolUses > 0;
            const summary = builtSomething
              ? `A model response stalled and was stopped after about ${minutes} min. Your files so far are saved — send another message and I'll continue from here.`
              : `The model didn't respond in time (stalled after about ${minutes} min). Nothing was lost — please try again.`;
            await persist(builtSomething ? 'complete' : 'error');
            events.emit({ type: 'done', ok: builtSomething, summary, ts: Date.now() });
            return { ok: builtSomething, summary, steps, usage, billedUsd: billed() };
          }
          throw err;
        }
        // #4 — capture the successful model turn (finish reason 'max_tokens' = truncated output).
        // Quiz-app autopsy 2026-07-17: record the model that ACTUALLY answered (TurnResult.model —
        // e.g. a GLM rung behind the multi-provider chain), not the requested id, so the report's
        // llmCalls agree with providerDelivery/builtBy instead of labelling a GLM turn "claude-haiku".
        // The requested id stays the fallback for runners that don't report their model.
        try {
          this.opts.onLlmCall?.({
            model: turn.model ?? model, promptPreview, promptChars: promptPreview.length,
            responsePreview: turn.text, responseChars: turn.text.length,
            finishReason: turn.stopReason, toolCalls: turn.toolUses.length,
            inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens,
            latencyMs: Date.now() - llmStartedAt, ok: true,
          });
        } catch { /* diagnostics capture is best-effort */ }

        usage.inputTokens += turn.usage.inputTokens;
        usage.outputTokens += turn.usage.outputTokens;
        usage.cacheCreationInputTokens += turn.usage.cacheCreationInputTokens;
        usage.cacheReadInputTokens += turn.usage.cacheReadInputTokens;
        // Billing accounting fix: feed the shared build-level sink so this turn's tokens are billed
        // even when this runner is a sub-agent or a heal/fix run whose `result` is later discarded.
        this.opts.usageSink?.add({ inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens });

        if (turn.text.trim()) {
          events.emit({ type: 'narration', agent: agentRole, text: turn.text, ts: Date.now(), id: turnId });
        }

        // Record the assistant turn verbatim so tool_use ids resolve next turn. Its creation time
        // is NOW — before its tools run — which is what keeps the reopened order faithful.
        messages.push({ role: 'assistant', content: turn.rawContent });
        messageTs.push(Date.now());

        // No tools requested → the model has finished its turn.
        if (turn.toolUses.length === 0) {
          // NUDGE-TO-BUILD: a build/edit that only NARRATED a plan ("here's my plan… now I'll
          // assign the frontend expert to create index.html") without calling a single tool has
          // not actually built anything — but the model usually intends to act on the NEXT turn.
          // Terminating here is the "model replied without building" failure (even Opus does it).
          // So instead of giving up, push the model to ACT and give it another turn (capped).
          if (expectsArtifacts && totalToolUses === 0 && noBuildNudges < MAX_BUILD_NUDGES) {
            noBuildNudges++;
            messages.push({
              role: 'user',
              content:
                'You described a plan but have not created any files yet. Do NOT just describe or ' +
                'delegate in prose — ACT NOW: use the tools (write_file / write_files_batch, and run ' +
                'commands as needed) to actually create the project files this turn. Start by writing ' +
                'the entry file (e.g. index.html or src/main). Output tool calls, not a description.',
            });
            messageTs.push(Date.now());
            continue; // give the model another turn to actually build
          }
          // A build/edit that NEVER called a single tool produced nothing — that is a FAILED
          // build, not a success. Reporting ok:true here is the fake-success bug (the model
          // replies "I'm preparing a plan…" instead of building, and gets billed as done).
          // Only treat a no-tool turn as success for chat, or when real work already happened.
          const builtNothing = expectsArtifacts && totalToolUses === 0;
          let ok = !builtNothing;
          let summary = builtNothing
            ? (turn.text.trim()
                ? `${turn.text.trim()}\n\n(No files were created — the build did not run. Retrying with a stronger model…)`
                : 'The build did not produce any files — the model replied without building.')
            : (turn.text.trim() || 'Build complete.');

          // R2 §1.1 — MANDATORY readiness gate (top-level build only). Before reporting a
          // successful build, run the objective evaluate scan; if it is NOT ready (a build-
          // breaker, secret leak, fake code, or an app that cannot run), DOWNGRADE to ok:false
          // with an honest summary of the blockers. The work is preserved (files/preview still
          // exist) — we simply refuse to claim success that wasn't earned ("Preview is EARNED").
          // When escalation is active, this ok:false is exactly what triggers a stronger retry.
          let buildHealth: { score: number; ready: boolean; blockers: string[]; warnings: string[]; tier: string } | undefined;
          if (ok && readinessGate && expectsArtifacts && totalToolUses > 0) {
            try {
              // HEAL-THEN-JUDGE (CLAUDE.md 50/50 law): make orphaned pages reachable BEFORE the gate
              // judges them — a page the builder created but forgot to route is wired into <Routes>
              // deterministically, so it stops being an orphan blocker instead of merely being reported.
              try { const w = await dispatcher.healOrphanPages(); if (w) events.emit({ type: 'narration', agent: 'architect', text: w, ts: Date.now() }); } catch { /* heal is best-effort — never fails a build */ }
              // Redact credential-logging console statements BEFORE the gate scans compliance — a single
              // pii-in-logs line is the gate's only high-severity privacy/compliance HARD block, so a
              // complete app was failing on one debug log. Deterministic, non-breaking, best-effort.
              try { const c = await dispatcher.healCredentialLogs(); if (c) events.emit({ type: 'narration', agent: 'architect', text: c, ts: Date.now() }); } catch { /* heal is best-effort — never fails a build */ }
              const readiness = await dispatcher.assessBuildReadiness();
              // Surface the verdict to the UI as a build-health card (R2 §4.6) — pass or fail.
              buildHealth = { score: readiness.score, ready: readiness.ready, blockers: readiness.blockers, warnings: readiness.warnings, tier: readiness.tier };
              if (!readiness.ready) {
                ok = false;
                // USER-FACING SUMMARY = SHORT + PLAIN (admin 2026-08-02: "isko simple short karo"). The raw
                // technical blockers (file:line, babel code frames like `Duplicate declaration ErrorBoundary`,
                // Rules-of-Hooks paths) AND the model's long, possibly-overstating "here's everything I built"
                // prose are developer NOISE to a non-technical user — a wall of text on a failed build. They
                // are NOT lost: the exact blockers ride the build-health card (buildHealth.blockers) and the
                // admin build report (rootCause / problems / issues structured fields), and the route appends
                // the actionable next step (e.g. the weak-tier "switch to a stronger tier" guidance). The user
                // just gets one honest, calm headline. AGENTV3_VERBOSE_READINESS=on restores the old detailed
                // summary (blockers dump + labelled agent prose) for deep debugging.
                if ((process.env.AGENTV3_VERBOSE_READINESS ?? '').trim().toLowerCase() === 'on') {
                  const blockers = readiness.blockers.length
                    ? ` Must fix before it's production-ready: ${readiness.blockers.join('; ')}.`
                    : '';
                  const claim = turn.text.trim();
                  const claimBlock = claim
                    ? `\n\n———\nWhat the agent reported (may overstate — the readiness verdict above is the real status):\n\n${claim}`
                    : '';
                  summary = `⚠️ Readiness gate: NOT READY — score ${readiness.score}/100. This build is not production-ready yet.${blockers}${claimBlock}`;
                } else {
                  summary = `⚠️ This app isn't fully working yet — a couple of things still need fixing before it's ready to use.`;
                }
              }
            } catch { /* gate is best-effort — a scan error never fails a real build */ }
          }

          // U-1 — LintGate (default-OFF): after a still-successful build, block on real ESLint errors.
          if (ok && lintGate && expectsArtifacts && totalToolUses > 0) {
            try {
              const lint = await dispatcher.assessLintGate();
              if (lint.blocked) {
                ok = false;
                const detail = lint.blockers.length ? ` ${lint.blockers.slice(0, 3).join('; ')}.` : '';
                summary = `${summary}\n\n⚠️ Lint gate: ${lint.errorCount} ESLint error${lint.errorCount === 1 ? '' : 's'} — fix before shipping.${detail}`;
              }
            } catch { /* lint gate is best-effort — a scan error never fails a real build */ }
          }

          // P-PIPE — build-end dependency-health advisory (CVE + strong-copyleft). Advisory-only: appends to
          // the summary of a successful artifact build, NEVER blocks it (a transitive CVE / GPL dep must not
          // break an otherwise-working app). Best-effort — a scan error is swallowed.
          if (ok && depHealthGate && expectsArtifacts && totalToolUses > 0) {
            try {
              const advisory = await dispatcher.assessDependencyHealthGate();
              if (advisory) summary = `${summary}\n\n${advisory}`;
            } catch { /* advisory gate is best-effort — never fails a build */ }
          }

          // P-PIPE — build-end prettier formatting advisory. Advisory-only: appends to a successful build's
          // summary, NEVER blocks (a formatting nit must not fail a working app). Best-effort — swallowed.
          if (ok && prettierGate && expectsArtifacts && totalToolUses > 0) {
            try {
              const advisory = await dispatcher.assessPrettierGate();
              if (advisory) summary = `${summary}\n\n${advisory}`;
            } catch { /* advisory gate is best-effort — never fails a build */ }
          }

          // Cap-4 injection — add a /health route to an Express entry that lacks one (durable write).
          // Purely additive; never blocks. Best-effort — a failure is swallowed.
          if (ok && observabilityInject && expectsArtifacts && totalToolUses > 0) {
            try {
              const note = await dispatcher.injectObservability();
              if (note) summary = `${summary}\n\n${note}`;
            } catch { /* injection is best-effort — never fails a build */ }
          }

          // SAY WHAT THE APP DOES NOT DO, in the message that says it is ready. A CONFIRMED-missing
          // requested feature is a WARNING, so it correctly does not block the build — but "do not
          // block" had quietly become "do not mention", and the user read only the model's summary of
          // everything it HAD made. Being told an app is ready and later finding the search box you
          // asked for is absent is misleading by omission. Empty for a complete build. See
          // missingFeatureNotice.ts.
          if (ok) summary = `${summary}${missingFeatureNotice(buildHealth?.warnings)}`;
          await persist(ok ? 'complete' : 'error');
          events.emit({ type: 'done', ok, summary, ts: Date.now(), ...(buildHealth ? { readiness: buildHealth } : {}) });
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
        // E4 — dispatch every tool under a hard timeout so one stuck call can't block the turn forever.
        // The `task` sub-agent tool is EXEMPT: it runs a whole nested build bounded by its OWN runner
        // watchdog/budget, so a cap here would wrongly kill a legitimate long sub-agent. On timeout the
        // tool yields an honest is_error result (never a throw) so the model can retry or route around it.
        const dispatchWithBudget = async (tu: ToolUse) => {
          if (toolTimeoutMs <= 0 || tu.name === 'task') return dispatcher.dispatch(tu, agentRole);
          try {
            return await withTimeout(dispatcher.dispatch(tu, agentRole), toolTimeoutMs, `tool ${tu.name}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const timedOut = /timed out after/.test(msg);
            const minutes = Math.max(1, Math.round(toolTimeoutMs / 60000));
            return {
              tool_use_id: tu.id,
              content: timedOut
                ? `Tool "${tu.name}" did not finish within about ${minutes} min and was skipped so the build could keep moving. Try a smaller step or a different approach.`
                : `Tool "${tu.name}" failed: ${msg}`,
              is_error: true,
            };
          }
        };
        const serialIdx: number[] = [];
        const parallelIdx: number[] = [];
        turn.toolUses.forEach((tu, i) => (isParallelSafeToolUse(tu, { parallelBuild: this.opts.parallelBuild }) ? parallelIdx : serialIdx).push(i));
        for (const i of serialIdx) {
          resultBlocks[i] = toBlock(await dispatchWithBudget(turn.toolUses[i]));
        }
        if (parallelIdx.length > 0) {
          await mapWithConcurrency(parallelIdx, toolConcurrency, async (i) => {
            resultBlocks[i] = toBlock(await dispatchWithBudget(turn.toolUses[i]));
          });
        }
        // TRUNCATION GUARD (ShopKhata autopsy 2026-07-17): a turn cut off at max_tokens can write a
        // file whose tail is missing — the LLM_TRUNCATED warning was recorded but nothing ACTED on it,
        // so a broken-brace controller shipped and the builder later burned minutes hand-hunting it
        // with tail/wc/cat -A. Deterministic close: when THIS turn hit the token limit, parse every
        // file it wrote (esbuild, in-process, free) and hand the exact parse failures back with the
        // tool results — the very next turn rewrites the broken file instead of discovering it later.
        let truncationSteer: string | null = null;
        // Trigger on the explicit `truncated` flag (set by EVERY provider adapter from the real finish
        // reason) — NOT just stopReason === 'max_tokens'. CargoPilot autopsy (NEW-F): the OpenAI/Gemini
        // adapters MASK a mid-write_file truncation to stopReason 'tool_use', so keying on 'max_tokens'
        // alone left GLM/Kimi/Gemini truncations (the common cheap-floor case) completely unguarded and a
        // partial file on disk. `truncated` unmasks them.
        if (turn.truncated || turn.stopReason === 'max_tokens') {
          try {
            const written: Record<string, string> = {};
            // A write_file whose arguments were sliced mid-`content` at the token limit: the adapter
            // salvaged the `path` but there is no `content`, so nothing was written. Name it so the guard
            // steers a rewrite (the "Unterminated string in JSON" case that previously lost the file's
            // identity entirely and produced a blind retry).
            const truncatedToolPaths: string[] = [];
            for (const tu of turn.toolUses) {
              // Cover write_file AND write_files_batch — a batch write is just as truncatable, and the
              // old guard only looked at write_file (so a batch's cut-off tail slipped through).
              if (tu.name === 'write_file') {
                const inp = tu.input as { path?: unknown; content?: unknown };
                if (typeof inp?.path === 'string' && typeof inp?.content === 'string') written[inp.path] = inp.content;
                else if (typeof inp?.path === 'string' && inp?.content === undefined) truncatedToolPaths.push(inp.path);
              } else if (tu.name === 'write_files_batch') {
                const b = tu.input as { files?: unknown };
                if (Array.isArray(b?.files)) {
                  for (const f of b.files) {
                    const ff = f as { path?: unknown; content?: unknown };
                    if (typeof ff?.path === 'string' && typeof ff?.content === 'string') written[ff.path] = ff.content;
                    else if (typeof ff?.path === 'string' && ff?.content === undefined) truncatedToolPaths.push(ff.path);
                  }
                }
              }
            }
            const broken = Object.keys(written).length > 0 ? await findSyntaxErrors(written) : [];
            // Connectly autopsy 2026-07-21: a cheap model that wrote a file as a `<<<FILE …>>>` TEXT block
            // (not a write_file tool call) and hit its token ceiling loses that file entirely — the main
            // loop only writes tool calls. Recover those lost/partial text-marker files too, not just the
            // JS parse-failures. (A path also written via a tool call is not "lost", so exclude it.)
            const writtenPaths = new Set(Object.keys(written));
            const textLost = textMarkerFilePaths(turn.text).filter((p) => !writtenPaths.has(p));
            const truncatedLost = truncatedToolPaths.filter((p) => !writtenPaths.has(p));
            truncationSteer = truncationRecoverySteer({ brokenJs: broken, textMarkerPaths: textLost, truncatedToolPaths: truncatedLost });
            if (truncationSteer) {
              events.emit({ type: 'narration', agent: agentRole, text: truncationRecoveryNarration(broken.length, textLost.length + truncatedLost.length), ts: Date.now() });
            }
          } catch { /* the guard is best-effort — it must never break a build */ }
        }
        // LOOP BREAKER — steer the model off a repeated non-progressing call (best-effort; never blocks).
        const loopSteer = loopGuardOn ? collectRepeatProbeSteer(repeatProbe, turn.toolUses, loopThreshold) : null;
        if (loopSteer) {
          // Honest narration per severity: the FINAL steer means the model ignored an earlier nudge and
          // the same dead call is now banned — say that, rather than repeating the softer first line.
          const escalated = loopSteer.includes('LOOP GUARD — FINAL');
          events.emit({
            type: 'narration', agent: agentRole, ts: Date.now(),
            text: escalated
              ? '⚠️ Still repeating the same step — blocking it and moving on to finish the app.'
              : '⚠️ Noticed a repeated step that isn\'t making progress — nudging a change of approach.',
          });
        }
        const steer = [truncationSteer, loopSteer].filter(Boolean).join('\n\n') || null;
        messages.push({ role: 'user', content: steer ? [...resultBlocks, { type: 'text', text: steer }] : resultBlocks });
        messageTs.push(Date.now());

        // Budget guardrail (CostGuard / D5) — stop honestly, never silently.
        if (maxBudgetUsd !== undefined && billed() >= maxBudgetUsd) {
          const summary = `Budget reached ($${billed().toFixed(4)} of $${maxBudgetUsd.toFixed(2)}). Your work is saved — continue to keep building.`;
          await persist('stopped');
          events.emit({ type: 'done', ok: false, summary, ts: Date.now() });
          // T1-budget-ux: a budget stop is a resumable PAUSE, not a failure — flag it so the client offers
          // an honest "continue" (each continue is a fresh run with a fresh budget window).
          return { ok: false, summary, steps, usage, billedUsd: billed(), budgetReached: true };
        }

        // Mid-build checkpoint: the turn (assistant + tool results) is persisted so a reconnect
        // resumes from here, not from the start.
        await persist('running');

        // Slice 2 — weak-tier EVIDENCE checkpoint. On a weak build (flag on), every N steps run the
        // FREE deterministic readiness scan and, ONLY for a completeness-independent build-breaker
        // (server-only Node lib in the browser, high-severity security), inject ONE corrective steer
        // so the weak model fixes it now instead of drifting to the step cap with a broken app. The
        // false-alarm filter (weakBuildCheckpoint.ts) deliberately IGNORES "unresolved import" /
        // low-score blockers — those are normal for an incomplete app. Bounded, best-effort: a scan
        // error or a slow scan never blocks or fails the build.
        if (shouldRunWeakCheckpoint({ isWeakBuild: weakBuild, cfg: weakCkptCfg, step: steps, toolUses: totalToolUses, nudgesUsed: checkpointNudges })) {
          try {
            const readiness = await dispatcher.assessBuildReadiness();
            const steer = weakCheckpointSteer(readiness);
            if (steer) {
              messages.push({ role: 'user', content: steer });
              checkpointNudges++;
              events.emit({ type: 'narration', agent: agentRole, text: '🔎 Checkpoint: fixing a build-breaker before adding more…', ts: Date.now() });
            }
          } catch { /* checkpoint is best-effort — a scan error never blocks a build */ }
        }

        // Slice 2 — error-trend checkpoint (all artifact builds; kill: AGENTV3_ERRTREND_CHECKPOINT=off).
        if (expectsArtifacts && trendCfg.enabled && !trendFired && endgameRepairEnabled()
          && steps > 0 && steps % trendCfg.interval === 0) {
          try {
            const io = dispatcher.endgameIo();
            const count = parseTscErrors(await withTimeout(io.runTsc(), 20_000, 'errtrend-tsc')).length;
            trendCounts.push(count);
            if (shouldTriggerMidBuildRepair(trendCounts)) {
              trendFired = true; // once per run — the step-cap endgame remains the final net
              events.emit({ type: 'narration', agent: agentRole, text: '🔎 Checkpoint: compile errors are not going down — fixing them all in one pass…', ts: Date.now() });
              const verdict = await withTimeout(
                runEndgameRepair({ ...io, llmRepair: endgameBatchRepair, log: (msg) => events.emit({ type: 'narration', agent: agentRole, text: msg, ts: Date.now() }) }),
                150_000, 'errtrend-repair',
              );
              if (verdict.attempted && verdict.errorsAfter < verdict.errorsBefore) {
                // Tell the model the grind is over so it spends the remaining steps on FEATURES.
                messages.push({ role: 'user', content: `[BUILD CHECKPOINT] ${verdict.errorsBefore - verdict.errorsAfter} compile error(s) were just auto-fixed for you (${verdict.errorsAfter} remain). Do NOT re-fix them one by one — run tsc once to confirm, then continue completing the app's remaining FEATURES.` });
              }
            }
          } catch { /* trend checkpoint is best-effort — never blocks or fails a build */ }
        }
      }

      // Step cap — judge by EVIDENCE, not by how the loop ended. The old unconditional ok:false
      // reported a build whose files were written (and whose compile/readiness checks pass) as a
      // FAILURE just because the model kept polishing until the cap — the "working app shown as
      // failed" bug from the admin's build diagnostics. The wall-clock watchdog above already
      // treats builtSomething as success; this exit now applies the SAME policy, and when the
      // readiness gate is enabled the success claim must still be EARNED by the objective scan.
      {
        const builtSomething = totalToolUses > 0;
        let ok = expectsArtifacts && builtSomething;
        let summary = ok
          ? `Step limit reached (${stepCap}) — stopping here. Your files are saved; send another message to continue.`
          : `Step limit reached (${stepCap}). Stopped without completing.`;
        let buildHealth: { score: number; ready: boolean; blockers: string[]; warnings: string[]; tier: string } | undefined;
        if (ok && readinessGate) {
          try {
            const readiness = await dispatcher.assessBuildReadiness();
            buildHealth = { score: readiness.score, ready: readiness.ready, blockers: readiness.blockers, warnings: readiness.warnings, tier: readiness.tier };
            if (readiness.ready) {
              summary = `Step limit reached (${stepCap}) — but the app itself is verified READY (score ${readiness.score}/100). Files are saved; send another message to keep improving it.`;
            } else {
              ok = false;
              // User-facing: short + plain (admin 2026-08-02). The exact blockers stay on the health card +
              // admin report; AGENTV3_VERBOSE_READINESS=on restores the detailed line for debugging.
              summary = (process.env.AGENTV3_VERBOSE_READINESS ?? '').trim().toLowerCase() === 'on'
                ? `Step limit reached (${stepCap}) — and the build is NOT ready (score ${readiness.score}/100).${readiness.blockers.length ? ` Must fix: ${readiness.blockers.join('; ')}.` : ''}`
                : `⚠️ This app isn't fully working yet — a couple of things still need fixing. Send another message and I'll keep going.`;
              // ENDGAME REPAIR (QuizArena autopsy 2026-07-17, Slice 1): the builder died grinding the
              // last compile errors ONE per 4-5 step round-trip. Fix them OUTSIDE the step loop —
              // deterministic tsc-error fixers first (unused imports, import/export drift — pure code,
              // no tokens), then ONE batch LLM call for the residue — and re-earn the readiness
              // verdict. Only runs on an already-failing build, so it can only improve the outcome.
              if (endgameRepairEnabled()) {
                try {
                  const io = dispatcher.endgameIo();
                  const verdict = await withTimeout(runEndgameRepair({
                    ...io,
                    llmRepair: endgameBatchRepair,
                    log: (msg) => events.emit({ type: 'narration', agent: agentRole, text: msg, ts: Date.now() }),
                  }), 150_000, 'endgame-repair');
                  if (verdict.attempted && verdict.errorsAfter < verdict.errorsBefore) {
                    const after = await dispatcher.assessBuildReadiness();
                    buildHealth = { score: after.score, ready: after.ready, blockers: after.blockers, warnings: after.warnings, tier: after.tier };
                    if (after.ready) {
                      ok = true;
                      summary = `Step limit reached (${stepCap}) — endgame repair then fixed the remaining ${verdict.errorsBefore} compile error(s) (${verdict.deterministicFixes.length} mechanically, ${verdict.llmFilesWritten} file(s) via one batch pass) and the app is verified READY (score ${after.score}/100).`;
                    } else {
                      summary = `Step limit reached (${stepCap}) — endgame repair cut the compile errors ${verdict.errorsBefore} → ${verdict.errorsAfter}, but the build is still NOT ready (score ${after.score}/100).${after.blockers.length ? ` Must fix: ${after.blockers.join('; ')}.` : ''}`;
                    }
                  }
                } catch { /* endgame is best-effort — the honest NOT-ready verdict above stands */ }
              }
            }
          } catch { /* gate is best-effort — a scan error never flips the evidence verdict */ }
        }
        // U-1 — LintGate (default-OFF) also applies at the step-cap exit.
        if (ok && lintGate) {
          try {
            const lint = await dispatcher.assessLintGate();
            if (lint.blocked) {
              ok = false;
              const detail = lint.blockers.length ? ` ${lint.blockers.slice(0, 3).join('; ')}.` : '';
              summary = `Step limit reached (${stepCap}) — and the lint gate found ${lint.errorCount} ESLint error${lint.errorCount === 1 ? '' : 's'}.${detail}`;
            }
          } catch { /* lint gate is best-effort — a scan error never flips the verdict */ }
        }
        // P-PIPE — build-end dependency-health advisory also applies at the step-cap exit (advisory-only).
        if (ok && depHealthGate && expectsArtifacts && totalToolUses > 0) {
          try {
            const advisory = await dispatcher.assessDependencyHealthGate();
            if (advisory) summary = `${summary}\n\n${advisory}`;
          } catch { /* advisory gate is best-effort — never fails a build */ }
        }
        // P-PIPE — build-end prettier advisory also applies at the step-cap exit (advisory-only, never blocks).
        if (ok && prettierGate && expectsArtifacts && totalToolUses > 0) {
          try {
            const advisory = await dispatcher.assessPrettierGate();
            if (advisory) summary = `${summary}\n\n${advisory}`;
          } catch { /* advisory gate is best-effort — never fails a build */ }
        }
        // Cap-4 injection — /health route injection also applies at the step-cap exit (additive, never blocks).
        if (ok && observabilityInject && expectsArtifacts && totalToolUses > 0) {
          try {
            const note = await dispatcher.injectObservability();
            if (note) summary = `${summary}\n\n${note}`;
          } catch { /* injection is best-effort — never fails a build */ }
        }
        // Slice 3 — AUTO-RESUME: a NOT-ready artifact build at the cap continues (bounded) instead of
        // dying; the model is steered at the remaining blockers so the extension is spent finishing,
        // not wandering. Chat runs / aborted runs / builds that produced nothing never extend.
        if (!ok && expectsArtifacts && builtSomething && stepResumesLeft > 0 && !this.opts.signal?.aborted) {
          stepResumesLeft--;
          stepCap += Math.max(20, Math.ceil(maxSteps / 2));
          const blockerNote = buildHealth?.blockers.length
            ? ` Remaining blockers to fix: ${buildHealth.blockers.join('; ')}.`
            : '';
          messages.push({ role: 'user', content: `[BUILD RESUME] The step budget was extended ONCE to let you finish — do not start over and do not rebuild what exists.${blockerNote} Fix what is listed, verify with tsc, and finish.` });
          events.emit({ type: 'narration', agent: agentRole, text: '🔁 The build hit its step budget while unfinished — extending once to complete the remaining blockers…', ts: Date.now() });
          continue stepResumeLoop;
        }
        // SIBLING of the notice above: this is the step-cap exit, a second and entirely separate `done`
        // emit. A long build is exactly the kind most likely to drop a feature, so leaving this one
        // silent would have hidden the worst cases.
        if (ok) summary = `${summary}${missingFeatureNotice(buildHealth?.warnings)}`;
        await persist(ok ? 'complete' : 'stopped');
        events.emit({ type: 'done', ok, summary, ts: Date.now(), ...(buildHealth ? { readiness: buildHealth } : {}) });
        return { ok, summary, steps, usage, billedUsd: billed() };
      }
      } // stepResumeLoop
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await persist('error');
      events.emit({ type: 'error', message, ts: Date.now() });
      return { ok: false, summary: `Error: ${message}`, steps, usage, billedUsd: billed() };
    }
  }
}
