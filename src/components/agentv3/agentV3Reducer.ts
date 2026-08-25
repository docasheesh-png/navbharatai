import type { ActivityEntry, AgentCard, AgentRole, AgentV3ClientState, AgentV3WireEvent, FileChange, NarrationLine } from './agentV3Types';

// Pure reducer: folds each NDJSON wire event into the client state that drives
// all merged surfaces (narration, files, diffs, terminal, git/history, todos,
// and the live "AI Team" tracker). Pure + deterministic → fully unit-testable.
//
// D9: the agent cards are produced ONLY from real tool_call/tool_result/narration
// events — there is no synthetic/fake activity. If no event arrives for an agent,
// its card does not move.

const MAX_NARRATION = 500;
const MAX_TERMINAL = 1000;
const MAX_ACTIVITY = 300;

/** Append a new activity entry to the live "working…" feed (capped). */
function pushActivity(activity: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  return [...activity, entry].slice(-MAX_ACTIVITY);
}

/** Mark an in-flight tool activity (matched by callId) as completed with its ok/fail verdict. */
function completeActivity(activity: ActivityEntry[], callId: string, ok: boolean): ActivityEntry[] {
  let found = false;
  const next = activity.map((a) => (a.id === callId && a.active ? ((found = true), { ...a, active: false, ok }) : a));
  return found ? next : activity;
}

function touchAgent(
  agents: Record<string, AgentCard>,
  agent: AgentRole,
  lastAction: string,
  active: boolean,
  ts: number,
): Record<string, AgentCard> {
  return { ...agents, [agent]: { agent, lastAction, active, updatedTs: ts } };
}

function applyFileChange(files: FileChange[], change: FileChange): FileChange[] {
  const without = files.filter((f) => f.path !== change.path);
  if (change.kind === 'delete') return without;
  return [...without, change];
}

