import type { AgentEventStream } from './AgentEventStream';
import type { WorkspaceState } from './WorkspaceState';
import type { TurnRunner } from './ClaudeClient';
import type { ActuatorPort, SubAgentSpawn, ReadLedger } from './ToolDispatcher';
import type { Checkpointer } from './GitManager';
import { ToolDispatcher } from './ToolDispatcher';
import { AgentRunner } from './AgentRunner';
import { roleConfig } from './AgentRegistry';
import { catalogForTools } from './ToolCatalog';
import { agentLifecycle } from './AgentLifecycle';
import { getWorkspaceMemory } from './WorkspaceMemory';
import type { AgentRole } from './types';

/**
 * Builds the `SubAgentSpawn` the Architect's `task` tool uses to delegate work
 * to a specialist (§3.3). The spawned worker:
 *  - runs with its role's constrained tool set (no `task` → no deep recursion),
 *  - shares the same sandbox actuator, WorkspaceState and event stream (so its
 *    file changes, diffs and terminal output land on the same merged surfaces),
 *  - is attributed to its role in the AI-team tracker,
 *  - has its own step + budget caps under the global CostGuard.
 *
 * Wiring the spawn here (not inside ToolDispatcher) keeps the dispatcher
 * decoupled from AgentRunner and avoids a circular import.
 */
export interface SubAgentDeps {
  client: TurnRunner;
  actuator: ActuatorPort;
  workspaceId: string;
  state: WorkspaceState;
  events: AgentEventStream;
  model: string;
  onlyOpus?: boolean;
  /**
   * The build's power level (admin tier→model redefinition 2026-07-13). MUST be threaded: sub-agents
   * spend the bulk of a build's tokens, and AgentRunner bills by `powerLevel ?? onlyOpus` — without
   * this a Strong ('mini' → Sonnet 100%) build's sub-agents fell back to the boolean and were billed
   * at real-Opus rates for Sonnet work.
   */
  powerLevel?: 'weak' | 'off' | 'mini' | 'medium' | 'max';
  /** Claude reasoning effort for the tier (Opus tiers only) — same lever the top-level runner gets. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Per-sub-agent caps (defaults: 40 steps; budget inherited from parent if unset). */
  maxSteps?: number;
  maxBudgetUsd?: number;
  /** Max output tokens per turn. The Architect delegates ALL app code to sub-agents, so the top-level
   *  runner's 32000 cap (buildMaxTokensPerTurn) MUST be passed through — otherwise a sub-agent falls
   *  back to ClaudeClient's 8192 default and truncates large multi-file writes (the #1 cause of
   *  incomplete complex apps), costing extra repair turns. */
  maxTokensPerTurn?: number;
  /** Real git checkpointer, so sub-agent writes are committed too. */
  checkpointer?: Checkpointer;
  /**
   * Build-level token accumulator (billing accounting fix). The Architect delegates ALL app code to
   * sub-agents, so the bulk of a build's tokens are spent HERE. Passing the parent build's sink makes
   * every sub-agent's turns count toward the user's charge — previously they were dropped entirely.
   */
  usageSink?: import('./UsageSink').UsageSink;

  /**
   * C2 — the project's protected paths, as a GETTER rather than a value.
   *
   * A sub-agent writes files exactly like the architect does, so a child dispatcher without the guard
   * would be a hole straight through it. It is a thunk because the spawn is constructed BEFORE the
   * ignore file is read — passing the array here would capture an empty one and silently disarm every
   * sub-agent, which is the worst kind of bug: the feature would look present and protect nothing.
   */
  ignoreRules?: () => import('./ignoreRules').IgnoreRule[];

