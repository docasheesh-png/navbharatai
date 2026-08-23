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
  | { type: 'workspace'; workspaceId: string; ts: number }
  | { type: 'narration'; agent: AgentRole; text: string; ts: number; id?: string }
  | { type: 'thinking'; agent: AgentRole; text: string; ts: number }
  | { type: 'stream_delta'; agent: AgentRole; id: string; kind: 'text' | 'thinking'; delta: string; ts: number }
  | { type: 'tool_call'; agent: AgentRole; tool: ToolName; input: unknown; callId: string; ts: number }
  | { type: 'tool_result'; agent: AgentRole; callId: string; ok: boolean; summary: string; ts: number }
  | { type: 'file_changed'; agent: AgentRole; change: FileChange; ts: number }
  /**
   * What the engine is doing to this workspace right now, so the preview can stop hard-remounting a
   * running app under the person using it.
   *
   * 'settling' is the load-bearing value: the app exists and RUNS, and everything happening to it now
   * is verification and repair — mid-surgery states the user must not be shown. See
   * components/agentv3/previewReloadPolicy.ts for why the phase, and not "is the user interacting",
   * had to be the discriminator (a cross-origin iframe hides every click from us).
   */
  | { type: 'build_phase'; phase: 'generating' | 'settling' | 'idle'; ts: number }
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
  // B8 — how full the conversation's context is. Carries a PERCENTAGE and plain words only: the window
  // size differs per engine, so sending it would leak which engine ran (White-Label Law). Emitted only
  // when the reading meaningfully CHANGES, never once per turn.
  | { type: 'context_usage'; pct: number; level: 'ok' | 'high' | 'critical'; note: string; ts: number }
  /**
   * The framework the SERVER actually detected, emitted only when it DIFFERS from what the client
   * sent (2026-08-21).
   *
   * ROOT CAUSE this closes (both Mitrify "preview nahi chala" reports): the server corrects the
   * framework in two places — an import reads the real app's package.json, and the drift check reads
   * an existing workspace — but the correction only ever reached the DURABLE record and the build
   * report. So a REOPENED session started with the right answer while the session that DID the
   * correcting kept its `vite-react` default for its whole life. That stale label picked the wrong
   * in-browser preview lane and the wrong dev-server port to wait on, and the preview never came up:
   * the client was guessing about a fact the server already knew.
   */
  | { type: 'framework'; framework: string; reason: 'imported' | 'detected'; ts: number }
  | { type: 'preview'; url: string; ts: number }
  | { type: 'repo'; url: string; fullName: string; ts: number }
  // Own-repo working-branch storage is active — drives the client's "Ship to main" / "Revert" controls.
  | { type: 'own_repo'; owner: string; repo: string; workBranch: string; baseBranch: string; ts: number }
  // A read-only role chat (planner/advisor) proposed concrete build steps — the user approves them
  // into the executor's queue (they are NEVER auto-enqueued).
  | { type: 'proposed_steps'; role: 'planner' | 'advisor'; steps: string[]; ts: number }
  | { type: 'done'; ok: boolean; summary: string; ts: number; readiness?: BuildHealth }
  // GREEN STOP (admin 2026-08-12): the app is built and works; the engine noticed improvements it did
  // NOT apply (silently editing a working app is how it gets re-broken) and offers them. A richer client
  // renders per-item "fix" buttons; a plain client already has the same offer in the done summary.
  | { type: 'suggest'; kind: 'review_suggestions'; count: number; items: Array<{ title: string; detail: string; functional: boolean }>; ts: number }
  | { type: 'error'; message: string; ts: number }
  | { type: 'security_warning'; filePath: string; safe: boolean; findings: Array<{ severity: string; rule: string; description: string; line: number }>; report: string; ts: number };

/** R2 §4.6 — the objective readiness verdict surfaced to the user as a build-health card. */
export interface BuildHealth {
  score: number;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  /**
   * Was the finished app actually SEEN RUNNING — opened in a real browser and rendered?
   *
   * Absent on an older payload. It exists because a perfect score used to be the DEFAULT rather than
   * something earned: "no problems were found" and "nothing was ever checked" both produce zero
   * problems, so a build whose app never started scored the same 100/100 as one proven to work.
   */
  provenRunning?: boolean;
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
