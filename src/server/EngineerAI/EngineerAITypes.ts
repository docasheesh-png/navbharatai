export interface EngineerTask {
  workspaceId: string;
  instruction: string;
  /** Optional hint about the project stack — defaults to auto-detection. */
  projectType?: 'vite-react' | 'node' | 'python' | 'auto';
}

/** One ReAct action the model outputs per turn. */
export interface ReActAction {
  thought?: string;
  action: 'reply' | 'bash' | 'edit_file' | 'patch_file' | 'browse' | 'screenshot' | 'done';
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
  | { type: 'server_ready'; url: string; port: number }
  | { type: 'status'; message: string }
  | { type: 'complete'; summary: string; steps: number }
  | { type: 'max_steps_reached'; steps: number }
  | { type: 'aborted' }
  | { type: 'error'; message: string };
