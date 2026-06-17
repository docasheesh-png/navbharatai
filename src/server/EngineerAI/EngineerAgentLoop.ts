import { AIRouter } from '../AI/Router/AIRouter';
import { IEngineerActuator } from './actuators/IEngineerActuator';
import { ReActAction, EngineerAgentEvent, EngineerTask } from './EngineerAITypes';

const MAX_STEPS = 24;
const DEADLINE_MS = 8 * 60 * 1000;
const MAX_FILES_SHOWN = 20;
const MAX_CHARS_PER_FILE = 1000;
const MAX_OBS_CHARS = 3000;
const MAX_HISTORY_STEPS = 20;

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
- bash and browse require a real sandboxed environment — if you see an error saying they are unavailable, solve the task with edit_file/patch_file only.`;

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

    await this.actuator.ensureWorkspace(workspaceId, projectType);

    const history: { step: number; actionJson: string; observation: string }[] = [];

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (signal?.aborted) { yield { type: 'aborted' }; return; }
      if (Date.now() > deadline) { yield { type: 'max_steps_reached', steps: step - 1 }; return; }

      const prompt = await this.buildPrompt(workspaceId, instruction, history);

      let parsed: ReActAction;
      try {
        const { response } = await this.router.route(prompt, SYSTEM_PROMPT);
        parsed = parseAction(response.content);
      } catch (err: any) {
        yield { type: 'error', message: `AI planning failed: ${err?.message || String(err)}` };
        return;
      }

      if (signal?.aborted) { yield { type: 'aborted' }; return; }

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
        observation = `exit ${result.exitCode}:\n${output}`;
      } else if (parsed.action === 'edit_file') {
        const filePath = parsed.args.path || '';
        const content = parsed.args.content || '';
        try {
          await this.actuator.writeFile(workspaceId, filePath, content);
          yield { type: 'files_changed', paths: [filePath], kind: 'edit' };
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
            yield { type: 'files_changed', paths: [filePath], kind: 'patch' };
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
      const recent = history.slice(-MAX_HISTORY_STEPS);
      const historyText = recent
        .map(h => `Step ${h.step} — ${h.actionJson}\nObservation: ${h.observation}`)
        .join('\n\n');
      parts.push(`[HISTORY]\n${historyText}`);
    }

    parts.push('[OUTPUT the next single action JSON]');
    return parts.join('\n\n');
  }
}
