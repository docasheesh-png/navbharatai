import { AIRouter } from '../AI/Router/AIRouter';
import { IEngineerActuator } from './actuators/IEngineerActuator';
import { ReActAction, EngineerAgentEvent, EngineerTask } from './EngineerAITypes';
import { WebSearchClient } from './WebSearchClient';
import { extractSearchTerms, rankFiles, buildFileTree, packFileSections } from './ContextRetriever';

const MAX_STEPS = 24;
const DEADLINE_MS = 8 * 60 * 1000;
const MAX_OBS_CHARS = 3000;
// Phase 12A — named viewports so the agent can verify responsive layouts.
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },   // iPhone 14-ish
  tablet: { width: 820, height: 1180 },  // iPad Air-ish
  desktop: { width: 1280, height: 720 },
};
// Phase 12A — cross-session project memory file (the agent records WHY decisions here).
const MEMORY_PATH = '.engineer/memory.md';
const MAX_MEMORY_CHARS = 4000;
const MAX_HISTORY_STEPS = 20;
const MAX_PARSE_RETRIES = 3;
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
MODE 2 — AUTONOMOUS CODING  →  use bash / edit_file / patch_file / screenshot / browser_action / drive / web_search / restore / provision_db / done
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

{ "thought": "one-sentence reasoning", "action": "reply"|"bash"|"edit_file"|"patch_file"|"browse"|"screenshot"|"browser_action"|"drive"|"web_search"|"restore"|"provision_db"|"done", "args": { ... } }

Action args:
  reply:          { "message": "your conversational response — can be detailed, friendly, multi-paragraph" }
  bash:           { "command": "shell command to run in the workspace" }
  edit_file:      { "path": "relative/path.tsx", "content": "FULL new file content" }
  patch_file:     { "path": "relative/path.tsx", "old_str": "exact text to replace", "new_str": "replacement" }
  restore:        { "checkpointId": "ckpt_1234567890" }
  provision_db:   { "features": "db,auth,storage" }
  screenshot:     { "url": "http://localhost:3000", "viewport": "mobile"|"tablet"|"desktop" (optional — defaults to desktop) }
  browser_action: { "action": "click"|"type"|"navigate"|"scroll"|"press"|"wait", "selector": "CSS selector", "text": "text to type / key to press", "url": "url to navigate to", "direction": "up"|"down" }
  drive:          { "steps": "[{\"action\":\"navigate\",\"url\":\"http://localhost:3000\"},{\"action\":\"click\",\"selector\":\"#btn\"}]" }
  web_search:     { "query": "what to look up — docs, error messages, package names/versions" }
  restore:        { "checkpointId": "ckpt_1234567890" }
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
- One action per response. Wait for the observation before the next action.
- Use patch_file for targeted changes (<30% of a file). Use edit_file for rewrites or new files.
- Use bash to install packages, run scripts, inspect files, check versions, or build the project.
- Use web_search when you're unsure: to confirm the correct/latest package version before installing, to read API/docs for an unfamiliar library, or to look up the fix for an error you don't recognize. Don't guess a version — search it.
- After starting a dev server: take a screenshot (or navigate via browser_action/drive) to visually verify the UI.
- Responsive check: when layout matters, screenshot at BOTH "mobile" and "desktop" viewports and fix anything that breaks at mobile width (overflow, tiny text, overlapping elements).
- Project memory: record key decisions, architecture choices, and the WHY behind them in ${'`.engineer/memory.md`'} using edit_file (append to it — read it first if it exists). This file is automatically shown to you at the start of every future session, so future-you remembers context that isn't obvious from the code alone. Update it after any significant design decision.
- For anything interactive (forms, buttons, navigation, login): actually TEST it with browser_action or drive —
  click the buttons, fill the forms, and confirm from the returned screenshot that it works.
