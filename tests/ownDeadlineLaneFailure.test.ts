import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Hoisted before the real runner import: never initialize Firestore or a provider/client graph.
// The runner's control flow, deadline recognition and stop handling remain real; every rung is injected.
vi.mock('../src/server/lib/aiMaintenance', () => ({
  assertAiAvailable: vi.fn(async () => {}),
  AiMaintenanceError: class AiMaintenanceError extends Error {},
}));
vi.mock('../src/server/AgentV3/TruncationRecovery', () => ({ turnDiscardedTruncatedOutput: () => false }));

import {
  classifyLaneFailure, anotherLaneWorthTrying, upsellIsHonest,
} from '../src/server/AgentV3/laneFailure';
import {
  BUDGET_EXHAUSTED_MESSAGE, BUDGET_REACHED_MESSAGE, SLOW_STREAM_MESSAGE, SILENT_OPEN_MARK,
  isBudgetEndedError,
} from '../src/server/AgentV3/turnDeadline';
import { makeMultiProviderTurnRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { BuildStoppedError } from '../src/server/AgentV3/stopSignal';

/**
 * Synthetic current-code regression, NOT recovery/replay of a historical report payload.
 * The route seam below executes production AST admission/skip statements and its original runOneShot
 * call against mocks. It does not import the HTTP route, generate an app, or prove end-to-end billing,
 * upsell narration or deadline propagation. upsellIsHonest is a helper with no production caller.
 * Global-stop protection tested here begins when the watchdog's signal is aborted; elapsed wall-clock
 * time before that callback is NOT independently gated by this patch and is not simulated as a stop.
 */
const MARKERS = [BUDGET_EXHAUSTED_MESSAGE, BUDGET_REACHED_MESSAGE];
const PROVIDER_FACTS = ['Request timed out.', 'HTTP 429 Too Many Requests'];
const envelope = (inner: string) => `The time allowed for this step ran out before it could finish (${inner}). No provider failed — the work was stopped by our own deadline.`;
const production = { classifyLaneFailure, anotherLaneWorthTrying, upsellIsHonest };
type Classifier = typeof production;

function expectDeadline(reason: string, api: Classifier = production) {
  expect(api.classifyLaneFailure(reason), reason).toBe('own-deadline');
  expect(api.anotherLaneWorthTrying(reason), reason).toBe(true);
  expect(api.upsellIsHonest(reason), reason).toBe(false);
}
function expectDegraded(reason: string, api: Classifier = production) {
  expect(api.classifyLaneFailure(reason), reason).toBe('provider-degraded');
  expect(api.anotherLaneWorthTrying(reason), reason).toBe(false);
  expect(api.upsellIsHonest(reason), reason).toBe(false);
}

function injectedRunner(message: string) {
  const first = vi.fn(async () => { throw new Error(message); });
  const next = vi.fn(async () => { throw new Error('The next synthetic rung must not run'); });
  const runner = makeMultiProviderTurnRunner([
    { name: 'SYNTHETIC_OWN_DEADLINE', runner: { runTurn: first } },
    { name: 'SYNTHETIC_NEXT', runner: { runTurn: next } },
  ], {
    cooldowns: { until: () => 0, strike: vi.fn(), clear: vi.fn(), reset: vi.fn() },
    now: () => 1_000,
  });
  return { runner, first, next };
}
async function emittedEnvelope(message: string): Promise<string> {
  const { runner, first, next } = injectedRunner(message);
  const error = await runner.runTurn({ model: 'synthetic', messages: [] }).then(
    () => { throw new Error('Expected the real runner to reject'); },
    (caught: unknown) => caught,
  );
  expect(first).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(envelope(message));
  return (error as Error).message;
}

describe('own deadlines retain their cause at the real emitter boundary', () => {
  it.each(MARKERS)('recognizes the exported raw marker: %s', (marker) => expectDeadline(marker));

  it.each(MARKERS)('classifies the real injected-runner envelope: %s', async (marker) => {
    expectDeadline(await emittedEnvelope(marker));
  });

  it.each(MARKERS)('keeps budget-plus-content out of the content class: %s', async (marker) => {
    for (const content of ['no files', 'invalid', 'empty']) {
      const reason = `${marker}; ${content}`;
      expectDeadline(reason);
      expectDeadline(await emittedEnvelope(reason));
    }
  });

  it.each(MARKERS)('preserves lowercase/outer-whitespace normalization: %s', (marker) => {
    expectDeadline(` \n${marker.toUpperCase()}\t `);
    expectDeadline(` \n${envelope(marker).toUpperCase()}\t `);
  });

  it.each(MARKERS)('an already-aborted signal calls no rung, even one holding the marker: %s', async (marker) => {
    const { runner, first, next } = injectedRunner(marker);
    const abort = new AbortController();
    abort.abort();
    await expect(runner.runTurn({ model: 'synthetic', messages: [], signal: abort.signal })).rejects.toBeInstanceOf(BuildStoppedError);
    expect(first).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('positive provider facts still win over our own budget', () => {
  it.each([
    ...PROVIDER_FACTS, 'simple-plan timed out after 90000ms', 'all providers failed',
    'no provider answered', 'socket hang up', 'ECONNRESET connecting to upstream',
    `${SLOW_STREAM_MESSAGE} after 15000ms`, `${SLOW_STREAM_MESSAGE} after 15000ms — ${SILENT_OPEN_MARK}`,
    'the engine reasons before every answer; the fast lane stops here and hands off',
  ])('preserves the existing degraded control: %s', (reason) => expectDegraded(reason));

  it.each(MARKERS)('retains timeout/429 evidence raw, inside and outside the exact envelope: %s', async (marker) => {
    for (const fact of PROVIDER_FACTS) {
      for (const inner of [`${marker}; ${fact}`, `${fact}; ${marker}; no files`]) {
        expectDegraded(inner);
        expectDegraded(await emittedEnvelope(inner));
      }
      const wrapped = await emittedEnvelope(marker);
      expectDegraded(`${fact}; ${wrapped}`);
      expectDegraded(`${wrapped}; ${fact}`);
    }
  });
});

describe('the exception is one complete known envelope, not a broad negation rewrite', () => {
  it.each(MARKERS)('rejects malformed, nested, prefixed and trailing envelope variants: %s', (marker) => {
    const wrapped = envelope(marker);
    for (const reason of [
      wrapped.slice(0, -1),
      wrapped.replace('before it could finish', 'before it finished'),
      wrapped.replace('No provider failed —', 'No provider failed -'),
      wrapped.replace('step ran out', 'step  ran out'),
      wrapped.replace(`(${marker})`, `[${marker}]`),
      `Error: ${wrapped}`,
      `${wrapped} Additional context.`,
      envelope(wrapped),
      `${marker}; No provider failed`,
    ]) expectDegraded(reason);
  });

  it.each(['unrecognized step cap', 'no files', 'invalid', 'build budget reached'])('requires a known budget marker inside: %s', (reason) => {
    expectDegraded(envelope(reason));
  });
  it('does not reinterpret a standalone provider negation', () => expectDegraded('No provider failed'));

  it.each([null, undefined, '', ' \n\t ', 'an unrelated unfamiliar reason', 'the step deadline expired'])('leaves unknown evidence unknown: %s', (reason) => {
    expect(classifyLaneFailure(reason)).toBe('unknown');
    expect(anotherLaneWorthTrying(reason)).toBe(true);
    expect(upsellIsHonest(reason)).toBe(false);
  });
  it.each(['manifest_too_small', 'no files', 'invalid response', 'could not parse the file blocks'])('preserves ordinary content: %s', (reason) => {
    expect(classifyLaneFailure(reason)).toBe('content');
    expect(anotherLaneWorthTrying(reason)).toBe(true);
    expect(upsellIsHonest(reason)).toBe(true);
  });
});

function parse(path: string) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const nodes: ts.Node[] = [];
  (function visit(node: ts.Node) { nodes.push(node); ts.forEachChild(node, visit); })(source);
  return { source, nodes, text: (node: ts.Node) => node.getText(source) };
}
function one<T>(matches: T[], label: string): T {
  if (matches.length !== 1) throw new Error(`Expected one production ${label}, found ${matches.length}`);
  return matches[0];
}
function replaceOnce(source: string, from: string, to: string): string {
  if (!from || source.split(from).length !== 2) throw new Error(`Expected exactly one mutation target: ${from}`);
  return source.replace(from, to);
}
const transpile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

// Only the admission/skip seam is extracted. No route import, copied predicate, full-builder, finishing,
// persistence, provider, or wallet work. Include the original decline-settlement gate and call as well.
const route = parse('src/server/routes/agentv3.ts');
const ifWith = (fragment: string) => one(route.nodes.filter(ts.isIfStatement).filter((node) => route.text(node.expression).includes(fragment)), `condition ${fragment}`);
const skip = ifWith('classifyForOneShot(analysis?.startTier) && !oneShotStillViable(sb)');
const selection = ifWith('settleInitialDecline(sb.initialDecline)');
const admission = ifWith('oneShotStillViable(sb) && anotherLaneWorthTrying(sb.reason)');
if (!ts.isBlock(admission.thenStatement)) throw new Error('One-shot admission no longer owns a block');
const call = one(admission.thenStatement.statements.filter(ts.isVariableStatement).filter((node) => node.declarationList.declarations.some((decl) =>
  ts.isIdentifier(decl.name) && decl.name.text === 'os' && decl.initializer && ts.isAwaitExpression(decl.initializer)
  && ts.isCallExpression(decl.initializer.expression) && route.text(decl.initializer.expression.expression) === 'runOneShot')),
'original runOneShot call');
const settle = one(route.nodes.filter(ts.isVariableStatement).filter((node) => node.declarationList.declarations.some((decl) =>
  ts.isIdentifier(decl.name) && decl.name.text === 'settleInitialDecline')), 'initial-decline settlement');
const oneShot = parse('src/server/AgentV3/OneShotBuilder.ts');
const viability = ['classifyForOneShot', 'oneShotStillViable', 'oneShotSkipReason'].map((name) =>
  oneShot.text(one(oneShot.nodes.filter(ts.isFunctionDeclaration).filter((node) => node.name?.text === name), name)).replace(/^export /, ''),
).join('\n');
type RouteMutation = 'remove-stopped' | 'remove-aborted';
const routePrograms = new Map<string, string>();
function routeProgram(mutation?: RouteMutation): string {
  const key = mutation ?? 'production';
  if (!routePrograms.has(key)) {
    let code = replaceOnce(route.text(selection), route.text(admission.thenStatement), `{ ${route.text(call)} }`);
    if (mutation) {
      const original = route.text(admission.expression);
      const removed = mutation === 'remove-stopped' ? '!sb.stopped && ' : '!abort.signal.aborted && ';
      code = replaceOnce(code, original, replaceOnce(original, removed, ''));
    }
    routePrograms.set(key, transpile(`return async () => {
      ${viability}
      let initialTerminalDecline = false; let result;
      ${route.text(settle)}
      ${route.text(skip)}
      ${code}
      return { initialTerminalDecline, result };
    };`));
  }
  return routePrograms.get(key)!;
}
async function runAdmission(reason: string, options: {
  stopped?: boolean; aborted?: boolean; tier?: string; plannedFiles?: number;
  reasoningRung?: string; initialDecline?: { modelAnswer: string }; ok?: boolean;
  mutation?: RouteMutation;
} = {}) {
  const abort = new AbortController();
  if (options.aborted) abort.abort();
  const records: Array<{ code: string; message: string; detail?: string }> = [];
  const writeFiles = vi.fn();
  const runOneShot = vi.fn(async () => ({ ok: false, summary: 'Synthetic admission only' }));
  const laneFence = { open: vi.fn(() => writeFiles), handoff: vi.fn() };
  const env = {
    sb: { ok: options.ok ?? false, reason, stopped: options.stopped ?? false, plannedFiles: options.plannedFiles ?? 0, initialDecline: options.initialDecline },
    abort, analysis: { startTier: options.tier ?? 'haiku' }, fastLaneReasoningRung: options.reasoningRung ?? null,
    anotherLaneWorthTrying, buildDiag: { record: (row: typeof records[number]) => records.push(row) },
    runOneShot, laneFence, fastLaneRequest: 'Synthetic one-file app', requestNotesSuffix: '\nSynthetic note',
    framework: 'vite-react', scaffold: ['src/App.tsx'], readExistingProjectFile: vi.fn(),
    fastGenerate: vi.fn(), fastPreview: vi.fn(), fastLog: vi.fn(), fastResult: vi.fn(),
    osUsage: { inputTokens: 0, outputTokens: 0 }, powerLevelReqEffective: 'off', billedAmountUsd: () => 0,
  };
  const state = await new Function(...Object.keys(env), routeProgram(options.mutation))(...Object.values(env))();
  return { state, records, runOneShot, laneFence, env, writeFiles };
}
function expectNotAdmitted(result: Awaited<ReturnType<typeof runAdmission>>) {
  expect(result.runOneShot).not.toHaveBeenCalled();
  expect(result.laneFence.open).not.toHaveBeenCalled();
}

describe('production AST one-shot admission and skip narration, not full HTTP execution', () => {
  it.each(MARKERS)('admits a real emitted own-deadline once, with no false outage skip: %s', async (marker) => {
    const result = await runAdmission(await emittedEnvelope(marker));
    expect(result.runOneShot).toHaveBeenCalledTimes(1);
    expect(result.laneFence.open).toHaveBeenCalledExactlyOnceWith('one-shot');
    expect(result.runOneShot).toHaveBeenCalledWith({
      prompt: 'Synthetic one-file app\nSynthetic note', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'],
      readExisting: result.env.readExistingProjectFile, generate: result.env.fastGenerate,
      writeFiles: result.writeFiles, startPreview: result.env.fastPreview, log: result.env.fastLog,
    });
    expect(result.records).toEqual([]);
    expect(result.env.fastGenerate).not.toHaveBeenCalled();
  });

  it.each(PROVIDER_FACTS)('denies a real provider fact and records the corresponding skip: %s', async (fact) => {
    for (const reason of [fact, await emittedEnvelope(`${BUDGET_REACHED_MESSAGE}; ${fact}`)]) {
      const result = await runAdmission(reason);
      expectNotAdmitted(result);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].code).toBe('ONESHOT_SKIPPED');
      expect(result.records[0].message).toMatch(/engine/);
      expect(result.records[0].message).toMatch(fact.includes('timed out') ? /timed out/ : /did not respond in time/);
    }
  });

  it('independently respects stopped:true while the signal is still live', async () => {
    const result = await runAdmission(await emittedEnvelope(BUDGET_REACHED_MESSAGE), { stopped: true });
    expect(result.env.abort.signal.aborted).toBe(false);
    expectNotAdmitted(result);
    expect(result.records).toEqual([]);
  });
  it('independently respects an aborted signal after a stopped:false lane result', async () => {
    const result = await runAdmission(await emittedEnvelope(BUDGET_REACHED_MESSAGE), { aborted: true });
    expect(result.env.sb.stopped).toBe(false);
    expectNotAdmitted(result);
    expect(result.records).toEqual([]);
  });
  it('preserves initial-decline settlement rather than retrying the answer', async () => {
    const result = await runAdmission(await emittedEnvelope(BUDGET_REACHED_MESSAGE), { initialDecline: { modelAnswer: 'Synthetic initial decline' } });
    expectNotAdmitted(result);
    expect(result.state.initialTerminalDecline).toBe(true);
    expect(result.state.result.modelAnswer).toBe('Synthetic initial decline');
    expect(result.laneFence.handoff).toHaveBeenCalledTimes(1);
    expect(result.records).toEqual([]);
  });
  it.each(['sonnet', 'opus'])('preserves disallowed tier %s', async (tier) => {
    const result = await runAdmission(envelope(BUDGET_REACHED_MESSAGE), { tier });
    expectNotAdmitted(result);
    expect(result.records).toEqual([]);
  });
  it('preserves measured multi-file exclusion and its actual skip narration', async () => {
    const result = await runAdmission(envelope(BUDGET_REACHED_MESSAGE), { plannedFiles: 2 });
    expectNotAdmitted(result);
    expect(result.records).toEqual([expect.objectContaining({ code: 'ONESHOT_SKIPPED', message: expect.stringContaining('found 2 files') })]);
  });
  it('preserves the independent reasoning-handoff exclusion and narration', async () => {
    const result = await runAdmission(envelope(BUDGET_REACHED_MESSAGE), { reasoningRung: 'synthetic-reasoning-rung' });
    expectNotAdmitted(result);
    expect(result.records).toEqual([expect.objectContaining({ code: 'ONESHOT_SKIPPED', message: expect.stringContaining('reasons before every answer') })]);
  });
  it.each(['haiku', 'gemini'])('keeps eligible one-file/content/unknown positive controls for %s', async (tier) => {
    for (const reason of [BUDGET_REACHED_MESSAGE, 'invalid response', 'unfamiliar reason']) {
      const result = await runAdmission(reason, { tier, plannedFiles: 1 });
      expect(result.runOneShot).toHaveBeenCalledTimes(1);
      expect(result.records).toEqual([]);
    }
  });
  it('a successful simple lane is not retried', async () => {
    expectNotAdmitted(await runAdmission(envelope(BUDGET_REACHED_MESSAGE), { ok: true }));
  });
});

// Mutate executable source only in memory. Each test reuses the production assertion that must fail;
// a missing/ambiguous source target fails loudly rather than silently skipping the mutation.
type ClassifierMutation = 'remove-budget-recognition' | 'restore-wrapper-scan' | 'budget-before-provider';
function mutatedClassifier(mutation: ClassifierMutation): Classifier {
  const parsed = parse('src/server/AgentV3/laneFailure.ts');
  const classifier = one(parsed.nodes.filter(ts.isFunctionDeclaration).filter((node) => node.name?.text === 'classifyLaneFailure'), 'lane classifier');
  const statements = [...classifier.body!.statements];
  const returning = (kind: string) => one(statements.filter(ts.isIfStatement).filter((node) => parsed.text(node.thenStatement) === `return '${kind}';`), `${kind} recognition`);
  const budget = parsed.text(returning('own-deadline'));
  const provider = parsed.text(returning('provider-degraded'));
  const wrapper = parsed.text(one(statements.filter(ts.isIfStatement).filter((node) => parsed.text(node.expression).includes('.startsWith(') && parsed.text(node.expression).includes('.endsWith(')), 'exact envelope exception'));
  let body = parsed.source.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => parsed.text(node).replace(/^export /, '')).join('\n');
  if (mutation === 'remove-budget-recognition') body = replaceOnce(body, budget, '');
  if (mutation === 'restore-wrapper-scan') body = replaceOnce(body, wrapper, '');
  if (mutation === 'budget-before-provider') body = replaceOnce(replaceOnce(body, budget, ''), provider, `${budget}\n${provider}`);
  return new Function('isBudgetEndedError', `${transpile(body)}\nreturn { classifyLaneFailure, anotherLaneWorthTrying, upsellIsHonest };`)(isBudgetEndedError);
}

describe('in-memory reversion controls prove the guards are load-bearing', () => {
  it('removing budget recognition fails the raw-marker contract', () => {
    const mutant = mutatedClassifier('remove-budget-recognition');
    for (const marker of MARKERS) {
      expect(mutant.classifyLaneFailure(marker)).toBe('unknown');
      expect(() => expectDeadline(marker, mutant)).toThrow();
    }
  });
  it('restoring the full wrapper scan fails the actual-emitter contract', async () => {
    const mutant = mutatedClassifier('restore-wrapper-scan');
    for (const marker of MARKERS) {
      const wrapped = await emittedEnvelope(marker);
      expect(mutant.classifyLaneFailure(wrapped)).toBe('provider-degraded');
      expect(() => expectDeadline(wrapped, mutant)).toThrow();
    }
  });
  it('putting budget before genuine provider evidence fails timeout and 429 controls', async () => {
    const mutant = mutatedClassifier('budget-before-provider');
    for (const marker of MARKERS) for (const fact of PROVIDER_FACTS) {
      const reason = `${marker}; ${fact}`;
      for (const mixed of [reason, await emittedEnvelope(reason)]) {
        expect(mutant.classifyLaneFailure(mixed)).toBe('own-deadline');
        expect(() => expectDegraded(mixed, mutant)).toThrow();
      }
    }
  });
  it.each(['remove-stopped', 'remove-aborted'] as const)('%s independently fails the no-admission contract', async (mutation) => {
    const result = await runAdmission(await emittedEnvelope(BUDGET_REACHED_MESSAGE), {
      stopped: mutation === 'remove-stopped', aborted: mutation === 'remove-aborted', mutation,
    });
    expect(result.runOneShot).toHaveBeenCalledTimes(1);
    expect(() => expectNotAdmitted(result)).toThrow();
  });
});
