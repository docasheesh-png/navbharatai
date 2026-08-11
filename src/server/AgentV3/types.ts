// AgentV3 (Vargen 3.0) — shared type contracts for the v5.0 agent engine.
//
// DESIGN: NAVBHARATAI_PRO_V3_DESIGN.md. This is the P0 skeleton — the type
// vocabulary plus the state/event spine that P1+ fills in. By design (strangler-
// fig) nothing in AgentV3 imports from the live Pro/Engineer build paths, so the
// module cannot affect the live app until v5.0 is explicitly enabled and proven.

/** Current build phase of the v5.0 engine. Bumped as phases land. */
export const AGENTV3_PHASE = 'P3' as const;

/** Native tool-use tool names the agent team can call (RC-1). */
export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'bash'
  | 'grep'
  | 'glob'
  | 'update_todo'
  | 'update_preview'
  | 'recall'
  | 'evaluate'
  | 'generate_readme'
  | 'generate_architecture_docs'
  | 'generate_env_example'
  | 'generate_gitignore'
  | 'generate_app_defaults'
  | 'generate_openapi'
  | 'generate_api_docs'
  | 'generate_tests'
  | 'run_tests'
  | 'find_dead_code'
  | 'architecture_map'
  | 'api_graph'
  | 'code_graph'
  | 'typecheck'
  | 'check_toolchain'
  | 'check_package'
  | 'lint'
  | 'generate_observability'
  | 'generate_bundle_optimization'
  | 'generate_seed_data'
  | 'generate_auth'
  | 'generate_migration'
  | 'generate_deploy_artifacts'
  | 'replace_symbol'
  | 'check_conventions'
  | 'generate_release_notes'
  | 'codemod_rename'
  | 'codemod_add_prop'
  | 'codemod_move_file'
  | 'task'
  | 'second_opinion'
  | 'consensus'
  | 'web_search'
  | 'screenshot'
  | 'browser_action'
  | 'console_errors'
  | 'deploy';

/**
 * The multi-agent team roles (§3.3). 'architect' is the lead/orchestrator; every
 * other role is a specialist worker the Architect can delegate to via the `task`
 * tool. The roster spans the planning, development, quality, repair, knowledge
 * and operations layers (Phase 1 — Agent Orchestration). Each role has a focused
 * system prompt, a constrained tool set, and declared capabilities (see
 * AgentRegistry) so work is routed to the right specialist.
 */
export type AgentRole =
  // Lead
  | 'architect'
  // Planning layer
  | 'requirement'
  | 'planner'
  | 'product'
  // Development layer
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'database'
  | 'mobile'
  | 'api'
  | 'devops'
  | 'infrastructure'
  | 'designer'
  // Quality layer
  | 'qa'
  | 'tester'
  | 'security'
  | 'performance'
  | 'accessibility'
  | 'reviewer'
  // Repair layer
  | 'debugger'
  | 'refactor'
  | 'optimizer'
  // Knowledge layer
  | 'docs'
  | 'researcher'
  // Operations layer
  | 'deploy'
  | 'monitor'
  | 'recovery';

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
  /**
   * `lang` carries the language the PLATFORM resolved for this build (ROADMAP item 6), so the CLIENT
   * can label files in the same language without shipping a second script detector — the duplicate
   * that would drift from `LanguageDetect` and make the two halves of one feed disagree. Optional, so
   * an older client and a replayed history are unaffected.
   */
  | { type: 'workspace'; workspaceId: string; ts: number; lang?: 'en' | 'hi' }
  | { type: 'narration'; agent: AgentRole; text: string; ts: number; id?: string }
  | { type: 'thinking'; agent: AgentRole; text: string; ts: number }
  | { type: 'stream_delta'; agent: AgentRole; id: string; kind: 'text' | 'thinking'; delta: string; ts: number }
  | { type: 'tool_call'; agent: AgentRole; tool: ToolName; input: unknown; callId: string; ts: number }
  | { type: 'tool_result'; agent: AgentRole; callId: string; ok: boolean; summary: string; ts: number }
  | { type: 'file_changed'; agent: AgentRole; change: FileChange; ts: number }
  | { type: 'diff'; agent: AgentRole; diff: FileDiff; ts: number }
  | { type: 'todo_updated'; todos: TodoItem[]; ts: number }
  | { type: 'plan_updated'; plan: string; ts: number }
  | { type: 'agent_spawned'; agent: AgentRole; task: string; ts: number }
  // A DELEGATED specialist finished (or was step-capped). Deliberately distinct from 'done':
  // a sub-agent's terminal event must never mark the whole BUILD as finished/failed in the UI —
  // that is how a specialist hitting its own 40-step cap overwrote the top-level summary with
  // "Step limit reached (40)" while the Architect (cap 80) was still running.
  | { type: 'agent_done'; agent: AgentRole; ok: boolean; summary: string; ts: number }
  | { type: 'permission_request'; agent: AgentRole; action: string; callId: string; ts: number }
  // The build needs credentials from the user. Carries NAMES ONLY — the value is written straight to
  // the encrypted vault by the client and never travels on this stream (see secretRequest.ts).
  | { type: 'secret_request'; agent: AgentRole; callId: string; prompt: string; secrets: Array<{ name: string; why: string }>; ts: number }
  | { type: 'checkpoint'; checkpoint: GitCheckpoint; ts: number }
  | { type: 'preview'; url: string; ts: number }
  | { type: 'repo'; url: string; fullName: string; ts: number }
  // Own-repo working-branch storage is active — drives the client's "Ship to main" / "Revert" controls.
  | { type: 'own_repo'; owner: string; repo: string; workBranch: string; baseBranch: string; ts: number }
  // A read-only role chat (planner/advisor) proposed concrete build steps — the user approves them
  // into the executor's queue (they are NEVER auto-enqueued).
  | { type: 'proposed_steps'; role: 'planner' | 'advisor'; steps: string[]; ts: number }
  | { type: 'done'; ok: boolean; summary: string; ts: number; readiness?: BuildHealth }
  | { type: 'error'; message: string; ts: number }
  | { type: 'security_warning'; filePath: string; safe: boolean; findings: Array<{ severity: string; rule: string; description: string; line: number }>; report: string; ts: number };

/** R2 §4.6 — the objective readiness verdict surfaced to the user as a build-health card. */
export interface BuildHealth {
  score: number;
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

export type AgentEventType = AgentEvent['type'];

/** A read-only snapshot a freshly-mounted surface can hydrate from. */
export interface WorkspaceSnapshot {
  files: FileChange[];
  todos: TodoItem[];
  plan: string;
  checkpoints: GitCheckpoint[];
  terminalLines: string[];
}
