// AgentV3 (Vargen 3.0) — client-side mirror of the engine's NDJSON wire format.
//
// The frontend cannot import server code (tsconfig excludes src/server), so these
// types mirror the wire contract of src/server/AgentV3/types.ts `AgentEvent` plus
// the final {type:'result'} line streamed by /api/agentv3/chat. Client and server
// communicate only via this JSON contract — normal client/server decoupling.

// Mirrors the server roster (src/server/AgentV3/types.ts). The six-layer AI team.
export type AgentRole =
  | 'architect'
  | 'requirement' | 'planner' | 'product'
  | 'frontend' | 'backend' | 'fullstack' | 'database' | 'mobile' | 'api' | 'devops' | 'infrastructure' | 'designer'
  | 'qa' | 'tester' | 'security' | 'performance' | 'accessibility' | 'reviewer'
  | 'debugger' | 'refactor' | 'optimizer'
  | 'docs' | 'researcher'
  | 'deploy' | 'monitor' | 'recovery';

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export interface TodoItem {
  id: string;
  title: string;
  status: TodoStatus;
  owner?: AgentRole;
}

export interface FileChange {
  path: string;
  kind: 'create' | 'modify' | 'delete';
}

export interface GitCheckpoint {
  id: string;
  sha: string;
  message: string;
  ts: number;
}

/** One NDJSON line from /api/agentv3/chat: an engine AgentEvent or the final result. */
export type AgentV3WireEvent =
  | { type: 'workspace'; workspaceId: string; ts: number }
  | { type: 'narration'; agent: AgentRole; text: string; ts: number; id?: string }
  | { type: 'thinking'; agent: AgentRole; text: string; ts: number }
  | { type: 'stream_delta'; agent: AgentRole; id: string; kind: 'text' | 'thinking'; delta: string; ts: number }
  | { type: 'tool_call'; agent: AgentRole; tool: string; input: unknown; callId: string; ts: number }
  | { type: 'tool_result'; agent: AgentRole; callId: string; ok: boolean; summary: string; ts: number }
  | { type: 'file_changed'; agent: AgentRole; change: FileChange; ts: number }
  | { type: 'diff'; agent: AgentRole; diff: { path: string; patch: string }; ts: number }
  | { type: 'todo_updated'; todos: TodoItem[]; ts: number }
  | { type: 'plan_updated'; plan: string; ts: number }
  | { type: 'agent_spawned'; agent: AgentRole; task: string; ts: number }
  | { type: 'permission_request'; agent: AgentRole; action: string; callId: string; ts: number }
  | { type: 'checkpoint'; checkpoint: GitCheckpoint; ts: number }
  | { type: 'preview'; url: string; ts: number }
  | { type: 'done'; ok: boolean; summary: string; ts: number }
  | { type: 'error'; message: string; ts: number }
  | { type: 'result'; ok: boolean; summary: string; steps: number; billedUsd: number; billedInr?: number };

/** One live agent card in the "AI Team" tracker (D9 — driven by REAL events only). */
export interface AgentCard {
  agent: AgentRole;
  /** Human-readable current action, e.g. "writing src/App.tsx" or "running tests". */
  lastAction: string;
  active: boolean;
  updatedTs: number;
}

export interface NarrationLine {
  agent: AgentRole;
  text: string;
  ts: number;
  /** Ties a line to its streamed deltas so a final narration finalizes (not dupes) it. */
  id?: string;
  /** 'text' = visible reply, 'thinking' = dim/italic thinking summary. */
  kind?: 'text' | 'thinking';
  /** True while the line is still receiving deltas (renders a typing cursor). */
  streaming?: boolean;
}

/** The full client view a v3.0 build renders — one source for all merged surfaces. */
export interface AgentV3ClientState {
  /** Architect/agent narration feed (chat-bubble text). */
  narration: NarrationLine[];
  /** File explorer surface — current change set. */
  files: FileChange[];
  /** Todo surface (editable in P4). */
  todos: TodoItem[];
  /** Code Studio surface — latest diff per file. */
  diffs: Record<string, string>;
  /** Terminal surface. */
  terminal: string[];
  /** Git/History surface — checkpoints. */
  checkpoints: GitCheckpoint[];
  /** Plan-mode text. */
  plan: string;
  /** Live preview URL (the running app in the sandbox), once published. */
  previewUrl?: string;
  /** A pending plan/permission gate awaiting the user's Approve/Reject (P4). */
  pendingPermission?: { callId: string; action: string };
  /** The sandbox workspace id for this build (enables History → restore). */
  workspaceId?: string;
  /** The live "AI Team" tracker, keyed by role (D9). */
  agents: Record<string, AgentCard>;
  /** Internal: bash callId → command, so a tool_result can be routed to the terminal. */
  pendingBash: Record<string, string>;
  /** Terminal state. */
  done: boolean;
  ok?: boolean;
  summary?: string;
  billedUsd?: number;
  /** Customer-facing bill in INR (billedUsd × the real-time USD→INR rate). */
  billedInr?: number;
  error?: string;
}

export function initialAgentV3State(): AgentV3ClientState {
  return {
    narration: [],
    files: [],
    todos: [],
    diffs: {},
    terminal: [],
    checkpoints: [],
    plan: '',
    agents: {},
    pendingBash: {},
    done: false,
  };
}
