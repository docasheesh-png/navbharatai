import { AIRouter } from '../AI/Router/AIRouter';
import { IEngineerActuator } from './actuators/IEngineerActuator';
import { ReActAction, EngineerAgentEvent, EngineerTask, SharedLoopState } from './EngineerAITypes';
import { WebSearchClient } from './WebSearchClient';
import { PlannerAgent } from './PlannerAgent';
import { CoderAgent, STEPS_PER_PLAN_STEP } from './CoderAgent';
import { deploymentService } from './DeploymentService';
import { backendScaffolder } from './BackendScaffolder';
import { CREATOR_IDENTITY, INDIA_TERRITORIAL_INTEGRITY } from '../lib/prompts';
import { extractSearchTerms, rankFiles, buildFileTree, packFileSections } from './ContextRetriever';
import { usageTracker } from './UsageTracker';
import { workspaceMemoryStore } from './WorkspaceMemoryStore';
import { AppContextInjector } from '../AppContext/AppContextInjector';

const MAX_STEPS = 60;
const DEADLINE_MS = 45 * 60 * 1000;
// Phase 4 — larger per-step observation window so full build logs stay visible.
const MAX_OBS_CHARS = 6000;
// Phase 12A — named viewports so the agent can verify responsive layouts.
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },   // iPhone 14-ish
  tablet: { width: 820, height: 1180 },  // iPad Air-ish
  desktop: { width: 1280, height: 720 },
};
// Phase 12A — cross-session project memory file (the agent records WHY decisions here).
const MEMORY_PATH = '.engineer/memory.md';
const MAX_MEMORY_CHARS = 4000;
// Phase 4 — retain more steps of history so the agent keeps long-task context.
const MAX_HISTORY_STEPS = 30;
const MAX_PARSE_RETRIES = 5;
// Steps kept verbatim; older steps are condensed into a one-line summary each.
const HISTORY_VERBATIM_TAIL = 12;
// Regex patterns that indicate a dev server started and is listening on a port.
const PORT_PATTERNS = [
  /Local(?:host)?[:\s]+(?:http:\/\/[^:]+:)?(\d{4,5})/i,
  /listening on (?:port\s+)?(\d{4,5})/i,
  /running(?:\s+at)?\s+(?:http:\/\/[^:]+:)?(\d{4,5})/i,
  /started(?:\s+server)?\s+on\s+(?:port\s+)?(\d{4,5})/i,
  /server\s+is\s+running\s+on\s+(?:port\s+)?(\d{4,5})/i,
  /:\s*(\d{4,5})\b.*(?:ready|started|running)/i,
  /running on (?:http:\/\/)?[^:]+:(\d{4,5})/i,
];

const SYSTEM_PROMPT = `You are Engineer AI — a sharp, friendly senior engineer who can both converse intelligently AND build real software autonomously. You have EYES and HANDS: you can take screenshots of running apps and SEE what the UI looks like, AND you can drive a real browser cursor to interact with any page.

You handle TWO very different kinds of requests. Read the user's message carefully and pick the right mode:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODE 1 — CONVERSATION  →  use "reply"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use this for: greetings, questions, planning, architecture discussion, technology advice,
explaining concepts, asking for clarification, brainstorming, feedback, or anything where
the user is NOT asking you to write or modify actual code/files right now.

Examples that trigger reply (in ANY language):
  "hello", "hi", "namaste", "hola"
  "what tech should I use for my app?"
  "explain how React hooks work"
  "I want to build a todo app — where do we start?"
  "what do you think about this design?"
  "kya aap meri madad kar sakte hain?" (any language)
  "app banana hai — kya plan hoga?" (planning, not yet building)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODE 2 — AUTONOMOUS CODING  →  use bash / edit_file / patch_file / screenshot / browser_action / drive / web_search / restore / provision_db / deploy / generate_tests / done
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use this when the user clearly wants you to BUILD, CREATE, MODIFY, or FIX code/files right now.

Examples that trigger coding (in ANY language):
  "build me a todo app", "app banao", "create a React dashboard"
  "fix the bug in App.tsx", "bug fix karo"
  "add dark mode", "dark mode add karo"
  "update the login component", "login component update karo"
  "write a Python script that..."
  Any clear signal — in any language, any phrasing — that they want real code changes NOW.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — always one JSON object, no markdown fences:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{ "thought": "step-by-step reasoning: (1) what is the current state and what has been done, (2) what is the single most impactful next action and why, (3) what could go wrong or what to watch for", "action": "reply"|"bash"|"edit_file"|"patch_file"|"browse"|"screenshot"|"browser_action"|"drive"|"web_search"|"restore"|"provision_db"|"deploy"|"clone_repo"|"git_push"|"generate_tests"|"done", "args": { ... } }

Action args:
  reply:          { "message": "your conversational response — can be detailed, friendly, multi-paragraph" }
  bash:           { "command": "shell command to run in the workspace" }
  edit_file:      { "path": "relative/path.tsx", "content": "FULL new file content" }
  patch_file:     { "path": "relative/path.tsx", "old_str": "exact text to replace", "new_str": "replacement" }
  restore:        { "checkpointId": "ckpt_1234567890" }
  provision_db:   { "features": "db,auth,storage" }
  deploy:         { } — builds the project then publishes dist/ to Firebase Hosting; returns a PERMANENT public URL that survives sandbox pause/restart. Use for static/SPA apps (React/Vite, Vue, Svelte, Next.js static export). Node/Python backends: use the live-preview URL instead (E2B already exposes a public HTTPS URL via server_ready).
  screenshot:     { "url": "http://localhost:3000", "viewport": "mobile"|"tablet"|"desktop" (optional — defaults to desktop) }
  browser_action: { "action": "click"|"type"|"navigate"|"scroll"|"press"|"wait"|"hover"|"double_click"|"select_option", "selector": "CSS selector", "text": "text to type / key to press / option value to select", "url": "url to navigate to", "direction": "up"|"down" }
                  — hover: move the mouse over an element (reveals dropdown menus, tooltips). double_click: open/select (e.g. select a word, expand a tree item). select_option: choose a value in a <select> dropdown (pass the option value/label in "text").
  drive:          { "steps": "[{\"action\":\"navigate\",\"url\":\"http://localhost:3000\"},{\"action\":\"click\",\"selector\":\"#btn\"}]" }
  web_search:     { "query": "what to look up — docs, error messages, package names/versions" }
  clone_repo:     { "repoUrl": "https://github.com/owner/repo" } — clones a GitHub repo INTO the workspace. Use when the user wants to work on an existing repo. The user's GitHub token (from Secrets & Keys) is used automatically for private repos.
  git_push:       { "message": "commit message", "branch": "main" (optional) } — commits ALL current changes and pushes to the repo's origin on GitHub. Requires a GITHUB_TOKEN in Settings → App Settings → Secrets & Keys. Use clone_repo first (or set a remote) so origin is known.
  restore:        { "checkpointId": "ckpt_1234567890" }
  generate_tests: {} — scans the workspace source files and writes Vitest unit tests covering the main functions, utilities, and components. Also wires up "vitest run" as the package.json test script so tests run automatically on done. Call this ONCE after the core implementation is working but BEFORE done — tests act as a quality gate.
  done:           { "summary": "one sentence describing what was accomplished" }

You can both SEE and INTERACT with the running app:
- screenshot = take a picture and look at the UI (passive — no cursor).
- browser_action = perform ONE browser interaction (active — moves the cursor). The browser session is
  persistent — cookies, form input, and the current page survive between calls. EVERY browser_action
  returns a fresh screenshot automatically with the cursor position marked.
- drive = perform MULTIPLE browser interactions in one action, streaming each step live to the user.
  The user will see your cursor moving on screen in real-time. Use drive when you want to do a complete
  multi-step verification flow (e.g. navigate → fill form → click submit → see result) without pausing
  between steps. After all drive steps complete, the final screenshot is attached to your next thinking step.

drive example — test a login form in one action:
  { "action": "drive", "args": { "steps": "[{\"action\":\"navigate\",\"url\":\"http://localhost:3000\"},{\"action\":\"type\",\"selector\":\"#email\",\"text\":\"test@example.com\"},{\"action\":\"type\",\"selector\":\"#password\",\"text\":\"secret\"},{\"action\":\"click\",\"selector\":\"button[type=submit]\"},{\"action\":\"wait\"}]" } }

browser_action examples (single step):
  Open the app:        { "action": "navigate", "url": "http://localhost:3000" }
  Fill a field:        { "action": "type", "selector": "#email", "text": "test@example.com" }
  Click a button:      { "action": "click", "selector": "button[type=submit]" }
  Press a key:         { "action": "press", "text": "Enter" }
  Scroll down:         { "action": "scroll", "direction": "down" }

Coding rules (when in MODE 2):
- Always fill "thought" with explicit step-by-step reasoning before choosing an action: (1) what has been accomplished so far, (2) exactly what the next action will do and why it is the highest-impact choice right now, (3) one specific risk to watch for. Never leave "thought" as a vague label — concrete reasoning produces better actions.
- One action per response. Wait for the observation before the next action.
- CRITICAL — write files ONE AT A TIME, never the whole app at once:
  • Each edit_file should contain ONE focused unit: one component, one route, one utility, one config file.
  • NEVER write a 300+ line file in a single edit_file. If a component is large, write a skeleton first (the structure + props), then patch_file to add logic.
  • The workspace ALREADY has a starter template (package.json, vite.config.ts, tsconfig.json, index.html, src/main.tsx). Your job is to MODIFY and ADD files on top of it — do NOT re-create boilerplate from scratch.
  • Build order for a new feature: read the existing src/App.tsx first → create the new component → patch App.tsx to add the component → bash to verify → repeat.
  • After every 2-3 files written, run bash with "npm run build" or the LOCAL binary "./node_modules/.bin/tsc --noEmit" to verify. NEVER "npx tsc" (not even --no-install): when typescript isn't installed, npx resolves "tsc" to an ancient unrelated squatter package (tsc@2.0.4) that only prints a help page and never typechecks. If "./node_modules/.bin/tsc" is missing, run "npm install typescript --save-dev" ONCE, then use the local binary. Fix ALL errors before writing more files.
  • This incremental approach shows real progress to the user AND catches errors early.
- Use patch_file for targeted changes (<30% of a file). Use edit_file for rewrites or new files.
- Use bash to install packages, run scripts, inspect files, check versions, or build the project.
- Save steps: chain multiple shell commands with \`&&\` in ONE bash action (e.g. \`npm install && npm run build\`) instead of spending a separate step on each. Steps are limited, so batch related commands.
- Use web_search when you're unsure: to confirm the correct/latest package version before installing, to read API/docs for an unfamiliar library, or to look up the fix for an error you don't recognize. Don't guess a version — search it.
- After starting a dev server: take a screenshot (or navigate via browser_action/drive) to visually verify the UI.
- Responsive check: when layout matters, screenshot at BOTH "mobile" and "desktop" viewports and fix anything that breaks at mobile width (overflow, tiny text, overlapping elements).
- Project memory: record key decisions, architecture choices, and the WHY behind them in \`.engineer/memory.md\` using edit_file (append to it — read it first if it exists). This file is automatically shown to you at the start of every future session, so future-you remembers context that isn't obvious from the code alone. Update it after any significant design decision.
- For anything interactive (forms, buttons, navigation, login): actually TEST it with browser_action or drive —
  click the buttons, fill the forms, and confirm from the returned screenshot that it works.
- If a screenshot reveals problems (wrong layout, missing elements, broken styles, errors): fix them, then re-verify.
- After a screenshot, browser_action, or drive, any RUNTIME browser errors (console.error, uncaught exceptions, failed network requests) are reported back to you automatically. Treat them as real bugs and fix them — a clean build does NOT mean the app works at runtime.
- Tests: for any app with non-trivial logic (more than 3 source files), call generate_tests ONCE after the implementation is working and the build passes. This writes Vitest unit tests for the main functions and components, wires "vitest run" into package.json scripts, and lets the automatic test gate in done catch regressions. If generated tests fail, fix the SOURCE CODE — not the tests. IMPORTANT: the test script MUST be single-run, never watch mode (use "vitest run", "jest --ci", or "node --test" — NOT bare "vitest"/"jest" which hang waiting for file changes).
- Output done only AFTER you have visually confirmed the app looks AND works correctly. No confirmation = not done.
- Paths are relative to workspace root, no leading "/" or "..".
- When starting a dev server, use port 3000 and bind to 0.0.0.0 (--host 0.0.0.0 --port 3000).
- Commands run with a 60-second timeout.
- Checkpoints are created automatically before every edit_file and patch_file action. If a change makes things worse, use restore to go back: { "action": "restore", "args": { "checkpointId": "<id from checkpoint_created event>" } }.
- Use provision_db ONCE at the start of any task that needs a database, auth (login/signup), or file uploads. It installs and starts PostgreSQL inside the sandbox, generates a DATABASE_URL + JWT_SECRET in .env, and scaffolds src/lib/db.ts / auth.ts / storage.ts helpers. Features: "db" (PostgreSQL), "auth" (bcrypt + JWT), "storage" (local filesystem). After provision_db, install required packages with bash (npm install) if not already done, then create an Express server that uses the scaffolded helpers.
- Supported project types: vite-react (default), nextjs, vue, svelte, node-express, python-fastapi, python-django, python-flask, go-gin, go-fiber, rust-axum, java-spring, php-laravel, ruby-rails, static. The workspace is scaffolded with the correct template on first use.
- Language-specific setup commands (run before starting the server):
  Python (FastAPI/Flask/Django): pip install -r requirements.txt. Run: uvicorn main:app --host 0.0.0.0 --port 3000 --reload (FastAPI) OR python manage.py runserver 0.0.0.0:3000 (Django) OR flask run --host 0.0.0.0 --port 3000 (Flask).
  Go: go mod init app && go mod tidy. Build: go build -o app . Run: ./app (bind to 0.0.0.0:3000). For Gin: import "github.com/gin-gonic/gin".
  Rust: cargo build. Run: cargo run. Bind to 0.0.0.0:3000. For Axum: add axum, tokio to Cargo.toml.
  Java (Spring Boot): mvn spring-boot:run OR ./gradlew bootRun. Port: server.port=3000 in application.properties.
  PHP: php -S 0.0.0.0:3000 (built-in server). For Laravel: php artisan serve --host 0.0.0.0 --port 3000.
  Ruby (Rails): bundle install && rails s -b 0.0.0.0 -p 3000. For plain Ruby: ruby server.rb.
- Node.js production build (Express, Fastify, Hono, etc.): use esbuild to produce a single bundled file: "npx esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js". Add esbuild to devDependencies. Use "node dist/index.js" to test the production bundle. The node-express template already includes this build script — only add it manually if you wrote your own package.json.
- Next.js static export (for Firebase Hosting deploy): add output:'export' to next.config.js so "next build" exports to out/ instead of .next/. The deploy action detects out/ automatically.
- The workspace is a git repo (auto-initialized). You can use bash to run git commands: "git status", "git log --oneline", "git diff". After major milestones, commit with "git add -A && git commit -m 'message'". The final commit is created automatically when done succeeds.`;

