import type { AgentCard, AgentRole, AgentV3ClientState, AgentV3WireEvent, FileChange } from './agentV3Types';

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
    case 'narration':
    case 'thinking': {
      const narration =
        event.type === 'narration'
          ? [...state.narration, { agent: event.agent, text: event.text, ts: event.ts }].slice(-MAX_NARRATION)
          : state.narration;
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

    case 'permission_request':
      return {
        ...state,
        pendingPermission: { callId: event.callId, action: event.action },
        agents: touchAgent(state.agents, event.agent, `awaiting permission: ${event.action}`, true, event.ts),
      };

    case 'done':
      return { ...state, done: true, ok: event.ok, summary: event.summary, pendingPermission: undefined };

    case 'result':
      return { ...state, done: true, ok: event.ok, summary: event.summary, billedUsd: event.billedUsd, pendingPermission: undefined };

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
    default:
      return `using ${tool}`;
  }
}

/** Append terminal output for the terminal surface (called by the hook on bash results). */
export function appendTerminal(state: AgentV3ClientState, line: string): AgentV3ClientState {
  return { ...state, terminal: [...state.terminal, line].slice(-MAX_TERMINAL) };
}
