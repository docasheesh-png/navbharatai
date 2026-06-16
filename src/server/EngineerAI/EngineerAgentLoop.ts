import { AIRouter } from '../AI/Router/AIRouter';
import { IEngineerActuator } from './actuators/IEngineerActuator';
import { EngineerAgentEvent, EngineerPlan, EngineerTask } from './EngineerAITypes';

const MAX_ITERATIONS = 8;
const DEADLINE_MS = 6 * 60 * 1000;
const MAX_FILES_SHOWN = 25;
const MAX_CHARS_PER_FILE = 1200;
const MAX_LOG_CHARS = 4000;

const SYSTEM_PROMPT = `You are Engineer AI, an autonomous coding agent working inside an existing Vite + React + TypeScript workspace.
You are given the current file tree (with truncated contents) and a user instruction.
Respond with ONLY a single JSON object — no prose, no markdown code fences:
{
  "done": boolean,
  "summary": "one short sentence describing what you changed or why the task is complete",
  "commands": [ "shell command to run in the workspace before edits are applied" ],
  "edits": [ { "path": "relative/file/path.tsx", "content": "FULL new file content" } ]
}
Rules:
- "edits[].content" must be the FULL content of the file after your change — never a diff or partial snippet.
- Only list files that actually need to change this iteration; omit unchanged files.
- Paths are relative to the workspace root, no leading "/", no "..".
- "commands" is optional (omit or leave empty for ordinary edits). Use it only for things file edits can't
  do alone, e.g. installing an extra package or running a codegen/migration script. Shell execution is only
  available in a real sandbox — if you see a command failed because no sandbox is configured, stop relying
  on commands and solve the task with file edits only.
- Set "done": true and "edits": [] once the instruction is satisfied and the project builds cleanly.
- If the previous build failed, the failure log will be included — fix the reported error first.`;

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

function extractJsonObject(text: string): string {
  const stripped = stripJsonFences(text);
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return stripped;
  return stripped.slice(start, end + 1);
}

function parsePlan(raw: string): EngineerPlan {
  const parsed = JSON.parse(extractJsonObject(raw));
  const edits = Array.isArray(parsed.edits)
    ? parsed.edits.filter((e: any) => e && typeof e.path === 'string' && typeof e.content === 'string')
    : [];
  const commands = Array.isArray(parsed.commands)
    ? parsed.commands.filter((c: any) => typeof c === 'string' && c.trim().length > 0)
    : [];
  return {
    done: !!parsed.done,
    summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    commands,
    edits,
  };
}

export class EngineerAgentLoop {
  constructor(private router: AIRouter, private actuator: IEngineerActuator) {}

  async *run(task: EngineerTask): AsyncGenerator<EngineerAgentEvent> {
    const { workspaceId, instruction } = task;
    const deadline = Date.now() + DEADLINE_MS;

    await this.actuator.ensureWorkspace(workspaceId);

    let lastBuildLogs = '';
    let lastCommandLogs = '';

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      if (Date.now() > deadline) {
        yield { type: 'max_iterations_reached', iterations: iteration - 1 };
        return;
      }

      yield { type: 'iteration_start', iteration };

      const prompt = await this.buildPrompt(workspaceId, instruction, lastBuildLogs, lastCommandLogs);

      let plan: EngineerPlan;
      try {
        const { response } = await this.router.route(prompt, SYSTEM_PROMPT);
        plan = parsePlan(response.content);
      } catch (err: any) {
        yield { type: 'error', message: `Plan generation failed: ${err?.message || String(err)}` };
        return;
      }

      yield { type: 'plan', summary: plan.summary || '', editCount: plan.edits.length };

      if (plan.commands.length > 0) {
        const outputs: string[] = [];
        for (const command of plan.commands) {
          let result: { exitCode: number; stdout: string; stderr: string };
          try {
            result = await this.actuator.runCommand(workspaceId, command);
          } catch (err: any) {
            result = { exitCode: -1, stdout: '', stderr: err?.message || String(err) };
          }
          const output = (result.stdout + result.stderr).slice(-MAX_LOG_CHARS);
          outputs.push(`$ ${command}\n${output}`);
          yield { type: 'command_result', command, exitCode: result.exitCode, output };
        }
        lastCommandLogs = outputs.join('\n\n').slice(-MAX_LOG_CHARS);
      }

      if (plan.edits.length > 0) {
        for (const edit of plan.edits) {
          await this.actuator.writeFile(workspaceId, edit.path, edit.content);
        }
        yield { type: 'files_changed', paths: plan.edits.map(e => e.path) };

        const buildResult = await this.actuator.build(workspaceId);
        lastBuildLogs = buildResult.logs.slice(-MAX_LOG_CHARS);
        yield { type: 'build_result', success: buildResult.success, logs: lastBuildLogs };
      }

      if (plan.done) {
        yield { type: 'complete', summary: plan.summary || 'Task complete.', iterations: iteration };
        return;
      }
    }

    yield { type: 'max_iterations_reached', iterations: MAX_ITERATIONS };
  }

  private async buildPrompt(
    workspaceId: string,
    instruction: string,
    lastBuildLogs: string,
    lastCommandLogs: string
  ): Promise<string> {
    const fileList = await this.actuator.listFiles(workspaceId);
    const shown = fileList.slice(0, MAX_FILES_SHOWN);

    const sections: string[] = [];
    for (const filePath of shown) {
      try {
        const content = await this.actuator.readFile(workspaceId, filePath);
        sections.push(`--- ${filePath} ---\n${content.slice(0, MAX_CHARS_PER_FILE)}`);
      } catch {
        sections.push(`--- ${filePath} --- (unreadable)`);
      }
    }
    if (fileList.length > MAX_FILES_SHOWN) {
      sections.push(`... and ${fileList.length - MAX_FILES_SHOWN} more file(s) not shown`);
    }

    const parts = [`Instruction: ${instruction}`, `Current workspace files:\n${sections.join('\n\n')}`];
    if (lastCommandLogs) parts.push(`Previous command output:\n${lastCommandLogs}`);
    if (lastBuildLogs) parts.push(`Previous build output:\n${lastBuildLogs}`);
    return parts.join('\n\n');
  }
}
