export interface EngineerTask {
  workspaceId: string;
  instruction: string;
}

export interface EngineerPlanEdit {
  path: string;
  content: string;
}

export interface EngineerPlan {
  done: boolean;
  summary?: string;
  edits: EngineerPlanEdit[];
}

export type EngineerAgentEvent =
  | { type: 'iteration_start'; iteration: number }
  | { type: 'plan'; summary: string; editCount: number }
  | { type: 'files_changed'; paths: string[] }
  | { type: 'build_result'; success: boolean; logs: string }
  | { type: 'complete'; summary: string; iterations: number }
  | { type: 'max_iterations_reached'; iterations: number }
  | { type: 'error'; message: string };