export function agentV3Reducer(state: AgentV3ClientState, event: AgentV3WireEvent): AgentV3ClientState {
  switch (event.type) {
    case 'workspace':
      return { ...state, workspaceId: event.workspaceId };

    // P0 — capture THIS build's unique identity so the report export can be validated against it.
    case 'build_meta':
      return { ...state, buildId: event.buildId, promptHash: event.promptHash, ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}) };

    case 'stream_delta': {
      const kind = event.kind ?? 'text';
      // Find the LAST live line for this turn id + kind and append the delta.
      let foundIdx = -1;
      for (let i = state.narration.length - 1; i >= 0; i--) {
        const line = state.narration[i];
        if (line.id === event.id && (line.kind ?? 'text') === kind) {
          foundIdx = i;
          break;
        }
      }
      let narration: NarrationLine[];
      if (foundIdx >= 0) {
        narration = state.narration.map((line, i) =>
          i === foundIdx ? { ...line, text: line.text + event.delta } : line,
        );
      } else {
        narration = [
          ...state.narration,
          { agent: event.agent, text: event.delta, ts: event.ts, id: event.id, kind, streaming: true },
        ].slice(-MAX_NARRATION);
      }
      return {
        ...state,
        narration,
        agents: touchAgent(state.agents, event.agent, event.delta, true, event.ts),
      };
    }

    case 'narration':
    case 'thinking': {
      let narration = state.narration;
      if (event.type === 'narration') {
        // If this turn was streamed (its id already has a text line), finalize that
        // line in place instead of pushing a duplicate. Otherwise (no id, or no
        // matching line) push a new line — the original/backward-compatible path.
        const idx =
          event.id != null
            ? state.narration.findIndex((line) => line.id === event.id && (line.kind ?? 'text') === 'text')
            : -1;
        if (idx >= 0) {
          narration = state.narration.map((line, i) =>
            i === idx ? { ...line, text: event.text, streaming: false } : line,
          );
        } else {
          narration = [
            ...state.narration,
            { agent: event.agent, text: event.text, ts: event.ts, id: event.id },
          ].slice(-MAX_NARRATION);
        }
      }
      return {
        ...state,
        narration,
        agents: touchAgent(state.agents, event.agent, event.text, true, event.ts),
      };
    }

    case 'tool_call': {
      const action = describeToolCall(event.tool, event.input);
      const agents = touchAgent(state.agents, event.agent, action, true, event.ts);
      // Live activity feed: record the tool call as in-flight (matched to its result by callId).
      const activity = pushActivity(state.activity, { id: event.callId, ts: event.ts, kind: 'tool', text: action, agent: event.agent, active: true });
      // Route bash commands to the terminal surface (real execution log).
      if (event.tool === 'bash') {
        const cmd = typeof (event.input as Record<string, unknown>)?.command === 'string'
          ? String((event.input as Record<string, unknown>).command)
          : '';
        return {
          ...state,
          agents,
          activity,
          pendingBash: { ...state.pendingBash, [event.callId]: cmd },
          terminal: [...state.terminal, `$ ${cmd}`].slice(-MAX_TERMINAL),
        };
      }
      return { ...state, agents, activity };
    }

    case 'tool_result': {
      const existing = state.agents[event.agent];
      const action = existing ? existing.lastAction : event.summary;
      const agents = touchAgent(state.agents, event.agent, action, false, event.ts);
      // Live activity feed: mark the matching in-flight tool entry done (✓ / ✗).
      const activity = completeActivity(state.activity, event.callId, event.ok);
      // If this completes a bash call, append its output to the terminal.
      if (state.pendingBash[event.callId] !== undefined) {
        const { [event.callId]: _done, ...rest } = state.pendingBash;
        return {
          ...state,
          agents,
          activity,
          pendingBash: rest,
          terminal: [...state.terminal, event.summary].slice(-MAX_TERMINAL),
        };
      }
      return { ...state, agents, activity };
    }

    case 'agent_spawned':
      return {
        ...state,
        agents: touchAgent(state.agents, event.agent, `started: ${event.task}`, true, event.ts),
        activity: pushActivity(state.activity, { id: `a-${event.ts}-${event.agent}`, ts: event.ts, kind: 'agent', text: `${event.agent} — ${event.task}`, agent: event.agent }),
      };

    // A DELEGATED specialist finished — updates only that agent's card/activity, NEVER the
    // build's done/ok/summary (a sub-agent's own step cap used to overwrite the top-level
    // result as "Step limit reached (40)" while the Architect was still building).
    case 'agent_done':
      return {
        ...state,
        agents: touchAgent(state.agents, event.agent, event.ok ? 'finished' : `stopped: ${event.summary.slice(0, 80)}`, false, event.ts),
        activity: pushActivity(state.activity, { id: `ad-${event.ts}-${event.agent}`, ts: event.ts, kind: 'agent', text: `${event.agent} ${event.ok ? 'finished' : 'stopped'}`, agent: event.agent }),
      };

    case 'file_changed': {
      const verb = event.change.kind === 'create' ? 'created' : event.change.kind === 'delete' ? 'deleted' : 'edited';
      return {
        ...state,
        files: applyFileChange(state.files, event.change),
        activity: pushActivity(state.activity, { id: `f-${event.ts}-${event.change.path}`, ts: event.ts, kind: 'file', text: `${verb} ${event.change.path}`, agent: event.agent, ok: true }),
      };
    }

    // The engine says what it is doing. 'settling' is what stops the live preview hard-remounting a
    // running app under the person using it (previewReloadPolicy.ts).
    case 'build_phase':
      return { ...state, buildPhase: event.phase };

    case 'files_restored':
      // "Restore all files" replaced the whole file list with what's genuinely in the workspace now.
      return { ...state, files: event.files };

    case 'diff':
      return { ...state, diffs: { ...state.diffs, [event.diff.path]: event.diff.patch } };

    case 'todo_updated':
      return { ...state, todos: event.todos };

    case 'plan_updated':
      return { ...state, plan: event.plan };

    case 'checkpoint':
      return { ...state, checkpoints: [...state.checkpoints, event.checkpoint] };

    // B8 — replaces rather than accumulates: this is a CURRENT reading, not a log.
    case 'context_usage':
      return { ...state, contextUsage: { pct: event.pct, level: event.level, note: event.note } };

    case 'preview':
      return {
        ...state,
        previewUrl: event.url,
        activity: pushActivity(state.activity, { id: `p-${event.ts}`, ts: event.ts, kind: 'preview', text: 'preview published', ok: true }),
      };

    // The server detected a DIFFERENT framework than the client assumed — adopt it. The server read
    // the real files (an import's package.json, or an existing workspace's config); the client only
    // ever had a default. Between a measurement and a default, the measurement wins.
    case 'framework':
      return { ...state, framework: event.framework };

    case 'repo':
      return { ...state, repoUrl: event.url, repoFullName: event.fullName, repoOwnedByUser: event.ownedByUser === true };

    case 'own_repo':
      return { ...state, ownRepo: { owner: event.owner, repo: event.repo, workBranch: event.workBranch, baseBranch: event.baseBranch } };

    case 'proposed_steps':
      return { ...state, proposedSteps: { role: event.role, steps: event.steps } };

    case 'clarify':
      // Non-blocking: just record the questions for the panel to surface. The build keeps streaming.
      return { ...state, pendingClarify: { domain: event.domain, questions: event.questions } };

    case 'secret_request':
      // Same shape as a permission request — one pending interactive gate — but with fields to fill.
      // Kept SEPARATE so a secrets popup can never be answered by the yes/no buttons, and so the
      // reducer's existing "done clears pendingPermission" rule cannot silently drop a half-typed key.
      return { ...state, pendingSecrets: { callId: event.callId, prompt: event.prompt, secrets: event.secrets } };

    case 'permission_request':
      return {
        ...state,
        pendingPermission: { callId: event.callId, action: event.action },
        agents: touchAgent(state.agents, event.agent, `awaiting permission: ${event.action}`, true, event.ts),
      };

    case 'done':
      return { ...state, done: true, ok: event.ok, summary: event.summary, pendingPermission: undefined, pendingSecrets: undefined, ...(event.readiness ? { buildHealth: event.readiness } : {}) };

    case 'result':
      // T1-health-card: the successful build terminates with `result` (not `done`), so surface the
      // build-health verdict from here too — otherwise <BuildHealthCard/> only ever showed on failure.
      return { ...state, done: true, ok: event.ok, summary: event.summary, billedUsd: event.billedUsd, billedInr: event.billedInr, costBreakdown: event.costBreakdown, budgetReached: event.budgetReached === true, resumable: event.resumable === true, planRemaining: typeof event.planRemaining === 'number' ? event.planRemaining : undefined, filesWritten: typeof event.filesWritten === 'number' ? event.filesWritten : undefined, tokens: typeof event.tokens === 'number' ? event.tokens : undefined, walletTokensDebited: typeof event.walletTokensDebited === 'number' ? event.walletTokensDebited : undefined, walletTokenBalance: typeof event.walletTokenBalance === 'number' ? event.walletTokenBalance : undefined, pendingPermission: undefined, ...(event.buildId ? { buildId: event.buildId } : {}), ...(event.promptHash ? { promptHash: event.promptHash } : {}), ...(event.diagnostics ? { diagnostics: event.diagnostics } : {}), ...(event.readiness ? { buildHealth: event.readiness } : {}) };

    case 'error':
      // A crashed build now carries its diagnostics report (server attaches it) — keep it so the
      // failure card / "Build report" renders and the user can see WHAT went wrong, not a bare error.
      return { ...state, done: true, ok: false, error: event.message, errorCode: event.code, pendingPermission: undefined, ...(event.diagnostics ? { diagnostics: event.diagnostics } : {}) };

    default:
      return state;
  }
}

