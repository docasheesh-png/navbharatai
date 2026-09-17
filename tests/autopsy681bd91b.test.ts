/**
 * AUTOPSY 681bd91b (2026-09-17) — a single-file AI-chat app, DONE at minute 4:45, then 26 minutes of
 * "Type-checking… fixing" in which glm-5.3 starved at a hard-coded 8,000-token ceiling FOURTEEN times.
 *
 * Six root causes, one report:
 *   A1  a starvation was retired per KEY ('GLM#2', 'GLM#3' …) although it is a fact about the MODEL,
 *       so a 51-key pool re-proved it key after key;
 *   A2  the repair (8,000) and the roadmap planner (4,000) hard-coded an ask below what an
 *       always-reasoning model needs to BEGIN an answer, and nothing raised it;
 *   TS  the typecheck gate ran on the vite-react SCAFFOLD's untouched src/*.tsx for a build that had
 *       written exactly one index.html — the user having forbidden React, Vite, npm and src/main.tsx;
 *   B   the planner's own HARD RULE told it to plan "local/mock data", its user prompt cut the request
 *       at 4,000 chars (dropping "NO FAKE FEATURES"), and the milestone swap replaced the user's words
 *       with the planner's — so the builder shipped a mock assistant and console.log placeholders;
 *   E1  "No page zoom problems" made the app a "clone of Zoom / Meet";
 *   E2  "Store:\n- provider" made it ecommerce, and cart/checkout/refunds were injected into the prompt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { reasoningAwareAsk, REASONING_MIN_ASK } from '../src/server/AgentV3/reasoningAsk';
import { typecheckGateShouldRun, postBuildCodeGateShouldRun, isTypeScriptSourcePath } from '../src/server/routes/agentv3';
import { megaRoadmapSystemPrompt, megaRoadmapUserPrompt, boundedRequest, hardConstraintLines } from '../src/server/lib/megaRoadmap';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { makeMultiProviderTurnRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { starvedBudgetError } from '../src/server/AgentV3/floorBudget';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// The report's own prompt, reduced to the lines that mattered.
const REPORTED_PROMPT = [
  'Build a complete AI Chat Web App as ONE SINGLE self-contained HTML file named index.html.',
  '- Do NOT use React.', '- Do NOT use Vite.', '- Do NOT use npm.',
  'SAVE API CONFIGURATION', 'Store:', '- provider', '- endpoint', '- model', '- API key', 'Use localStorage.',
  'On Android:', '- Full viewport', '- No page zoom problems', '- No horizontal scrolling',
  'No fake AI responses.', 'No simulated model responses.', "Do NOT create buttons that don't work.", 'Do NOT create fake streaming.',
].join('\n');

const starve = (ask: number) => starvedBudgetError(ask, ask, false);
const rung = (name: string, modelId: string, reportAs: string | undefined, impl: () => Promise<any>) =>
  ({ name, modelId, reportAs, runner: { runTurn: impl } as any });

describe('A1 — a starvation retires the MODEL across the whole key pool, not one key at a time', () => {
  it('THE REPORTED SHAPE: 3 keys of glm-5.3 starve once, not three times', async () => {
    let glmCalls = 0;
    const glm = () => { glmCalls++; return Promise.reject(starve(8000)); };
    // The FIRST key to starve is deliberately NOT the one whose name equals the family ('GLM'):
    // with the old per-key write ('GLM#2::glm-5.3') a family lookup ('GLM::glm-5.3') would miss, so
    // this ordering is what makes the write-key half of the fix load-bearing, not only the lookup.
    const chain = [
      rung('GLM#2', 'glm-5.3', 'GLM', glm), rung('GLM#3', 'glm-5.3', 'GLM', glm), rung('GLM', 'glm-5.3', 'GLM', glm),
      rung('CLAUDE_HAIKU', 'claude-haiku-4-5', undefined, async () => ({ text: 'ok', stopReason: 'end_turn', toolUses: [], usage: { inputTokens: 1, outputTokens: 1 } })),
    ];
    const dead = new Map<string, string>();
    const r = makeMultiProviderTurnRunner(chain as any, { deadRungs: dead } as any);
    const out = await r.runTurn({ model: 'x', messages: [], maxTokens: 8000 } as any);
    expect(out.text).toBe('ok');
    expect(glmCalls, 'the second and third keys must not re-prove the same starvation').toBe(1);
    expect([...dead.keys()]).toEqual(['GLM::glm-5.3']);
    // …and a SECOND turn skips the whole pool without a single call.
    await r.runTurn({ model: 'x', messages: [], maxTokens: 8000 } as any);
    expect(glmCalls).toBe(1);
  });

  it('🔒 faa98da9 IS PRESERVED — a dead model does not take a sibling model on the same family down', async () => {
    const chain = [
      rung('KIMI', 'kimi-k2.5', 'KIMI', () => Promise.reject(starve(4000))),
      rung('KIMI#2', 'kimi-k2.6', 'KIMI', async () => ({ text: 'k2.6 answered', stopReason: 'end_turn', toolUses: [], usage: { inputTokens: 1, outputTokens: 1 } })),
    ];
    const dead = new Map<string, string>();
    const r = makeMultiProviderTurnRunner(chain as any, { deadRungs: dead } as any);
    expect((await r.runTurn({ model: 'x', messages: [], maxTokens: 4000 } as any)).text).toBe('k2.6 answered');
    expect([...dead.keys()]).toEqual(['KIMI::kimi-k2.5']);
  });
});

describe('A2 — a rung measured to always reason is never asked for less than it needs to begin', () => {
  it('raises the reported 8,000 and 4,000 asks on glm-5.3 to the measured minimum', () => {
    expect(reasoningAwareAsk(8000, 'glm-5.3')).toBe(REASONING_MIN_ASK);
    expect(reasoningAwareAsk(4000, 'glm-5.3')).toBe(REASONING_MIN_ASK);
    expect(reasoningAwareAsk(20_000, 'glm-5.3'), 'a larger ask is never lowered').toBe(20_000);
  });
  it('leaves a model that can be told not to think exactly as asked', () => {
    expect(reasoningAwareAsk(4000, 'glm-4.7-flashx')).toBe(4000);
    expect(reasoningAwareAsk(undefined, 'glm-4.7-flashx')).toBeUndefined();
  });
  it('follows the unclamp family switch — off means the ask is untouched', () => {
    expect(reasoningAwareAsk(8000, 'glm-5.3', { AGENTV3_REASONING_UNCLAMP: 'off' } as NodeJS.ProcessEnv)).toBe(8000);
  });
  it('is applied in the runner at the one place the rung is known', async () => {
    let seen: number | undefined;
    const chain = [rung('GLM', 'glm-5.3', 'GLM', async (p: any) => { seen = p.maxTokens; return { text: 'ok', stopReason: 'end_turn', toolUses: [], usage: { inputTokens: 1, outputTokens: 1 } }; })];
    // The runner passes the caller's params through `{ ...params, maxTokens: reasoningAwareAsk(...) }`.
    const src = read('src/server/AgentV3/providers/MultiProviderTurnRunner.ts');
    expect(src).toMatch(/maxTokens: reasoningAwareAsk\(params\.maxTokens, chain\[i\]\.modelId\)/);
    await makeMultiProviderTurnRunner(chain as any, {} as any).runTurn({ model: 'x', messages: [], maxTokens: 8000 } as any);
    expect(seen).toBe(REASONING_MIN_ASK);
  });
});

describe('TS — the typecheck gate judges only TypeScript WE wrote', () => {
  const base = { enabled: true, fastLaneGated: false, buildOk: true, wroteFiles: true, isImportTurn: false, aborted: false };
  it('a build that wrote only index.html does not typecheck the scaffold it never touched', () => {
    expect(postBuildCodeGateShouldRun(base), 'the shared predicate is unchanged').toBe(true);
    expect(typecheckGateShouldRun({ ...base, wroteTypeScript: false })).toBe(false);
    expect(typecheckGateShouldRun({ ...base, wroteTypeScript: true })).toBe(true);
  });
  it('knows a TypeScript source when it sees one', () => {
    expect(['index.html', 'x.css', 'types.d.ts', 'data.json'].map(isTypeScriptSourcePath)).toEqual([false, false, false, false]);
    expect(['src/App.tsx', 'a.ts', 'b.mts'].map(isTypeScriptSourcePath)).toEqual([true, true, true]);
  });
  it('the route wires it, and records an honest skip rather than a silent one', () => {
    const src = read('src/server/routes/agentv3.ts');
    expect(src).toContain('const wroteTypeScript = [...writtenFiles.keys()].some(isTypeScriptSourcePath);');
    expect(src).toContain('typecheckGateShouldRun({ ...tscGateBase, wroteTypeScript })');
    expect(src).toContain("code: 'TYPECHECK_SKIPPED_NO_TS_WRITTEN'");
  });
});

describe('B — the planner may not plan a fake, and the user’s rules survive to every step', () => {
  it('the system prompt no longer instructs "local/mock data" unconditionally, and forbids placeholders', () => {
    const p = megaRoadmapSystemPrompt();
    expect(p).not.toMatch(/working on local\/mock data\)/);
    expect(p).toMatch(/core promise is not the live thing itself/);
    expect(p).toMatch(/NEVER plan a placeholder/);
    expect(p).toMatch(/bind EVERY step/);
  });
  it('THE REPORTED CUT: a request whose rules sit past 4,000 chars still reaches the planner with them', () => {
    const big = 'x'.repeat(4500) + '\n' + REPORTED_PROMPT;
    const u = megaRoadmapUserPrompt(big, null, []);
    expect(u).toContain('No fake AI responses.');
    expect(u).toContain("Do NOT create buttons that don't work.");
    expect(u).toMatch(/NON-NEGOTIABLE CONSTRAINTS/);
    expect(u.length, 'still bounded — the existing size pin').toBeLessThan(6500);
    expect(boundedRequest(big)).toMatch(/middle of the request omitted/);
  });
  it('extracts exactly the hard constraints, none of the prose', () => {
    const c = hardConstraintLines(REPORTED_PROMPT);
    expect(c).toEqual(expect.arrayContaining(['Do NOT use React.', 'Do NOT use npm.', 'No fake AI responses.', 'No simulated model responses.', 'Do NOT create fake streaming.']));
    expect(c).not.toContain('SAVE API CONFIGURATION');
    expect(c).not.toContain('- provider');
    expect(hardConstraintLines('')).toEqual([]);
  });
  it('the milestone swap restates the constraints to the builder', () => {
    const src = read('src/server/routes/agentv3.ts');
    const swap = src.slice(src.indexOf('const step1 = megaRoadmapActive.steps[0];'), src.indexOf('// Universal Language (Layer 73)'));
    expect(swap).toContain('const constraints = hardConstraintLines(prompt);');
    expect(swap).toMatch(/NON-NEGOTIABLE CONSTRAINTS from the user's original request/);
  });
});

describe('E — two common words are not two famous products', () => {
  it('E1: "No page zoom problems" is a mobile requirement, not a Zoom clone; a real Zoom ask still is', () => {
    expect(analyzeAppScope(REPORTED_PROMPT).famousApp).toBeNull();
    expect(analyzeAppScope('make a zoom clone for my school').famousApp).toBe('Zoom / Meet');
    expect(analyzeAppScope('an app like zoom for tuition').famousApp).toBe('Zoom / Meet');
    expect(analyzeAppScope('pinch to zoom on the image, and a zoom level slider').famousApp).toBeNull();
  });
  it('E2: "Store:" before a list is an instruction to persist, not a shop — on the REAL prompt', () => {
    // The full request as the report carried it. On it the pre-fix analyser answered `ecommerce`
    // (hits: "Store:" and "Each profile stores:"), and `AGENTV3_REQUIREMENT_AWARE=on` then handed the
    // builder cart, checkout and refunds to include in an AI chat app. The reduced prompt above is not
    // enough to reproduce that — other domains outvote it there — so this case reads the real one.
    const full = read('tests/fixtures/prompt681bd91b.txt');
    expect(analyzeRequirementGaps(full).domain).not.toBe('ecommerce');
    expect(analyzeAppScope(full).famousApp, 'E1 on the real prompt too').toBeNull();
    expect(analyzeRequirementGaps(REPORTED_PROMPT).domain).not.toBe('ecommerce');
    expect(analyzeRequirementGaps('an online store with a cart and checkout for my shop').domain).toBe('ecommerce');
  });
});
