export interface BackendProvisionResult {
  dbUrl: string;
  envVars: Record<string, string>;
  scaffoldFiles: { path: string; content: string }[];
  /**
   * True ONLY when a real `SELECT 1` succeeded over the exact URL the app is handed.
   *
   * A URL is returned either way, deliberately — `.env` must point at the local server so a
   * late-starting database heals without a rewrite. What this flag prevents is the URL's mere existence
   * being read as success, which is how an app ended up meeting ECONNREFUSED on boot while every status
   * line said the backend was provisioned.
   */
  dbVerified?: boolean;
  /** Which way it failed, when it did — so the message can say something true and specific. */
  dbVerifyFailure?: string | null;
}

export interface IEngineerActuator {
  /**
   * Prepare the workspace. If `resumeSandboxId` is provided, reconnect to that
   * (possibly paused) sandbox — restoring its files, node_modules, and any
   * running dev server — instead of creating a fresh one. Falls back to a new
   * sandbox if the resume target no longer exists.
   */
  ensureWorkspace(workspaceId: string, projectType?: string, resumeSandboxId?: string): Promise<void>;
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  /**
   * Phase 12C/12D — write a binary file (e.g. an uploaded image/logo) from a
   * base64 payload. Decodes to raw bytes so the asset is usable as-is (a UTF-8
   * string write would corrupt binary data). Used by the asset-upload route.
   */
  writeBinaryFile(workspaceId: string, filePath: string, base64: string): Promise<void>;
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
   * Optional `viewport` sets the browser window size so the agent can verify
   * responsive layouts (e.g. mobile vs desktop). Defaults to 1280×720.
   */
  screenshot(
    workspaceId: string,
    url: string,
    viewport?: { width: number; height: number },
  ): Promise<{ base64: string; mimeType: 'image/png' }>;
  /**
   * Perform a real browser interaction (click, type, navigate, scroll, press, wait)
   * against a persistent headless browser session inside the sandbox, then return
   * a screenshot of the resulting page. State (cookies, DOM, current URL) persists
   * across calls so the agent can drive a multi-step flow (e.g. fill a form, submit,
   * verify). Requires a real sandbox; LocalActuator rejects.
   */
  browserAction(
    workspaceId: string,
    action: 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait' | 'hover' | 'double_click' | 'select_option',
    args: { selector?: string; text?: string; url?: string; direction?: 'up' | 'down' },
  ): Promise<{ screenshot: string; result: string; cursorX?: number; cursorY?: number }>;
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
  /**
   * Return the persistent sandbox ID backing this workspace, or null when there
   * is no real sandbox (LocalActuator). The client stores this and sends it back
   * as `resumeSandboxId` next session to continue the same workspace.
   */
  getSandboxId(workspaceId: string): Promise<string | null>;
  /**
   * Pause a sandbox by ID to stop compute billing while preserving full state
   * for a later resume. Works across server instances (operates on the cloud
   * resource by ID). LocalActuator is a no-op. Returns true if paused.
   */
  pauseSandbox(sandboxId: string): Promise<boolean>;
  /**
   * Search for workspace files whose content matches ANY of the given terms
   * (grep -rl style). Used by ContextRetriever to rank files by relevance to
   * the current task. Skips node_modules/.git/dist. Returns relative paths.
   * LocalActuator returns [] (no subprocess available in sandboxed deploys).
   */
  searchFiles(workspaceId: string, terms: string[]): Promise<string[]>;
  /**
   * Create a lightweight snapshot of the workspace source files (excludes
   * node_modules/dist/.git) and return a unique checkpoint ID. Called
   * automatically before every mutating action (edit_file, patch_file) so
   * the user can restore to any prior state with a single click.
   */
  checkpoint(workspaceId: string, triggeredBy?: string): Promise<string>;
  /**
   * Restore the workspace to a previously created checkpoint. The workspace
   * source files are overwritten with the snapshot; node_modules/dist are
   * left untouched so the next build doesn't need a full reinstall.
   */
  restore(workspaceId: string, checkpointId: string): Promise<void>;
  /**
   * Phase 10 — Provision a local backend inside the sandbox:
   * - 'db':      install + start PostgreSQL, create a 'myapp' database, return the
   *              DATABASE_URL connection string.
   * - 'auth':    generate a JWT_SECRET env var.
   * - 'storage': set up a local STORAGE_DIR path.
   * Also returns ready-to-use scaffold files (src/lib/db.ts, auth.ts, storage.ts)
   * and the npm packages that should be installed for the requested features.
   * LocalActuator throws — provisioning requires a real sandbox (set E2B_API_KEY).
   */
  provisionBackend(workspaceId: string, features: ('db' | 'auth' | 'storage')[]): Promise<BackendProvisionResult>;
  /**
   * Phase 13 — Download the built dist/ directory from the workspace as a
   * Map<relativePath, fileBuffer>. Used by DeploymentService to upload files
   * to Firebase Hosting for a permanent public URL.
   * LocalActuator throws — Firebase deploy requires a real E2B sandbox.
   */
  downloadDistFiles(workspaceId: string): Promise<Map<string, Buffer>>;
}
