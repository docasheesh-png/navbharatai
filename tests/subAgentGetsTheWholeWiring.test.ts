import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { roleExpectsArtifacts } from '../src/server/AgentV3/SubAgent';

/**
 * 🔴 ELEVEN OF THIRTEEN (deep re-autopsy of build `9cca1fd5`, 2026-09-17).
 *
 * `makeSubAgentSpawn` builds the specialist that writes the app — the Architect delegates all app code
 * to it by design. Its child `ToolDispatcher` was constructed with **11 of the constructor's 13
 * positional parameters**, and its child `AgentRunner` with five of its options missing.
 *
 * PR #2988 had already fixed ONE dropped argument here, for THIS EXACT BUILD: `onFileWrite`, position
 * 11. The comment it left behind reads *"only onFileWrite (position 11) is newly threaded through"* —
 * which is precisely how 12 and 13 stayed invisible. A fix that names what it added, beside a call that
 * counts nothing, is a fix that hides its own siblings.
 *
 * What the gaps cost, each verified against the code:
 *   • `onCommand` (13) — NOT ONE sub-agent shell command has ever reached a build report
 *   • `framework` (12) — every child dispatcher silently assumed `vite-react`
 *   • `onLlmCall`      — the majority of a build's model calls appear in no `llmCalls` log
 *   • `signal`         — Stop and the mid-build cost ceiling could not end a delegated run
 *   • `maxBuildMs`     — the child never learned the build had a deadline
 *   • `expectsArtifacts` — `ok = expectsArtifacts && builtSomething` at the step cap, so a capped
 *                          sub-agent was ALWAYS "Stopped without completing", however much it built —
 *                          and the bounded one-time step extension, gated on the same flag, could
 *                          never fire either
 *
 * The guard that matters most is the ARITY one: it is the only one that would have caught this class
 * before it shipped, and it is the only one that will catch a fourteenth parameter.
 */

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SUB_AGENT = src('../src/server/AgentV3/SubAgent.ts');
const DISPATCHER = src('../src/server/AgentV3/ToolDispatcher.ts');
const ROUTE = src('../src/server/routes/agentv3.ts');

/** The `new ToolDispatcher(...)` call inside SubAgent.ts, as source text. */
function childDispatcherCall(): string {
  const at = SUB_AGENT.indexOf('const childDispatcher = new ToolDispatcher(');
  expect(at, 'the child dispatcher construction must be findable').toBeGreaterThan(-1);
  const open = SUB_AGENT.indexOf('(', at + 'const childDispatcher = new ToolDispatcher'.length);
  let depth = 0;
  for (let i = open; i < SUB_AGENT.length; i++) {
    if (SUB_AGENT[i] === '(') depth++;
    else if (SUB_AGENT[i] === ')') { depth--; if (depth === 0) return SUB_AGENT.slice(open + 1, i); }
  }
  throw new Error('unbalanced parentheses in the child dispatcher call');
}

/**
 * Strip comments before counting anything.
 *
 * ⚠️ NOT optional, and the first draft of this file got it wrong in the most instructive way: the doc
 * block above `onFileWriteRaw` contains the phrase *"not relying on a later, sometimes-empty, sandbox
 * listFiles"*. Those commas sit at bracket depth ZERO, so a naive split counted the comment itself as
 * a fourteenth parameter and the guard failed against correct code. A guard whose parser is wrong is
 * worse than no guard: it teaches the next reader that the thing it measures is noisy.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Split a top-level argument list on commas that are not nested inside (), [] or {}. */
function topLevelArgs(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of stripComments(list)) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((a) => a.trim()).filter((a) => a.length > 0);
}

/** How many positional parameters `ToolDispatcher`'s constructor really declares. */
function constructorArity(): number {
  const at = DISPATCHER.indexOf('  constructor(');
  expect(at, "ToolDispatcher's constructor must be findable").toBeGreaterThan(-1);
  const open = DISPATCHER.indexOf('(', at);
  let depth = 0;
  let body = '';
  for (let i = open; i < DISPATCHER.length; i++) {
    if (DISPATCHER[i] === '(') depth++;
    else if (DISPATCHER[i] === ')') { depth--; if (depth === 0) { body = DISPATCHER.slice(open + 1, i); break; } }
  }
  // Parameters carry doc comments and `private readonly` modifiers; counting the top-level commas of
  // the COMMENT-STRIPPED body is the only spelling-independent way to ask "how many are there?".
  return topLevelArgs(body).length;
}

