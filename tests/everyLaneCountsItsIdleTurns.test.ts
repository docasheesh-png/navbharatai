// Q-1030 — EVERY LANE THAT CAN WRITE COUNTS ITS PLAN-ONLY TURNS, AND THE LINE IS WRITTEN LAST.
//
// 🔴 THE TWO DEFECTS THIS LOCKS (build-report queue Q-1030, from report 12ef62b2's autopsy).
//
//   1. THE SUB-AGENT LANE WAS NEVER COUNTED. `TODO_ONLY_TURNS` (todoOnlyTurn.ts, autopsy 9c612cdb) was
//      wired to the three generation-shaped runners and to every heal that spreads `baseRunnerOpts` — but
//      not to the child runner in SubAgent.ts, which on a delegating build runs MOST of the turns. The
//      exact sibling of the `onLlmCall` omission fixed on 2026-09-19, in the same object, for the same
//      reason: a recorder the architect has is not a recorder the child has unless someone hands it over.
//
//   2. THE LINE WAS WRITTEN BEFORE THE COUNTING FINISHED. The route recorded it the moment generation
//      ended — above twelve heal/fix runners that all share `baseRunnerOpts` and all count into the same
//      tally. The arithmetic was right and the number the admin read was wrong. The report now builds the
//      line when it SERIALIZES (BuildDiagnostics.setTodoOnlyTally), which is the same lesson
//      `resolveRecoveredOnSuccess` already learned in that file: a truth that arrives later cannot be
//      stamped early.
//
// WHY A CENSUS AND NOT THREE PINS: the class behind both defects is "a count kept at one of N call sites is
// not kept". So the test does not list the lanes that must count — it finds EVERY `new AgentRunner` in the
// server and requires each one to either feed the tally or prove, in its own source, that it cannot write.
// A thirteenth heal lane added next month fails this test until it is wired.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { noteTodoOnlyTurn, todoOnlyTurnsLine, todoOnlyTurnsNote } from '../src/server/AgentV3/todoOnlyTurn';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const ROUTE = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const SUB_AGENT = readFileSync(join(__dirname, '../src/server/AgentV3/SubAgent.ts'), 'utf8');

describe('noteTodoOnlyTurn — ONE counter, so a lane needs one line to join the tally', () => {
  it('sums turns, latency and the once-per-run hand-backs', () => {
    const tally = { turns: 0, latencyMs: 0, firstInRun: 0 };
    noteTodoOnlyTurn(tally, { latencyMs: 4000, firstInRun: true });
    noteTodoOnlyTurn(tally, { latencyMs: 3500 });
    noteTodoOnlyTurn(tally, { latencyMs: 2500, firstInRun: true });
    expect(tally).toEqual({ turns: 3, latencyMs: 10000, firstInRun: 2 });
  });

  it('a junk latency costs a turn but never corrupts the clock', () => {
    const tally = { turns: 0, latencyMs: 0, firstInRun: 0 };
    noteTodoOnlyTurn(tally, { latencyMs: Number.NaN });
    noteTodoOnlyTurn(tally, { latencyMs: -9000 });
    noteTodoOnlyTurn(tally, undefined as unknown as { latencyMs: number });
    expect(tally).toEqual({ turns: 3, latencyMs: 0, firstInRun: 0 });
  });

  it('never throws without a tally — a measurement must not be able to end a build', () => {
    expect(() => noteTodoOnlyTurn(undefined as unknown as { turns: number; latencyMs: number; firstInRun: number }, { latencyMs: 1 })).not.toThrow();
  });
});

