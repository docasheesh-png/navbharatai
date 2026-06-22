// AgentV3 (Vargen 3.0) — shared type contracts for the v3.0 agent engine.
//
// DESIGN: NAVBHARATAI_PRO_V3_DESIGN.md. This is the P0 skeleton — the type
// vocabulary plus the state/event spine that P1+ fills in. By design (strangler-
// fig) nothing in AgentV3 imports from the live Pro/Engineer build paths, so the
// module cannot affect the live app until v3.0 is explicitly enabled and proven.

/** Current build phase of the v3.0 engine. Bumped as phases land. */
export const AGENTV3_PHASE = 'P0' as const;

/** Native tool-use tool names the agent team can call (RC-1). */
export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'bash'
  | 'grep'
  | 'glob'
  | 'update_todo'
  | 'task';

/** The multi-agent team roles (§3.3). 'architect' is the lead/orchestrator. */
export type AgentRole =
  | 'architect'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'designer'
  | 'qa'
  | 'debugger'
  | 'reviewer'
  | 'deploy';

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export interface TodoItem {
  id: string;
  title: string;
  status: TodoStatus;
  /** Which agent owns this item, when delegated by the architect. */
  owner?: AgentRole;
}

export interface FileChange {
  path: string;
  kind: 'create' | 'modify' | 'delete';
}

export interface FileDiff {
  path: string;
  /** Unified-diff text (red/green) rendered live in the Code Studio surface. */
  patch: string;
}

export interface GitCheckpoint {
  id: string;
  /** Real git commit SHA in the sandbox repo (empty until committed in P1+). */
  sha: string;
  message: string;
  ts: number;
}

/**
 * Discriminated union of everything the engine broadcasts to the surfaces
 * (Preview, IDE/Code Studio, File explorer, Git, History). One vocabulary →
 * every surface stays in sync from one stream (§3.2).
 */
export type AgentEvent =
  | { type: 'narration'; agent: AgentRole; text: string; ts: number }
  | { type: 'thinking'; agent: AgentRole; text: string; ts: number }
  | { type: 'tool_call'; agent: AgentRole; tool: ToolName; input: unknown; callId: string; ts: number }
  | { type: 'tool_result'; agent: AgentRole; callId: string; ok: boolean; summary: string; ts: number }
  | { type: 'file_changed'; agent: AgentRole; change: FileChange; ts: number }
  | { type: 'diff'; agent: AgentRole; diff: FileDiff; ts: number }
  | { type: 'todo_updated'; todos: TodoItem[]; ts: number }
  | { type: 'plan_updated'; plan: string; ts: number }
  | { type: 'agent_spawned'; agent: AgentRole; task: string; ts: number }
  | { type: 'permission_request'; agent: AgentRole; action: string; callId: string; ts: number }
  | { type: 'checkpoint'; checkpoint: GitCheckpoint; ts: number }
  | { type: 'done'; ok: boolean; summary: string; ts: number }
  | { type: 'error'; message: string; ts: number };

export type AgentEventType = AgentEvent['type'];

/** A read-only snapshot a freshly-mounted surface can hydrate from. */
export interface WorkspaceSnapshot {
  files: FileChange[];
  todos: TodoItem[];
  plan: string;
  checkpoints: GitCheckpoint[];
  terminalLines: string[];
}
