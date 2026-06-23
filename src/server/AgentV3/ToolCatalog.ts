import type { ClaudeToolDef } from './ClaudeClient';
import type { ToolName } from './types';
import { WORKER_ROLES } from './AgentRegistry';

/**
 * ToolCatalog — the native Anthropic tool definitions the v3.0 agent team can
 * call (RC-1). These are the Claude-Code-class file/exec/search tools. The
 * `task` sub-agent tool is added in P3.5 (multi-agent). Each definition's
 * `input_schema` is what Claude validates its `tool_use` input against.
 */
export function defaultToolCatalog(): ClaudeToolDef[] {
  return [
    {
      name: 'read_file',
      description: 'Read the full contents of a file in the workspace.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with the given full contents.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          content: { type: 'string', description: 'The complete file contents.' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'edit_file',
      description:
        'Replace an exact, unique string in a file with a new string. The ' +
        'old_string must appear exactly once; include surrounding context to ' +
        'make it unique.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          old_string: { type: 'string', description: 'The exact text to replace (must be unique).' },
          new_string: { type: 'string', description: 'The replacement text.' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'bash',
      description: 'Run a shell command in the workspace and return its exit code, stdout and stderr.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
    },
    {
      name: 'grep',
      description: 'Search file contents for a pattern (recursive). Returns matching lines with paths.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The text/regex to search for.' },
          path: { type: 'string', description: 'Optional path to search under (default: whole workspace).' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'glob',
      description: 'List workspace files whose path matches a glob pattern (e.g. "src/**/*.ts").',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'A glob pattern.' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'update_preview',
      description:
        'Publish the live preview URL after you start a dev server. Call this with ' +
        'the port your dev server is listening on so the user sees the app live as ' +
        'it builds. Call it again if the port changes.',
      input_schema: {
        type: 'object',
        properties: {
          port: { type: 'number', description: 'The port the dev server is listening on (e.g. 3000, 5173).' },
        },
        required: ['port'],
      },
    },
    {
      name: 'recall',
      description:
        'Search the project memory — exported symbols, files, components, routes ' +
        'and past errors/fixes from this build — for a query. Use it to find where ' +
        'something is, what already exists, or what failed before, instead of ' +
        're-scanning the whole tree.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for (a symbol/file/component name, or a past error).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'evaluate',
      description:
        'Statically analyse the project for real defects from the indexed code: ' +
        'unresolved local imports (which break the build), import cycles, ' +
        'front-end→back-end layering violations, plus security issues (hardcoded ' +
        'secrets, eval, dangerouslySetInnerHTML, insecure http) and accessibility ' +
        'issues (images with no alt text, form controls with no accessible name, ' +
        'click handlers on non-interactive elements, positive tabindex, missing ' +
        'document language), and trust/privacy/compliance issues (DPDP/GDPR-oriented: ' +
        'personal data in logs, sensitive values in browser storage, cookies without ' +
        'SameSite, personal data over plain http, a tracker with no consent surface, ' +
        'or collecting personal data with no privacy policy) — ending with an honest ' +
        '"launch-safe" certificate. It also reports a calibrated "build confidence" ' +
        '(0–100% with High/Medium/Low and a plain-language "here\'s why") synthesized ' +
        'from all of the above, so you state honest confidence instead of guessing. ' +
        'Use it to check your work before declaring it done, then fix what it reports.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'update_todo',
      description: 'Replace the build todo list shown to the user. Use this to plan and track progress.',
      input_schema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The full todo list (replaces the previous one).',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'] },
                owner: { type: 'string' },
              },
              required: ['id', 'title', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
    {
      name: 'generate_readme',
      description:
        'Generate a real README.md for the project from the actual code: detected ' +
        'tech stack, how to install and run, project structure (components/routes/files) ' +
        'and the available npm scripts. Everything is derived from the real project ' +
        'graph + package.json (never invented). Writes the result to README.md.',
      input_schema: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: 'Optional project title (defaults to package.json name).' },
          path: { type: 'string', description: 'Optional output path (defaults to README.md).' },
        },
      },
    },
  ];
}

/** The set of base tool names the catalog exposes (for validation). */
export const CATALOG_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'bash',
  'grep',
  'glob',
  'update_todo',
  'update_preview',
  'recall',
  'evaluate',
  'generate_readme',
] as const;

/**
 * The `task` sub-agent tool (§3.3) — only the Architect gets this. Delegates a
 * focused unit of work to a specialist agent, which runs as a constrained nested
 * agent and returns a summary.
 */
export function taskToolDef(): ClaudeToolDef {
  return {
    name: 'task',
    description:
      'Delegate a focused task to a specialist agent. The agent runs with its own ' +
      'tools and returns a summary of what it did. Use this to parallelise and ' +
      'organise the build across the team.',
    input_schema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: `The specialist to delegate to. One of: ${WORKER_ROLES.join(', ')}.`,
          enum: [...WORKER_ROLES],
        },
        instruction: {
          type: 'string',
          description: 'A clear, self-contained instruction for the specialist.',
        },
      },
      required: ['role', 'instruction'],
    },
  };
}

/**
 * The `second_opinion` tool (Layer 84 — Multi-Model Ensemble). Optional, granted
 * only to the Architect (and Reviewer). Sends the question/artifact to a DIFFERENT
 * AI model (the non-Claude router) for an independent critique, so the agent can
 * cross-check risky or final work beyond a single model.
 */
export function secondOpinionToolDef(): ClaudeToolDef {
  return {
    name: 'second_opinion',
    description:
      'Get an independent critical review from a DIFFERENT AI model (not Claude). ' +
      'Provide the question or the code/decision to review. Use sparingly for ' +
      'risky or final work.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'What to review — a question, a decision, or code/explanation to critique.',
        },
      },
      required: ['prompt'],
    },
  };
}

/**
 * The `consensus` tool (Layer 49 — Collective Intelligence). Optional, granted
 * only to the Architect. Convenes a PANEL of independent expert viewpoints
 * (correctness, security, UX) from a DIFFERENT AI model on a hard design
 * decision and returns their synthesized verdict — going beyond a single
 * viewpoint.
 */
export function consensusToolDef(): ClaudeToolDef {
  return {
    name: 'consensus',
    description:
      'Convene a panel of independent expert viewpoints (correctness, security, ' +
      'UX) from a different AI model on a hard design decision, and get their ' +
      'synthesized verdict. Use sparingly for important architectural choices.',
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The hard decision or design choice to put to the panel.',
        },
      },
      required: ['question'],
    },
  };
}

/** Build the tool definitions for a given allowed-tool list (incl. `task`). */
export function catalogForTools(allowed: ToolName[]): ClaudeToolDef[] {
  const base = defaultToolCatalog().filter((t) => (allowed as string[]).includes(t.name));
  if ((allowed as string[]).includes('task')) base.push(taskToolDef());
  if ((allowed as string[]).includes('second_opinion')) base.push(secondOpinionToolDef());
  if ((allowed as string[]).includes('consensus')) base.push(consensusToolDef());
  return base;
}
