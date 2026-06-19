export interface EngineerTask {
  workspaceId: string;
  instruction: string;
  /** Optional hint about the project stack — defaults to auto-detection. */
  projectType?: 'vite-react' | 'node' | 'python' | 'auto';
  /** Persisted sandbox ID to resume — restores files/node_modules/running server. */
  resumeSandboxId?: string;
}

/** One ReAct action the model outputs per turn. */
export interface ReActAction {
  thought?: string;
  action: 'reply' | 'bash' | 'edit_file' | 'patch_file' | 'browse' | 'screenshot' | 'browser_action' | 'web_search' | 'drive' | 'restore' | 'provision_db' | 'done';
  args: Record<string, string>;
}

export type EngineerAgentEvent =
  | { type: 'chat_reply'; message: string }
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
  | { type: 'backend_ready'; features: string[]; dbUrl: string; scaffoldFiles: string[] }
  | { type: 'workspace_saved'; sandboxId: string }
  | { type: 'server_ready'; url: string; port: number }
  | { type: 'status'; message: string }
  | { type: 'complete'; summary: string; steps: number }
  | { type: 'max_steps_reached'; steps: number }
  | { type: 'aborted' }
  | { type: 'error'; message: string };
