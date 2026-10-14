/**
 * 🧬 TWO COPIES OF ONE TRUTH, WHERE ONLY ONE OF THEM IS THE TRUTH (build report 9c612cdb, 2026-10-13,
 * Q-1026 + Q-1033).
 *
 * Two findings from the same report, one class — the fourth absolute rule's centralisation class:
 *
 *   Q-1026  Where the CONTRACT module lives, and how a file imports it, were each written twice.
 *           `contractRenames.ts` had `importSpecifierFor` and `SimpleBuilder.ts` had
 *           `contractImportSpecifier`, byte-identical. Worse, the WRITER decided the path
 *           (`contractFilePath`) while the HEALERS searched a hand-kept list
 *           (`CONTRACT_PATH_CANDIDATES`). Move the contract to a third location in the writer and the
 *           healers silently find no contract: no test fails, because the list is still internally
 *           consistent — just no longer about reality.
 *
 *   Q-1033  The money predicate `(paid-public OR credit-gate) AND not free-listed` was written SIX
 *           times in `routes/agentv3.ts`. It has already been widened once (the credit gate was OR-ed
 *           in on 2026-07-10). The next widening that reaches five of the six leaves the sixth
 *           charging — or not charging — by a rule nobody chose.
 *
 * 🔒 WHAT THESE TESTS LOCK IS THE CLASS, NOT THE TWO INSTANCES. Deleting the copies is the easy half;
 * these fail when a NEW copy appears — a second specifier implementation, a second contract-path list,
 * a seventh billing predicate — and the structural assertion below makes the Q-1026 disagreement
 * impossible rather than merely absent: every path `contractFilePath` can return IS a candidate,
 * because both are built from the same two constants.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import {
  CONTRACT_PATH_CANDIDATES, contractFilePath, contractImportSpecifier,
} from '../src/server/AgentV3/contractLocation';
import { billingAppliesTo } from '../src/server/AgentV3/featureFlag';

const AGENTV3 = join(__dirname, '..', 'src/server/AgentV3');
const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');

/** Every non-test TypeScript source under the engine, path relative to it. Walked, never listed. */
function engineSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
      out.push(relative(AGENTV3, full));
    }
  };
  walk(AGENTV3);
  return out.sort();
}

