// A Nemotron judge is not Sonnet (2026-09-20).
//
// 🔴 THE DEFECT. `selectReviewJudge` has been able to return `kind: 'nemotron'` since the NVIDIA
// trial key went on the Weak judge, and the admin set `AGENTV3_NEMOTRON=weak` in Cloud Run on
// 2026-09-19 — so it is LIVE, not hypothetical. The report's label for that verdict was an inline
// ternary with four branches and no `nemotron` among them:
//
//     judge.kind === 'grok' ? 'Grok' : judge.kind === 'glm' ? 'GLM' : judge.kind === 'opus' ? 'Opus' : 'Sonnet'
//
// A union member with no branch does not fail: it falls off the end. So every Nemotron verdict since
// that key went live has been filed in the admin build report as **"Sonnet review"** — an engine that
// did not run, at the exact line an autopsy reads to decide which vendor to trust, tune or drop.
//
// ⚠️ THE CLASS, named so it is recognised again: a LABEL built as a chain of equality checks with a
// bare `else` is not exhaustive, and nothing tells you when it stops being right. `tsc` cannot see the
// gap (every branch returns a string), and no test can either, because the wrong answer is a perfectly
// well-formed one. Only a `switch` with a `never` default turns "a new engine appeared" into a compile
// error, which is why the fix is a function and not a fifth ternary arm.
//
// 🔒 This is the ADMIN report's label only. It never reaches a user (White-Label Law) — the two
// narration lines beside it say "NavBharatAI's reviewer", and a test below holds that.
//
// 🔗 Companion to #3143, which stopped that same line calling an un-run review a PASS. Same line, two
// different lies: that one was about whether a review happened, this one is about who did it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { judgeEngineLabel } from '../src/server/AgentV3/BuildJudge';

const ROUTE = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const JUDGE = readFileSync(join(__dirname, '..', 'src/server/AgentV3/BuildJudge.ts'), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('every judge names itself', () => {
  it('🔴 THE BUG: a Nemotron verdict is labelled Nemotron, never Sonnet', () => {
    expect(judgeEngineLabel('nemotron')).toBe('Nemotron');
    expect(judgeEngineLabel('nemotron')).not.toBe('Sonnet');
  });

  it('the four engines that already worked still answer exactly as before', () => {
    // The fix must not move an existing label — the whole point is that the report stays readable
    // for the verdicts it was already getting right.
    expect(judgeEngineLabel('grok')).toBe('Grok');
    expect(judgeEngineLabel('glm')).toBe('GLM');
    expect(judgeEngineLabel('opus')).toBe('Opus');
    expect(judgeEngineLabel('sonnet')).toBe('Sonnet');
  });

  it('every label is distinct — two engines sharing a name is the same lie in a different shape', () => {
    const kinds = ['grok', 'sonnet', 'opus', 'glm', 'nemotron'] as const;
    const labels = kinds.map(judgeEngineLabel);
    expect(new Set(labels).size).toBe(kinds.length);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
  });
});

describe('the union and the label cannot drift apart', () => {
  it("🔒 selectReviewJudge's `kind` union is EXACTLY what judgeEngineLabel accepts", () => {
    // This is the assertion that makes the fix durable. A sixth engine added to the union without a
    // branch here fails `npm run typecheck:server` (the `never` default — proven by reversion; note
    // the FRONTEND `tsc --noEmit` does not cover src/server and stays green, so the server typecheck
    // is the one that catches it). This test fails first if somebody widens the union in the route
    // and narrows it in the label to make that compile error go away.
    const route = codeOnly(ROUTE);
    const at = route.indexOf('function selectReviewJudge');
    expect(at).toBeGreaterThan(-1);
    const signature = route.slice(at, route.indexOf('{', route.indexOf('kind:', at)));
    const routeUnion = (signature.match(/kind:\s*([^}]+)}/) || [])[1];
    expect(routeUnion).toBeTruthy();
    const routeKinds = (routeUnion as string).split('|').map((s) => s.trim().replace(/'/g, '')).sort();

    const labelSig = codeOnly(JUDGE).match(/export function judgeEngineLabel\(kind:\s*([^)]+)\)/);
    expect(labelSig).toBeTruthy();
    const labelKinds = (labelSig as RegExpMatchArray)[1].split('|').map((s) => s.trim().replace(/'/g, '')).sort();

    expect(labelKinds).toEqual(routeKinds);
  });

  it('🔒 the label is a SWITCH with a `never` default, not a ternary chain', () => {
    // A ternary chain is how this bug happened: it has no exhaustiveness and no compile error when a
    // member is missing. Asserting the SHAPE is what stops the fix being undone by a tidy-up.
    const code = codeOnly(JUDGE);
    const at = code.indexOf('export function judgeEngineLabel');
    const body = code.slice(at, at + 700);
    expect(body).toMatch(/switch \(kind\)/);
    expect(body).toMatch(/const never: never = kind/);
    expect(body).not.toMatch(/\?.*:.*\?/); // no ternary chain
  });
});

describe('the route uses it — the ternary is gone', () => {
  const code = codeOnly(ROUTE);

  it('🔒 reviewerName comes from the shared label', () => {
    expect(code).toMatch(/const reviewerName = judgeEngineLabel\(judge\.kind\)/);
  });

  it("🔒 and the four-branch ternary is not left behind anywhere in the route", () => {
    // The old expression, in any spacing. If it comes back — copied into a second report line, say —
    // the same silent mislabelling comes back with it.
    expect(code).not.toMatch(/judge\.kind\s*===\s*'grok'\s*\?/);
    expect(code).not.toMatch(/:\s*'Opus'\s*:\s*'Sonnet'/);
  });

  it('🔒 WHITE-LABEL — the label feeds the ADMIN record, never the user narration', () => {
    // `reviewerName` may only appear on `recordVerdict` (buildDiag, admin-only). The narration beside
    // it used to print it ("🔎 Grok is reviewing…"); that was fixed on 2026-09-14 and must stay fixed —
    // naming Nemotron correctly to the ADMIN is the fix, naming it to a USER would be a new breach.
    const uses = code.split('\n').filter((l) => l.includes('reviewerName'));
    expect(uses.length).toBeGreaterThan(1);
    for (const line of uses) {
      const isDeclaration = line.includes('const reviewerName');
      const isAdminRecord = line.includes('recordVerdict');
      expect(isDeclaration || isAdminRecord).toBe(true);
    }
    const narration = code.split('\n').filter((l) => l.includes("type: 'narration'") && l.includes('reviewer'));
    expect(narration.length).toBeGreaterThan(0);
    for (const line of narration) {
      expect(line).not.toMatch(/Nemotron|Sonnet|Grok|GLM|Opus|reviewerName/);
    }
  });
});
