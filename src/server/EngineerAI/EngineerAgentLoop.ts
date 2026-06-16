import { AIRouter } from '../AI/Router/AIRouter';
import { WorkspaceManager } from '../AppMakerLab/WorkspaceManager';
import { BuildManager } from '../AppMakerLab/BuildManager';
import { ScaffoldGenerator } from '../AppMakerLab/generator/ScaffoldGenerator';
import { InProcessEventBus } from '../AppMakerLab/eventbus/InProcessEventBus';
import { EventHistoryStore } from '../AppMakerLab/eventbus/EventHistoryStore';
import { EngineerAgentEvent, EngineerPlan, EngineerTask } from './EngineerAITypes';

const NAMESPACE = 'engineer';
const WORKSPACES_ROOT = `/workspaces/${NAMESPACE}`;
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
  "edits": [ { "path": "relative/file/path.tsx", "content": "FULL new file content" } ]
}
Rules:
- "edits[].content" must be the FULL content of the file after your change — never a diff or partial snippet.
- Only list files that actually need to change this iteration; omit unchanged files.
- Paths are relative to the workspace root, no leading "/", no "..".
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
  return {
    done: !!parsed.done,
    summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    edits,
  };
}

export class EngineerAgentLoop {
  private workspaceManager = new WorkspaceManager(NAMESPACE);
  private buildManager: BuildManager;

  constructor(private router: AIRouter) {
    const eventBus = new InProcessEventBus(new EventHistoryStore(NAMESPACE));
    this.buildManager = new BuildManager(eventBus, WORKSPACES_ROOT);
  }

  async *run(task: EngineerTask): AsyncGenerator<EngineerAgentEvent> {
    const { workspaceId, instruction } = task;
    const deadline = Date.now() + DEADLINE_MS;

    await this.ensureWorkspace(workspaceId);

    let lastBuildLogs = '';

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      if (Date.now() > deadline) {
        yield { type: 'max_iterations_reached', iterations: iteration - 1 };
        return;
      }

      yield { type: 'iteration_start', iteration };

      const prompt = await this.buildPrompt(workspaceId, instruction, lastBuildLogs);

      let plan: EngineerPlan;
      try {
        const { response } = await this.router.route(prompt, SYSTEM_PROMPT);
        plan = parsePlan(response.content);
      } catch (err: any) {
        yield { type: 'error', message: `Plan generation failed: ${err?.message || String(err)}` };
        return;
      }

      yield { type: 'plan', summary: plan.summary || '', editCount: plan.edits.length };

      if (plan.edits.length > 0) {
        for (const edit of plan.edits) {
          await this.workspaceManager.writeFile(workspaceId, edit.path, edit.content);
        }
        yield { type: 'files_changed', paths: plan.edits.map(e => e.path) };

        const buildResult = await this.buildManager.build(workspaceId);
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

  private async ensureWorkspace(workspaceId: string): Promise<void> {
    const info = await this.workspaceManager.getWorkspaceInfo(workspaceId).catch(() => null);
    if (info && info.files.length > 0) return;

    await this.workspaceManager.createWorkspace(workspaceId);
    const scaffolder = new ScaffoldGenerator(this.workspaceManager);
    await scaffolder.generate({ framework: 'vite-react', language: 'typescript', features: [], workspaceId });
  }

  private async buildPrompt(workspaceId: string, instruction: string, lastBuildLogs: string): Promise<string> {
    const fileList = await this.workspaceManager.listFiles(workspaceId);
    const shown = fileList.slice(0, MAX_FILES_SHOWN);

    const sections: string[] = [];
    for (const filePath of shown) {
      try {
        const content = await this.workspaceManager.readFile(workspaceId, filePath);
        sections.push(`--- ${filePath} ---\n${content.slice(0, MAX_CHARS_PER_FILE)}`);
      } catch {
        sections.push(`--- ${filePath} --- (unreadable)`);
      }
    }
    if (fileList.length > MAX_FILES_SHOWN) {
      sections.push(`... and ${fileList.length - MAX_FILES_SHOWN} more file(s) not shown`);
    }

    const parts = [`Instruction: ${instruction}`, `Current workspace files:\n${sections.join('\n\n')}`];
    if (lastBuildLogs) parts.push(`Previous build output:\n${lastBuildLogs}`);
    return parts.join('\n\n');
  }
}