/** Comment text is evidence, not code — a class named in a header must not fail its own census. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('Q-1026 — the contract has ONE home, and the search cannot disagree with the writer', () => {
  it('every path the writer can choose is a path the healers search', () => {
    // The writer's whole decision space: sources under `src/`, and sources at the root.
    const underSrc = contractFilePath([{ path: 'src/App.tsx' }, { path: 'src/main.tsx' }]);
    const atRoot = contractFilePath([{ path: 'app/page.tsx' }, { path: 'index.html' }]);
    for (const chosen of [underSrc, atRoot]) {
      expect(CONTRACT_PATH_CANDIDATES).toContain(chosen);
    }
    // And nothing else is searched — a candidate the writer can never produce is a dead branch that
    // would read a file belonging to someone else.
    expect([...CONTRACT_PATH_CANDIDATES].sort()).toEqual([underSrc, atRoot].sort());
  });

  it('the candidates are DERIVED, not a second hand-kept list of the same strings', () => {
    const src = codeOnly(read('src/server/AgentV3/contractLocation.ts'));
    // The two paths appear exactly once each, as named constants; both readers are built from them.
    expect((src.match(/'src\/types\.ts'/g) ?? []).length).toBe(1);
    expect((src.match(/'types\.ts'/g) ?? []).length).toBe(1);
    expect(src).toContain('CONTRACT_PATH_CANDIDATES: readonly string[] = [CONTRACT_UNDER_SRC, CONTRACT_AT_ROOT]');
    expect(src).toContain('? CONTRACT_UNDER_SRC : CONTRACT_AT_ROOT');
  });

  it('the import specifier has exactly ONE implementation in the engine', () => {
    // The BODY, not the name: a copy under any name computes the specifier exactly this way, which is
    // how the two copies hid — one was called `importSpecifierFor`. The engine tree is WALKED, never
    // listed: a hand-kept list of files to check is the same drift class this test exists to end.
    const BODY = 'posix.relative(posix.dirname(';
    const owners = engineSources().filter((f) => codeOnly(readFileSync(join(AGENTV3, f), 'utf8')).includes(BODY));
    expect(owners).toEqual(['contractLocation.ts']);
    // The walk really reached the engine, so a narrowed walk cannot pass this vacuously.
    expect(owners.length).toBeGreaterThan(0);
    expect(engineSources().length).toBeGreaterThan(50);
    expect(engineSources()).toContain('SimpleBuilder.ts');
    expect(engineSources()).toContain('contractRenames.ts');
  });

  it('the two modules that held the copies now import them', () => {
    expect(read('src/server/AgentV3/contractRenames.ts'))
      .toContain("import { CONTRACT_PATH_CANDIDATES, contractImportSpecifier } from './contractLocation';");
    expect(read('src/server/AgentV3/SimpleBuilder.ts'))
      .toContain("import { contractFilePath, contractImportSpecifier } from './contractLocation';");
    // The deleted copies are GONE, not merely unused: a dead copy is the next session's source of truth.
    expect(codeOnly(read('src/server/AgentV3/contractRenames.ts'))).not.toContain('function importSpecifierFor');
    expect(codeOnly(read('src/server/AgentV3/SimpleBuilder.ts'))).not.toContain('export function contractImportSpecifier');
    expect(codeOnly(read('src/server/AgentV3/SimpleBuilder.ts'))).not.toContain('export function contractFilePath');
  });

  it('behaviour is byte-for-byte what both copies did', () => {
    expect(contractFilePath([{ path: 'src/App.tsx' }])).toBe('src/types.ts');
    expect(contractFilePath([{ path: 'app/page.tsx' }])).toBe('types.ts');
    expect(contractImportSpecifier('src/Game.tsx', 'src/types.ts')).toBe('./types');
    expect(contractImportSpecifier('src/components/Car.tsx', 'src/types.ts')).toBe('../types');
    expect(contractImportSpecifier('app/page.tsx', 'types.ts')).toBe('../types');
    expect(contractImportSpecifier('main.ts', 'types.ts')).toBe('./types');
  });
});

describe('Q-1033 — a bill has ONE rule, and the route holds no copy of it', () => {
  const route = codeOnly(read('src/server/routes/agentv3.ts'));

  it('not one copy of the predicate survives anywhere in the engine or the routes', () => {
    const COPY = 'isAgentV3PaidPublicEnabled() || isAgentV3CreditGateEnabled()';
    expect(route).not.toContain(COPY);
    // featureFlag.ts is the one home; it is where the expression is allowed to exist.
    const flags = codeOnly(read('src/server/AgentV3/featureFlag.ts'));
    expect((flags.match(/isAgentV3PaidPublicEnabled\(\) \|\| isAgentV3CreditGateEnabled\(\)/g) ?? []).length).toBe(1);
  });

  it('all six readings call the one function', () => {
    expect((route.match(/billingAppliesTo\(userId, email\)/g) ?? []).length).toBe(6);
  });

  it('a caller that also needs a billable uid still says so itself', () => {
    // `billingAppliesTo` answers "is billing on for them", never "is there someone to bill" — the live
    // figure's own `!!userId` is not folded in, because folding it in would silently stop charging the
    // five sites that never had it.
    expect(route).toContain('const liveCostCharged = !!userId && billingAppliesTo(userId, email);');
    const flags = codeOnly(read('src/server/AgentV3/featureFlag.ts'));
    const body = flags.slice(flags.indexOf('export function billingAppliesTo'));
    expect(body.slice(0, body.indexOf('}'))).not.toContain('!!userId');
  });

  it('the rule itself is unchanged: flags off = free, free-listed = free, flags on = billed', () => {
    const env = { ...process.env };
    try {
      delete process.env.AGENTV3_PAID_PUBLIC; delete process.env.AGENTV3_CREDIT_GATE;
      process.env.AGENTV3_FREE_LIST = 'free@example.com';
      expect(billingAppliesTo('u1', 'someone@example.com')).toBe(false);

      process.env.AGENTV3_PAID_PUBLIC = 'true';
      expect(billingAppliesTo('u1', 'someone@example.com')).toBe(true);
      expect(billingAppliesTo('u1', 'free@example.com')).toBe(false);

      delete process.env.AGENTV3_PAID_PUBLIC;
      process.env.AGENTV3_CREDIT_GATE = 'true';
      expect(billingAppliesTo('u1', 'someone@example.com')).toBe(true);
      expect(billingAppliesTo('u1', 'free@example.com')).toBe(false);
    } finally {
      process.env = env;
    }
  });
});
