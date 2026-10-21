/**
 * A starvation flag records an unusable turn, not measured consumption or a verdict on every rung.
 * All fixtures are synthetic. Execute real constructors and diagnostics; extract only the route's
 * actual diagnostic branch with TypeScript AST boundaries, never import its server/provider graph.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  STARVED_BUDGET_MESSAGE, STARVED_BY_ASK_MARK, STARVED_BY_LANE_MARK, STARVED_UNCLAMPED_MARK,
  isAskBoundStarvation, isLaneBoundStarvation, isStarvedBudgetError, isUnclampedStarvation,
  reconcileFloorBudget, starvedBudgetError, turnStarvedItsBudget,
} from '../src/server/AgentV3/floorBudget';
import {
  BuildDiagnostics, buildStarvedItsOutputBudget, classifyProviderFailure,
  type BuildDiagnosticsReport,
} from '../src/server/AgentV3/BuildDiagnostics';
import { isFatalProviderError, isModelUnavailableError } from '../src/server/AgentV3/providerErrorClass';
import { isBudgetEndedError } from '../src/server/AgentV3/turnDeadline';
import { streamingBudget } from '../src/server/AgentV3/reliability/streamBudget';

const branches = [
  { label: 'cap', granted: 4_833, requested: 32_000, unclamped: false, laneMs: undefined, marks: [false, false, false] },
  { label: 'lane', granted: 2_314, requested: 8_000, unclamped: false, laneMs: 74_420, marks: [false, true, false] },
  { label: 'ask', granted: 8_000, requested: 8_000, unclamped: false, laneMs: 74_420, marks: [true, false, false] },
  { label: 'unclamped', granted: 32_000, requested: 32_000, unclamped: true, laneMs: 74_420, marks: [false, false, true] },
] as const;
const errorFor = (b: typeof branches[number]): Error => starvedBudgetError(b.granted, b.requested, b.unclamped, b.laneMs);
const diagnostics = (): BuildDiagnostics => new BuildDiagnostics({ now: () => 1_000 });

function one<T>(matches: T[], label: string): T {
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}`);
  return matches[0];
}
function nodesWithin(root: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  function visit(node: ts.Node): void { nodes.push(node); ts.forEachChild(node, visit); }
  visit(root);
  return nodes;
}
function property(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.filter(ts.isPropertyAssignment).find((p) =>
    (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name);
}

const route = ts.createSourceFile('agentv3.ts', readFileSync('src/server/routes/agentv3.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const routeNodes = nodesWithin(route);
const routeRecord = one(routeNodes.filter(ts.isCallExpression).filter((call) => {
  if (call.expression.getText(route) !== 'buildDiag.record') return false;
  const object = call.arguments[0];
  if (!object || !ts.isObjectLiteralExpression(object)) return false;
  const code = property(object, 'code')?.initializer;
  return code && ts.isStringLiteral(code) && code.text === 'UPSELL_SUPPRESSED';
}), 'production UPSELL_SUPPRESSED record');
const routeRecordObject = routeRecord.arguments[0] as ts.ObjectLiteralExpression;
const routeMessage = property(routeRecordObject, 'message');
const recordStatement = routeRecord.parent;
if (!routeMessage || !ts.isExpressionStatement(recordStatement)
    || !ts.isBlock(recordStatement.parent) || !ts.isIfStatement(recordStatement.parent.parent)) {
  throw new Error('Production suppression diagnostic no longer has its expected guarded statement');
}
const routeGuard = recordStatement.parent.parent;
const starvedDeclaration = one(routeNodes.filter(ts.isVariableDeclaration).filter((node) =>
  ts.isIdentifier(node.name) && node.name.text === 'starved'
  && !!node.initializer && node.initializer.getText(route).includes('buildStarvedItsOutputBudget(')), 'production starvation predicate');
const routeStarvedMessage = one(nodesWithin(routeMessage.initializer).filter(ts.isConditionalExpression)
  .filter((node) => ts.isIdentifier(node.condition) && node.condition.text === 'starved'), 'starvation message branch').whenTrue;
// AST-selected production expressions, not a copy of the routing conditions or message.
const routeBody = ts.transpileModule(`
  const starved = ${starvedDeclaration.initializer!.getText(route)};
  ${routeGuard.getText(route)}
  return { starved, report: buildDiag.report() };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
type Flags = { stopped: boolean; interrupted: boolean; refused: boolean; degraded: boolean; misconfigured: boolean };
function runRoute(buildDiag: BuildDiagnostics, flags: Partial<Flags> = {}): { starved: boolean; report: BuildDiagnosticsReport } {
  const env = {
    stopped: false, interrupted: false, refused: false, degraded: false, misconfigured: false, ...flags,
    buildDiag, buildStarvedItsOutputBudget,
    abort: { signal: {} }, abortCauseOf: () => 'server_draining',
  };
  return new Function(...Object.keys(env), routeBody)(...Object.values(env));
}
function suppression(report: BuildDiagnosticsReport) {
  return one(report.issues.filter((i) => i.code === 'UPSELL_SUPPRESSED'), 'suppression finding');
}
function starvedFinding(report: BuildDiagnosticsReport) {
  return one(report.issues.filter((i) => i.code === 'OUTPUT_BUDGET_STARVED'), 'starvation finding');
}

describe('starvation evidence does not require token consumption measurements', () => {
  it.each([
    { text: '', toolUses: [], truncated: true },
    { text: '  ', toolUses: [], reasoningOnly: true },
    { text: '', toolUses: [], truncated: true, reasoningOnly: true },
    { text: '', toolUses: [], reasoningOnly: true, usage: { inputTokens: 11, outputTokens: 3 } },
  ])('accepts the recorded unusable-turn shape without requiring the full grant to be spent: %j', (turn) => {
    expect(turnStarvedItsBudget(turn)).toBe(true);
  });

  it('keeps ordinary empty turns and salvageable output out of this class', () => {
    for (const turn of [
      { text: '', toolUses: [] },
      { text: 'A usable answer', toolUses: [], truncated: true, reasoningOnly: true },
      { text: '', toolUses: [{ id: 'synthetic-tool' }], truncated: true, reasoningOnly: true },
      null, undefined,
    ]) expect(turnStarvedItsBudget(turn)).toBe(false);
  });

  it('preserves legacy markers byte for byte and recognises old stored failures', () => {
    expect(STARVED_BUDGET_MESSAGE).toBe('the output budget ran out before the answer began');
    expect(STARVED_BY_ASK_MARK).toBe('the ceiling was the ask itself');
    expect(STARVED_BY_LANE_MARK).toBe('the clock came from the lane that called it, not our own cap');
    expect(STARVED_UNCLAMPED_MARK).toBe('the ceiling was not reduced');
    for (const suffix of ['', STARVED_BY_ASK_MARK, STARVED_BY_LANE_MARK, STARVED_UNCLAMPED_MARK]) {
      const legacy = `${STARVED_BUDGET_MESSAGE} ${suffix}`;
      expect(isStarvedBudgetError(legacy)).toBe(true);
      expect(classifyProviderFailure(legacy)).toBe('output-budget');
    }
  });

  it.each(branches)('$label constructor retains provenance without inventing measured spend', (b) => {
    const err = errorFor(b);
    expect(err.message.startsWith(STARVED_BUDGET_MESSAGE)).toBe(true);
    expect(err.message).toContain(`authorised ${b.label === 'ask' ? 'the full ' : ''}${b.granted} output tokens`);
    if (b.requested !== b.granted) expect(err.message).toContain(`cut down from ${b.requested}`);
    expect(err.message).toContain(b.unclamped ? 'No text or tool call was returned' : 'returned no text or tool call');
    expect(err.message).toContain('truncated or returned reasoning only');
    expect(err.message).toContain('not measured usage');
    expect([isAskBoundStarvation(err), isLaneBoundStarvation(err), isUnclampedStarvation(err)]).toEqual(b.marks);
    if (b.label === 'lane') {
      expect(err.message).toContain('74420ms left');
      expect(err.message).toContain('configured floor rate');
      expect(err.message).toContain('not our own cap');
    }
    for (const reason of [err, err.message]) {
      expect(classifyProviderFailure(reason)).toBe('output-budget');
      expect(isFatalProviderError(reason)).toBe(false);
      expect(isModelUnavailableError(reason)).toBe(false);
      expect(isBudgetEndedError(reason)).toBe(false);
    }
    // These are the competing classifier triggers, not assertions that every failure is starvation.
    expect(err.message).not.toMatch(/timed? ?out|timeout|deadline|context length|too long|max tokens|token limit|\b429\b|rate.?limit|quota/i);
  });

  it('never invents a lane source from an absent, nonpositive or nonfinite clock', () => {
    for (const lane of [undefined, 0, -1, NaN, Infinity]) {
      expect(isLaneBoundStarvation(starvedBudgetError(4_833, 32_000, false, lane))).toBe(false);
    }
    expect(classifyProviderFailure(new Error('request timed out'))).toBe('timeout');
    expect(classifyProviderFailure(new Error('429 rate limit'))).toBe('rate-limit');
    expect(classifyProviderFailure(new Error('model not found'))).toBe('model-unavailable');
    expect(classifyProviderFailure(new Error('synthetic unrelated failure'))).toBe('other: synthetic unrelated failure');
  });

  it.each([16_000, 32_000])('the real streaming helper bypasses the clock clamp without promising the full ask at a %s model ceiling', (modelCeiling) => {
    const original = reconcileFloorBudget(32_000, 300_000, {});
    expect(original).toMatchObject({ maxTokens: 9_833, requested: 32_000, clamped: true });
    const budget = streamingBudget(32_000, 'synthetic-unlisted-model', original, {
      AGENTV3_STREAM_MAX_OUTPUT_DEFAULT: String(modelCeiling),
    });
    expect(budget).toEqual({ maxTokens: modelCeiling, requested: 32_000, clamped: false, reasoningUnclamped: true });
    const err = starvedBudgetError(budget.maxTokens, budget.requested, budget.reasoningUnclamped);
    expect(isUnclampedStarvation(err)).toBe(true);
    expect(isAskBoundStarvation(err)).toBe(false);
    expect(isLaneBoundStarvation(err)).toBe(false);
    expect(classifyProviderFailure(err)).toBe('output-budget');
    expect(err.message).toContain(`${modelCeiling} output tokens with the clock/rate clamp bypassed`);
    expect(err.message).toContain("another ceiling may still reduce the caller's ask");
    expect(err.message).toContain('not measured usage');
    const diag = diagnostics(); diag.recordProviderFailure('SYNTHETIC_STREAM', err);
    const report = diag.report();
    const finding = starvedFinding(report);
    expect(finding).toMatchObject({ severity: 'warning', autoResolved: false });
    expect(finding.message).toContain('without measured usage');
    expect(finding.message).toContain('The clock/rate clamp was bypassed');
    expect(finding.message).toContain("another ceiling may still make the granted allowance smaller than the caller's ask");
    expect(finding.message).not.toContain("keeps the build loop's full per-turn ask");
    if (modelCeiling < budget.requested) {
      expect(err.message).not.toContain(`the full ${modelCeiling} output tokens the build asked for`);
      expect(finding.message).not.toContain(`the full ${modelCeiling} output tokens the build asked for`);
    }
    expect(report.providerFailureReasons).toEqual({ SYNTHETIC_STREAM: '1 output-budget' });
    expect(report.providerTokens).toBeUndefined();
    expect(report.providerDelivery).toBeUndefined();
    expect(report.llmCalls).toBeUndefined();
  });
});

describe('actual diagnostics preserve the failure without inventing output or usage', () => {
  it.each(branches)('$label records one unresolved warning per provider, not an answer or a usage measurement', (b) => {
    const diag = diagnostics();
    diag.recordProviderFailure('SYNTHETIC_A', errorFor(b));
    diag.recordProviderFailure('SYNTHETIC_A', errorFor(b));
    const report = diag.report();
    const finding = starvedFinding(report);
    expect(finding).toMatchObject({ phase: 'provider', severity: 'warning', autoResolved: false });
    expect(finding.message).toContain('rung returned no text or tool call and was classified as output-budget');
    expect(finding.message).toMatch(/(?:not measured consumption|without measured usage)/);
    expect(report.providerFailures).toEqual({ SYNTHETIC_A: 2 });
    expect(report.providerFailureReasons).toEqual({ SYNTHETIC_A: '2 output-budget' });
    expect(buildStarvedItsOutputBudget(diag.providerFailureBreakdown())).toBe(true);
    expect(report.counts.warnings).toBe(1);
    expect(report.counts.unresolved).toBe(1);
    expect(report.problems).toContainEqual(expect.objectContaining({ code: 'OUTPUT_BUDGET_STARVED' }));
    for (const field of ['llmCalls', 'providerDelivery', 'builtBy', 'providerTokens', 'liveTokens', 'billing'] as const) {
      expect(report[field], field).toBeUndefined();
    }
  });

  it('keeps the four provenance explanations distinct, including the streamed-cap qualification', () => {
    const messages = branches.map((b) => {
      const diag = diagnostics(); diag.recordProviderFailure('SYNTHETIC_A', errorFor(b));
      return starvedFinding(diag.report()).message;
    });
    expect(messages[0]).toContain('effective call clock, overhead and AGENTV3_FLOOR_MS_PER_TOKEN');
    expect(messages[0]).toContain('FLOOR_TIMEOUT_CAP_MS applies to non-streamed calls');
    expect(messages[0]).toContain('streamed calls use their own hard cap');
    expect(messages[1]).toContain('REMAINING BUDGET OF THE LANE');
    expect(messages[1]).toContain('configured floor rate');
    expect(messages[2]).toContain("CALLER'S OWN ASK");
    expect(messages[2]).toContain('ask fitted the clock');
    expect(messages[3]).toContain('The clock/rate clamp was bypassed');
    expect(messages[3]).toContain("another ceiling may still make the granted allowance smaller than the caller's ask");
    for (const message of messages.slice(1)) expect(message).not.toContain('FLOOR_TIMEOUT_CAP_MS');
  });

  it.each([undefined, 0, 3, 4_833])('an empty truncated LLM record with outputTokens=%s cannot prove its allowance was spent', (outputTokens) => {
    const diag = diagnostics();
    diag.recordLlmCall({ ok: true, model: 'synthetic-model', finishReason: 'length', responseChars: 0, toolCalls: 0, outputTokens });
    const report = diag.report();
    const finding = one(report.issues.filter((i) => i.code === 'LLM_TRUNCATED'), 'truncated finding');
    expect(finding).toMatchObject({ severity: 'warning', autoResolved: false });
    expect(finding.message).toContain('marked truncated with no recorded text or tool call');
    expect(finding.message).toContain(`outputTokens=${outputTokens ?? 0}`);
    expect(finding.message).toContain('defaulting to 0 when unreported');
    expect(finding.message).toContain('does not establish the authorised allowance, whether it was fully consumed');
    expect(report.llmCalls?.[0].outputTokens).toBe(outputTokens);
    expect(report.providerTokens).toBeUndefined();
    expect(report.providerFailureReasons).toBeUndefined();
    expect(buildStarvedItsOutputBudget(report.providerFailureReasons)).toBe(false);
  });

  it('preserves the partial-output truncation and genuine failure branches and their original severity', () => {
    const partial = diagnostics();
    partial.recordLlmCall({ ok: true, model: 'synthetic-model', finishReason: 'length', responseChars: 5, toolCalls: 0 });
    expect(one(partial.report().issues.filter((i) => i.code === 'LLM_TRUNCATED'), 'partial truncation')).toMatchObject({
      severity: 'warning', autoResolved: false,
      message: 'Model response hit the token limit (synthetic-model, finish=length) — output may be truncated.',
    });
    const failed = diagnostics();
    failed.recordLlmCall({ ok: false, model: 'synthetic-model', error: 'synthetic unrelated failure' });
    expect(one(failed.report().issues.filter((i) => i.code === 'LLM_CALL_FAILED'), 'failed call')).toMatchObject({
      severity: 'error', autoResolved: false,
      message: 'Model call failed (synthetic-model): synthetic unrelated failure',
    });
  });
});

describe('the actual route diagnostic uses existential evidence, preserving the other branches', () => {
  it('one recorded starvation among unrelated provider failures does not say every rung answered', () => {
    const diag = diagnostics();
    diag.recordProviderFailure('SYNTHETIC_A', errorFor(branches[0]));
    diag.recordProviderFailure('SYNTHETIC_B', new Error('401 unauthorized'));
    diag.recordProviderFailure('SYNTHETIC_C', new Error('synthetic unrelated failure'));
    expect(diag.providerFailureBreakdown()).toEqual({
      SYNTHETIC_A: '1 output-budget', SYNTHETIC_B: '1 auth', SYNTHETIC_C: '1 other: synthetic unrelated failure',
    });
    const { starved, report } = runRoute(diag);
    expect(starved).toBe(true);
    const finding = suppression(report);
    expect(finding).toMatchObject({ phase: 'build', severity: 'warning', autoResolved: false });
    expect(finding.message).toContain('at least one recorded failure was output starvation');
    expect(finding.message).toContain('truncated or reasoning-only turn with no usable text or tool call');
    expect(finding.message).toContain('does not establish that every rung answered');
    expect(finding.message).toContain('or that a stronger engine would succeed or fail');
    expect(finding.message).toContain('does not justify asking the user to pay');
    expect(report.providerDelivery).toBeUndefined();
    expect(report.providerTokens).toBeUndefined();
    expect(report.llmCalls).toBeUndefined();
  });

  it('no output-budget bucket means no starvation verdict or suppression from this branch', () => {
    const diag = diagnostics();
    diag.recordProviderFailure('SYNTHETIC_B', new Error('synthetic unrelated failure'));
    const { starved, report } = runRoute(diag);
    expect(starved).toBe(false);
    expect(report.issues.filter((i) => i.code === 'UPSELL_SUPPRESSED')).toEqual([]);
    for (const reasons of [null, undefined, {}, { SYNTHETIC_B: '1 other: output-budget' }]) {
      expect(buildStarvedItsOutputBudget(reasons)).toBe(false);
    }
  });

  it.each([
    { flag: 'stopped', text: 'the build was STOPPED', severity: 'info', autoResolved: true },
    { flag: 'refused', text: 'the engine DECLINED this request', severity: 'warning', autoResolved: false },
    { flag: 'degraded', text: 'the build failed because the engine did not respond', severity: 'warning', autoResolved: false },
    { flag: 'misconfigured', text: 'the build failed because the engine did not respond', severity: 'warning', autoResolved: false },
  ] as const)('$flag retains precedence and the original severity despite a recorded starvation', ({ flag, text, severity, autoResolved }) => {
    const diag = diagnostics(); diag.recordProviderFailure('SYNTHETIC_A', errorFor(branches[0]));
    const { starved, report } = runRoute(diag, { [flag]: true });
    expect(starved).toBe(false);
    const finding = suppression(report);
    expect(finding).toMatchObject({ severity, autoResolved });
    expect(finding.message).toContain(text);
    expect(finding.message).not.toContain('at least one recorded failure was output starvation');
  });

  it('an interruption still wins message selection, and stopping still wins over every other flag', () => {
    const diag = diagnostics(); diag.recordProviderFailure('SYNTHETIC_A', errorFor(branches[0]));
    const interrupted = runRoute(diag, { interrupted: true });
    expect(interrupted.starved).toBe(true); // Preserve the existing predicate, not a new routing policy.
    expect(suppression(interrupted.report)).toMatchObject({ severity: 'warning', autoResolved: false });
    expect(suppression(interrupted.report).message).toContain('our own platform interrupted this build (server_draining)');
    const stopped = runRoute(diagnostics(), { stopped: true, interrupted: true, refused: true, degraded: true, misconfigured: true });
    expect(stopped.starved).toBe(false);
    expect(suppression(stopped.report)).toMatchObject({ severity: 'info', autoResolved: true });
    expect(suppression(stopped.report).message).toContain('the build was STOPPED');
  });
});

describe('runtime starvation prose census, excluding comments and unrelated route branches', () => {
  it('rejects unmeasured-spend, every-rung and cross-tier guarantees in every scoped runtime message', () => {
    const floor = ts.createSourceFile('floorBudget.ts', readFileSync('src/server/AgentV3/floorBudget.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const report = ts.createSourceFile('BuildDiagnostics.ts', readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const scopes = [
      one(nodesWithin(floor).filter(ts.isFunctionDeclaration).filter((n) => n.name?.text === 'starvedBudgetError'), 'constructor'),
      ...['recordProviderFailure', 'recordLlmCall'].map((name) => one(nodesWithin(report).filter(ts.isMethodDeclaration)
        .filter((n) => ts.isIdentifier(n.name) && n.name.text === name), name)),
      routeStarvedMessage,
    ];
    const forbidden = [
      /\bspent every (?:one of them|token)\b/i,
      /\bspent (?:its |the )?(?:entire|full|whole) (?:output )?(?:allowance|budget)\b/i,
      /\b(?:every|all) rungs? answered and produced nothing\b/i,
      /\banswered inside its clock\b/i,
      /\bidentical (?:on|across) every tier\b/i,
      /\bsame ceiling (?:on|across|for) (?:all|every) tiers?\b/i,
      /\bwould have failed identically\b/i,
      /\bneeds more output than one turn can carry\b/i,
      /\ba fuller wallet buys a different model, not a different ceiling\b/i,
    ];
    for (const scope of scopes) {
      // Literal AST nodes exclude comments; joining also catches a claim split across concatenations.
      const prose = nodesWithin(scope).filter((n): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail =>
        ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
        .map((n) => n.text).join(' ').replace(/\s+/g, ' ');
      expect(prose.length).toBeGreaterThan(0);
      for (const pattern of forbidden) expect(prose, pattern.source).not.toMatch(pattern);
    }
  });
});