- If a screenshot reveals problems (wrong layout, missing elements, broken styles, errors): fix them, then re-verify.
- After a screenshot, browser_action, or drive, any RUNTIME browser errors (console.error, uncaught exceptions, failed network requests) are reported back to you automatically. Treat them as real bugs and fix them — a clean build does NOT mean the app works at runtime.
- Tests: for non-trivial logic, write tests and make sure they pass. When you mark done, if the project's package.json has a "test" script it is run automatically and a FAILING test blocks done exactly like a broken build — so fix red tests before declaring done. IMPORTANT: the test script MUST be single-run, never watch mode (use "vitest run", "jest --ci", or "node --test" — NOT bare "vitest"/"jest" which hang waiting for file changes).
- Output done only AFTER you have visually confirmed the app looks AND works correctly. No confirmation = not done.
- Paths are relative to workspace root, no leading "/" or "..".
- When starting a dev server, use port 3000 and bind to 0.0.0.0 (--host 0.0.0.0 --port 3000).
- Commands run with a 60-second timeout.
- Checkpoints are created automatically before every edit_file and patch_file action. If a change makes things worse, use restore to go back: { "action": "restore", "args": { "checkpointId": "<id from checkpoint_created event>" } }.
- Use provision_db ONCE at the start of any task that needs a database, auth (login/signup), or file uploads. It installs and starts PostgreSQL inside the sandbox, generates a DATABASE_URL + JWT_SECRET in .env, and scaffolds src/lib/db.ts / auth.ts / storage.ts helpers. Features: "db" (PostgreSQL), "auth" (bcrypt + JWT), "storage" (local filesystem). After provision_db, install required packages with bash (npm install) if not already done, then create an Express server that uses the scaffolded helpers.
- Supported project types: vite-react (default), nextjs, vue, svelte, node-express, python-fastapi, static. The workspace is scaffolded with the correct template on first use. For Python (python-fastapi) projects: start the server with "uvicorn main:app --host 0.0.0.0 --port 3000 --reload" and install deps with "pip install -r requirements.txt". For static sites: no build step; open index.html directly in the browser.
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
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return s;
  return s.slice(start, end + 1);
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

  constructor(private router: AIRouter, private actuator: IEngineerActuator) {}

  async *run(task: EngineerTask, signal?: AbortSignal): AsyncGenerator<EngineerAgentEvent> {
    const { workspaceId, instruction, projectType, resumeSandboxId, attachedImage } = task;
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

    const history: { step: number; actionJson: string; observation: string }[] = [];
    let consecutiveParseFailures = 0;
    let lastPreviewUrl: string | null = null;  // updated when server_ready fires
    let lastScreenshot: string | null = null;  // base64 PNG — injected into next Grok call
    let lastConsoleCheck = Date.now();          // Phase 4 — runtime error watermark

    // Phase 12C/12D — if the user attached an image, save it as a usable workspace
    // asset AND show it to the agent (vision) so it can replicate the design or use
    // the asset. The agent decides intent from the user's text.
    if (attachedImage?.base64) {
      const assetPath = `public/uploads/${sanitizeAssetName(attachedImage.filename)}`;
      try {
        await this.actuator.writeBinaryFile(workspaceId, assetPath, attachedImage.base64);
        lastScreenshot = attachedImage.base64; // injected into the FIRST router call as a vision image
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

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (signal?.aborted) { yield { type: 'aborted' }; return; }
      if (Date.now() > deadline) { yield { type: 'max_steps_reached', steps: step - 1 }; return; }

      yield { type: 'status', message: `Step ${step}: reading workspace…` };
      const prompt = await this.buildPrompt(workspaceId, effectiveInstruction, history);
      yield { type: 'status', message: `Step ${step}: thinking…` };

      // Router/provider failure is a real infra error — abort. Malformed model
      // output is recoverable — feed the parse error back and let it retry.
      let rawResponse: string;
      const images = lastScreenshot ? [lastScreenshot] : undefined;
      lastScreenshot = null; // consume: each screenshot is used exactly once
      try {
        const { response, telemetry } = await this.router.route(prompt, SYSTEM_PROMPT, images);
        if (!telemetry.success) {
          // All providers failed (budget exhausted, wrong key, rate-limit, etc.)
          yield {
            type: 'error',
            message:
              'Grok API call failed. Check: ' +
              '① GROK_API_KEY (or XAI_API_KEY) is set correctly in Cloud Run env vars — get it at console.x.ai, ' +
              '② xAI API rate limit — wait a minute and retry, ' +
              '③ xAI API is temporarily down — check status.x.ai',
          };
          return;
        }
        rawResponse = response.content;
      } catch (err: any) {
        yield { type: 'error', message: `AI planning failed: ${err?.message || String(err)}` };
        return;
      }

      if (signal?.aborted) { yield { type: 'aborted' }; return; }

      let parsed: ReActAction;
      try {
        parsed = parseAction(rawResponse);
      } catch {
        consecutiveParseFailures++;
        if (consecutiveParseFailures >= MAX_PARSE_RETRIES) {
          yield { type: 'error', message: 'Model repeatedly returned output that was not a valid single-action JSON object.' };
          return;
        }
        history.push({
          step,
          actionJson: '(unparseable model output)',
          observation: 'Your last response was not a valid single-action JSON object. Respond with EXACTLY one JSON object {"thought","action","args"} and nothing else — no prose, no markdown fences.',
        });
        continue;
      }
      consecutiveParseFailures = 0;

      // ── reply: conversational response, no coding needed ──────────────────
      if (parsed.action === 'reply') {
        const message = parsed.args.message || parsed.thought || 'How can I help you?';
        yield { type: 'chat_reply', message };
        yield { type: 'complete', summary: 'Replied.', steps: step };
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

        // Detect a dev server starting — emit a live-preview URL
        for (const pattern of PORT_PATTERNS) {
          const m = output.match(pattern);
          if (m) {
            const port = parseInt(m[1], 10);
            if (port > 1000 && port < 65536) {
              try {
                const url = await this.actuator.getPortUrl(workspaceId, port);
                lastPreviewUrl = url;
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
        // Auto-checkpoint before every write so the user can restore if needed.
        try {
          const ckptId = await this.actuator.checkpoint(workspaceId, `before edit: ${filePath}`);
          yield { type: 'checkpoint_created', checkpointId: ckptId, createdAt: Date.now(), triggeredBy: `before edit: ${filePath}` };
        } catch { /* non-fatal — proceed even if checkpoint fails */ }
        try {
          await this.actuator.writeFile(workspaceId, filePath, content);
          yield { type: 'files_changed', kind: 'edit', files: [{ path: filePath, content }] };
          observation = `File "${filePath}" written (${content.split('\n').length} lines).`;
        } catch (err: any) {
          observation = `Error writing "${filePath}": ${err?.message}`;
        }
      } else if (parsed.action === 'patch_file') {
        const filePath = parsed.args.path || '';
        const oldStr = parsed.args.old_str || '';
        const newStr = parsed.args.new_str ?? '';
        // Auto-checkpoint before every patch so the user can restore if needed.
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
        const targetUrl = parsed.args.url || lastPreviewUrl || 'http://localhost:3000';
        // Phase 12A — optional named viewport (mobile/tablet/desktop) for responsive checks.
        const vpName = (parsed.args.viewport || '').toLowerCase();
        const viewport = VIEWPORTS[vpName];
        const vpLabel = viewport ? ` @ ${vpName} (${viewport.width}×${viewport.height})` : '';
        yield { type: 'status', message: `Step ${step}: taking screenshot of ${targetUrl}${vpLabel}…` };
        try {
          const shot = await this.actuator.screenshot(workspaceId, targetUrl, viewport);
          lastScreenshot = shot.base64; // injected into the NEXT router call as a vision image
          yield { type: 'screenshot_result', url: targetUrl, base64: shot.base64 };
          observation = `Screenshot captured of ${targetUrl}${vpLabel}. The image has been attached to your next thinking step — look at it carefully and describe what you see, then decide what to fix.`;
        } catch (err: any) {
          observation = `screenshot error: ${err?.message}. If playwright is not installed, run: bash { "command": "npm install playwright && npx playwright install chromium" }`;
        }
      } else if (parsed.action === 'browser_action') {
        const subAction = parsed.args.action as 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait';
        const validActions = ['click', 'type', 'navigate', 'scroll', 'press', 'wait'];
        if (!validActions.includes(subAction)) {
          observation = `browser_action error: "args.action" must be one of ${validActions.join(', ')}. Got "${subAction}".`;
        } else {
          yield { type: 'status', message: `Step ${step}: browser ${subAction}…` };
          try {
            const res = await this.actuator.browserAction(workspaceId, subAction, {
              selector: parsed.args.selector,
              text: parsed.args.text,
              url: parsed.args.url || lastPreviewUrl || undefined,
              direction: parsed.args.direction === 'up' ? 'up' : 'down',
            });
            lastScreenshot = res.screenshot; // attached to next router call as a vision image
            yield { type: 'browser_action_result', action: subAction, detail: res.result, base64: res.screenshot, cursorX: res.cursorX, cursorY: res.cursorY };
            observation = `${res.result}. A screenshot of the resulting page is attached to your next thinking step — look at it and decide the next action.`;
          } catch (err: any) {
            observation = `browser_action error: ${err?.message}`;
          }
        }
      } else if (parsed.action === 'drive') {
        // Multi-step browser driving — executes each step and streams a drive_frame event
        // per step so the user sees the cursor moving in real-time on the live preview.
        let driveSteps: { action: string; selector?: string; text?: string; url?: string; direction?: string }[] = [];
        try {
          driveSteps = JSON.parse(parsed.args.steps || '[]');
        } catch {
          observation = 'drive error: "args.steps" must be a valid JSON array of browser action objects.';
        }
        if (driveSteps.length > 0) {
          const validActions = ['click', 'type', 'navigate', 'scroll', 'press', 'wait'];
          let driveObservations: string[] = [];
          let driveScreenshot: string | null = null;
          let driveCursorX: number | undefined;
          let driveCursorY: number | undefined;
          const driveUrl = lastPreviewUrl || 'http://localhost:3000';

          for (let di = 0; di < driveSteps.length; di++) {
            if (signal?.aborted) break;
            const ds = driveSteps[di];
            const subAction = ds.action as 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait';
            if (!validActions.includes(subAction)) {
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
              // Stream a drive_frame so the frontend can show the cursor moving live
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
          // After all steps: attach the final screenshot for the next AI think step
          if (driveScreenshot) {
            lastScreenshot = driveScreenshot;
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

          // Collect runtime errors after the drive sequence
          try {
            const checkStart = Date.now();
            const { errors } = await this.actuator.getConsoleErrors(workspaceId, lastConsoleCheck);
            lastConsoleCheck = checkStart;
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
            // Fetch the SERP from INSIDE the sandbox (open internet) rather than the
            // egress-restricted server. Falls back to server-side fetch if it errors.
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

          // Write or append .env
          const envLines = Object.entries(result.envVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
          try {
            const existing = await this.actuator.readFile(workspaceId, '.env');
            await this.actuator.writeFile(workspaceId, '.env', existing.trimEnd() + '\n' + envLines);
          } catch {
            await this.actuator.writeFile(workspaceId, '.env', envLines);
          }

          // Write scaffold files
          for (const f of result.scaffoldFiles) {
            await this.actuator.writeFile(workspaceId, f.path, f.content);
          }
          if (result.scaffoldFiles.length > 0) {
            yield { type: 'files_changed', kind: 'edit', files: result.scaffoldFiles };
          }

          // Install required npm packages
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
      } else if (parsed.action === 'done') {
        // Verify the build is actually clean before declaring success
        const buildResult = await this.actuator.build(workspaceId);
        yield { type: 'build_result', success: buildResult.success, logs: buildResult.logs.slice(-MAX_OBS_CHARS) };
        if (buildResult.success) {
          // Phase 12B: if the project defines a real test script, run it and treat
          // a red test exactly like a failed build — done is NOT allowed until green.
          yield { type: 'status', message: `Step ${step}: running tests…` };
          const testResult = await this.runProjectTests(workspaceId);
          if (testResult.ran) {
            yield { type: 'build_result', success: testResult.success, logs: `[TESTS]\n${testResult.logs}`.slice(-MAX_OBS_CHARS) };
          }
          if (testResult.ran && !testResult.success) {
            const testLogs = testResult.logs.slice(-2000);
            observation = `Build passed but TESTS FAILED — cannot mark done yet. Fix the failing tests (a red test is treated like a broken build):\n${testLogs}`;
          } else {
            // Phase 11A: auto-commit the finished work so git history reflects each session.
            const summary = parsed.args.summary || 'Task complete.';
            await this.actuator.runCommand(workspaceId,
              `git add -A && git commit -m ${JSON.stringify(`feat: ${summary.slice(0, 72)}`)} 2>&1 | tail -3`
            ).catch(() => {/* non-fatal */});
            yield { type: 'complete', summary, steps: step };
            return;
          }
        } else {
          // Phase 11B: extract TypeScript error codes and inject targeted hints.
          const buildLogs = buildResult.logs.slice(-2000);
          const tsCodes = [...new Set((buildLogs.match(/\bTS\d{4}\b/g) || []))];
          const searchHint = tsCodes.length > 0
            ? `\n\nTypeScript error codes found: ${tsCodes.join(', ')}. Consider using web_search to look up the fix (e.g. "${tsCodes[0]} fix typescript").`
            : '';
          observation = `Build failed — cannot mark done yet. Fix the errors:${searchHint}\n${buildLogs}`;
        }
      } else {
        observation = `Unknown action "${parsed.action}". Valid actions: bash, edit_file, patch_file, browse, screenshot, browser_action, drive, web_search, restore, provision_db, done.`;
      }

      // Phase 4 — Live Sync: after any browser interaction, surface runtime
      // errors (console.error, uncaught exceptions, failed requests) to BOTH
      // the user (console_error event) and the agent (appended to observation,
      // so it self-corrects on runtime bugs a clean build would never reveal).
      if (parsed.action === 'screenshot' || parsed.action === 'browser_action') {
        // Note: 'drive' handles console errors inside its own loop above, so it's excluded here.
        try {
          // Capture the watermark BEFORE the read so an error logged during the
          // read isn't skipped next time (no-miss; at worst a sub-second re-report).
          const checkStart = Date.now();
          const { errors } = await this.actuator.getConsoleErrors(workspaceId, lastConsoleCheck);
          lastConsoleCheck = checkStart;
          if (errors.length > 0) {
            yield { type: 'console_error', errors: errors.map(e => ({ kind: e.kind, text: e.text })) };
            observation += `\n\n[RUNTIME BROWSER ERRORS — these happened in the live app, fix them]\n` +
              errors.map(e => `• [${e.kind}] ${e.text}`).join('\n');
          }
        } catch { /* non-fatal — console capture is best-effort */ }
      }

      history.push({
        step,
        actionJson: JSON.stringify({ action: parsed.action, args: parsed.args }),
        observation: observation.slice(-MAX_OBS_CHARS),
      });
    }

    yield { type: 'max_steps_reached', steps: MAX_STEPS };
  }

  /**
   * Phase 12B — run the project's test suite if it defines a real, non-watch test
   * script. Returns ran:false when there's no intentional test script (so we never
   * fabricate a failure for projects without tests). Uses the actuator's command
   * timeout as a safety net against a mis-configured watch-mode script.
   */
  private async runProjectTests(workspaceId: string): Promise<{ ran: boolean; success: boolean; logs: string }> {
    let pkgRaw: string;
    try {
      pkgRaw = await this.actuator.readFile(workspaceId, 'package.json');
    } catch {
      return { ran: false, success: true, logs: '' }; // no package.json (static/python) — skip
    }
    let testScript = '';
    try {
      testScript = String(JSON.parse(pkgRaw)?.scripts?.test ?? '');
    } catch {
      return { ran: false, success: true, logs: '' };
    }
    // Skip the npm default placeholder and empty scripts.
    if (!testScript.trim() || /no test specified/i.test(testScript)) {
      return { ran: false, success: true, logs: '' };
    }
    try {
      const result = await this.actuator.runCommand(workspaceId, 'npm test');
      const logs = (result.stdout + result.stderr).slice(-MAX_OBS_CHARS);
      return { ran: true, success: result.exitCode === 0, logs };
    } catch (err: any) {
      return { ran: true, success: false, logs: err?.message || String(err) };
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
    history: { step: number; actionJson: string; observation: string }[]
  ): Promise<string> {
    // ── Phase 7: smart context retrieval ──────────────────────────────────
    // 1. Get full file list (paths only — always fast)
    const fileList = await this.actuator.listFiles(workspaceId);

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
    const MAX_TO_READ = 30;
    for (const filePath of ranked.slice(0, MAX_TO_READ)) {
      try {
        contentMap.set(filePath, await this.actuator.readFile(workspaceId, filePath));
      } catch {
        contentMap.set(filePath, ''); // mark as unreadable
      }
    }
    const fileSections = packFileSections(ranked, contentMap);

    // 6. Full file tree (paths only) — gives the model the overall shape
    const fileTree = buildFileTree(fileList);

    // ── Phase 12A: cross-session project memory ───────────────────────────
    // If the agent recorded architecture/decisions in a prior session, surface
    // them FIRST so it remembers WHY (not just the files). Best-effort read.
    let memorySection = '';
    try {
      const mem = await this.actuator.readFile(workspaceId, MEMORY_PATH);
      if (mem && mem.trim()) {
        memorySection = `[PROJECT MEMORY — decisions & architecture from earlier sessions]\n${mem.slice(0, MAX_MEMORY_CHARS)}`;
      }
    } catch { /* no memory file yet — first session */ }

    // ── Assemble prompt ───────────────────────────────────────────────────
    const parts: string[] = [
      `[TASK]\n${instruction}`,
    ];
    if (memorySection) parts.push(memorySection);
    parts.push(
      `[WORKSPACE — FILE TREE (${fileList.length} files)]\n${fileTree}`,
      `[WORKSPACE — FILE CONTENTS (top ${fileSections.length} by relevance)]\n${fileSections.join('\n\n')}`,
    );

    if (history.length > 0) {
      const verbatim = history.slice(-HISTORY_VERBATIM_TAIL);
      const condensed = history.slice(0, history.length - HISTORY_VERBATIM_TAIL);
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
