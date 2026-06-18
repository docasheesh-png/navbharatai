import { AIRouter } from '../AI/Router/AIRouter';
import { IEngineerActuator } from './actuators/IEngineerActuator';
import { ReActAction, EngineerAgentEvent, EngineerTask } from './EngineerAITypes';
import { WebSearchClient } from './WebSearchClient';

const MAX_STEPS = 24;
const DEADLINE_MS = 8 * 60 * 1000;
const MAX_FILES_SHOWN = 20;
const MAX_CHARS_PER_FILE = 1000;
const MAX_OBS_CHARS = 3000;
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
];

const SYSTEM_PROMPT = `You are Engineer AI — a sharp, friendly senior engineer who can both converse intelligently AND build real software autonomously. You have EYES: you can take screenshots of running apps and see exactly what the UI looks like.

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
MODE 2 — AUTONOMOUS CODING  →  use bash / edit_file / patch_file / screenshot / browser_action / web_search / done
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

{ "thought": "one-sentence reasoning", "action": "reply"|"bash"|"edit_file"|"patch_file"|"screenshot"|"browser_action"|"done", "args": { ... } }

Action args:
  reply:          { "message": "your conversational response — can be detailed, friendly, multi-paragraph" }
  bash:           { "command": "shell command to run in the workspace" }
  edit_file:      { "path": "relative/path.tsx", "content": "FULL new file content" }
  patch_file:     { "path": "relative/path.tsx", "old_str": "exact text to replace", "new_str": "replacement" }
  screenshot:     { "url": "http://localhost:3000" }
  browser_action: { "action": "click"|"type"|"navigate"|"scroll"|"press"|"wait", "selector": "CSS selector", "text": "text to type / key to press", "url": "url to navigate to", "direction": "up"|"down" }
  web_search:     { "query": "what to look up — docs, error messages, package names/versions" }
  done:           { "summary": "one sentence describing what was accomplished" }

You can both SEE and INTERACT with the running app:
- screenshot = take a picture and look at the UI (passive).
- browser_action = actually drive the app like a user (active). The browser session is persistent —
  cookies, form input, and the current page survive between browser_action calls, so you can do a
  multi-step flow: navigate → type into a field → click submit → see the result. EVERY browser_action
  returns a fresh screenshot automatically, so you don't need a separate screenshot after it.

browser_action examples:
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
- After starting a dev server: take a screenshot (or navigate via browser_action) to visually verify the UI.
- For anything interactive (forms, buttons, navigation, login): actually TEST it with browser_action —
  click the buttons, fill the forms, and confirm from the returned screenshot that it works.
- If a screenshot reveals problems (wrong layout, missing elements, broken styles, errors): fix them, then re-verify.
- After a screenshot or browser_action, any RUNTIME browser errors (console.error, uncaught exceptions, failed network requests) are reported back to you automatically. Treat them as real bugs and fix them — a clean build does NOT mean the app works at runtime.
- Output done only AFTER you have visually confirmed the app looks AND works correctly. No confirmation = not done.
- Paths are relative to workspace root, no leading "/" or "..".
- When starting a dev server, use port 3000 and bind to 0.0.0.0 (--host 0.0.0.0 --port 3000).
- Commands run with a 60-second timeout.`;

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

  constructor(private router: AIRouter, private actuator: IEngineerActuator) {}

  async *run(task: EngineerTask, signal?: AbortSignal): AsyncGenerator<EngineerAgentEvent> {
    const { workspaceId, instruction, projectType, resumeSandboxId } = task;
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

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (signal?.aborted) { yield { type: 'aborted' }; return; }
      if (Date.now() > deadline) { yield { type: 'max_steps_reached', steps: step - 1 }; return; }

      yield { type: 'status', message: `Step ${step}: reading workspace…` };
      const prompt = await this.buildPrompt(workspaceId, instruction, history);
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
        web_search: 'Searching the web…',
        done: 'Verifying the build…',
      };
      const thought = parsed.thought || thoughtFallback[parsed.action] || 'Thinking…';
      yield { type: 'action_start', step, action: parsed.action, thought };

      let observation: string;

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
        yield { type: 'status', message: `Step ${step}: taking screenshot of ${targetUrl}…` };
        try {
          const shot = await this.actuator.screenshot(workspaceId, targetUrl);
          lastScreenshot = shot.base64; // injected into the NEXT router call as a vision image
          yield { type: 'screenshot_result', url: targetUrl, base64: shot.base64 };
          observation = `Screenshot captured of ${targetUrl}. The image has been attached to your next thinking step — look at it carefully and describe what you see, then decide what to fix.`;
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
            yield { type: 'browser_action_result', action: subAction, detail: res.result, base64: res.screenshot };
            observation = `${res.result}. A screenshot of the resulting page is attached to your next thinking step — look at it and decide the next action.`;
          } catch (err: any) {
            observation = `browser_action error: ${err?.message}`;
          }
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
      } else if (parsed.action === 'done') {
        // Verify the build is actually clean before declaring success
        const buildResult = await this.actuator.build(workspaceId);
        yield { type: 'build_result', success: buildResult.success, logs: buildResult.logs.slice(-MAX_OBS_CHARS) };
        if (buildResult.success) {
          yield { type: 'complete', summary: parsed.args.summary || 'Task complete.', steps: step };
          return;
        }
        observation = `Build failed — cannot mark done yet. Fix the errors:\n${buildResult.logs.slice(-2000)}`;
      } else {
        observation = `Unknown action "${parsed.action}". Valid actions: bash, edit_file, patch_file, browse, screenshot, browser_action, web_search, done.`;
      }

      // Phase 4 — Live Sync: after any browser interaction, surface runtime
      // errors (console.error, uncaught exceptions, failed requests) to BOTH
      // the user (console_error event) and the agent (appended to observation,
      // so it self-corrects on runtime bugs a clean build would never reveal).
      if (parsed.action === 'screenshot' || parsed.action === 'browser_action') {
        try {
          const { errors } = await this.actuator.getConsoleErrors(workspaceId, lastConsoleCheck);
          lastConsoleCheck = Date.now();
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

  private async buildPrompt(
    workspaceId: string,
    instruction: string,
    history: { step: number; actionJson: string; observation: string }[]
  ): Promise<string> {
    const fileList = await this.actuator.listFiles(workspaceId);
    const shown = fileList.slice(0, MAX_FILES_SHOWN);

    const fileSections: string[] = [];
    for (const filePath of shown) {
      try {
        const content = await this.actuator.readFile(workspaceId, filePath);
        fileSections.push(`--- ${filePath} ---\n${content.slice(0, MAX_CHARS_PER_FILE)}`);
      } catch {
        fileSections.push(`--- ${filePath} --- (unreadable)`);
      }
    }
    if (fileList.length > MAX_FILES_SHOWN) {
      fileSections.push(`... ${fileList.length - MAX_FILES_SHOWN} more files not shown`);
    }

    const parts: string[] = [
      `[TASK]\n${instruction}`,
      `[WORKSPACE FILES]\n${fileSections.join('\n\n')}`,
    ];

    if (history.length > 0) {
      const verbatim = history.slice(-HISTORY_VERBATIM_TAIL);
      const condensed = history.slice(0, history.length - HISTORY_VERBATIM_TAIL);
      const sections: string[] = [];

      if (condensed.length > 0) {
        // Summarise older steps into one compact line each to save context window
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

    parts.push('[OUTPUT the next single action JSON]');
    return parts.join('\n\n');
  }
}
