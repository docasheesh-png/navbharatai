// Autopsy 9c612cdb (2026-10-12), Q-987 — five of the full builder's 22 turns did nothing but update_todo.
//
// 20.2 s of model time and a ~40k-token prompt each, for a plan the platform already advances as files land.
// The prompt said "Begin by calling update_todo … keep it updated as you progress" and nothing said WHEN, so
// a model that narrates through tool calls spent a whole turn on every tick — and nothing measured it.
//
// THE CLASS: a bookkeeping tool asked for without saying it rides with real work — a prose-only rule with no
// mechanical hand-back and no measurement. Locked here: the rule is in the contract and in every instruction
// that asks a writer to keep the plan (with a census over the source), the first plan-only turn of a run is
// handed back, every one is counted into TODO_ONLY_TURNS — and the lanes that CANNOT write are never told
// to pair the plan with a write.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isTodoOnlyTurn, TODO_RIDES_WITH_WORK, TODO_ONLY_TURN_STEER, todoOnlyTurnsNote } from '../src/server/AgentV3/todoOnlyTurn';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog, catalogForTools, taskToolDef } from '../src/server/AgentV3/ToolCatalog';
import { architectSystemPrompt, planSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { PLAN_YOURSELF_NOTE, roleConfig } from '../src/server/AgentV3/AgentRegistry';
import { blueprintAdvisoryBlock } from '../src/server/AgentV3/SimpleBuilder';
import { isNeverRootCause } from '../src/server/AgentV3/BuildDiagnostics';
import { instructionCensus, sourceFiles } from './helpers/instructionCensus';

/** The full builder's 22 model turns in report 9c612cdb (calls 6-27), as the tool names each one called. */
const REPORT_TURNS: string[][] = [
  ['read_file', 'read_file', 'read_file', 'read_file', 'read_file'], // 70.2 s — tool_use ×5
  ['read_file'],          // 77.9 read App.tsx
  ['update_todo'],        // 85.4
  ['edit_file'],          // 88.0
  ['edit_file'],          // 93.2
  ['read_file'],          // 104.2
  ['update_todo'],        // 108.0
  ['write_file'],         // 117.2 videoExtractor
  ['write_file'],         // 145.0 App.tsx
  ['update_todo'],        // 152.9
  ['write_files_batch'],  // 178.9
  ['write_file'],         // 198.7 AddVideoModal
  ['read_file'],          // 205.0
  ['edit_file'],          // 208.0
  ['edit_file'],          // 229.5
  ['update_todo'],        // 236.6
  ['edit_file'],          // 265.2 — the index.css miss (Q-986)
  ['edit_file'],          // 292.1
  ['update_todo'],        // 298.4
  ['bash'],               // 300.3
  ['update_preview'],     // 336.1
  [],                     // 348.4 end_turn
];
/** Their model latencies in seconds, from the same report: 6.4 + 2.9 + 4.0 + 3.3 + 3.6. */
const REPORT_TODO_ONLY_SECONDS = [6.4, 2.9, 4.0, 3.3, 3.6];

const ARCHITECT_TOOLS = defaultToolCatalog().map((t) => t.name);

describe('1 · the predicate, on the report\'s real turns', () => {
  it('🔴 five of the 22 turns were plan-only', () => {
    expect(REPORT_TURNS).toHaveLength(22);
    expect(REPORT_TURNS.filter((t) => isTodoOnlyTurn(t, ARCHITECT_TOOLS))).toHaveLength(5);
    expect(todoOnlyTurnsNote(5, REPORT_TODO_ONLY_SECONDS.reduce((a, b) => a + b, 0) * 1000)).toMatch(/^5 model turn\(s\) while the app was generated did nothing but update the plan .* 20\.2s of model time/);
  });

  it('a lane that cannot write is never counted, so never told to pair the plan with a write', () => {
    const planLane = ['update_todo']; // routes/agentv3.ts: catalogForTools(['update_todo'])
    expect(REPORT_TURNS.filter((t) => isTodoOnlyTurn(t, planLane))).toHaveLength(0);
    for (const role of ['planner', 'product', 'requirement'] as const) {
      expect(REPORT_TURNS.filter((t) => isTodoOnlyTurn(t, roleConfig(role).tools))).toHaveLength(0);
    }
  });

  it('a plan update that rides with work is not plan-only; an empty turn is not either', () => {
    expect(isTodoOnlyTurn(['update_todo', 'write_file'], ARCHITECT_TOOLS)).toBe(false);
    expect(isTodoOnlyTurn(['read_file', 'update_todo'], ARCHITECT_TOOLS)).toBe(false);
    expect(isTodoOnlyTurn([], ARCHITECT_TOOLS)).toBe(false);
    expect(isTodoOnlyTurn(['update_todo', 'update_todo'], ARCHITECT_TOOLS)).toBe(true);
  });

  it('the report line: zero is said, not left out', () => {
    expect(todoOnlyTurnsNote(0, 0)).toMatch(/^No model turn while the app was generated was spent only on updating the plan/);
    expect(isNeverRootCause('TODO_ONLY_TURNS')).toBe(true);
  });
});

// ── The runner ────────────────────────────────────────────────────────────────────────────────────────────
const use = { input_tokens: 5, output_tokens: 7 };
const todoTurn = (id: string) => ({ content: [{ type: 'tool_use', id, name: 'update_todo', input: { todos: [{ id: '1', title: 'Player', status: 'in_progress' }] } }], stop_reason: 'tool_use', usage: use });
const writeTurn = (id: string) => ({ content: [{ type: 'tool_use', id, name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } }], stop_reason: 'tool_use', usage: use });
const endTurn = { content: [{ type: 'text', text: 'Your video app is ready.' }], stop_reason: 'end_turn', usage: use };

