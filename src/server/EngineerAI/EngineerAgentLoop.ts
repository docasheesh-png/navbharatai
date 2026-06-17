import { AIRouter } from '../AI/Router/AIRouter';
import { IEngineerActuator } from './actuators/IEngineerActuator';
import { ReActAction, EngineerAgentEvent, EngineerTask } from './EngineerAITypes';

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

const SYSTEM_PROMPT = `You are Engineer AI, an autonomous coding agent running inside a sandboxed workspace.

Each response, output exactly ONE action as a JSON object — no prose, no markdown fences:

{
  "thought": "your reasoning (one sentence)",
  "action": "bash" | "edit_file" | "patch_file" | "browse" | "done",
  "args": { ... }
}

Action args:
  bash:       { "command": "shell command to run in the workspace" }
  edit_file:  { "path": "relative/path.tsx", "content": "FULL new file content" }
  patch_file: { "path": "relative/path.tsx", "old_str": "exact text to replace", "new_str": "replacement" }
  browse:     { "url": "https://..." }
  done:       { "summary": "one sentence describing what was accomplished" }

Rules:
- One action per response. Wait for the observation before the next action.
- Use patch_file for targeted changes (<30% of a file). Use edit_file for rewrites or new files.
- Use bash to install packages, run scripts, inspect files, or build the project.
- Use browse to fetch documentation or verify a running URL.
- Output done only when the task is fully complete and the project builds cleanly (run the build first via bash if unsure).
- Paths are relative to workspace root, no leading "/" or "..".
- bash and browse require a real sandboxed environment — if you see an error saying they are unavailable, solve the task with edit_file/patch_file only.
- When starting a dev server, always use port 3000 and bind to 0.0.0.0 (e.g. --host 0.0.0.0 --port 3000) so the live preview URL can be generated.
- To enable JS-rendered page browsing, install Playwright first: bash { "command": "npm install playwright && npx playwright install chromium --with-deps" }`;

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
  constructor(private router: AIRouter, private actuator: IEngineerActuator) {}

  async *run(task: EngineerTask, signal?: AbortSignal): AsyncGenerator<EngineerAgentEvent> {
    const { workspaceId, instruction, projectType } = task;
    const deadline = Date.now() + DEADLINE_MS;

    yield { type: 'status', message: 'Initializing workspace…' };
    await this.actuator.ensureWorkspace(workspaceId, projectType);

    const history: { step: number; actionJson: string; observation: string }[] = [];
    let consecutiveParseFailures = 0;

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (signal?.aborted) { yield { type: 'aborted' }; return; }
      if (Date.now() > deadline) { yield { type: 'max_steps_reached', steps: step - 1 }; return; }

      yield { type: 'status', message: `Step ${step}: reading workspace…` };
      const prompt = await this.buildPrompt(workspaceId, instruction, history);
      yield { type: 'status', message: `Step ${step}: thinking…` };

      // Router/provider failure is a real infra error — abort. Malformed model
      // output is recoverable — feed the parse error back and let it retry.
      let rawResponse: string;
      try {
        const { response } = await this.router.route(prompt, SYSTEM_PROMPT);
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

      yield { type: 'action_start', step, action: parsed.action, thought: parsed.thought || '' };

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
        observation = `Unknown action "${parsed.action}". Valid actions: bash, edit_file, patch_file, browse, done.`;
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
