export interface BackendProvisionResult {
  dbUrl: string;
  envVars: Record<string, string>;
  scaffoldFiles: { path: string; content: string }[];
  /**
   * True only when a REAL `SELECT 1` succeeded over the exact DATABASE_URL handed to the app
   * (admin task 1, 2026-08-05 — the Mitrify false-success class). `undefined` = this actuator
   * does not verify (Local/Docker stubs); callers must then not CLAIM verification either.
   */
  dbVerified?: boolean;
  /** Why verification failed, when it did — feeds the one shared outcome message. */
  dbVerifyFailure?: 'not-ready' | 'select1-failed' | 'no-output' | null;
  /**
   * WHY the database would not come up — pg_ctlcluster's own error, whether psql exists, which user
   * we are. ADMIN-ONLY: it belongs in the report's detail, never in the user's message (report
   * 15985d3b told the user the truth and still left us unable to say what to fix).
   */
  dbDiagnostics?: string;
}

export interface IEngineerActuator {
  /**
   * Prepare the workspace. If `resumeSandboxId` is provided, reconnect to that
   * (possibly paused) sandbox — restoring its files, node_modules, and any
   * running dev server — instead of creating a fresh one. Falls back to a new
   * sandbox if the resume target no longer exists.
   */
  ensureWorkspace(workspaceId: string, projectType?: string, resumeSandboxId?: string): Promise<void>;
  /**
   * Return (and CLEAR) the scaffold-template files the most recent `ensureWorkspace` seeded into a
   * fresh sandbox, as workspace-relative path→content. These bypass the write-tracking hook, so the
   * caller persists them to the durable store immediately — otherwise the scaffold's root manifests
   * (package.json etc.) only reach durable via a flaky end-of-build scan, and a later cold-sandbox
   * preview reports "No package.json found". Returns undefined when nothing was seeded (e.g. a resumed
   * sandbox that already had the workspace). Optional — actuators without a scaffold need not implement.
   */
  takeSeededScaffold?(workspaceId: string): Record<string, string> | undefined;
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
   * Make sure the project's dependencies are installed BEFORE a command that needs its binaries.
   *
   * WHY THIS EXISTS AS A WORKSPACE-LEVEL GUARANTEE (build report d6deaaf0, Mitrify, 2026-08-09):
   * the install used to be attached to the dev-server LAUNCH path only. Anything else that needs a
   * project binary ran outside that guarantee — so `npm run db:push` executed against an empty
   * node_modules and died with `sh: 1: drizzle-kit: not found` (exit 127), the app's tables were
   * never created, and every data page failed. The install is not extra work: it is the SAME install
   * the boot performs seconds later, moved ahead of the first command that depends on it.
   *
   * Optional so actuators without real isolation (Local/Docker) simply do not offer it; callers must
   * treat its absence, and a failure, as "carry on and report honestly" — never as a hard stop.
   */
  ensureDependencies?(workspaceId: string): Promise<{ ok: boolean; ran: boolean; log: string }>;
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
   * Scan the RENDERED page and return each visible element with what is needed to locate it in source
   * (class string, text, box, computed colours, and the `data-nbai-src` stamp when present).
   *
   * `scanned` distinguishes "the browser really looked and this is the page" from "the browser could
   * not look" — conflating them would let an unavailable browser masquerade as proof that an element
   * is absent, which is exactly the false confidence the find_ui_element tool exists to remove.
   * Optional: only sandboxes with a real browser implement it.
   */
  scanUiElements?(workspaceId: string, url: string): Promise<{ elements: unknown[]; scanned: boolean }>;
  /**
   * Return runtime browser errors (console.error, uncaught exceptions, failed
   * requests) captured since `sinceMs`. Lets the agent — and the user — see
   * runtime failures that a successful build would never reveal. Returns an
   * empty list when no browser session/errors exist.
   */
  getConsoleErrors(
    workspaceId: string,
    sinceMs: number,
  ): Promise<{ errors: { t: number; kind: string; text: string }[]; captured?: boolean }>;
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
