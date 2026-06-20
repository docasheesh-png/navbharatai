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
}

/** One ReAct action the model outputs per turn. */
export interface ReActAction {
  thought?: string;
  action: 'reply' | 'bash' | 'edit_file' | 'patch_file' | 'browse' | 'screenshot' | 'browser_action' | 'web_search' | 'drive' | 'restore' | 'provision_db' | 'deploy' | 'done';
  args: Record<string, string>;
}

export type EngineerAgentEvent =
  | { type: 'chat_reply'; message: string }
  /** Phase 4 — high-level build plan generated before the ReAct loop starts. */
  | { type: 'plan'; steps: string[] }
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
  | { type: 'error'; message: string };