  /**
   * Called with the path + final content on every successful write_file/edit_file A SUB-AGENT MAKES —
   * the same signal `ToolDispatcher`'s own `onFileWriteRaw` gives the top-level runner.
   *
   * 🔴 ROOT CAUSE (autopsy, build 9cca1fd5, 2026-09-17): the Architect delegates ALL app code to
   * sub-agents by design ("the Architect delegates ALL app code to sub-agents" — see `usageSink`
   * below, fixed for TOKEN billing the same way). But the child `ToolDispatcher` built here was
   * constructed with no `onFileWriteRaw` at all, so a sub-agent's writes reached the sandbox and the
   * live event stream but never the parent turn's `writtenFiles` tracking. Any build whose Architect
   * made no DIRECT write of its own — the common case, since it explores and delegates — then finished
   * with `writtenFiles.size === 0` even though the sub-agent had genuinely built the requested feature.
   * That count is what `verifiedNoChangeSummary`/`emptyBuildFailureSummary` gate on, so the user was
   * told "Nothing needed changing… No file was modified" over a build that had just shipped a new
   * screen — the exact class of dishonest verdict the fifth absolute rule exists to catch, reached
   * through a different hole than the one already fixed for it.
   */
  onFileWrite?: (path: string, content: string) => void;

  // ── THE REST OF WHAT THE PARENT ALREADY HAS ────────────────────────────────────────────────────
  //
  // 🔴 `onFileWrite` above closed ONE dropped argument, for this exact build (`9cca1fd5`, PR #2988).
  // An exhaustive re-autopsy of the SAME report found the rest: the child `ToolDispatcher` was being
  // constructed with **11 of the constructor's 13 positional parameters**, and the child `AgentRunner`
  // with five of its options missing. Seventeen separate findings, one call site.
  //
  // The comment left above that call said, in its own words, *"only onFileWrite (position 11) is newly
  // threaded through"* — which is exactly how positions 12 and 13 stayed invisible: the fix named what
  // it added and nobody counted what remained. `subAgentGetsTheWholeWiring.test.ts` now counts, by
  // comparing the constructor's real arity against this call's, so the class cannot return silently.
  //
  // 🔒 EVERY FIELD BELOW IS OPTIONAL AND ABSENT MEANS TODAY'S BEHAVIOUR EXACTLY. A caller that has not
  // been updated loses nothing it had; only a caller that passes them gains.

  /**
   * The framework id (`nextjs`, `vue`, …). Position 12 of the dispatcher constructor, and never passed
   * — so every sub-agent's dispatcher silently defaulted to `vite-react`, whatever the project is. The
   * framework-specific write transforms (the Next.js middleware relocation) therefore never fired for a
   * DELEGATED write, and the architect delegates all app code by design.
   */
  framework?: string;

  /**
   * The parent's LIVE write-time-typecheck stats, so a sub-agent's compiles are counted in the build
   * report instead of vanishing with its own dispatcher.
   *
   * 🔴 A THUNK, FOR THE SAME REASON `ignoreRules` IS ONE: the spawn is constructed BEFORE the parent
   * dispatcher exists (the spawn is an argument to that constructor), so a value here would capture
   * `undefined` and silently share nothing — the feature would look present and count nothing, which
   * is precisely the failure being fixed.
   */
  writeTypecheckStats?: () => import('./writeTimeTypecheck').WriteTypecheckStats | undefined;
  /**
   * The parent's file-read ledger, so a sub-agent's re-reads are counted in the build's own numbers.
   *
   * A thunk for the same reason as the one above: the parent `ToolDispatcher` takes this spawn as a
   * constructor argument, so it does not exist when the spawn is built. Absent ⇒ the child keeps its
   * own map — which is exactly the behaviour that hid the reviewer's waste in autopsy f97eb0ec.
   */
  readLedger?: () => ReadLedger | undefined;

  /**
   * The raw result of every sandbox `bash` command. Position 13, and never passed — so **not one
   * sub-agent shell command has ever reached a build report**. The phase that writes the app is the
   * phase whose `npm install`, `tsc` and `vite build` output is missing from the one document the
   * admin reads to find out why a build failed.
   */
  onCommand?: (result: { command: string; exitCode: number | null; stdout: string; stderr: string; durationMs: number }) => void;

  /**
   * Per-model-call telemetry. `AgentRunner` has always accepted it; the child was built without it, so
   * the majority of a build's turns appear in no `llmCalls` log — which is also why a sub-agent's slow
   * or failing provider is invisible to every instrument that reads that log.
   */
  onLlmCall?: import('./AgentRunner').AgentRunnerOptions['onLlmCall'];

  /**
   * The build's abort signal. Its absence is the one that costs money: a user pressing Stop, or the
   * mid-build cost ceiling firing, ends the ARCHITECT between turns — and the sub-agent it delegated to
   * keeps running and keeps spending, because nothing told it. The `task` tool is additionally exempt
   * from the tool timeout, so there is no second net.
   */
  signal?: AbortSignal;