export function reduceAll(state: AgentV3ClientState, events: AgentV3WireEvent[]): AgentV3ClientState {
  return events.reduce(agentV3Reducer, state);
}

function describeToolCall(tool: string, input: unknown): string {
  const arg = (input ?? {}) as Record<string, unknown>;
  const path = typeof arg.path === 'string' ? arg.path : undefined;
  switch (tool) {
    case 'write_file':
      return path ? `writing ${path}` : 'writing a file';
    case 'edit_file':
      return path ? `editing ${path}` : 'editing a file';
    case 'read_file':
      return path ? `reading ${path}` : 'reading a file';
    case 'bash':
      return typeof arg.command === 'string' ? `running: ${arg.command}` : 'running a command';
    case 'grep':
      return typeof arg.pattern === 'string' ? `searching "${arg.pattern}"` : 'searching';
    case 'glob':
      return 'listing files';
    case 'update_todo':
      return 'updating the plan';
    case 'recall':
      return typeof arg.query === 'string' ? `recalling "${arg.query}"` : 'recalling from memory';
    case 'evaluate':
      return 'evaluating the architecture';
    default:
      return `using ${tool}`;
  }
}

/** Append terminal output for the terminal surface (called by the hook on bash results). */
export function appendTerminal(state: AgentV3ClientState, line: string): AgentV3ClientState {
  return { ...state, terminal: [...state.terminal, line].slice(-MAX_TERMINAL) };
}
