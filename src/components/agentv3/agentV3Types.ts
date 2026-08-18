// AgentV3 (Vargen 3.0) — client-side mirror of the engine's NDJSON wire format.
//
// The frontend cannot import server code (tsconfig excludes src/server), so these
// types mirror the wire contract of src/server/AgentV3/types.ts `AgentEvent` plus
// the final {type:'result'} line streamed by /api/agentv3/chat. Client and server
// communicate only via this JSON contract — normal client/server decoupling.

/**
 * User-facing cost breakdown — mirrors the server's UserCostBreakdown (routes/agentv3.ts).
 * ANONYMIZED by design (admin rule 2026-07-15): tokens + the real bill + the user's tier, branded
 * NavBharatAI. It NEVER carries a provider/model name or our internal cost/markup — the user must
 * always feel NavBharatAI did the work, not any backend AI.
 */
export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  billedUsd: number;
  billedInr: number;
  usdInrRate: number;
  tier: string;
  engine: string;
}

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
  /** B5 — the user's own name for this version. Absent (not empty) when they haven't named it. */
  label?: string;
}

/** One NDJSON line from /api/agentv3/chat: an engine AgentEvent or the final result. */
export type AgentV3WireEvent =
  | { type: 'workspace'; workspaceId: string; ts: number }
  // P0 (2026-07-12) — the ACTIVE build's unique identity, emitted at build start (and echoed on `result`),
  // so the "Build report" export can be validated to belong to THIS build (never a previous, different app).
  | { type: 'build_meta'; buildId: string; promptHash: string; workspaceId?: string; ts?: number }
  | { type: 'narration'; agent: AgentRole; text: string; ts: number; id?: string }
  | { type: 'thinking'; agent: AgentRole; text: string; ts: number }
  | { type: 'stream_delta'; agent: AgentRole; id: string; kind: 'text' | 'thinking'; delta: string; ts: number }
  | { type: 'tool_call'; agent: AgentRole; tool: string; input: unknown; callId: string; ts: number }
  | { type: 'tool_result'; agent: AgentRole; callId: string; ok: boolean; summary: string; ts: number }
  | { type: 'file_changed'; agent: AgentRole; change: FileChange; ts: number }
  | { type: 'files_restored'; files: FileChange[]; ts: number }
  | { type: 'diff'; agent: AgentRole; diff: { path: string; patch: string }; ts: number }
  | { type: 'todo_updated'; todos: TodoItem[]; ts: number }
  | { type: 'plan_updated'; plan: string; ts: number }
  | { type: 'agent_spawned'; agent: AgentRole; task: string; ts: number }
  | { type: 'agent_done'; agent: AgentRole; ok: boolean; summary: string; ts: number }
  | { type: 'permission_request'; agent: AgentRole; action: string; callId: string; ts: number }
  // The build needs credentials from the user. Carries NAMES ONLY — the value is written straight to
  // the encrypted vault by the client and never travels on this stream (see secretRequest.ts).
  | { type: 'secret_request'; agent: AgentRole; callId: string; prompt: string; secrets: Array<{ name: string; why: string }>; ts: number }
  | { type: 'checkpoint'; checkpoint: GitCheckpoint; ts: number }
  | { type: 'preview'; url: string; ts: number }
  | { type: 'repo'; url: string; fullName: string; ts: number }
  // Own-repo working-branch storage is active: edits are on `workBranch` inside the user's REAL repo,
  // to be merged into `baseBranch` via a PR. Drives the in-app "Ship to main" / "Revert" controls.
  | { type: 'own_repo'; owner: string; repo: string; workBranch: string; baseBranch: string; ts: number }
  // A read-only role chat (planner/advisor) proposed concrete build steps — shown for the USER to
  // approve into the executor's queue (never auto-enqueued).
  | { type: 'proposed_steps'; role: 'planner' | 'advisor'; steps: string[]; ts: number }
  // ASK-USER (opt-in): non-blocking clarifications the engine assumed defaults for — shown as a
  // dismissible card the user MAY answer via a follow-up; the build never waits for it.
  | { type: 'clarify'; domain: string; questions: string[]; ts: number }
  | { type: 'done'; ok: boolean; summary: string; ts: number; readiness?: BuildHealth }
  | { type: 'error'; message: string; ts: number; diagnostics?: unknown }
  | { type: 'result'; ok: boolean; summary: string; steps: number; billedUsd: number; billedInr?: number; costBreakdown?: CostBreakdown; diagnostics?: unknown; resumable?: boolean; budgetReached?: boolean; tokens?: number; planRemaining?: number; filesWritten?: number; walletTokensDebited?: number; walletTokenBalance?: number; readiness?: BuildHealth; buildId?: string; promptHash?: string };

/** One live agent card in the "AI Team" tracker (D9 — driven by REAL events only). */
export interface AgentCard {
  agent: AgentRole;
  /** Human-readable current action, e.g. "writing src/App.tsx" or "running tests". */
  lastAction: string;
  active: boolean;
  updatedTs: number;
}

