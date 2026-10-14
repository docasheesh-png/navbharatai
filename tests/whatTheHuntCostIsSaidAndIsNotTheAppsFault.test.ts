/**
 * 💰 WHAT THE DEEP BUG HUNT COST (Q-1042) — and the defect found while adding it.
 *
 * The admin's instinct about the hunt is right: *"aap help ko glm se chalo to sayad sasta chale?"*. The
 * figure behind it is real but ARCHAEOLOGICAL — one report, read by hand: *"523,374 input tokens = 34.4%
 * of the build … billed at ×4"*. Routing is not touched here (`cheapBuildFloorRunners` carries six
 * verbatim admin decisions and CLAUDE.md says confirm first); what this adds is the same number on EVERY
 * build, so the decision comes from a trend instead of an anecdote.
 *
 * 🔴 AND THE REAL FIND, BY RULE 3: `BUG_HUNT_NOT_RUN` — shipped by #3728 — was in NO registry, so
 * `isAppFinding` said yes to it. That is the exact shape of the 2026-10-04 census recorded in
 * `BuildDiagnostics.ts`: a code in no registry appears in the USER's build-health card as a problem with
 * THEIR app and costs them 6 points. **A person pressing "Not now" on a paid extra was losing app-health
 * points for declining to pay.** Both codes are registered now, and the class is locked below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { bugHuntCostReading, bugHuntCostLine, type PhasedEntry } from '../src/server/AgentV3/bugHuntCost';
import { PROCESS_ONLY_CODES, isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';
import { PHASE_POST_BUILD_REVIEW } from '../src/server/AgentV3/billingPhase';

const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');

const hunt = (inputTokens: number, outputTokens: number): PhasedEntry => ({
  provider: 'KIMI', model: 'kimi-k2.7-code', phase: PHASE_POST_BUILD_REVIEW, usage: { inputTokens, outputTokens },
});
const build = (inputTokens: number, outputTokens: number): PhasedEntry => ({
  provider: 'KIMI', model: 'kimi-k2.7-code', usage: { inputTokens, outputTokens },
});

describe('the hunt\'s share of the engine cost is measured, not guessed', () => {
  it('a build with no hunt says NOTHING — a 0% line would read as a free hunt that found nothing', () => {
    const r = bugHuntCostReading([build(100_000, 5_000)]);
    expect(r.ran).toBe(false);
    expect(bugHuntCostLine(r)).toBeNull();
  });

  it('the share is the hunt\'s slice over the build\'s whole cost, both priced by the SAME function', () => {
    // Equal usage ⇒ the hunt is half the cost, whatever the rate card says. That is the point of
    // pricing both sides with `realProviderCostUsd` instead of deriving one from the other.
    const r = bugHuntCostReading([build(100_000, 5_000), hunt(100_000, 5_000)]);
    expect(r.ran).toBe(true);
    expect(r.sharePct).toBeCloseTo(50, 1);
    expect(r.realUsd).toBeGreaterThan(0);
  });

  it('a hunt that dominated the build is reported as dominating it', () => {
    const r = bugHuntCostReading([build(10_000, 500), hunt(90_000, 4_500)]);
    expect(r.sharePct).toBeGreaterThan(80);
    expect(bugHuntCostLine(r)).toContain('% of this build\'s engine cost');
  });

  it('several hunt slices are ONE pass — phases split a slice, so they must be summed', () => {
    const one = bugHuntCostReading([hunt(100_000, 5_000)]);
    const split = bugHuntCostReading([hunt(60_000, 3_000), hunt(40_000, 2_000)]);
    expect(split.inputTokens).toBe(one.inputTokens);
    expect(split.outputTokens).toBe(one.outputTokens);
    expect(split.realUsd).toBeCloseTo(one.realUsd, 10);
  });

  it('a zero-cost build yields no share rather than a division by zero', () => {
    const r = bugHuntCostReading([hunt(0, 0)]);
    expect(r.ran).toBe(true);
    expect(r.sharePct).toBeNull();
    expect(bugHuntCostLine(r)).toContain('could not be measured');
    expect(bugHuntCostLine(r)).not.toMatch(/NaN|Infinity|null%/);
  });
});

describe('the line names no engine and invents no rupee figure', () => {
  const line = bugHuntCostLine(bugHuntCostReading([build(10_000, 500), hunt(90_000, 4_500)])) ?? '';

  it('no vendor or model name — this report reaches the USER (the White-Label Law)', () => {
    for (const vendor of ['KIMI', 'Kimi', 'GLM', 'kimi-k2', 'glm-', 'Claude', 'Sonnet', 'Opus', 'Haiku', 'Anthropic', 'Grok', 'Gemini']) {
      expect(line).not.toContain(vendor);
    }
  });

  it('no per-slice ₹: the markup applies to the build\'s TOTAL, so a slice figure is a number nobody computed', () => {
    expect(line).not.toMatch(/[₹$]/);
  });

  it('the module itself does not reach for a markup or a discount — nor hardcode one', () => {
    const src = read('src/server/AgentV3/bugHuntCost.ts');
    expect(src).not.toMatch(/tieredMarkupUsd|applyBuildDiscount|usdInrRate/);
    // 🔴 FOUND BY A REVERSION THAT PASSED. The list above names FUNCTIONS, so a hardcoded rate
    // (`realUsd * 88 * 4`) walked straight past it — the guard knew the honest ways to get a rupee and
    // none of the dishonest ones. A currency symbol in the code is the shape that cannot be evaded.
    // Scoped to the rupee sign, NOT `$`: every template literal in this file contains `${…}`, so a
    // `[₹$]` guard failed the correct code — caught by running it. The rupee is the fabricated figure
    // this test is about.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).not.toMatch(/₹/);
    // And it prices with the ONE cost function rather than a second copy.
    expect(src).toContain("import { realProviderCostUsd, type ProviderCostEntry } from './providerRates';");
  });
});

describe('🔴 the user\'s own choice is never a finding against their app', () => {
  it('both bug-hunt codes are process-only, so no app-health point is lost for declining to pay', () => {
    for (const code of ['BUG_HUNT_NOT_RUN', 'BUG_HUNT_COST']) {
      expect(PROCESS_ONLY_CODES.has(code), `${code} is in no registry — isAppFinding would blame the app`).toBe(true);
      expect(isAppFinding({ phase: 'build', code })).toBe(false);
    }
  });

  it('and neither offers the user a "next move", because a choice and a cost are not next moves', () => {
    const sugg = read('src/server/AgentV3/buildFindingSuggestions.ts');
    expect(sugg).toContain("'BUG_HUNT_NOT_RUN'");
    expect(sugg).toContain("'BUG_HUNT_COST'");
  });

  it('🔒 THE CLASS: every BUG_HUNT_* code this repo records is process-only', () => {
    // The guard that catches the NEXT one. #3728 added `BUG_HUNT_NOT_RUN` to no registry at all; a third
    // code added the same way fails here instead of quietly costing a user six points.
    const codes = new Set<string>();
    for (const rel of ['src/server/routes/agentv3.ts', 'src/server/AgentV3/optionalBugHunt.ts']) {
      for (const m of read(rel).matchAll(/code: '(BUG_HUNT_[A-Z_]+)'/g)) codes.add(m[1]);
    }
    expect(codes.size, 'the scan found no BUG_HUNT_* code — it is looking in the wrong place').toBeGreaterThan(0);
    for (const code of codes) {
      expect(PROCESS_ONLY_CODES.has(code), `${code} is recorded but is not process-only`).toBe(true);
      expect(isAppFinding({ phase: 'build', code })).toBe(false);
    }
  });
});

describe('the wiring', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('it is recorded once, where the provider ledger is final', () => {
    expect((route.match(/bugHuntCostLine\(bugHuntCostReading\(/g) ?? []).length).toBe(1);
    expect(route).toContain("code: 'BUG_HUNT_COST'");
  });

  it('and it can never affect a build', () => {
    const at = route.indexOf('const huntLine = bugHuntCostLine(');
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at - 80, at + 400)).toContain('catch { /* a cost line never affects a build */ }');
  });

  it('routing is NOT touched — the cheap-rung decision stays the admin\'s (CLAUDE.md)', () => {
    // CODE only. The header NAMES `cheapBuildFloorRunners` to explain why it is left alone, and a
    // census that cannot tell a comment from a call would fail a file for documenting its own restraint.
    const code = read('src/server/AgentV3/bugHuntCost.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).not.toMatch(/cheapBuildFloorRunners|tierLadder|AGENTV3_CHEAP_FLOOR/);
    // And the header really does explain the restraint, so the next reader knows it was a decision.
    expect(read('src/server/AgentV3/bugHuntCost.ts')).toContain('does not touch routing');
  });
});
