export interface IEngineerActuator {
  ensureWorkspace(workspaceId: string, projectType?: string): Promise<void>;
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  readFile(workspaceId: string, filePath: string): Promise<string>;
  listFiles(workspaceId: string): Promise<string[]>;
  build(workspaceId: string): Promise<{ success: boolean; logs: string }>;
  /**
   * Run an arbitrary shell command in the workspace. Only safe to support
   * when the actuator provides real OS-level isolation (e.g. a sandbox VM) —
   * implementations without that isolation should reject instead of executing
   * in the server's own process.
   */
  runCommand(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /**
   * Fetch a URL from inside the sandbox and return the HTML body.
   * Requires a real sandbox; LocalActuator rejects for the same reason as runCommand.
   */
  browseUrl(workspaceId: string, url: string): Promise<{ html: string }>;
}
