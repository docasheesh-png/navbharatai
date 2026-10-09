/**
 * P5c — 16 CORE TOOLS + LOAD-ON-DEMAND (fix/build-reliability, AGENTV3_CORE_TOOLSET).
 *
 * The architect is offered ~56 tools (~50,700 chars of JSON schema) on every turn. Weak-tier models
 * pick worse from a long menu and the schemas cost context on every call. With the flag on the model
 * is offered the 16 tools a build actually lives on, plus `load_tools`, whose description names every
 * other tool it can pull in. A loaded tool joins the offered list from the next turn on (the runner
 * reads the same array each turn).
 *
 * Nothing is taken away: the dispatcher still executes every tool, so a model that calls a tool by
 * name without loading it first still gets it run — loading only hands it the exact schema.
 */
import type { ClaudeToolDef } from '../ClaudeClient';
import { reliabilityFlag } from './flags';

export function coreToolsetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return reliabilityFlag('CORE_TOOLSET', env);
}

export const CORE_TOOL_NAMES: readonly string[] = [
  'read_file', 'write_file', 'edit_file', 'write_files_batch', 'bash', 'grep', 'glob', 'typecheck',
  'update_todo', 'update_preview', 'console_errors', 'screenshot', 'request_secrets', 'task', 'run_recipe', 'web_search',
];

function firstSentence(s: string, max = 90): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const cut = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

export function loadToolsDef(available: readonly ClaudeToolDef[]): ClaudeToolDef {
  const listing = available.map((t) => `${t.name}: ${firstSentence(t.description)}`).join('\n');
  return {
    name: 'load_tools',
    description: `Load more tools by name; they are available from your next step. Load only what you are about to use. Available:\n${listing}`,
    input_schema: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' }, description: 'Tool names to load.' } },
      required: ['names'],
    },
  };
}

/**
 * The offered tool list for one build. `tools` is the SAME array object for the whole run, so the
 * runner picks loaded tools up on its next turn.
 */
export class DynamicToolset {
  readonly tools: ClaudeToolDef[];
  private readonly byName: Map<string, ClaudeToolDef>;

  /** `all` = every tool this role may use; `alwaysOn` = tools that must stay offered (connected MCP tools). */
  constructor(all: readonly ClaudeToolDef[], alwaysOn: readonly ClaudeToolDef[] = [], core: readonly string[] = CORE_TOOL_NAMES) {
    this.byName = new Map(all.map((t) => [t.name, t]));
    const coreDefs = core.map((n) => this.byName.get(n)).filter((t): t is ClaudeToolDef => !!t);
    const rest = all.filter((t) => !core.includes(t.name));
    this.tools = [...coreDefs, ...(rest.length ? [loadToolsDef(rest)] : []), ...alwaysOn];
  }

  offered(): string[] {
    return this.tools.map((t) => t.name);
  }

  /** Load tools by name. Returns the tool result text. */
  load(names: unknown): string {
    const list = Array.isArray(names) ? names.map((n) => String(n ?? '').trim()).filter(Boolean) : [];
    if (!list.length) return 'load_tools: pass names, e.g. {"names":["evaluate"]}.';
    const offered = new Set(this.offered());
    const added: string[] = [];
    const already: string[] = [];
    const unknown: string[] = [];
    for (const n of list) {
      if (offered.has(n)) { already.push(n); continue; }
      const def = this.byName.get(n);
      if (!def) { unknown.push(n); continue; }
      this.tools.push(def);
      offered.add(n);
      added.push(n);
    }
    return [
      added.length ? `Loaded: ${added.join(', ')} — available from your next step.` : '',
      already.length ? `Already available: ${already.join(', ')}.` : '',
      unknown.length ? `Unknown tool(s): ${unknown.join(', ')} — see the list in load_tools.` : '',
    ].filter(Boolean).join('\n');
  }
}
