import type { AgentCard, AgentRole, AgentV3ClientState, AgentV3WireEvent, FileChange, NarrationLine } from './agentV3Types';

// Pure reducer: folds each NDJSON wire event into the client state that drives
// all merged surfaces (narration, files, diffs, terminal, git/history, todos,
// and the live "AI Team" tracker). Pure + deterministic → fully unit-testable.
//
// D9: the agent cards are produced ONLY from real tool_call/tool_result/narration
// events — there is no synthetic/fake activity. If no event arrives for an agent,
// its card does not move.

const MAX_NARRATION = 500;
const MAX_TERMINAL = 1000;

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
      // Route bash commands to the terminal surface (real execution log).
      if (event.tool === 'bash') {
        const cmd = typeof (event.input as Record<string, unknown>)?.command === 'string'
          ? String((event.input as Record<string, unknown>).command)
          : '';
        return {
          ...state,
          agents,
          pendingBash: { ...state.pendingBash, [event.callId]: cmd },
          terminal: [...state.terminal, `$ ${cmd}`].slice(-MAX_TERMINAL),
        };
      }
      return { ...state, agents };
    }

    case 'tool_result': {
      const existing = state.agents[event.agent];
      const action = existing ? existing.lastAction : event.summary;
      const agents = touchAgent(state.agents, event.agent, action, false, event.ts);
      // If this completes a bash call, append its output to the terminal.
      if (state.pendingBash[event.callId] !== undefined) {
        const { [event.callId]: _done, ...rest } = state.pendingBash;
        return {
          ...state,
          agents,
          pendingBash: rest,
          terminal: [...state.terminal, event.summary].slice(-MAX_TERMINAL),
        };
      }
      return { ...state, agents };
    }

    case 'agent_spawned':
      return {
        ...state,
        agents: touchAgent(state.agents, event.agent, `started: ${event.task}`, true, event.ts),
      };

    case 'file_changed':
      return { ...state, files: applyFileChange(state.files, event.change) };

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

    case 'preview':
      return { ...state, previewUrl: event.url };

    case 'repo':
      return { ...state, repoUrl: event.url, repoFullName: event.fullName };

    case 'permission_request':
      return {
        ...state,
        pendingPermission: { callId: event.callId, action: event.action },
        agents: touchAgent(state.agents, event.agent, `awaiting permission: ${event.action}`, true, event.ts),
      };

    case 'done':
      return { ...state, done: true, ok: event.ok, summary: event.summary, pendingPermission: undefined, ...(event.readiness ? { buildHealth: event.readiness } : {}) };

    case 'result':
      return { ...state, done: true, ok: event.ok, summary: event.summary, billedUsd: event.billedUsd, billedInr: event.billedInr, pendingPermission: undefined };

    case 'error':
      return { ...state, done: true, ok: false, error: event.message, pendingPermission: undefined };

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
