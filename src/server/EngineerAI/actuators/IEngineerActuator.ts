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
  /**
   * Return the public HTTPS URL for a port running inside the sandbox.
   * Used for live-preview when the agent starts a dev server.
   */
  getPortUrl(workspaceId: string, port: number): Promise<string>;
  /**
   * Capture a screenshot of the given URL from inside the sandbox.
   * Returns a base64-encoded PNG. Requires a real sandbox with a browser available.
   */
  screenshot(workspaceId: string, url: string): Promise<{ base64: string; mimeType: 'image/png' }>;
}