async function runScript(script: unknown[], tools = defaultToolCatalog()) {
  const sent: unknown[][] = [];
  let n = 0;
  const client: MessagesCreateClient = {
    messages: {
      create: async (params: { messages?: unknown[] }) => {
        sent.push(JSON.parse(JSON.stringify(params.messages ?? [])));
        const m = script[n] ?? endTurn;
        n++;
        return m as never;
      },
    },
  };
  const dispatcher = { dispatch: async (tu: { id: string; name: string }) => ({ tool_use_id: tu.id, content: tu.name === 'update_todo' ? 'Updated 1 todo(s).' : 'ok', is_error: false }) };
  const stream = new AgentEventStream();
  const todoOnly: number[] = [];
  await new AgentRunner({
    client: new ClaudeClient(client), dispatcher: dispatcher as never, state: new WorkspaceState(stream), events: stream,
    model: 'm', system: 's', tools, onTodoOnlyTurn: (t) => todoOnly.push(t.latencyMs),
  }).run('build a video app');
  /** The tool_result text the model read for a given tool_use id, from the last request that carried it. */
  const resultFor = (id: string): string => {
    for (const msgs of [...sent].reverse()) {
      for (const m of msgs as Array<{ content?: unknown }>) {
        if (!Array.isArray(m.content)) continue;
        for (const b of m.content as Array<{ type?: string; tool_use_id?: string; content?: unknown }>) {
          if (b.type === 'tool_result' && b.tool_use_id === id) return String(b.content);
        }
      }
    }
    return '';
  };
  return { todoOnly, resultFor };
}

describe('2 · the runner hands the first one back, and counts every one', () => {
  it('🔴 two plan-only turns: both counted, only the first handed back', async () => {
    const { todoOnly, resultFor } = await runScript([todoTurn('t1'), todoTurn('t2'), writeTurn('w1')]);
    expect(todoOnly).toHaveLength(2);
    expect(resultFor('t1')).toContain(TODO_ONLY_TURN_STEER);
    expect(resultFor('t2')).toBe('Updated 1 todo(s).');
    expect(resultFor('w1')).not.toContain(TODO_ONLY_TURN_STEER);
  });

  it('the plan-approval lane (update_todo only) is never handed back or counted', async () => {
    const { todoOnly, resultFor } = await runScript([todoTurn('t1')], catalogForTools(['update_todo']));
    expect(todoOnly).toHaveLength(0);
    expect(resultFor('t1')).toBe('Updated 1 todo(s).');
  });

  it('wiring: the route sums the turns into one TODO_ONLY_TURNS line', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    // PIN UPDATED 2026-10-13: the record and its try moved into todoOnlyTurn.ts (`recordTodoOnlyTurns`) — the chat handler
    // is at TypeScript's control-flow limit (TS2563). The route makes the one call; the module writes the line.
    expect(route).toContain('recordTodoOnlyTurns(buildDiag, todoOnlyTally);');
    const module = readFileSync('src/server/AgentV3/todoOnlyTurn.ts', 'utf8');
    expect(module).toContain("code: 'TODO_ONLY_TURNS', message: todoOnlyTurnsNote(tally.turns, tally.latencyMs)");
    expect(route).toMatch(/onTodoOnlyTurn: \(t: \{ latencyMs: number \}\) => \{\s*todoOnlyTally\.turns \+= 1;/);
  });
});

