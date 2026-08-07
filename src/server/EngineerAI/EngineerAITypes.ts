/**
 * Phase 14 — Bring Your Own Database.
 * User's chosen provider + credentials, stored client-side and sent with every
 * /api/engineer-chat request so the agent knows which SDK to use.
 * NEVER stored in NavBharatAI's Firestore — lives in the user's localStorage only.
 */
export interface DbProviderConfig {
  provider: 'supabase' | 'firebase' | 'mongodb' | 'neon' | 'appwrite' | 'other';
  /** Human-readable platform name (used for 'other' and display). */
  platformName?: string;
  /** Key–value pairs that go into the workspace .env and scaffold files. */
  credentials: Record<string, string>;
}

export interface EngineerTask {
  workspaceId: string;
  instruction: string;
  /** Optional hint about the project stack — defaults to auto-detection. */
  projectType?: 'vite-react' | 'nextjs' | 'vue' | 'svelte' | 'node-express' | 'python-fastapi' | 'static' | 'node' | 'python' | 'auto';
  /** Persisted sandbox ID to resume — restores files/node_modules/running server. */
  resumeSandboxId?: string;
  /**
   * Phase 12C/12D — an image the user attached to this message. It is saved into
   * the workspace as a usable asset AND shown to the agent via Grok vision so it
   * can replicate a design or use the asset (logo/photo) in the build.
   */
  attachedImage?: { base64: string; mimeType: string; filename: string };
  /** Phase 14 — user's own database provider + credentials. */
  dbConfig?: DbProviderConfig;
  /**
   * Phase 5 — the user's GitHub personal-access token, read server-side from
   * Secrets & API Keys (GITHUB_TOKEN). Used for clone_repo/git_push. Never sent by
   * the client; injected by the route so the agent can push to the user's repos.
   */
  githubToken?: string;
  /**
   * Phase 2.3 — unified memory: Pro Chat's rolling session summary + recent edit
   * log. Injected by ProEngineRunner so the agent knows what Pro already built in
   * this workspace. Prevents the agent from re-reasoning decisions Pro already made.
   */
  proMemorySummary?: string;
  proEditLog?: string[];
  /**
   * Phase 5.4 — error pattern learning: hints from previous failed attempts on this
   * session (ERESOLVE, unclosed JSX, missing module, etc.) and pre-build hints based
   * on detected technology keywords. Injected into the agent's system prompt so it
   * avoids repeating known mistakes from prior failed builds.
   */
  errorHints?: string[];
}

/**
 * Phase 7 — shared mutable state passed between the orchestrator and the bounded
 * ReAct loop so context (history, screenshots, preview URL) persists across plan steps.
 */
export interface SharedLoopState {
  history: { step: number; actionJson: string; observation: string }[];
  consecutiveParseFailures: number;
  lastPreviewUrl: string | null;
  lastScreenshot: string | null;
  lastConsoleCheck: number;
  globalStep: number;
  /** True once any terminal event (error, aborted, deadline) has been yielded. */
  terminated: boolean;
  /** Set (instead of yielding directly) when 'done' or 'reply' succeeds, so the
   *  orchestrator can emit plan_step_done BEFORE the 'complete' event. */
  completionEvent: EngineerAgentEvent | null;
  /** Phase 5.5 — set to true once the provider-fallback warning has been shown so
   *  we don't spam it on every step of a degraded-mode build. */
  providerFallbackShown: boolean;
}

/** One ReAct action the model outputs per turn. */
export interface ReActAction {
  thought?: string;
  action: 'reply' | 'bash' | 'edit_file' | 'patch_file' | 'browse' | 'screenshot' | 'browser_action' | 'web_search' | 'drive' | 'restore' | 'provision_db' | 'deploy' | 'clone_repo' | 'git_push' | 'generate_tests' | 'done';
  args: Record<string, string>;
}

export type EngineerAgentEvent =
  | { type: 'chat_reply'; message: string }
  /** Phase 4 — high-level build plan generated before the ReAct loop starts. */
  | { type: 'plan'; steps: string[] }
  /** Phase 7 — orchestrator emits these around each CoderAgent step so the UI can track progress. */
  | { type: 'plan_step_start'; stepIndex: number; description: string }
  | { type: 'plan_step_done'; stepIndex: number }
  /** Phase 5 — a GitHub repo was cloned into the workspace. */
  | { type: 'repo_cloned'; url: string }
  /** Phase 5 — changes were committed and pushed to a GitHub repo. */
  | { type: 'git_pushed'; url: string }
  | { type: 'action_start'; step: number; action: string; thought: string }
  | { type: 'command_result'; command: string; exitCode: number; output: string }
  | { type: 'files_changed'; kind: 'edit' | 'patch'; files: { path: string; content: string }[] }
  | { type: 'build_result'; success: boolean; logs: string }
  | { type: 'browse_result'; url: string; content: string }
  | { type: 'screenshot_result'; url: string; base64: string }
  | { type: 'browser_action_result'; action: string; detail: string; base64: string; cursorX?: number; cursorY?: number }
  /** Streaming frame emitted during a `drive` action — one per browser step. */
  | { type: 'drive_frame'; screenshot: string; cursorX?: number; cursorY?: number; url: string; step: number; stepDetail: string }
  | { type: 'console_error'; errors: { kind: string; text: string }[] }
  | { type: 'search_result'; query: string; results: { title: string; url: string; snippet: string }[] }
  | { type: 'checkpoint_created'; checkpointId: string; createdAt: number; triggeredBy: string }
  | { type: 'deployed'; url: string; port: number }
  /** Phase 13 — permanent Firebase Hosting URL after a real deploy. */
  | { type: 'deploy_result'; url: string }
  | { type: 'backend_ready'; features: string[]; dbUrl: string; scaffoldFiles: string[] }
  /** Phase 14 — BYOD scaffold complete: lib file + .env written for the chosen provider. */
  | { type: 'backend_provisioned'; provider: string; filesWritten: string[] }
  | { type: 'workspace_saved'; sandboxId: string }
  | { type: 'server_ready'; url: string; port: number }
  | { type: 'status'; message: string }
  | { type: 'complete'; summary: string; steps: number }
  | { type: 'max_steps_reached'; steps: number }
  | { type: 'aborted' }
  /** Phase 5.5 — all AI providers unavailable; client should show retry UI. */
  | { type: 'providers_unavailable'; retryAfterMs: number; message: string }
  | { type: 'error'; message: string };