describe('🔴 the child dispatcher gets EVERY positional argument the constructor declares', () => {
  it('the call passes exactly as many arguments as the constructor takes', () => {
    const passed = topLevelArgs(childDispatcherCall()).length;
    expect(passed, `ToolDispatcher takes ${constructorArity()} parameters; SubAgent passes ${passed}`)
      .toBe(constructorArity());
  });

  it('and the last two — the ones that were missing — are the real values, not undefined', () => {
    const args = topLevelArgs(childDispatcherCall());
    expect(args[11]).toContain('deps.framework');
    expect(args[12]).toContain('deps.onCommand');
  });

  it('🔒 the four WITHHELD capabilities stay withheld — this threads wiring, never new powers', () => {
    const args = topLevelArgs(childDispatcherCall());
    expect(args[4], 'no spawn → a sub-agent still cannot recurse').toBe('undefined');
    for (const i of [6, 7, 8, 9]) {
      expect(args[i], `position ${i + 1} (secondOpinion/consensus/webSearch/deploy) stays withheld`).toBe('undefined');
    }
  });
});

describe('🔴 the child runner gets the five options it never had', () => {
  const runnerBlock = (() => {
    const at = SUB_AGENT.indexOf('const runner = new AgentRunner({');
    expect(at).toBeGreaterThan(-1);
    return SUB_AGENT.slice(at, SUB_AGENT.indexOf('});', at));
  })();

  it('per-call telemetry, so a build report finally contains the phase that writes the app', () => {
    expect(runnerBlock).toContain('onLlmCall: deps.onLlmCall');
  });

  it('the abort signal, so Stop and the cost ceiling can end a delegated run', () => {
    expect(runnerBlock).toContain('signal: deps.signal');
  });

  it('the REMAINING build time, never the total', () => {
    expect(runnerBlock).toContain('deps.remainingBuildMs');
    expect(runnerBlock).toContain('maxBuildMs');
  });

  it('and the artifact expectation, gated on the role', () => {
    expect(runnerBlock).toContain('deps.expectsArtifacts');
    expect(runnerBlock).toContain('roleExpectsArtifacts(cfg.tools)');
  });
});

describe('roleExpectsArtifacts — derived from the role\'s own tools, so a new role classifies itself', () => {
  it('a builder writes files', () => {
    expect(roleExpectsArtifacts(['read_file', 'write_file', 'edit_file', 'bash'])).toBe(true);
  });

  it('🔒 a read-only researcher does NOT — its step-cap verdict is unchanged', () => {
    expect(roleExpectsArtifacts(['read_file', 'grep', 'glob', 'update_todo'])).toBe(false);
  });

  it('never throws on junk', () => {
    expect(roleExpectsArtifacts(null)).toBe(false);
    expect(roleExpectsArtifacts(undefined)).toBe(false);
    expect(roleExpectsArtifacts([])).toBe(false);
    expect(roleExpectsArtifacts('write_file' as unknown as string[])).toBe(false);
  });
});

describe('🔒 every thunk is called inside a try — a spawn can never be taken down by a getter', () => {
  it('the remaining-time and artifact thunks both have a catch', () => {
    const at = SUB_AGENT.indexOf('const runner = new AgentRunner({');
    const block = SUB_AGENT.slice(at, SUB_AGENT.indexOf('});', at));
    expect(block).toContain('try { left = Math.floor(deps.remainingBuildMs?.() ?? 0); } catch');
    expect(block).toContain('catch { return false; }');
  });
});

describe('the wiring at the route — proven by reversion', () => {
  const spawnBlock = (() => {
    const at = ROUTE.indexOf('const spawnSubAgent = makeSubAgentSpawn({');
    expect(at, 'the spawn call must be findable').toBeGreaterThan(-1);
    return ROUTE.slice(at, ROUTE.indexOf('});', at));
  })();

  it('the route hands over the same recorders the architect already uses', () => {
    expect(spawnBlock).toContain('buildDiag.recordCommand(c)');
    expect(spawnBlock).toContain('buildDiag.recordLlmCall(c)');
    expect(spawnBlock).toContain('signal: abort.signal');
    expect(spawnBlock).toContain('framework,');
  });

  it('🔒 the remaining time is computed, and a disabled wall clock stays disabled', () => {
    expect(spawnBlock).toContain('effectiveBuildSeconds * 1000 - (Date.now() - buildStartedAt)');
    // `0` means the operator turned the wall clock off — it must not read as "no time left".
    expect(spawnBlock).toContain('effectiveBuildSeconds > 0');
  });
});