describe('3 · the first attempt is told — every place a writer is asked to keep the plan', () => {
  it('the update_todo contract every lane reads', () => {
    expect(defaultToolCatalog().find((t) => t.name === 'update_todo')?.description).toContain(TODO_RIDES_WITH_WORK);
  });

  it('the architect prompt, with the phrase other tests cite kept', () => {
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain('Begin by calling update_todo');
    expect(p).toMatch(/update_todo[\s\S]{0,400}SAME turn/);
    expect(p).toContain(TODO_RIDES_WITH_WORK);
  });

  it('the delegation note, the blueprint block and the task tool', () => {
    expect(PLAN_YOURSELF_NOTE).toMatch(/update_todo[\s\S]*SAME turn/);
    expect(blueprintAdvisoryBlock([{ path: 'src/App.tsx', purpose: 'root' }])).toContain(TODO_RIDES_WITH_WORK);
    expect(taskToolDef().description).toContain(TODO_RIDES_WITH_WORK);
  });

  it('the rule never says to hold the plan back until a write (the plan still appears at once)', () => {
    expect(TODO_RIDES_WITH_WORK).toMatch(/reads included/);
    expect(TODO_RIDES_WITH_WORK).toMatch(/PREVIOUS step done alongside the next step's work/);
  });

  it('🔒 the lanes that cannot write are NOT told to pair the plan with work', () => {
    expect(planSystemPrompt()).not.toContain(TODO_RIDES_WITH_WORK);
    for (const role of ['planner', 'product', 'requirement'] as const) expect(roleConfig(role).system).not.toContain(TODO_RIDES_WITH_WORK);
  });

  // 🔴 REVIEW FINDING (adversarial review of this fix, 2026-10-12): the rule rode the update_todo CONTRACT, and
  // `catalogForTools(['update_todo'])` — the plan-approval lane, whose prompt says "End your turn after calling
  // update_todo" — handed that lane "never as a turn of its own". The prompt checks above passed with that
  // contradiction live, because they never looked at the tool description the lane actually reads.
  it('🔒 …and not through the update_todo contract either: a non-writer lane reads the plain contract', () => {
    const todoDesc = (defs: Array<{ name: string; description?: string }>) => defs.find((t) => t.name === 'update_todo')?.description ?? '';
    // The plan-approval lane is built from exactly this list (source guard below keeps that true).
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("tools: catalogForTools(['update_todo'])");
    const planLane = todoDesc(catalogForTools(['update_todo']));
    expect(planLane).toContain('Update the ONE running build plan shown to the user');
    expect(planLane).not.toContain(TODO_RIDES_WITH_WORK);
    expect(planLane).not.toMatch(/turn of its own/);
    // The planning roles, spawned through SubAgent's `catalogForTools(cfg.tools)`.
    for (const role of ['planner', 'product', 'requirement'] as const) {
      expect(todoDesc(catalogForTools(roleConfig(role).tools))).not.toContain(TODO_RIDES_WITH_WORK);
    }
    // Every writer lane keeps the rule — the contract and the hand-back answer the same question.
    for (const role of ['architect', 'frontend', 'backend'] as const) {
      expect(todoDesc(catalogForTools(roleConfig(role).tools)), role).toContain(TODO_RIDES_WITH_WORK);
    }
  });
});

describe('4 · 🔒 CENSUS — a new "keep the plan" instruction cannot be written without the rule', () => {
  const CLASS = [/\b(call|calling|record|keep|use|own|send|mark|plan)\b[^.;]{0,60}\b(update_todo|todo list)\b/i];
  const FILES = [...sourceFiles('src/server/AgentV3'), 'src/server/routes/agentv3.ts']
    .filter((f) => !f.endsWith('AgentV3/todoOnlyTurn.ts'));
  const ALLOWED: Array<{ file: string; has: string; why: string; check?: () => boolean }> = [
    { file: 'systemPrompt.ts', has: 'record it by calling the update_todo tool', why: 'the plan-approval lane: it is offered ONLY update_todo and told to end its turn after it' },
    { file: 'systemPrompt.ts', has: 'End your turn after calling update_todo', why: 'the plan-approval lane, as above' },
    {
      file: 'AgentRegistry.ts', has: 'You are the Architect — the lead engineer', why: 'registry metadata: the architect\'s real prompt is architectSystemPrompt (section 3); this text is never sent',
      check: () => !/roleConfig\('architect'\)\.system|REGISTRY\.architect\.system/.test(readFileSync('src/server/routes/agentv3.ts', 'utf8')),
    },
    ...(['Requirements analyst', 'You are the Planner', 'You are the Product manager'].map((has) => ({
      file: 'AgentRegistry.ts', has, why: 'a planning role — no writer tool, so it has no work to pair the plan with',
      check: () => (['requirement', 'planner', 'product'] as const).every((r) => !roleConfig(r).tools.some((t) => t === 'write_file' || t === 'edit_file')),
    }))),
  ];
  const hits = instructionCensus(FILES, CLASS, 'TODO_RIDES_WITH_WORK');
  const allowedFor = (h: { file: string; text: string }) => ALLOWED.find((a) => h.file.endsWith(a.file) && h.text.includes(a.has));

  it('the census sees this build\'s instruction', () => {
    expect(CLASS[0].test('Begin by calling update_todo to lay out a short, concrete plan')).toBe(true);
    expect(hits.filter((h) => h.covered).length).toBeGreaterThanOrEqual(4);
  });

  it('every instruction carries TODO_RIDES_WITH_WORK or a written reason', () => {
    expect(hits.filter((h) => !h.covered && !allowedFor(h)).map((h) => `${h.file}:${h.line} — ${h.text.slice(0, 120)}`)).toEqual([]);
  });

  it('an allowance is checked, and none is stale', () => {
    for (const a of ALLOWED) {
      expect(hits.some((h) => h.file.endsWith(a.file) && h.text.includes(a.has)), `stale allowance: ${a.has}`).toBe(true);
      if (a.check) expect(a.check(), a.why).toBe(true);
    }
  });
});