/**
 * Phase 12C/12D — make an uploaded filename safe to write under public/uploads:
 * strip any directory components and disallow characters, keep a sane extension.
 * Falls back to a timestamped name when nothing usable remains.
 */
function sanitizeAssetName(filename: string | undefined): string {
  const base = String(filename || '').split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80);
  return cleaned || `upload_${Date.now()}.png`;
}

function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : t;
}

function extractJson(text: string): string {
  const s = stripFences(text);
  const start = s.indexOf('{');
  if (start === -1) return s;
  // Balanced-brace scan from the first '{' to its matching '}', ignoring braces
  // that appear inside string literals (and escaped quotes). This is robust to
  // trailing prose, multiple objects, and '}' characters inside string values —
  // far more reliable than a naive lastIndexOf('}'), which is the #1 cause of
  // "model returned invalid JSON" parse failures.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  // Unbalanced (e.g. truncated output) — best-effort fall back to the last '}'.
  const end = s.lastIndexOf('}');
  return end > start ? s.slice(start, end + 1) : s.slice(start);
}

/**
 * Phase 5 — extract "owner/repo" from any GitHub URL form
 * (https://github.com/owner/repo, with/without .git, or a bare "owner/repo").
 * Returns null when the input is not a recognizable GitHub repo reference.
 */