  /**
   * How long this build still has, read as a THUNK at SPAWN time.
   *
   * ⚠️ It must be the REMAINING time, not the build's total: `AgentRunner` measures its deadline from
   * ITS OWN start, so handing a child the whole budget would give a sub-agent spawned at minute 25 a
   * fresh 30 minutes. A thunk because the spawn closure is built once and used many times.
   */
  remainingBuildMs?: () => number;

  /**
   * Does THIS BUILD expect files to be produced at all? (A plain chat turn does not.)
   *
   * Combined with the role's own tool set — see `roleExpectsArtifacts` — this is what stops a sub-agent
   * that hit its step cap being reported as a failure however much it built.
   *
   * ⚠️ A THUNK, like `ignoreRules` and `remainingBuildMs`: the route decides this well AFTER the spawn
   * closure is built (and the rebuild guard can still change `intent` in between), so reading a value
   * here would freeze an answer taken before the question was settled.
   */
  expectsArtifacts?: () => boolean;
}

/**
 * Can this role produce artifacts at all?
 *
 * Derived from the role's OWN tool set rather than a new per-role flag, so a role added later is
 * classified correctly without anyone remembering to mark it. A researcher (`read_file`/`grep`/`glob`)
 * is not expected to write files and must keep today's verdict; a builder is.
 *
 * Pure; never throws.
 */
export function roleExpectsArtifacts(tools: readonly string[] | null | undefined): boolean {
  return Array.isArray(tools) && tools.includes('write_file');
}