describe('🔴 DEFECT 2 — the report reads the tally when it serializes, not when generation ended', () => {
  it('a turn counted AFTER the generation phase is still in the line', () => {
    const diag = new BuildDiagnostics({ workspaceId: 'ws-q1030' });
    const tally = { turns: 0, latencyMs: 0, firstInRun: 0 };
    diag.setTodoOnlyTally(tally);
    // Generation's own turns.
    noteTodoOnlyTurn(tally, { latencyMs: 4000, firstInRun: true });
    // …and a heal lane's, which under the old wiring began after the line had already been written.
    noteTodoOnlyTurn(tally, { latencyMs: 6000, firstInRun: true });
    diag.finish(true, 'built');
    const line = diag.report().issues.find((i) => i.code === 'TODO_ONLY_TURNS');
    expect(line, 'every build carries the line').toBeTruthy();
    expect(line!.message).toContain('2 model turn(s)');
    expect(line!.message).toContain('10s of model time');
    expect(line!.severity).toBe('info');
    expect(line!.autoResolved).toBe(true);
  });

  it('🔒 the tally is kept BY REFERENCE — a copy would re-create the bug', () => {
    const diag = new BuildDiagnostics({ workspaceId: 'ws-q1030-ref' });
    const tally = { turns: 0, latencyMs: 0, firstInRun: 0 };
    diag.setTodoOnlyTally(tally);
    expect(diag.report().issues.find((i) => i.code === 'TODO_ONLY_TURNS')!.message).toContain('No model turn');
    noteTodoOnlyTurn(tally, { latencyMs: 2000 });
    expect(diag.report().issues.find((i) => i.code === 'TODO_ONLY_TURNS')!.message).toContain('1 model turn(s)');
  });

  it('🔒 zero is reported, because a missing line reads as "none"', () => {
    expect(todoOnlyTurnsLine({ turns: 0, latencyMs: 0 }).message).toBe(todoOnlyTurnsNote(0, 0));
    expect(todoOnlyTurnsLine({ turns: 0, latencyMs: 0 }).code).toBe('TODO_ONLY_TURNS');
  });

  it('🔒 it stays OUT of every tally and out of `problems` — it describes our pace, not the app', () => {
    const diag = new BuildDiagnostics({ workspaceId: 'ws-q1030-tally' });
    diag.setTodoOnlyTally({ turns: 5, latencyMs: 30000, firstInRun: 2 });
    diag.finish(true, 'built');
    const r = diag.report();
    expect(r.counts.errors).toBe(0);
    expect(r.counts.warnings).toBe(0);
    expect(r.problems.some((p) => p.code === 'TODO_ONLY_TURNS')).toBe(false);
  });

  it('🔒 the route no longer stamps the line mid-build', () => {
    expect(ROUTE).not.toContain('recordTodoOnlyTurns(');
    expect(ROUTE).toContain('buildDiag.setTodoOnlyTally(todoOnlyTally);');
  });
});

describe('🔴 DEFECT 1 — the sub-agent lane feeds the same tally', () => {
  it('SubAgent hands the hook to its child runner', () => {
    const at = SUB_AGENT.indexOf('const runner = new AgentRunner({');
    expect(at).toBeGreaterThan(-1);
    expect(SUB_AGENT.slice(at, SUB_AGENT.indexOf('\n    });', at))).toContain('onTodoOnlyTurn: deps.onTodoOnlyTurn');
  });

  it('…and the route supplies it, into the ONE build tally', () => {
    const at = ROUTE.indexOf('const subAgentDeps: SubAgentDeps = {');
    expect(at).toBeGreaterThan(-1);
    const block = ROUTE.slice(at, ROUTE.indexOf('\n      };\n', at));
    expect(block).toContain('onTodoOnlyTurn: (t) => noteTodoOnlyTurn(todoOnlyTally, t),');
    // The deps object is declared BELOW the tally, or the closure would read a binding not yet initialised.
    expect(ROUTE.indexOf('const todoOnlyTally = ')).toBeGreaterThan(-1);
    expect(ROUTE.indexOf('const todoOnlyTally = ')).toBeLessThan(at);
  });
});

describe('🔒 THE CLASS — every runner in the server either counts, or cannot write', () => {
  /** Each `new AgentRunner(` site in the route, with enough of its source to read its first properties. */
  const sites = (() => {
    const out: Array<{ at: number; text: string }> = [];
    for (let at = ROUTE.indexOf('new AgentRunner({'); at !== -1; at = ROUTE.indexOf('new AgentRunner({', at + 1)) {
      const next = ROUTE.indexOf('new AgentRunner({', at + 1);
      out.push({ at, text: ROUTE.slice(at, next === -1 ? Math.min(ROUTE.length, at + 3000) : Math.min(next, at + 3000)) });
    }
    return out;
  })();

  it('the census finds the lanes it is meant to police', () => {
    // Measured 2026-10-15: the main build, the plan runner, the escalation, the empty-build retry and the
    // heal/fix family. The floor guards against a regex that silently stops matching.
    expect(sites.length).toBeGreaterThanOrEqual(17);
  });

  it('every one of them feeds the tally, or pins a toolset with no writer in it', () => {
    const unwired = sites.filter((s) => {
      if (s.text.includes('...baseRunnerOpts,')) return false;        // shares the build's hook
      if (s.text.includes('onTodoOnlyTurn')) return false;            // or passes its own
      // The plan-approval lane is offered ONLY update_todo, so a plan-only turn is the whole job and
      // `isTodoOnlyTurn` deliberately answers false for it (todoOnlyTurn.ts, "NEVER TOLD, NEVER STEERED").
      // This is a STRUCTURAL exemption read from its own `tools:` line, not a name on an allowlist.
      if (s.text.includes("tools: catalogForTools(['update_todo'])")) return false;
      return true;
    });
    expect(unwired.map((s) => ROUTE.slice(s.at - 120, s.at + 40)), 'a lane that can write must count its plan-only turns').toEqual([]);
  });

  it('the sub-agent runner is the one outside the route, and it is wired', () => {
    expect(SUB_AGENT.match(/new AgentRunner\(\{/g) ?? []).toHaveLength(1);
    expect(SUB_AGENT).toContain('onTodoOnlyTurn: deps.onTodoOnlyTurn');
  });
});