function normalizeGithubRepo(input: string): string | null {
  if (!input) return null;
  let s = input.trim().replace(/\.git$/i, '');
  // Strip protocol + any embedded credentials + host.
  s = s.replace(/^https?:\/\/[^/]*github\.com\//i, '');
  s = s.replace(/^git@github\.com:/i, '');
  const m = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Phase 5 — never echo a GitHub token back to the user or the model. */
function redactToken(text: string, token?: string): string {
  if (!token) return text;
  return text.split(token).join('***');
}

function parseAction(raw: string): ReActAction {
  const parsed = JSON.parse(extractJson(raw));
  const action = String(parsed.action || '');
  const args: Record<string, string> = {};
  if (parsed.args && typeof parsed.args === 'object') {
    for (const [k, v] of Object.entries(parsed.args)) {
      args[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
  }
  return { thought: typeof parsed.thought === 'string' ? parsed.thought : '', action: action as ReActAction['action'], args };
}

export class EngineerAgentLoop {
  private search = new WebSearchClient();
  // Phase 9A: per-workspace queue of user click events captured from the live preview.
  // Consumed once per buildPrompt() call so the agent knows where the user clicked.
  private userClickQueue = new Map<string, { x: number; y: number; t: number }[]>();

  /** Called by the route handler when a user clicks the live preview image. */
  addUserClick(workspaceId: string, x: number, y: number): void {
    const q = this.userClickQueue.get(workspaceId) ?? [];
    q.push({ x, y, t: Date.now() });
    if (q.length > 10) q.splice(0, q.length - 10);
    this.userClickQueue.set(workspaceId, q);
  }

  private consumeUserClicks(workspaceId: string): { x: number; y: number; t: number }[] {
    const clicks = this.userClickQueue.get(workspaceId) ?? [];
    this.userClickQueue.delete(workspaceId);
    return clicks;
  }

  /** Optional context budget override — set large values when using 200k-context models. */
  private contextBudget?: { total: number; perFile: number; maxFiles: number };

  constructor(
    private router: AIRouter,
    private actuator: IEngineerActuator,
    opts?: { contextBudget?: { total: number; perFile: number; maxFiles: number } },
  ) {
    this.contextBudget = opts?.contextBudget;
  }

  async *run(task: EngineerTask, signal?: AbortSignal): AsyncGenerator<EngineerAgentEvent> {
    const { workspaceId, instruction, projectType, resumeSandboxId, attachedImage, dbConfig, githubToken, proMemorySummary, proEditLog } = task;
    let effectiveInstruction = instruction;
    const deadline = Date.now() + DEADLINE_MS;

    // Fail fast with a helpful message if no AI provider is reachable.
    yield { type: 'status', message: 'Checking AI provider…' };
    const providerOk = await this.router.hasHealthyProvider().catch(() => false);
    if (!providerOk) {
      yield {
        type: 'error',
        message:
          'Engineer AI requires GROK_API_KEY (or XAI_API_KEY) in Cloud Run → ' +
          'Edit & Deploy → Variables & Secrets. Get your key at console.x.ai',
      };
      return;
    }

    yield { type: 'status', message: resumeSandboxId ? 'Resuming workspace…' : 'Initializing workspace…' };
    try {
      await this.actuator.ensureWorkspace(workspaceId, projectType, resumeSandboxId);
    } catch (err: any) {
      yield { type: 'error', message: `Workspace init failed: ${err?.message || 'Cannot create workspace directory.'}` };
      return;
    }

    // Phase 19 — restore memory.md from Firestore if the sandbox is fresh.
    // This gives the agent continuity across sandbox recreations — it sees the
    // same [PROJECT MEMORY] block it built up in prior sessions.
    if (!resumeSandboxId) {
      try {
        const hasLocal = await this.actuator.readFile(workspaceId, MEMORY_PATH)
          .then(() => true).catch(() => false);
        if (!hasLocal) {
          const saved = await workspaceMemoryStore.load(workspaceId).catch(() => null);
          if (saved && saved.trim()) {
            await this.actuator.writeFile(workspaceId, MEMORY_PATH, saved);
            yield { type: 'status', message: 'Restored project memory from previous session.' };
          }
        }
      } catch { /* non-fatal */ }
    }

    // Phase 11A: auto-init git so the agent can commit milestones.
    // Best-effort: skip if git is unavailable or workspace already has a repo.
    if (!resumeSandboxId) {
      await this.actuator.runCommand(workspaceId,
        `git init && git config user.email "engineer-ai@navbharatai.app" && git config user.name "Engineer AI" && git add -A && git commit -m "chore: initial workspace scaffold" --allow-empty 2>&1 | tail -3`
      ).catch(() => {/* non-fatal */});
    }

    // Surface the persistent sandbox ID so the client can store it and resume later.
    try {
      const sandboxId = await this.actuator.getSandboxId(workspaceId);
      if (sandboxId) yield { type: 'workspace_saved', sandboxId };
    } catch { /* non-fatal */ }

    // Phase 14 — BYOD: auto-scaffold the DB lib file on first use if not yet written.
    // Runs best-effort so a scaffold failure never blocks the main conversation.
    let dbContextBlock = '';
    if (dbConfig) {
      const libPaths: Record<string, string> = {
        supabase: 'src/lib/supabase.ts',
        firebase: 'src/lib/firebase.ts',
        mongodb:  'src/lib/mongodb.ts',
        neon:     'src/lib/db.ts',
        appwrite: 'src/lib/appwrite.ts',
        other:    '.env',
      };
      const expectedFile = libPaths[dbConfig.provider];
      let alreadyScaffolded = false;
      try { await this.actuator.readFile(workspaceId, expectedFile); alreadyScaffolded = true; } catch { /* not yet written */ }
      if (!alreadyScaffolded) {
        try {
          const result = await backendScaffolder.scaffold(workspaceId, dbConfig, this.actuator);
          yield { type: 'backend_provisioned', provider: dbConfig.provider, filesWritten: result.filesWritten };
          if (result.npmPackages.length > 0) {
            await this.actuator.runCommand(workspaceId, `npm install ${result.npmPackages.join(' ')}`).catch(() => {});
          }
        } catch { /* non-fatal — agent can still attempt DB usage */ }
      }
      const providerLabel = dbConfig.platformName || dbConfig.provider;
      dbContextBlock = `\n\n[DATABASE CONFIGURED — ${providerLabel.toUpperCase()}]\n` +
        `The user has connected their own ${providerLabel} account. The SDK setup file is at "${expectedFile}".\n` +
        `Use this file for all database/auth operations. Do NOT call provision_db (that creates a temporary local DB).\n` +
        `The .env file already contains the user's credentials. Never ask the user for credentials again.`;
    }

    // Phase 7 — shared mutable state passed into the bounded loop so history,
    // screenshots, and preview URL accumulate across multiple plan steps.
    const shared: SharedLoopState = {
      history: [],
      consecutiveParseFailures: 0,
      lastPreviewUrl: null,
      lastScreenshot: null,
      lastConsoleCheck: Date.now(),
      globalStep: 0,
      terminated: false,
      completionEvent: null,
      providerFallbackShown: false,
    };

    // Phase 12C/12D — if the user attached an image, save it as a usable workspace
    // asset AND show it to the agent (vision) so it can replicate the design or use
    // the asset. The agent decides intent from the user's text.
    if (attachedImage?.base64) {
      const assetPath = `public/uploads/${sanitizeAssetName(attachedImage.filename)}`;
      try {
        await this.actuator.writeBinaryFile(workspaceId, assetPath, attachedImage.base64);
        shared.lastScreenshot = attachedImage.base64; // injected into the FIRST router call as a vision image
        effectiveInstruction =
          `${instruction}\n\n[ATTACHED IMAGE] The user attached an image, saved in the workspace at "${assetPath}". ` +
          `It is also shown to you visually. If the user wants this DESIGN built, replicate its layout/colors/components faithfully. ` +
          `If it is an ASSET (logo, photo, icon), reference it in the app from that path (e.g. <img src="/uploads/${sanitizeAssetName(attachedImage.filename)}">).`;
        yield { type: 'files_changed', kind: 'edit', files: [{ path: assetPath, content: `(binary image asset, ${Math.round(attachedImage.base64.length * 0.75 / 1024)} KB)` }] };
        yield { type: 'status', message: `Saved attached image to ${assetPath}` };
      } catch (err: any) {
        yield { type: 'status', message: `Could not save attached image: ${err?.message || 'write failed'}` };
      }
    }

    // Phase 7 — PlannerAgent: get a structured build plan before the ReAct loop.
    // Returns [] for conversational turns (skips multi-step orchestration).
    // Returns fallback single-step on any failure so planning never blocks the build.
    // Skipped for resumed sessions (plan already persisted in memory.md).
    let planSteps = [] as import('./PlannerAgent').PlanStep[];
    if (!resumeSandboxId && !signal?.aborted) {
      try {
        const fileTreeForPlanner = await this.actuator.listFiles(workspaceId).catch(() => [] as string[]);
        const planner = new PlannerAgent(this.router);
        planSteps = await planner.plan(
          effectiveInstruction,
          fileTreeForPlanner.slice(0, 80).join('\n'),
          signal,
        );
        if (planSteps.length > 0 && !signal?.aborted) {
          yield { type: 'plan', steps: planSteps.map(s => s.description) };
          // Persist plan to project memory so the agent can reference it in future sessions.
          const planMd = `\n\n## Build plan (${new Date().toISOString().slice(0, 10)})\n` +
            planSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n') + '\n';
          let existingMemory = '';
          try { existingMemory = await this.actuator.readFile(workspaceId, MEMORY_PATH); } catch { /* none yet */ }
          await this.actuator.writeFile(workspaceId, MEMORY_PATH, existingMemory + planMd).catch(() => {});
        }
      } catch { /* non-fatal */ }
    }

    // Phase 7 — Orchestrator: run one CoderAgent per plan step.
    // Conversational turns (planSteps=[]) run as a single unscoped bounded loop.
    const isMultiStep = planSteps.length > 0;
    const effectivePlanSteps = isMultiStep
      ? planSteps
      : [{ description: '', focusHint: '' }];

    const coderRunner = (
      task: EngineerTask,
      inst: string,
      ctx: string,
      sh: SharedLoopState,
      max: number,
      ddl: number,
      dbc: string,
      sig?: AbortSignal,
    ) => this.runBoundedLoop(task, inst, ctx, sh, max, ddl, dbc, sig);
    const coder = new CoderAgent(coderRunner);

    for (let i = 0; i < effectivePlanSteps.length; i++) {
      if (signal?.aborted) { yield { type: 'aborted' }; return; }
      if (Date.now() > deadline || shared.terminated) break;

      if (isMultiStep) {
        yield { type: 'plan_step_start', stepIndex: i, description: effectivePlanSteps[i].description };
      }

      const maxStepsForThisStep = isMultiStep ? STEPS_PER_PLAN_STEP : MAX_STEPS;
      yield* coder.runStep(
        task, effectiveInstruction, effectivePlanSteps[i],
        i, effectivePlanSteps.length, shared,
        maxStepsForThisStep, deadline, dbContextBlock, signal,
      );

      if (isMultiStep) {
        yield { type: 'plan_step_done', stepIndex: i };
      }
      if (shared.completionEvent) {
        // Phase 19 — persist memory to Firestore before completing so a fresh sandbox next
        // session can restore context without losing the decisions from this run.
        try {
          const memContent = await this.actuator.readFile(workspaceId, MEMORY_PATH);
          if (memContent.trim()) {
            await workspaceMemoryStore.save(workspaceId, memContent).catch(() => {});
          }
        } catch { /* no memory file — skip */ }
        yield shared.completionEvent;
        return;
      }
      if (shared.terminated) break;
    }

    if (!shared.terminated) {
      // Phase 19 — also persist on max_steps so a resumed session still has memory.
      try {
        const memContent = await this.actuator.readFile(workspaceId, MEMORY_PATH);
        if (memContent.trim()) {
          await workspaceMemoryStore.save(workspaceId, memContent).catch(() => {});
        }
      } catch { /* no memory file — skip */ }
      yield { type: 'max_steps_reached', steps: shared.globalStep };
    }
  }

  /**
   * Phase 7 — bounded ReAct execution loop. Runs up to `maxSteps` iterations of
   * the plan-code-observe cycle. All mutable state is stored in `shared` so it
   * persists across multiple CoderAgent steps (history, screenshots, preview URL).
   *
   * Terminal conditions (done-success, reply, error, abort, deadline) set
   * `shared.terminated = true`. For done/reply, the completion event is stored in
   * `shared.completionEvent` so the orchestrator can emit it AFTER plan_step_done.
   */
  private async *runBoundedLoop(
    task: EngineerTask,
    effectiveInstruction: string,
    stepContextPrefix: string,
    shared: SharedLoopState,
    maxSteps: number,
    deadline: number,
    dbContextBlock: string,
    signal?: AbortSignal,
  ): AsyncGenerator<EngineerAgentEvent> {
    const { workspaceId, githubToken, proMemorySummary, proEditLog, errorHints } = task;

    for (let localStep = 0; localStep < maxSteps; localStep++) {
      shared.globalStep++;
      const step = shared.globalStep;

      if (signal?.aborted) { yield { type: 'aborted' }; shared.terminated = true; return; }
      if (Date.now() > deadline) { yield { type: 'max_steps_reached', steps: step - 1 }; shared.terminated = true; return; }

      yield { type: 'status', message: `Step ${step}: reading workspace…` };
      const prompt = await this.buildPrompt(workspaceId, effectiveInstruction, shared.history, stepContextPrefix, proMemorySummary, proEditLog, errorHints);
      yield { type: 'status', message: `Step ${step}: thinking…` };

      let rawResponse: string;
      const images = shared.lastScreenshot ? [shared.lastScreenshot] : undefined;
      shared.lastScreenshot = null;
      try {
        // Phase 21 — inject app self-awareness ONLY when the user is asking about
        // NavBharatAI itself (navigation/features). Empty for normal coding turns.
        const appCtx = AppContextInjector.getRelevantContext(effectiveInstruction, 'engineer_ai');
        let effectiveSystemPrompt = dbContextBlock ? SYSTEM_PROMPT + dbContextBlock : SYSTEM_PROMPT;
        if (appCtx) effectiveSystemPrompt += `\n\n${appCtx}`;
        effectiveSystemPrompt += `\n\n${INDIA_TERRITORIAL_INTEGRITY}`; // India-first: territorial/map answers per India's official position
        effectiveSystemPrompt += `\n\n${CREATOR_IDENTITY}`; // every agent credits its creators (single source of truth)
        // Phase 1.6 — CoderAgent uses grok-3 (most capable) for accurate code generation;
        // PlannerAgent keeps grok-3-fast (default) since it only needs structured JSON.
        const { response, telemetry } = await this.router.route(prompt, effectiveSystemPrompt, images, 'grok-3');
        usageTracker.record(workspaceId, 'aiCall');
        // Phase 5.5 — provider fallback visibility: notify once per build when the
        // primary AI provider (Grok) is unavailable and a fallback took over.
        // Prevents silent degraded-mode builds where users see slow responses with
        // no explanation.
        if (telemetry.success && telemetry.retries > 0 && !shared.providerFallbackShown) {
          shared.providerFallbackShown = true;
          yield { type: 'status', message: `⚠️ Primary AI provider unavailable — using ${telemetry.provider} (${telemetry.retries} provider${telemetry.retries > 1 ? 's' : ''} tried first). Build continues normally.` };
        }
        if (!telemetry.success) {
          // Phase 5.5 — emit a typed event so clients can show a countdown retry UI.
          yield {
            type: 'providers_unavailable',
            retryAfterMs: 60000,
            message: 'All AI providers are temporarily unavailable. The service will recover automatically — please retry in about 1 minute.',
          };
          yield {
            type: 'error',
            message:
              'All AI providers are unavailable. Check: ' +
              '① GROK_API_KEY (or XAI_API_KEY) is set in Cloud Run env vars — get it at console.x.ai, ' +
              '② xAI API rate limit — wait a minute and retry, ' +
              '③ All providers may be temporarily down — check status.x.ai and wait 1–2 minutes',
          };
          shared.terminated = true;
          return;
        }
        rawResponse = response.content;
      } catch (err: any) {
        yield { type: 'error', message: `AI planning failed: ${err?.message || String(err)}` };
        shared.terminated = true;
        return;
      }

      if (signal?.aborted) { yield { type: 'aborted' }; shared.terminated = true; return; }

      let parsed: ReActAction;
      try {
        parsed = parseAction(rawResponse);
      } catch {
        shared.consecutiveParseFailures++;
        if (shared.consecutiveParseFailures >= MAX_PARSE_RETRIES) {
          yield { type: 'error', message: 'Model repeatedly returned output that was not a valid single-action JSON object.' };
          shared.terminated = true;
          return;
        }
        shared.history.push({
          step,
          actionJson: '(unparseable model output)',
          observation: 'Your last response was not a valid single-action JSON object. Respond with EXACTLY one JSON object {"thought","action","args"} and nothing else — no prose, no markdown fences.',
        });
        continue;
      }
      shared.consecutiveParseFailures = 0;

      // ── reply: conversational response ──────────────────────────────────────
      if (parsed.action === 'reply') {
        const message = parsed.args.message || parsed.thought || 'How can I help you?';
        yield { type: 'chat_reply', message };
        shared.completionEvent = { type: 'complete', summary: 'Replied.', steps: step };
        shared.terminated = true;
        return;
      }

      const thoughtFallback: Record<string, string> = {
        bash: 'Running a shell command…',
        edit_file: 'Writing a file…',
        patch_file: 'Patching a file…',
        browse: 'Fetching a URL…',
        screenshot: 'Taking a screenshot to visually verify the UI…',
        browser_action: 'Interacting with the app in the browser…',
        drive: 'Driving the browser through a multi-step flow…',
        web_search: 'Searching the web…',
        restore: 'Restoring workspace to a prior checkpoint…',
        provision_db: 'Provisioning database, auth, and storage…',
        clone_repo: 'Cloning a GitHub repository…',
        git_push: 'Committing and pushing to GitHub…',
        generate_tests: 'Generating test files…',
        done: 'Verifying the build…',
      };
      const thought = parsed.thought || thoughtFallback[parsed.action] || 'Thinking…';
      yield { type: 'action_start', step, action: parsed.action, thought };

      let observation = '';

      if (parsed.action === 'bash') {
        const command = parsed.args.command || '';
        let result: { exitCode: number; stdout: string; stderr: string };
        try {
          result = await this.actuator.runCommand(workspaceId, command);
        } catch (err: any) {
          result = { exitCode: -1, stdout: '', stderr: err?.message || String(err) };
        }
        const output = (result.stdout + result.stderr).slice(-MAX_OBS_CHARS);
        yield { type: 'command_result', command, exitCode: result.exitCode, output };

        for (const pattern of PORT_PATTERNS) {
          const m = output.match(pattern);
          if (m) {
            const port = parseInt(m[1], 10);
            if (port > 1000 && port < 65536) {
              try {
                const url = await this.actuator.getPortUrl(workspaceId, port);
                shared.lastPreviewUrl = url;
                yield { type: 'server_ready', url, port };
              } catch { /* non-fatal */ }
              break;
            }
          }
        }

        observation = `exit ${result.exitCode}:\n${output}`;
      } else if (parsed.action === 'edit_file') {
        const filePath = parsed.args.path || '';
        const content = parsed.args.content || '';
        try {
          const ckptId = await this.actuator.checkpoint(workspaceId, `before edit: ${filePath}`);
          yield { type: 'checkpoint_created', checkpointId: ckptId, createdAt: Date.now(), triggeredBy: `before edit: ${filePath}` };
        } catch { /* non-fatal */ }
        try {
          await this.actuator.writeFile(workspaceId, filePath, content);
          yield { type: 'files_changed', kind: 'edit', files: [{ path: filePath, content }] };
          observation = `File "${filePath}" written (${content.split('\n').length} lines).`;
          // Phase 18 — self-review: one focused AI call to catch hard bugs before moving on.
          const editFix = await this.reviewEditedFile(filePath, content, dbContextBlock, signal);
          if (editFix) {
            try {
              const before = await this.actuator.readFile(workspaceId, editFix.path);
              if (before.includes(editFix.oldStr)) {
                const after = before.replace(editFix.oldStr, editFix.newStr);
                await this.actuator.writeFile(workspaceId, editFix.path, after);
                yield { type: 'status', message: `Step ${step}: self-review corrected "${editFix.path}"` };
                observation += `\nSelf-review found and corrected an issue in "${editFix.path}".`;
              }
            } catch { /* non-fatal */ }
          }
        } catch (err: any) {
          observation = `Error writing "${filePath}": ${err?.message}`;
        }
      } else if (parsed.action === 'patch_file') {
        const filePath = parsed.args.path || '';
        const oldStr = parsed.args.old_str || '';
        const newStr = parsed.args.new_str ?? '';
        try {
          const ckptId = await this.actuator.checkpoint(workspaceId, `before patch: ${filePath}`);
          yield { type: 'checkpoint_created', checkpointId: ckptId, createdAt: Date.now(), triggeredBy: `before patch: ${filePath}` };
        } catch { /* non-fatal */ }
        try {
          const before = await this.actuator.readFile(workspaceId, filePath);
          if (!before.includes(oldStr)) {
            observation = `patch_file error: old_str not found in "${filePath}". File may have changed — read it again before patching.`;
          } else {
            const after = before.replace(oldStr, newStr);
            await this.actuator.writeFile(workspaceId, filePath, after);
            yield { type: 'files_changed', kind: 'patch', files: [{ path: filePath, content: after }] };
            observation = `Patched "${filePath}" successfully.`;
            // Phase 18 — self-review the patched result to catch introduced bugs.
            const patchFix = await this.reviewEditedFile(filePath, after, dbContextBlock, signal);
            if (patchFix) {
              try {
                const current = await this.actuator.readFile(workspaceId, patchFix.path);
                if (current.includes(patchFix.oldStr)) {
                  const corrected = current.replace(patchFix.oldStr, patchFix.newStr);
                  await this.actuator.writeFile(workspaceId, patchFix.path, corrected);
                  yield { type: 'status', message: `Step ${step}: self-review corrected "${patchFix.path}"` };
                  observation += `\nSelf-review found and corrected an issue in "${patchFix.path}".`;
                }
              } catch { /* non-fatal */ }
            }
          }
        } catch (err: any) {
          observation = `Error patching "${filePath}": ${err?.message}`;
        }
      } else if (parsed.action === 'restore') {
        const checkpointId = parsed.args.checkpointId || '';
        if (!checkpointId) {
          observation = 'restore error: "args.checkpointId" is required. Check the checkpoint timeline for available IDs.';
        } else {
          try {
            await this.actuator.restore(workspaceId, checkpointId);
            observation = `Workspace restored to checkpoint ${checkpointId}. Source files are back to that state — re-run the build to verify.`;
          } catch (err: any) {
            observation = `restore error: ${err?.message}`;
          }
        }
      } else if (parsed.action === 'clone_repo') {
        const repoUrl = (parsed.args.repoUrl || parsed.args.url || '').trim();
        const repoPath = normalizeGithubRepo(repoUrl);
        if (!repoPath) {
          observation = 'clone_repo error: "args.repoUrl" must be a GitHub URL like https://github.com/owner/repo.';
        } else {
          const httpsUrl = `https://github.com/${repoPath}.git`;
          const authUrl = githubToken
            ? `https://x-access-token:${githubToken}@github.com/${repoPath}.git`
            : httpsUrl;
          const cmd =
            `git clone ${authUrl} . 2>&1 && ` +
            `git remote set-url origin ${httpsUrl} && ` +
            `git config user.email "engineer-ai@navbharatai.app" && ` +
            `git config user.name "Engineer AI"`;
          let result: { exitCode: number; stdout: string; stderr: string };
          try {
            result = await this.actuator.runCommand(workspaceId, cmd);
          } catch (err: any) {
            result = { exitCode: -1, stdout: '', stderr: err?.message || String(err) };
          }
          const output = redactToken((result.stdout + result.stderr).slice(-MAX_OBS_CHARS), githubToken);
          if (result.exitCode === 0) {
            yield { type: 'repo_cloned', url: httpsUrl };
            observation = `Cloned ${httpsUrl} into the workspace.\n${output}`;
          } else {
            observation = `clone_repo failed (exit ${result.exitCode}):\n${output}`;
          }
        }
      } else if (parsed.action === 'git_push') {
        const message = parsed.args.message || 'Update from Engineer AI';
        const branch = (parsed.args.branch || '').trim();
        if (!githubToken) {
          observation =
            'git_push error: no GitHub token found. Ask the user to add a GITHUB_TOKEN in ' +
            'Settings → App Settings → Secrets & Keys, then retry.';
        } else {
          const remoteRes = await this.actuator.runCommand(workspaceId, 'git remote get-url origin 2>&1')
            .catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
          const repoPath = normalizeGithubRepo((remoteRes.stdout + remoteRes.stderr).trim());
          if (remoteRes.exitCode !== 0 || !repoPath) {
            observation =
              'git_push error: no GitHub origin remote found. Use clone_repo first, or set a ' +
              'remote with bash: git remote add origin https://github.com/owner/repo.git';
          } else {
            const authUrl = `https://x-access-token:${githubToken}@github.com/${repoPath}.git`;
            const safeMsg = message.replace(/"/g, '\\"');
            const branchSpec = branch ? `HEAD:${branch}` : 'HEAD';
            const cmd =
              `git add -A && ` +
              `(git commit -m "${safeMsg}" 2>&1 || echo "nothing to commit") && ` +
              `git push ${authUrl} ${branchSpec} 2>&1`;
            let result: { exitCode: number; stdout: string; stderr: string };
            try {
              result = await this.actuator.runCommand(workspaceId, cmd);
            } catch (err: any) {
              result = { exitCode: -1, stdout: '', stderr: err?.message || String(err) };
            }
            const output = redactToken((result.stdout + result.stderr).slice(-MAX_OBS_CHARS), githubToken);
            const httpsUrl = `https://github.com/${repoPath}`;
            if (result.exitCode === 0) {
              yield { type: 'git_pushed', url: httpsUrl };
              observation = `Pushed changes to ${httpsUrl}.\n${output}`;
            } else {
              observation = `git_push failed (exit ${result.exitCode}):\n${output}`;
            }
          }
        }
      } else if (parsed.action === 'browse') {
        const url = parsed.args.url || '';
        try {
          const result = await this.actuator.browseUrl(workspaceId, url);
          const content = result.html.slice(0, MAX_OBS_CHARS);
          yield { type: 'browse_result', url, content };
          observation = `Fetched ${url}. HTML (truncated):\n${content}`;
        } catch (err: any) {
          observation = `browse error: ${err?.message}`;
        }
      } else if (parsed.action === 'screenshot') {
        const targetUrl = parsed.args.url || shared.lastPreviewUrl || 'http://localhost:3000';
        const vpName = (parsed.args.viewport || '').toLowerCase();
        const viewport = VIEWPORTS[vpName];
        const vpLabel = viewport ? ` @ ${vpName} (${viewport.width}×${viewport.height})` : '';
        yield { type: 'status', message: `Step ${step}: taking screenshot of ${targetUrl}${vpLabel}…` };
        try {
          const shot = await this.actuator.screenshot(workspaceId, targetUrl, viewport);
          shared.lastScreenshot = shot.base64;
          yield { type: 'screenshot_result', url: targetUrl, base64: shot.base64 };
          observation = `Screenshot captured of ${targetUrl}${vpLabel}. The image has been attached to your next thinking step — look at it carefully and describe what you see, then decide what to fix.`;
        } catch (err: any) {
          observation = `screenshot error: ${err?.message}. If playwright is not installed, run: bash { "command": "npm install playwright && npx playwright install chromium" }`;
        }
      } else if (parsed.action === 'browser_action') {
        const subAction = parsed.args.action as 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait' | 'hover' | 'double_click' | 'select_option';
        const validActions = ['click', 'type', 'navigate', 'scroll', 'press', 'wait', 'hover', 'double_click', 'select_option'];
        if (!validActions.includes(subAction)) {
          observation = `browser_action error: "args.action" must be one of ${validActions.join(', ')}. Got "${subAction}".`;
        } else {
          yield { type: 'status', message: `Step ${step}: browser ${subAction}…` };
          try {
            const res = await this.actuator.browserAction(workspaceId, subAction, {
              selector: parsed.args.selector,
              text: parsed.args.text,
              url: parsed.args.url || shared.lastPreviewUrl || undefined,
              direction: parsed.args.direction === 'up' ? 'up' : 'down',
            });
            shared.lastScreenshot = res.screenshot;
            yield { type: 'browser_action_result', action: subAction, detail: res.result, base64: res.screenshot, cursorX: res.cursorX, cursorY: res.cursorY };
            observation = `${res.result}. A screenshot of the resulting page is attached to your next thinking step — look at it and decide the next action.`;
          } catch (err: any) {
            observation = `browser_action error: ${err?.message}`;
          }
        }
      } else if (parsed.action === 'drive') {
        let driveSteps: { action: string; selector?: string; text?: string; url?: string; direction?: string }[] = [];
        try {
          driveSteps = JSON.parse(parsed.args.steps || '[]');
        } catch {
          observation = 'drive error: "args.steps" must be a valid JSON array of browser action objects.';
        }
        if (driveSteps.length > 0) {
          const validDriveActions = ['click', 'type', 'navigate', 'scroll', 'press', 'wait', 'hover', 'double_click', 'select_option'];
          let driveObservations: string[] = [];
          let driveScreenshot: string | null = null;
          let driveCursorX: number | undefined;
          let driveCursorY: number | undefined;
          const driveUrl = shared.lastPreviewUrl || 'http://localhost:3000';

          for (let di = 0; di < driveSteps.length; di++) {
            if (signal?.aborted) break;
            const ds = driveSteps[di];
            const subAction = ds.action as 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait' | 'hover' | 'double_click' | 'select_option';
            if (!validDriveActions.includes(subAction)) {
              driveObservations.push(`Step ${di + 1}: unknown action "${ds.action}" — skipped.`);
              continue;
            }
            yield { type: 'status', message: `Driving step ${di + 1}/${driveSteps.length}: ${subAction}…` };
            try {
              const res = await this.actuator.browserAction(workspaceId, subAction, {
                selector: ds.selector,
                text: ds.text,
                url: ds.url || (subAction === 'navigate' ? driveUrl : undefined),
                direction: ds.direction === 'up' ? 'up' : 'down',
              });
              driveScreenshot = res.screenshot;
              driveCursorX = res.cursorX;
              driveCursorY = res.cursorY;
              const stepDetail = res.result;
              driveObservations.push(`Step ${di + 1}: ${stepDetail}`);
              yield {
                type: 'drive_frame',
                screenshot: res.screenshot,
                cursorX: res.cursorX,
                cursorY: res.cursorY,
                url: res.result.includes('now at ') ? res.result.replace(/.*now at /, '') : driveUrl,
                step: di + 1,
                stepDetail,
              };
            } catch (err: any) {
              driveObservations.push(`Step ${di + 1}: ERROR — ${err?.message}`);
            }
          }
          if (driveScreenshot) {
            shared.lastScreenshot = driveScreenshot;
            yield {
              type: 'browser_action_result',
              action: 'drive_complete',
              detail: driveObservations[driveObservations.length - 1] || 'Drive complete.',
              base64: driveScreenshot,
              cursorX: driveCursorX,
              cursorY: driveCursorY,
            };
          }
          observation = `Drive completed ${driveSteps.length} step(s):\n${driveObservations.join('\n')}\nFinal screenshot attached to your next thinking step.`;

          try {
            const checkStart = Date.now();
            const { errors } = await this.actuator.getConsoleErrors(workspaceId, shared.lastConsoleCheck);
            shared.lastConsoleCheck = checkStart;
            if (errors.length > 0) {
              yield { type: 'console_error', errors: errors.map(e => ({ kind: e.kind, text: e.text })) };
              observation += `\n\n[RUNTIME BROWSER ERRORS]\n` + errors.map(e => `• [${e.kind}] ${e.text}`).join('\n');
            }
          } catch { /* non-fatal */ }
        }
      } else if (parsed.action === 'web_search') {
        const query = parsed.args.query || parsed.args.q || '';
        if (!query.trim()) {
          observation = 'web_search error: "args.query" is required.';
        } else {
          yield { type: 'status', message: `Step ${step}: searching the web for "${query}"…` };
          try {
            const htmlFetcher = async (url: string): Promise<string> => {
              const r = await this.actuator.runCommand(
                workspaceId,
                `curl -s -L --max-time 12 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" ${JSON.stringify(url)}`,
              );
              return r.stdout || '';
            };
            const results = await this.search.search(query, 5, htmlFetcher);
            yield { type: 'search_result', query, results };
            if (results.length === 0) {
              observation = `Web search for "${query}" returned no results. Try a more specific query, or proceed with what you know.`;
            } else {
              observation = `Web search results for "${query}":\n` +
                results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
            }
          } catch (err: any) {
            observation = `web_search error: ${err?.message}. Proceed with your existing knowledge.`;
          }
        }
      } else if (parsed.action === 'provision_db') {
        const featuresRaw = (parsed.args.features || 'db,auth,storage').split(',')
          .map(f => f.trim())
          .filter((f): f is 'db' | 'auth' | 'storage' => ['db', 'auth', 'storage'].includes(f));
        const features: ('db' | 'auth' | 'storage')[] = featuresRaw.length > 0
          ? featuresRaw
          : ['db', 'auth', 'storage'];

        yield { type: 'status', message: `Step ${step}: provisioning backend (${features.join(', ')})…` };
        try {
          const result = await this.actuator.provisionBackend(workspaceId, features);

          const envLines = Object.entries(result.envVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
          try {
            const existing = await this.actuator.readFile(workspaceId, '.env');
            await this.actuator.writeFile(workspaceId, '.env', existing.trimEnd() + '\n' + envLines);
          } catch {
            await this.actuator.writeFile(workspaceId, '.env', envLines);
          }

          for (const f of result.scaffoldFiles) {
            await this.actuator.writeFile(workspaceId, f.path, f.content);
          }
          if (result.scaffoldFiles.length > 0) {
            yield { type: 'files_changed', kind: 'edit', files: result.scaffoldFiles };
          }

          const { BackendProvisioner } = await import('./BackendProvisioner');
          const pkgs = BackendProvisioner.getPackages(features);
          if (pkgs.length > 0) {
            yield { type: 'status', message: `Step ${step}: installing ${pkgs.join(', ')}…` };
            const installResult = await this.actuator.runCommand(workspaceId, `npm install ${pkgs.join(' ')} 2>&1 | tail -8`);
            yield { type: 'command_result', command: `npm install ${pkgs.join(' ')}`, exitCode: installResult.exitCode, output: installResult.stdout + installResult.stderr };
          }

          yield {
            type: 'backend_ready',
            features,
            dbUrl: result.dbUrl,
            scaffoldFiles: result.scaffoldFiles.map(f => f.path),
          };

          observation = `Backend provisioned successfully!\n` +
            `DB URL: ${result.dbUrl || '(none)'}\n` +
            `Env vars written to .env: ${Object.keys(result.envVars).join(', ')}\n` +
            `Scaffold files: ${result.scaffoldFiles.map(f => f.path).join(', ')}\n` +
            (pkgs.length > 0 ? `Packages installed: ${pkgs.join(', ')}\n` : '') +
            `\nReady-to-use helpers:\n` +
            (features.includes('db')      ? `  import { db } from './src/lib/db';       // Pool.query(sql, params)\n` : '') +
            (features.includes('auth')    ? `  import { hashPw, checkPw, signJwt, verifyJwt } from './src/lib/auth';\n` : '') +
            (features.includes('storage') ? `  import { saveFile, readFile } from './src/lib/storage';\n` : '') +
            `\nNext step: create an Express API server (e.g. server.ts) that imports these helpers, then start it with bash (e.g. "npx ts-node server.ts &").`;
        } catch (err: any) {
          observation = `provision_db error: ${err?.message}. Requires E2B sandbox with apt-get access — ensure E2B_API_KEY is set.`;
        }
      } else if (parsed.action === 'deploy') {
        yield { type: 'status', message: `Step ${step}: building for deploy…` };
        try {
          const buildResult = await this.actuator.build(workspaceId);
          yield { type: 'build_result', success: buildResult.success, logs: buildResult.logs.slice(-MAX_OBS_CHARS) };
          if (!buildResult.success) {
            observation = `Deploy aborted — build failed. Fix the errors first:\n${buildResult.logs.slice(-1500)}`;
          } else {
            yield { type: 'status', message: `Step ${step}: uploading to Firebase Hosting…` };
            const files = await this.actuator.downloadDistFiles(workspaceId);
            const url = await deploymentService.deployStatic(workspaceId, files);
            yield { type: 'deploy_result', url };
            observation =
              `App deployed successfully!\n` +
              `Permanent URL: ${url}\n` +
              `This URL stays live even when the sandbox is paused or deleted. ` +
              `Share it with anyone — no sign-in required to view it.`;
          }
        } catch (err: any) {
          const msg = err?.message || String(err);
          observation =
            `deploy error: ${msg}\n` +
            (msg.includes('403') || msg.includes('Firebase Hosting Admin')
              ? 'Fix: grant the Cloud Run service account the "Firebase Hosting Admin" IAM role in GCP Console.'
              : 'Ensure E2B_API_KEY is set and the build produced a dist/ directory.');
        }
      } else if (parsed.action === 'generate_tests') {
        yield { type: 'status', message: `Step ${step}: generating tests…` };
        const testFiles = await this.generateTestFiles(workspaceId, effectiveInstruction, signal);
        if (testFiles.length === 0) {
          observation =
            'No testable source files found, or test generation returned no results. ' +
            'Proceed — or write tests manually with edit_file if needed.';
        } else {
          const written: { path: string; content: string }[] = [];
          for (const tf of testFiles) {
            try {
              await this.actuator.writeFile(workspaceId, tf.path, tf.content);
              written.push(tf);
            } catch { /* non-fatal */ }
          }
          // Wire up "vitest run" as the test script so the done handler picks it up.
          try {
            const pkgRaw = await this.actuator.readFile(workspaceId, 'package.json');
            const pkg = JSON.parse(pkgRaw);
            if (!pkg.scripts) pkg.scripts = {};
            const existing = String(pkg.scripts.test ?? '');
            if (!existing.trim() || /no test specified/i.test(existing)) {
              pkg.scripts.test = 'vitest run';
              await this.actuator.writeFile(workspaceId, 'package.json', JSON.stringify(pkg, null, 2));
            }
          } catch { /* non-fatal — package.json may not exist yet */ }
          if (written.length > 0) {
            yield { type: 'files_changed', kind: 'edit', files: written };
          }
          observation =
            `Generated ${written.length} test file(s): ${written.map(f => f.path).join(', ')}.\n` +
            `Tests will run automatically when you call done. ` +
            `If any test fails, fix the source code — not the test file.`;
        }
      } else if (parsed.action === 'done') {
        const buildResult = await this.actuator.build(workspaceId);
        yield { type: 'build_result', success: buildResult.success, logs: buildResult.logs.slice(-MAX_OBS_CHARS) };
        if (buildResult.success) {
          yield { type: 'status', message: `Step ${step}: running tests…` };
          const testResult = await this.runProjectTests(workspaceId);
          if (testResult.ran) {
            yield { type: 'build_result', success: testResult.success, logs: `[TESTS]\n${testResult.logs}`.slice(-MAX_OBS_CHARS) };
          }
          if (testResult.ran && !testResult.success) {
            const testLogs = testResult.logs.slice(-2000);
            observation = `Build passed but TESTS FAILED — cannot mark done yet. Fix the failing tests (a red test is treated like a broken build):\n${testLogs}`;
          } else {
            const summary = parsed.args.summary || 'Task complete.';
            await this.actuator.runCommand(workspaceId,
              `git add -A && git commit -m ${JSON.stringify(`feat: ${summary.slice(0, 72)}`)} 2>&1 | tail -3`
            ).catch(() => {/* non-fatal */});
            // Store completion — orchestrator emits it after plan_step_done.
            shared.completionEvent = { type: 'complete', summary, steps: step };
            shared.terminated = true;
            return;
          }
        } else {
          const buildLogs = buildResult.logs.slice(-2000);
          const tsCodes = [...new Set((buildLogs.match(/\bTS\d{4}\b/g) || []))];
          const searchHint = tsCodes.length > 0
            ? `\n\nTypeScript error codes found: ${tsCodes.join(', ')}. Consider using web_search to look up the fix (e.g. "${tsCodes[0]} fix typescript").`
            : '';
          // Phase 71 — focused diagnosis: one targeted AI call to identify the root
          // cause before the agent's regular loop continues. Applied at most once per
          // build failure (no recursive retry chain, no runaway loop).
          const diagFix = await this.diagnoseBuildFailure(buildResult.logs, workspaceId, signal);
          if (diagFix) {
            try {
              if (diagFix.action === 'patch_file') {
                const before = await this.actuator.readFile(workspaceId, diagFix.path);
                if (before.includes(diagFix.args.old_str)) {
                  const after = before.replace(diagFix.args.old_str, diagFix.args.new_str ?? '');
                  await this.actuator.writeFile(workspaceId, diagFix.path, after);
                  yield { type: 'status', message: `Diagnosis: auto-patched "${diagFix.path}"` };
                }
              } else if (diagFix.action === 'edit_file' && diagFix.args.content) {
                await this.actuator.writeFile(workspaceId, diagFix.path, diagFix.args.content);
                yield { type: 'status', message: `Diagnosis: rewrote "${diagFix.path}"` };
              }
            } catch { /* non-fatal — agent will see the error on next done */ }
          }
          observation = `Build failed — cannot mark done yet. Fix the errors:${searchHint}\n${buildLogs}`;
        }
      } else {
        observation = `Unknown action "${parsed.action}". Valid actions: bash, edit_file, patch_file, browse, screenshot, browser_action, drive, web_search, restore, provision_db, deploy, generate_tests, done.`;
      }

      // After any browser interaction, surface runtime errors to the agent.
      if (parsed.action === 'screenshot' || parsed.action === 'browser_action') {
        try {
          const checkStart = Date.now();
          const { errors } = await this.actuator.getConsoleErrors(workspaceId, shared.lastConsoleCheck);
          shared.lastConsoleCheck = checkStart;
          if (errors.length > 0) {
            yield { type: 'console_error', errors: errors.map(e => ({ kind: e.kind, text: e.text })) };
            observation += `\n\n[RUNTIME BROWSER ERRORS — these happened in the live app, fix them]\n` +
              errors.map(e => `• [${e.kind}] ${e.text}`).join('\n');
          }
        } catch { /* non-fatal */ }
      }

      shared.history.push({
        step,
        actionJson: JSON.stringify({ action: parsed.action, args: parsed.args }),
        observation: observation.slice(-MAX_OBS_CHARS),
      });
    }
    // Step budget for this plan step exhausted — orchestrator moves to next step.
  }

  /**
   * Phase 12B — run the project's test suite if it defines a real, non-watch test
   * script. Returns ran:false when there's no intentional test script (so we never
   * fabricate a failure for projects without tests). Uses the actuator's command
   * timeout as a safety net against a mis-configured watch-mode script.
   */
  private async runProjectTests(workspaceId: string): Promise<{ ran: boolean; success: boolean; logs: string }> {
    // Detect language by characteristic files and pick the right test command
    const fileList = await this.actuator.listFiles(workspaceId).catch(() => [] as string[]);
    const hasGoTest   = fileList.some(f => f.endsWith('_test.go'));
    const hasCargoToml = fileList.some(f => f === 'Cargo.toml');
    const hasPomXml   = fileList.some(f => f === 'pom.xml');
    const hasPyTest   = fileList.some(f => /test_.*\.py$|.*_test\.py$/.test(f));
    const hasRubySpec = fileList.some(f => f.endsWith('_spec.rb'));

    let testCmd: string | null = null;
    if (hasGoTest)    testCmd = 'go test ./... 2>&1';
    else if (hasCargoToml) testCmd = 'cargo test 2>&1';
    else if (hasPomXml)   testCmd = 'mvn test -q 2>&1 || gradle test 2>&1';
    else if (hasPyTest)   testCmd = 'python -m pytest -q 2>&1';
    else if (hasRubySpec) testCmd = 'bundle exec rspec --format progress 2>&1';
    else {
      // JS/TS: use package.json test script
      let pkgRaw: string;
      try { pkgRaw = await this.actuator.readFile(workspaceId, 'package.json'); }
      catch { return { ran: false, success: true, logs: '' }; }
      let testScript = '';
      try { testScript = String(JSON.parse(pkgRaw)?.scripts?.test ?? ''); } catch { return { ran: false, success: true, logs: '' }; }
      if (!testScript.trim() || /no test specified/i.test(testScript)) return { ran: false, success: true, logs: '' };
      testCmd = 'npm test';
    }

    try {
      const result = await this.actuator.runCommand(workspaceId, testCmd);
      const logs = (result.stdout + result.stderr).slice(-MAX_OBS_CHARS);
      return { ran: true, success: result.exitCode === 0, logs };
    } catch (err: any) {
      return { ran: true, success: false, logs: err?.message || String(err) };
    }
  }

  /**
   * Phase 18 — self-review pass: one focused AI call after writing a file to catch
   * correctness bugs (missing imports, undefined variables, wrong API calls) before
   * the main loop moves on. Returns a patch to apply, or null when code looks correct.
   * Never throws — all failures degrade silently so the main loop is never blocked.
   */
  private async reviewEditedFile(
    filePath: string,
    content: string,
    dbContextBlock: string,
    signal?: AbortSignal,
  ): Promise<{ path: string; oldStr: string; newStr: string } | null> {
    if (signal?.aborted) return null;
    const reviewSystemPrompt =
      `You are a senior engineer doing a quick correctness review of code just written. ` +
      `Find ONLY hard bugs: missing imports, undefined variables, wrong function signatures, ` +
      `logic errors that would cause a runtime crash or build failure. ` +
      `Do NOT suggest style changes, naming improvements, or optional refactors. ` +
      `Output exactly one JSON object with no markdown fences:\n` +
      `• If you find a specific fixable bug: { "action": "patch_file", "args": { "path": "...", "old_str": "exact existing text", "new_str": "corrected text" } }\n` +
      `• If the code is correct (no hard bugs): { "action": "done_reviewing", "args": {} }`;
    const snippet = content.slice(0, 5000);
    const reviewPrompt =
      `Quickly review the file you just wrote for hard bugs:\n\nFile: ${filePath}\n\`\`\`\n${snippet}\n\`\`\`\n\n` +
      `Output a single patch_file action to fix the most critical bug, or done_reviewing if the code is correct.`;
    try {
      const effectiveSystem = dbContextBlock ? reviewSystemPrompt + dbContextBlock : reviewSystemPrompt;
      const { response } = await this.router.route(reviewPrompt, effectiveSystem);
      const parsed = parseAction(response.content);
      if (
        parsed.action === 'patch_file' &&
        parsed.args.path &&
        typeof parsed.args.old_str === 'string' &&
        parsed.args.old_str.length > 0
      ) {
        return { path: parsed.args.path, oldStr: parsed.args.old_str, newStr: parsed.args.new_str ?? '' };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Phase 71 — focused build-failure diagnosis. One targeted AI call that reads
   * the raw build logs and returns a single surgical fix action (patch_file or
   * edit_file) if the root cause is clear. Applied once before the agent's
   * regular ReAct loop continues — no recursion, no retry chain.
   */
  private async diagnoseBuildFailure(
    buildLogs: string,
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<{ action: 'patch_file' | 'edit_file'; path: string; args: Record<string, string> } | null> {
    if (signal?.aborted) return null;
    const diagnosisSystemPrompt =
      `You are a build-error expert. You will see raw build/compiler output. ` +
      `Identify the SINGLE root-cause error (file, line, what is wrong), then output ` +
      `exactly one JSON fix action — no markdown fences, no prose:\n` +
      `• To patch a line: { "action": "patch_file", "args": { "path": "...", "old_str": "exact existing text", "new_str": "corrected text" } }\n` +
      `• To rewrite a file: { "action": "edit_file", "args": { "path": "...", "content": "FULL corrected file content" } }\n` +
      `• If you cannot determine a targeted fix: { "action": "skip", "args": {} }`;
    const diagnosisPrompt =
      `Build failed. Identify the root cause and provide one targeted fix:\n\n` +
      `BUILD LOG (last 3000 chars):\n${buildLogs.slice(-3000)}`;
    try {
      const { response } = await this.router.route(diagnosisPrompt, diagnosisSystemPrompt);
      const parsed = parseAction(response.content);
      if ((parsed.action === 'patch_file' || parsed.action === 'edit_file') && parsed.args.path) {
        return { action: parsed.action as 'patch_file' | 'edit_file', path: parsed.args.path, args: parsed.args };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Phase 17 — generate Vitest test files for the workspace's source files.
   * Makes one focused AI call with the top source files as context.
   * Returns up to 3 test file objects, or empty array on any failure.
   */
  private async generateTestFiles(
    workspaceId: string,
    instruction: string,
    signal?: AbortSignal,
  ): Promise<{ path: string; content: string }[]> {
    if (signal?.aborted) return [];

    // Gather source files — include all supported languages
    const fileList = await this.actuator.listFiles(workspaceId).catch(() => [] as string[]);
    const srcFiles = fileList.filter(f =>
      /\.(ts|tsx|js|jsx|py|go|rs|java|php|rb)$/.test(f) &&
      !/\.test\.|\.spec\.|_test\.|_spec\.|node_modules/.test(f) &&
      !/^\.engineer\//.test(f),
    ).slice(0, 6);

    // Detect language by file extensions
    const hasGo   = fileList.some(f => f.endsWith('.go'));
    const hasRust  = fileList.some(f => f.endsWith('.rs'));
    const hasJava  = fileList.some(f => f.endsWith('.java'));
    const hasPHP   = fileList.some(f => f.endsWith('.php'));
    const hasRuby  = fileList.some(f => f.endsWith('.rb'));
    const hasPy    = fileList.some(f => f.endsWith('.py'));
    // Default: JS/TS (Vitest)

    const fileSections: string[] = [];
    for (const fp of srcFiles) {
      try {
        const content = await this.actuator.readFile(workspaceId, fp);
        fileSections.push(`// ${fp}\n${content.slice(0, 1500)}`);
      } catch { /* skip unreadable */ }
    }

    const sourceContext = fileSections.length > 0
      ? `\n\nSource files to test:\n${fileSections.join('\n\n')}`
      : '\n\n(No source files found — generate a placeholder test based on the task description.)';

    // Language-specific test framework instructions
    const langInstructions = hasGo
      ? `Use Go's built-in testing package. File naming: *_test.go. Functions: func TestXxx(t *testing.T). Run: go test ./...`
      : hasRust
      ? `Use Rust's built-in #[test] attribute. Add tests in the same file under #[cfg(test)] mod tests { }. Run: cargo test.`
      : hasJava
      ? `Use JUnit 5 (@Test annotation, import org.junit.jupiter.api.*). Place tests in src/test/java/. Run: mvn test or gradle test.`
      : hasPHP
      ? `Use PHPUnit. File naming: *Test.php. Class extends TestCase. Run: ./vendor/bin/phpunit or composer test.`
      : hasRuby
      ? `Use RSpec. File naming: *_spec.rb in spec/. describe/it/expect syntax. Run: bundle exec rspec.`
      : hasPy
      ? `Use pytest. File naming: test_*.py or *_test.py. Functions: def test_xxx(). Run: pytest.`
      : `Use Vitest (import { describe, it, expect } from 'vitest'). For React components use @testing-library/react.`;

    const testGenSystemPrompt =
      `You are a test engineer writing minimal unit tests for the language detected. ` +
      langInstructions + ` ` +
      `Focus on pure functions and testable logic — skip untestable side-effects and fetch calls. ` +
      `Output EXACTLY one JSON object with no markdown fences: ` +
      `{ "testFiles": [{ "path": "src/__tests__/app.test.ts", "content": "..." }] }`;

    const testGenPrompt =
      `Task: ${instruction.slice(0, 200)}\n` +
      `Generate 1-2 minimal test files covering the most important logic.` +
      sourceContext +
      `\n\nOutput one JSON object: { "testFiles": [{ "path": "...", "content": "..." }] }`;

    try {
      const { response } = await this.router.route(testGenPrompt, testGenSystemPrompt);
      const raw = extractJson(response.content);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.testFiles)) return [];
      return (parsed.testFiles as { path: string; content: string }[])
        .filter(f => typeof f.path === 'string' && typeof f.content === 'string' && f.path.length > 0)
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  /** Extract file paths that the agent edited/patched in recent history steps. */
  private extractEditedFiles(history: { step: number; actionJson: string; observation: string }[]): string[] {
    const files: string[] = [];
    const seen = new Set<string>();
    for (const h of history.slice(-10)) {
      try {
        const a = JSON.parse(h.actionJson);
        if ((a.action === 'edit_file' || a.action === 'patch_file') && typeof a.args?.path === 'string') {
          if (!seen.has(a.args.path)) { seen.add(a.args.path); files.push(a.args.path); }
        }
      } catch { /* skip malformed */ }
    }
    return files;
  }

  private async buildPrompt(
    workspaceId: string,
    instruction: string,
    history: { step: number; actionJson: string; observation: string }[],
    stepContextPrefix?: string,
    proMemorySummary?: string,
    proEditLog?: string[],
    errorHints?: string[],
  ): Promise<string> {
    // 1. Get full file list (paths only — always fast)
    const fileList = await this.actuator.listFiles(workspaceId);

    // Phase 2.4 — adaptive context budget: scale down verbatim history tail and
    // file budget when the session grows large (deep history OR many files).
    // Prevents prompt overflow on long multi-step builds without losing the agent's
    // view of the most recent steps (always keeps the last 6 verbatim).
    const sessionLarge = history.length > 20 || fileList.length > 50;
    const effectiveVerbatimTail = sessionLarge ? 6 : HISTORY_VERBATIM_TAIL;
    const effectiveBudgetTotal = sessionLarge
      ? Math.min(this.contextBudget?.total ?? 50_000, 60_000)
      : this.contextBudget?.total;
    const effectiveBudgetPerFile = sessionLarge ? 3_000 : this.contextBudget?.perFile;
    const effectiveBudgetMaxFiles = sessionLarge ? 20 : (this.contextBudget?.maxFiles ?? 30);

    // 2. Extract search terms from instruction + recent observations
    const recentObs = history.slice(-5).map(h => h.observation);
    const terms = extractSearchTerms(instruction, recentObs);

    // 3. grep-based relevance: find files containing the search terms
    let matchedFiles: string[] = [];
    if (terms.length > 0) {
      try {
        matchedFiles = await this.actuator.searchFiles(workspaceId, terms);
      } catch { /* non-fatal — degrade to rank-only */ }
    }

    // 4. Rank: recently-edited > grep-matched > config/entry > rest
    const recentlyEdited = this.extractEditedFiles(history);
    const ranked = rankFiles(fileList, matchedFiles, recentlyEdited);

    // 5. Read top-ranked files and pack within the context budget
    const contentMap = new Map<string, string>();
    const maxToRead = effectiveBudgetMaxFiles;
    for (const filePath of ranked.slice(0, maxToRead)) {
      try {
        contentMap.set(filePath, await this.actuator.readFile(workspaceId, filePath));
      } catch {
        contentMap.set(filePath, ''); // mark as unreadable
      }
    }
    const fileSections = packFileSections(
      ranked, contentMap,
      effectiveBudgetTotal,
      effectiveBudgetPerFile,
      effectiveBudgetMaxFiles,
    );

    // 6. Full file tree (paths only) — gives the model the overall shape
    const fileTree = buildFileTree(fileList);

    // Phase 12A: cross-session project memory — surface first so agent remembers WHY.
    let memorySection = '';
    try {
      const mem = await this.actuator.readFile(workspaceId, MEMORY_PATH);
      if (mem && mem.trim()) {
        memorySection = `[PROJECT MEMORY — decisions & architecture from earlier sessions]\n${mem.slice(0, MAX_MEMORY_CHARS)}`;
      }
    } catch { /* no memory file yet — first session */ }

    // Phase 2.3 — unified memory: prepend Pro Chat's rolling summary + edit log so
    // the agent doesn't re-reason decisions Pro already made in this workspace.
    let proMemSection = '';
    if (proMemorySummary && proMemorySummary.trim()) {
      const editLogLines = proEditLog && proEditLog.length > 0
        ? `\nRecent edits:\n${proEditLog.slice(-10).map(e => `  - ${e}`).join('\n')}`
        : '';
      proMemSection = `[PRO CHAT CONTEXT — what was built in this session]\n${proMemorySummary.slice(0, 1500)}${editLogLines}`;
    }

    // Phase 5.4 — error pattern learning: inject known-issue hints from previous
    // failed attempts and pre-build technology hints into every prompt step.
    // Capped to prevent context bloat. Injected before the file tree.
    let errorHintsSection = '';
    if (errorHints && errorHints.length > 0) {
      const hintsText = errorHints.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join('\n');
      errorHintsSection = `[KNOWN ISSUES — apply these fixes proactively]\n${hintsText}`;
    }

    const taskSection = stepContextPrefix
      ? `[TASK]\n${instruction}\n\n${stepContextPrefix}`
      : `[TASK]\n${instruction}`;
    const parts: string[] = [taskSection];
    if (proMemSection) parts.push(proMemSection);
    if (errorHintsSection) parts.push(errorHintsSection);
    if (memorySection) parts.push(memorySection);
    parts.push(
      `[WORKSPACE — FILE TREE (${fileList.length} files)]\n${fileTree}`,
      `[WORKSPACE — FILE CONTENTS (top ${fileSections.length} by relevance)]\n${fileSections.join('\n\n')}`,
    );

    if (history.length > 0) {
      const verbatim = history.slice(-effectiveVerbatimTail);
      const condensed = history.slice(0, history.length - effectiveVerbatimTail);
      const sections: string[] = [];

      if (condensed.length > 0) {
        const summary = condensed
          .map(h => {
            const action = (() => { try { return JSON.parse(h.actionJson).action; } catch { return '?'; } })();
            return `Step ${h.step}: ${action} → ${h.observation.slice(0, 120).replace(/\n/g, ' ')}`;
          })
          .join('\n');
        sections.push(`[EARLIER STEPS — condensed]\n${summary}`);
      }

      const verbatimText = verbatim
        .map(h => `Step ${h.step} — ${h.actionJson}\nObservation: ${h.observation}`)
        .join('\n\n');
      sections.push(`[RECENT STEPS]\n${verbatimText}`);

      parts.push(sections.join('\n\n'));
    }

    // Phase 9A: inject any user clicks from the live preview so the agent can act on them.
    const pendingClicks = this.consumeUserClicks(workspaceId);
    if (pendingClicks.length > 0) {
      const lines = pendingClicks.map(c => `  • (${c.x}, ${c.y})`).join('\n');
      parts.push(`[USER INTERACTIONS — the user clicked on the live preview (1280×720 viewport)]\n${lines}\nUse browser_action to interact with the element the user clicked on, or describe what's at that coordinate.`);
    }

    parts.push('[OUTPUT the next single action JSON]');
    return parts.join('\n\n');
  }
}