export function makeSubAgentSpawn(deps: SubAgentDeps): SubAgentSpawn {
  return async (role: AgentRole, instruction: string) => {
    const cfg = roleConfig(role);
    // A child dispatcher with NO spawn capability → workers cannot recurse.
    // secondOpinion/consensus/webSearch/deploy stay withheld deliberately (positions 7-10): that is a
    // CAPABILITY decision, and it is the only reason any argument here is `undefined`.
    //
    // ⚠️ EVERY OTHER POSITION IS NOW PASSED, AND THE COUNT IS TESTED. This call used to stop at 11 of
    // 13, so `framework` and `onCommand` were silently undefined — see `SubAgentDeps` for what that
    // cost. `subAgentGetsTheWholeWiring.test.ts` compares this call's argument count against the
    // constructor's real arity, so a fourteenth parameter added later fails CI here instead of
    // becoming the next thing nobody threaded.
    const childDispatcher = new ToolDispatcher(
      deps.actuator, deps.workspaceId, deps.state, deps.events, undefined, deps.checkpointer,
      undefined, undefined, undefined, undefined, deps.onFileWrite, deps.framework, deps.onCommand,
    );
    // C2 — arm the guard on the child too. Read at SPAWN time via the thunk, so it sees the rules
    // however late they were loaded.
    try { childDispatcher.setIgnoreRules(deps.ignoreRules?.() ?? []); } catch { /* never block a spawn */ }
    // Count this child's compiles in the PARENT's numbers. Read through the thunk at SPAWN time for
    // the same reason the guard above is: the parent dispatcher does not exist when this spawn is
    // built. Absent ⇒ the child keeps its own object, i.e. exactly today's behaviour.
    try {
      const shared = deps.writeTypecheckStats?.();
      if (shared) childDispatcher.shareWriteTypecheckStats(shared);
    } catch { /* never block a spawn */ }
    // Count this child's file READS in the PARENT's ledger too — same thunk, same reason, and the
    // sibling of the line above. Autopsy f97eb0ec: the reviewer re-read one unchanged file SEVEN
    // times and the build report carried no repeated-read finding at all, because this was the one
    // measurement still left behind in the child.
    try {
      const sharedReads = deps.readLedger?.();
      if (sharedReads) childDispatcher.shareReadLedger(sharedReads);
    } catch { /* never block a spawn */ }
    // TERMINAL-EVENT ISOLATION — the sub-runner shares the build's event stream, so its own
    // `done`/`error` used to flow to every surface as if the WHOLE build finished: the client
    // reducer set done:true and overwrote the top-level summary (the "Step limit reached (40)"
    // shown while the Architect, cap 80, was still working). Translate the specialist's terminal
    // events into non-terminal `agent_done`; everything else (files, diffs, tool calls, narration)
    // passes through unchanged so the merged surfaces stay live.
    const childEvents = Object.create(deps.events) as AgentEventStream;
    childEvents.emit = (event) => {
      if (event.type === 'done') {
        deps.events.emit({ type: 'agent_done', agent: role, ok: event.ok, summary: event.summary, ts: event.ts });
      } else if (event.type === 'error') {
        deps.events.emit({ type: 'agent_done', agent: role, ok: false, summary: event.message, ts: event.ts });
      } else {
        deps.events.emit(event);
      }
    };
    const runner = new AgentRunner({
      client: deps.client,
      dispatcher: childDispatcher,
      state: deps.state,
      events: childEvents,
      model: deps.model,
      system: cfg.system,
      tools: catalogForTools(cfg.tools),
      onlyOpus: deps.onlyOpus,
      powerLevel: deps.powerLevel,
      effort: deps.effort,
      maxSteps: deps.maxSteps ?? 40,
      maxBudgetUsd: deps.maxBudgetUsd,
      maxTokensPerTurn: deps.maxTokensPerTurn,
      agentRole: role,
      // Billing accounting fix: feed the SAME build-level sink so this sub-agent's tokens are billed.
      usageSink: deps.usageSink,
      // ── and the five the child never got ───────────────────────────────────────────────────────
      // Telemetry: without this the majority of a build's model calls appear in no `llmCalls` log.
      onLlmCall: deps.onLlmCall,
      // Stop / the mid-build cost ceiling can finally end a delegated run. `AgentRunner` ends BETWEEN
      // turns, so this cancels nothing in flight and loses no written file — it stops the next call.
      signal: deps.signal,
      // The REMAINING build time, read now (see `remainingBuildMs`). A non-positive answer is omitted
      // rather than passed as 0 — `buildTimedOut` treats 0 as "no deadline", so passing it would read
      // as unlimited, which is the opposite of what an exhausted budget means.
      ...(() => {
        // 🔒 Every thunk here is called inside a try: a getter that throws — including a `const` read
        // before its own initialiser has run, which a closure built earlier in the same scope can do —
        // must degrade to today's behaviour, never take down a spawn. Same discipline as `ignoreRules`.
        let left = 0;
        try { left = Math.floor(deps.remainingBuildMs?.() ?? 0); } catch { left = 0; }
        return left > 0 ? { maxBuildMs: left } : {};
      })(),
      // A step-capped specialist that BUILT something is not a failure. `ok` at that exit is
      // `expectsArtifacts && builtSomething`, so an absent flag made every capped sub-agent FAILED
      // however much it produced — and also withheld the bounded one-time step extension, which is
      // gated on the same flag. Both halves of `AgentRunner`'s own step-cap policy were unreachable.
      expectsArtifacts: (() => {
        try { return (deps.expectsArtifacts?.() ?? false) && roleExpectsArtifacts(cfg.tools); }
        catch { return false; }
      })(),
    });
    // Give the specialist the live project map (Phase 2) so it knows the codebase
    // the Architect has built so far — what files/components/routes exist and what
    // has failed — instead of working blind. Empty early in a build (no-op then).
    // Plus the shared VERIFICATION LEDGER (slice 4): "deps already installed / tsc already
    // clean" — the diagnostics showed each specialist re-running npm install + tsc from
    // scratch because nothing told it the work was already done.
    const mem = getWorkspaceMemory(deps.workspaceId);
    const projectMap = mem.projectMap();
    const verification = mem.verificationStatus();
    const contextBlocks = [
      projectMap ? `Current project context:\n${projectMap}` : '',
      verification,
    ].filter(Boolean);
    const fullInstruction = contextBlocks.length
      ? `${contextBlocks.join('\n\n')}\n\n---\nYour task: ${instruction}`
      : instruction;

    // Record the real lifecycle of this delegated run (Agent Health Monitor).
    const token = agentLifecycle.start(role);
    try {
      const result = await runner.run(fullInstruction);
      agentLifecycle.finish(token, result.ok);
      return { ok: result.ok, summary: result.summary };
    } catch (err) {
      agentLifecycle.finish(token, false);
      throw err;
    }
  };
}
