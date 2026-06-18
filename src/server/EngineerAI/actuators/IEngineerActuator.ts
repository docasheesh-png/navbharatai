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
  /**
   * Perform a real browser interaction (click, type, navigate, scroll, press, wait)
   * against a persistent headless browser session inside the sandbox, then return
   * a screenshot of the resulting page. State (cookies, DOM, current URL) persists
   * across calls so the agent can drive a multi-step flow (e.g. fill a form, submit,
   * verify). Requires a real sandbox; LocalActuator rejects.
   */
  browserAction(
    workspaceId: string,
    action: 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait',
    args: { selector?: string; text?: string; url?: string; direction?: 'up' | 'down' },
  ): Promise<{ screenshot: string; result: string }>;
  /**
   * Return runtime browser errors (console.error, uncaught exceptions, failed
   * requests) captured since `sinceMs`. Lets the agent — and the user — see
   * runtime failures that a successful build would never reveal. Returns an
   * empty list when no browser session/errors exist.
   */
  getConsoleErrors(
    workspaceId: string,
    sinceMs: number,
  ): Promise<{ errors: { t: number; kind: string; text: string }[] }>;
}