/**
 * One line in the live "working…" activity feed (the Claude-style expandable indicator). Derived
 * ONLY from real engine events (tool calls, file writes, agent spawns, preview) — no synthetic
 * activity. The collapsed indicator shows the latest entry; expanding reveals the full ordered log.
 */
export interface ActivityEntry {
  /** Stable key for React + to mark a tool entry done when its result arrives. */
  id: string;
  ts: number;
  /** Coarse kind → the UI maps it to an icon. */
  kind: 'tool' | 'file' | 'agent' | 'preview' | 'plan';
  /** Human-readable action, e.g. "writing src/App.tsx" or "running: npm install". */
  text: string;
  agent?: AgentRole;
  /** True while a tool call is in-flight (renders a live cursor); cleared on its tool_result. */
  active?: boolean;
  /** Set on completion: did the tool call succeed? (used to show ✓ / ✗). */
  ok?: boolean;
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

/** The full client view a v5.0 build renders — one source for all merged surfaces. */
export interface AgentV3ClientState {
  /** Architect/agent narration feed (chat-bubble text). */
  narration: NarrationLine[];
  /** Live "working…" activity log (the expandable indicator) — ordered, capped, real events only. */
  activity: ActivityEntry[];
  /** PRIOR turns' activity (admin 2026-07-21 — "diff gayab na ho"): each new send used to wipe
   *  `activity`, so the finished build's action rows ("Created 33 files +812 -0" + its diffs)
   *  vanished from the chat. The hook archives the settled turn's entries here (deactivated,
   *  capped) so the chat timeline keeps decorating past prose forever within the session. */
  activityLog: ActivityEntry[];
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
  /** The project's GitHub repo (the user's own, or platform-org), once git-native storage runs. */
  repoUrl?: string;
  repoFullName?: string;
  /** Present when own-repo working-branch storage is active: edits live on `workBranch` in the user's
   *  REAL repo and reach `baseBranch` via a PR. Drives the "Ship to main" / "Revert last merge" UI. */
  ownRepo?: { owner: string; repo: string; workBranch: string; baseBranch: string };
  /** Steps a read-only role chat (planner/advisor) proposed this turn — the user approves them into
   *  the executor's queue via the queue UI (never auto-enqueued). */
  proposedSteps?: { role: 'planner' | 'advisor'; steps: string[] };
  /** ASK-USER (opt-in): non-blocking clarifications the engine assumed defaults for on a fresh domain
   *  build — the panel shows a dismissible card; the build never waits for an answer. */
  pendingClarify?: { domain: string; questions: string[] };
  /** A pending plan/permission gate awaiting the user's Approve/Reject (P4). */
  pendingPermission?: { callId: string; action: string };
  /** The build is waiting on credentials the user must type. Names only — values go straight to the vault. */
  pendingSecrets?: { callId: string; prompt: string; secrets: Array<{ name: string; why: string }> };
  /** The sandbox workspace id for this build (enables History → restore). */
  workspaceId?: string;
  /** P0 — the ACTIVE build's unique id + prompt hash (from `build_meta`/`result`). Echoed on the report
   *  export so the server can validate the returned report belongs to THIS build, never a different app's. */
  buildId?: string;
  promptHash?: string;
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
  /** T1-cost-transparency — the "why this build cost ₹X" breakdown (token split, tier, markup, base). */
  costBreakdown?: CostBreakdown;
  /** T1-budget-ux — the build paused ONLY because it hit the per-build budget cap (work saved, resumable). */
  budgetReached?: boolean;
  /** R2 §4.6 — the objective readiness verdict for the finished build (build-health card). */
  buildHealth?: BuildHealth;
  /** The build's diagnostics report, delivered live with the `result` event. Kept so the
   *  "Build report" button can download the copy the client already received, instead of
   *  re-fetching from per-instance server memory that a Cloud Run instance rotation or a
   *  dropped stream may have lost. */
  diagnostics?: unknown;
  /** True when the build paused at the wall-clock limit and can be auto-continued (Layer 3). */
  resumable?: boolean;
  /** SPM-3 (project mode): modules not yet done after this turn — drives the progress-monotone
   *  auto-continue guard (continue only while this number strictly decreases). */
  planRemaining?: number;
  /** FleetOps: total files written by this build so far, reported on a wall-clock PAUSE — the
   *  progress signal for the classic auto-continue (keep going while it strictly increases). */
  filesWritten?: number;
  /** P-UX.7 — total tokens (in + out) the finished build used, for the usage badge. */
  tokens?: number;
  /** Billing Phase 1 — tokens actually deducted from the user's wallet for this build. */
  walletTokensDebited?: number;
  /** Billing Phase 1 — the wallet's token balance right after the deduction (live at build end). */
  walletTokenBalance?: number;
  error?: string;
}

/** R2 §4.6 — readiness verdict shown as a build-health card after a build. */
export interface BuildHealth {
  score: number;
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

export function initialAgentV3State(): AgentV3ClientState {
  return {
    narration: [],
    activity: [],
    activityLog: [],
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
