import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  makeMultiProviderTurnRunner,
  sharedRateLimitCooldowns,
  type NamedRunner,
} from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { STARVED_BUDGET_MESSAGE } from '../src/server/AgentV3/floorBudget';
import type { RunTurnParams, TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

/**
 * THE FAST LANE MUST NOT RE-DISCOVER A DEAD RUNG ON EVERY FILE.
 *
 * 🔴 The build this locks (Panchang `16cabab2`, 2026-09-16). `makeFastTextRunner()` is called fresh
 * inside `fastGenerateOnce` — once per FILE — so each file got a runner with an empty dead-rung map
 * and paid the same GLM output-budget starvation again. Two files, `muhurat.ts` and `astro.ts`, spent
 * **812.9 s and 1,397.3 s**: 92.6% of that build's entire model time. KIMI was one rung further down
 * the ladder and was never reached on either file (`providerDelivery: {GLM: 5}`, 89 output-budget
 * failures).
 *
 * The retirement logic was already correct; only its LIFETIME was wrong. These tests pin the lifetime
 * — shared within one build, fresh for the next, never across users — and pin the two things that must
 * NOT change with it: a success is never retired, and a timeout is still not a starvation.
 */

// The 429 cooldown registry is a process-wide singleton by design; reset it so a simulated failure in
// one case can never bench a provider for the next (same guard the existing runner suite uses).
beforeEach(() => sharedRateLimitCooldowns.reset());

const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

const ok = (text: string): TurnResult => ({
  text,
  toolUses: [],
  stopReason: 'end_turn',
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  rawContent: [{ type: 'text', text }],
});

/** A rung that starves its output budget — the exact failure the Panchang build hit, 89 times. */
const starvingRunner = (): TurnRunner => ({
  runTurn: vi.fn().mockRejectedValue(new Error(
    `${STARVED_BUDGET_MESSAGE} — this rung was authorised 8000 output tokens and spent every one of them.`,
  )),
});
const okRunner = (text: string): TurnRunner => ({ runTurn: vi.fn().mockResolvedValue(ok(text)) });
const timingOutRunner = (): TurnRunner => ({
  runTurn: vi.fn().mockRejectedValue(new Error('OpenAI-compatible call (GLM/Kimi) timed out after 60000ms')),
});

/** One build's fast lane: a NEW runner per file, all sharing that build's one dead-rung map. */
const perFileRunner = (chain: NamedRunner[], deadRungs: Map<string, string>): TurnRunner =>
  makeMultiProviderTurnRunner(chain, { deadRungs });

const glmKimi = (glm: TurnRunner, kimi: TurnRunner): NamedRunner[] => [
  { name: 'GLM', runner: glm, modelId: 'glm-5.3-flash' },
  { name: 'KIMI', runner: kimi, modelId: 'kimi-k2.7-code' },
];

describe('Test 1 — a rung starved on file A is SKIPPED for file B in the SAME build', () => {
  it('does not call the starved GLM rung a second time, and serves file B from KIMI', async () => {
    const build = new Map<string, string>(); // one build's memory
    const glm = starvingRunner();
    const kimiA = okRunner('file A');
    const kimiB = okRunner('file B');

    // File A — GLM is tried, starves, and is retired into the build's shared map.
    const a = await perFileRunner(glmKimi(glm, kimiA), build).runTurn(PARAMS);
    expect(a.text).toBe('file A');
    expect(glm.runTurn).toHaveBeenCalledTimes(1);
    expect(build.size).toBe(1);

    // File B — a BRAND NEW runner (exactly what fastGenerateOnce builds), same build map.
    const b = await perFileRunner(glmKimi(glm, kimiB), build).runTurn(PARAMS);
    expect(b.text).toBe('file B');
    // 🔑 THE WHOLE POINT: still 1. Before this change it would have been 2 — the second file
    // re-paying the same starvation that produced the 1,397 s call.
    expect(glm.runTurn).toHaveBeenCalledTimes(1);
  });

  it('retires only the rung that starved — the rest of the ladder is untouched', async () => {
    const build = new Map<string, string>();
    const glm = starvingRunner();
    const kimi = okRunner('from kimi');
    await perFileRunner(glmKimi(glm, kimi), build).runTurn(PARAMS);
    // Keyed on name::modelId, so a different model on the same provider is NOT retired.
    expect([...build.keys()]).toEqual(['GLM::glm-5.3-flash']);
  });
});

describe('Test 2 — a NEW build starts with a fresh dead-rung state', () => {
  it('file C in the next build is allowed to try the rung that starved in the previous one', async () => {
    const buildOne = new Map<string, string>();
    const glm = starvingRunner();
    await perFileRunner(glmKimi(glm, okRunner('A')), buildOne).runTurn(PARAMS);
    expect(glm.runTurn).toHaveBeenCalledTimes(1);

    // A new build = a new map, exactly as the route's per-request `const` produces.
    const buildTwo = new Map<string, string>();
    await perFileRunner(glmKimi(glm, okRunner('C')), buildTwo).runTurn(PARAMS);

    // Tried AGAIN — a starved rung is slow for one build, never blacklisted for the next.
    expect(glm.runTurn).toHaveBeenCalledTimes(2);
    expect(buildOne.size).toBe(1);
    expect(buildTwo.size).toBe(1);
  });
});

describe('Test 3 — one user’s build never affects another’s', () => {
  it('two concurrent builds keep entirely separate memories', async () => {
    const userA = new Map<string, string>();
    const userB = new Map<string, string>();
    const glm = starvingRunner();

    await perFileRunner(glmKimi(glm, okRunner('a1')), userA).runTurn(PARAMS);
    expect(glm.runTurn).toHaveBeenCalledTimes(1);
    expect(userB.size).toBe(0); // user B learned nothing from user A

    await perFileRunner(glmKimi(glm, okRunner('b1')), userB).runTurn(PARAMS);
    expect(glm.runTurn).toHaveBeenCalledTimes(2); // user B still gets to try GLM

    // …and user A still skips it.
    await perFileRunner(glmKimi(glm, okRunner('a2')), userA).runTurn(PARAMS);
    expect(glm.runTurn).toHaveBeenCalledTimes(2);
  });

  it('🔒 the memory is caller-owned, never a module singleton — two runners with NO map share nothing', async () => {
    const glm = starvingRunner();
    await makeMultiProviderTurnRunner(glmKimi(glm, okRunner('x')), {}).runTurn(PARAMS);
    await makeMultiProviderTurnRunner(glmKimi(glm, okRunner('y')), {}).runTurn(PARAMS);
    // Omitting the option keeps the old private-map behaviour byte-identical: tried both times.
    expect(glm.runTurn).toHaveBeenCalledTimes(2);
  });
});

describe('Test 4 — a successful provider call is NEVER marked dead', () => {
  it('leaves the shared map empty and keeps serving from the same rung', async () => {
    const build = new Map<string, string>();
    const glm = okRunner('built fine');
    const kimi = okRunner('unused');

    await perFileRunner(glmKimi(glm, kimi), build).runTurn(PARAMS);
    await perFileRunner(glmKimi(glm, kimi), build).runTurn(PARAMS);

    expect(build.size).toBe(0);
    expect(glm.runTurn).toHaveBeenCalledTimes(2); // still the leading rung on every file
    expect(kimi.runTurn).not.toHaveBeenCalled();
  });
});

describe('Test 5 — starved ≠ timeout, and sharing the map does not blur them', () => {
  it('a TIMEOUT is not written to the dead-rung memory (it is a transient, benched class)', async () => {
    const build = new Map<string, string>();
    const glm = timingOutRunner();
    await perFileRunner(glmKimi(glm, okRunner('via kimi')), build).runTurn(PARAMS);

    // 🔒 The distinction the engine deliberately draws: a timeout means the provider was slow, which
    // a later file may not reproduce, so it is NOT retired here — it is handled by the consecutive-
    // timeout family bench instead. Only a starvation (our own ceiling) is a permanent fact.
    expect(build.size).toBe(0);
  });

  it('a STARVATION is written, so the two classes remain distinguishable', async () => {
    const build = new Map<string, string>();
    await perFileRunner(glmKimi(starvingRunner(), okRunner('via kimi')), build).runTurn(PARAMS);
    expect(build.size).toBe(1);
    expect([...build.values()][0]).toContain(STARVED_BUDGET_MESSAGE);
  });

  it('a timed-out rung is therefore still RE-TRIED on the next file of the same build', async () => {
    const build = new Map<string, string>();
    const glm = timingOutRunner();
    await perFileRunner(glmKimi(glm, okRunner('a')), build).runTurn(PARAMS);
    await perFileRunner(glmKimi(glm, okRunner('b')), build).runTurn(PARAMS);
    expect(glm.runTurn).toHaveBeenCalledTimes(2);
  });
});

describe('the wiring — one map per BUILD, inside the request handler', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the fast lane declares its own dead-rung map and hands it to every per-file runner', () => {
    expect(route).toContain('const fastLaneDeadRungs = new Map<string, string>();');
    const at = route.indexOf('const makeFastTextRunner =');
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at, at + 900)).toContain('deadRungs: fastLaneDeadRungs');
  });

  it('🔒 it is declared INSIDE the build request handler, so it cannot outlive one build', () => {
    const decl = route.indexOf('const fastLaneDeadRungs');
    const handler = route.indexOf("app.post('/api/agentv3/chat'");
    expect(handler).toBeGreaterThan(0);
    // After the handler opens ⇒ per-request. A module-level const would sit before it.
    expect(decl).toBeGreaterThan(handler);
    // …and indented, i.e. nested in a function body rather than at module scope.
    const lineStart = route.lastIndexOf('\n', decl) + 1;
    expect(route.slice(lineStart, decl)).toMatch(/^\s+$/);
  });

  it('🔒 it is never a module-level singleton (the one shape that would leak across builds)', () => {
    // No top-of-file `const fastLaneDeadRungs` at zero indentation anywhere.
    expect(route).not.toMatch(/^const fastLaneDeadRungs/m);
  });

  it('buildTurnRunner forwards the option only when the caller supplied one', () => {
    const at = route.indexOf('export function buildTurnRunner');
    expect(at).toBeGreaterThan(0);
    // Anchored on a statement INSIDE the body, not on the first `}` — that one closes the options
    // type literal, so slicing to it cut the body off entirely (caught by this test failing first).
    const handoff = route.indexOf('makeMultiProviderTurnRunner(guardedChain', at);
    expect(handoff).toBeGreaterThan(at);
    const body = route.slice(handoff, route.indexOf('\n}', handoff));
    expect(body).toContain('...(opts.deadRungs ? { deadRungs: opts.deadRungs } : {})');
  });
});
