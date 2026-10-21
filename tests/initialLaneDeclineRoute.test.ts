import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSimpleBuild, unwrittenEntries } from '../src/server/AgentV3/SimpleBuilder';
import { runOneShot, classifyForOneShot, oneShotStillViable, oneShotSkipReason } from '../src/server/AgentV3/OneShotBuilder';
import { anotherLaneWorthTrying, providerDegradedMessage } from '../src/server/AgentV3/laneFailure';
import { createLaneWriteFence, LaneAbandonedError } from '../src/server/AgentV3/laneWriteFence';
import { fastLanePhaseSummary, dominantFastLanePhase } from '../src/server/AgentV3/fastLanePhases';
import { recordReasoningStays } from '../src/server/AgentV3/FastLaneBudget';
import { entryFirstHandoffLine } from '../src/server/AgentV3/earlyPreview';
import { planHandoffText } from '../src/server/AgentV3/planHandoff';
import { billedAmountUsd, type BilledUsage } from '../src/server/AgentV3/pricing';
import { readTurnAnswer, modelsOwnWords } from '../src/server/AgentV3/turnAnswer';
import { normalizeImportSpecifiers, injectGlobalStylesheetImport, dedupeStylesheetImports } from '../src/server/AgentV3/ProjectIntegrityChecks';
import { injectDotenvLoad, dotenvWiringMessage } from '../src/server/AgentV3/envLoading';
import { missingViteEnvTypes, viteEnvTypesNote } from '../src/server/AgentV3/viteEnvTypes';
import { redactCredentialLogs } from '../src/server/AgentV3/credentialLogRedaction';
import { createFinishingPassGuard } from '../src/server/AgentV3/finishingPassesAtCap';
import { shouldAutoScaffoldE2e } from '../src/server/AgentV3/e2eAutoScaffold';
import { renderRescueEligible } from '../src/server/AgentV3/renderRescue';
import { findAmbientShimCollisions, stripCollidingAmbientShims, ambientShimNote } from '../src/server/AgentV3/ambientModuleShim';
import { withE2eExcluded, e2eExcludeNote } from '../src/server/AgentV3/e2eTypecheck';
import { recheckAfterFinishingWrites, postGreenRecheckEnabled } from '../src/server/AgentV3/finishingRecheck';
import { BuildDiagnostics, buildWasStopped, stoppedByUser, outcomeCodeOf, isAppFinding, userFacingReport, providerFailuresLookDegraded, providerFailuresLookMisconfigured, buildStarvedItsOutputBudget } from '../src/server/AgentV3/BuildDiagnostics';
import { abortBuild, abortCauseOf, interruptedBeforeAnyVerdict } from '../src/server/AgentV3/buildAbortCause';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';
import { buildExceptionDetails } from '../src/server/AgentV3/BuildRequestCoordination';
import { SandboxRecoveryUnavailableError } from '../src/server/AgentV3/SandboxRecoveryError';
import { zeroBillReasonFor } from '../src/server/AgentV3/zeroBillReason';
import { buildBillingLabel } from '../src/server/AgentV3/buildBillingLabel';
import { chargeRecordFields } from '../src/server/lib/chargeRecord';

/**
 * Synthetic-only, bounded caller-effects integration. This is NOT a full HTTP/server harness.
 * Execute production AST statements (not copies of their conditions) against an in-memory workspace:
 * real builders + lease -> actual lane selection/fallback -> answer capture/retry gate -> deterministic
 * integrity writers -> complete finishing function/call -> empty-build billing/upsell + diagnostics finish.
 * Integrity's later advisory/model-quality stages, HTTP admission, providers, storage and wallet are not
 * exercised. The deterministic prefix contains every zero-artifact writer protected by its new admission;
 * positive controls prove those real helpers actually write without that admission. No private inputs.
 */
const source = ts.createSourceFile('agentv3.ts', readFileSync('src/server/routes/agentv3.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const nodes: ts.Node[] = [];
(function visit(n: ts.Node) { nodes.push(n); ts.forEachChild(n, visit); })(source);
const text = (n: ts.Node) => n.getText(source);
function one<T extends ts.Node>(matches: T[], label: string): T {
  if (matches.length !== 1) throw new Error(`Expected one production ${label}, found ${matches.length}`);
  return matches[0];
}
function variable(name: string, filter: (n: ts.VariableStatement) => boolean = () => true): ts.VariableStatement {
  return one(nodes.filter(ts.isVariableStatement).filter((n) => n.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name) && filter(n)), `variable ${name}`);
}
function statementContainingCall(name: string, filter: (n: ts.ExpressionStatement) => boolean = () => true) {
  return one(nodes.filter(ts.isExpressionStatement).filter((n) => {
    const e = ts.isAwaitExpression(n.expression) ? n.expression.expression : n.expression;
    return ts.isCallExpression(e) && text(e.expression) === name && filter(n);
  }), `call ${name}`);
}
function conditionContains(fragment: string): ts.IfStatement {
  return one(nodes.filter(ts.isIfStatement).filter((n) => text(n.expression).includes(fragment)), `condition ${fragment}`);
}
function siblingsFrom(start: ts.Statement, end?: ts.Statement): string {
  if (!ts.isBlock(start.parent) || (end && end.parent !== start.parent)) throw new Error('Production statements no longer share a block');
  const statements = [...start.parent.statements];
  const first = statements.indexOf(start);
  const last = end ? statements.indexOf(end) : statements.length - 1;
  if (first < 0 || last < first) throw new Error('Production statement ordering changed');
  return statements.slice(first, last + 1).map(text).join('\n');
}
const lane = [text(variable('fastResult')), text(variable('settleInitialDecline')), siblingsFrom(variable('sb', (n) => text(n).includes('await runSimpleBuild(')))].join('\n');
const fallback = conditionContains('!result && analysis && !freeTierBuildActive');
const lastFallback = one(nodes.filter(ts.isIfStatement).filter((n) => text(n.expression) === '!result' && !ts.isBlock(n.thenStatement) && text(n.thenStatement).includes('result = await runner.run(buildPrompt)')), 'last full-runner fallback');
const retry = conditionContains('shouldRetryEmptyBuild(');
const firstAttempt = siblingsFrom(variable('costAfterFirstAttempt'), retry);
const captureAnswer = siblingsFrom(variable('modelAnswer'), conditionContains('modelAnswer.declined && !abort.signal.aborted'));
const integrityTry = one(nodes.filter(ts.isTryStatement).filter((n) => n.tryBlock.statements.some((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => text(d.name) === 'integrityStartedAt'))), 'integrity try');
const integrityLast = one([...integrityTry.tryBlock.statements].filter(ts.isIfStatement).filter((n) => text(n.expression).includes('AGENTV3_CRED_LOG_GUARD')), 'last deterministic integrity writer');
const integrityAdmission = ts.isIfStatement(integrityTry.parent) ? integrityTry.parent : integrityTry;
// Keep the production wrapper and every original prefix statement, including all write calls/catches.
// Omit only the later advisory/model-quality stages, whose behavior this test does not claim to prove.
const integrity = text(integrityAdmission).replace(
  text(integrityTry.tryBlock),
  `{ ${[...integrityTry.tryBlock.statements].slice(0, integrityTry.tryBlock.statements.indexOf(integrityLast) + 1).map(text).join('\n')} }`,
);
const finishingCall = statementContainingCall('applyFinishingPasses');
const finishingAdmission = ts.isIfStatement(finishingCall.parent) ? finishingCall.parent : finishingCall;
const finalOutcome = one(nodes.filter(ts.isIfStatement).filter((n) => text(n.expression) === 'result && result.ok === false' && text(n).includes('OUTCOME_UNEXPLAINED')), 'normal-settle no-outcome branch');
const zeroBill = one(nodes.filter(ts.isIfStatement).filter((n) => text(n.expression) === 'expectsArtifacts && builderWroteCount() === 0' && text(n).includes('zeroBillReasonFor(')), 'zero-artifact billing and upsell');
const finish = statementContainingCall('buildDiag.finish', (n) => text(n).includes('result.ok, result.summary'));
const billing = statementContainingCall('buildDiag.setBilling');
const providerTokens = statementContainingCall('buildDiag.setProviderTokens');
const resultEvent = statementContainingCall('emit', (n) => text(n).includes("type: 'result', ...result"));
const pureFunctions = ['shouldRetryEmptyBuild', 'sessionCostCapUsd'].map((name) => text(one(nodes.filter(ts.isFunctionDeclaration).filter((n) => n.name?.text === name), name)).replace(/^export /, '')).join('\n');

type Mutation = 'simple-handoff' | 'one-shot-handoff' | 'integrity' | 'finishing' | 'cost-narration' | 'diagnostic-outcome';
const compiledPrograms = new Map<string, string>();
function program(mutation?: Mutation): string {
  const key = mutation ?? 'production';
  const cached = compiledPrograms.get(key);
  if (cached) return cached;
  let selection = lane;
  let integrityCode = integrity;
  let finishingCode = text(finishingAdmission);
  let attemptCode = firstAttempt;
  let outcomeCode = text(finalOutcome);
  // In-memory reversion controls only: never edit a production file to prove test sensitivity.
  if (mutation === 'simple-handoff') selection = selection.replace('settleInitialDecline(sb.initialDecline)', 'false');
  if (mutation === 'one-shot-handoff') selection = selection.replace('settleInitialDecline(os.initialDecline)', 'false');
  if (mutation === 'integrity') integrityCode = integrityCode.replace('if (!initialTerminalDecline)', 'if (true)');
  if (mutation === 'finishing') finishingCode = finishingCode.replace('if (!initialTerminalDecline)', 'if (true)');
  if (mutation === 'diagnostic-outcome') outcomeCode = outcomeCode.replace('initialTerminalDecline && !abort.signal.aborted ?', 'false ?');
  if (mutation === 'cost-narration') attemptCode = attemptCode.replace('!initialTerminalDecline && ', '');
  const compiled = ts.transpileModule(`return async () => {
    ${pureFunctions}
    ${text(variable('initialTerminalDecline'))}
    let result; let fastLaneGated = false; let deliveredTier; let buildPrompt = prompt;
    let etaPlannedFiles = 0; let etaFirstFileAt = 0; let etaFinalChecks = false;
    let wholeProjectFiles = null; let inBuildWriteTick = 0;
    const osUsage = accumulatedUsage;
    ${selection}
    ${text(fallback)}
    ${text(lastFallback)}
    ${attemptCode}
    ${captureAnswer}
    ${integrityCode}
    ${text(variable('finishingGuard'))}
    ${text(variable('applyFinishingPasses'))}
    ${finishingCode}
    ${text(statementContainingCall('recheckAfterFinishingWrites'))}
    beforeFinalOutcome();
    ${outcomeCode}
    let effectiveBilledUsd = result.billedUsd; let zeroBillReason;
    ${text(zeroBill)}
    const reconciledProviderUsage = { synthetic: { ...osUsage } };
    ${text(providerTokens)}
    const settledBilledInr = Math.round(effectiveBilledUsd * usdInrRate() * 100) / 100;
    ${text(billing)}
    ${text(finish)}
    const diagnostics = buildDiag.report();
    const totalTokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
    ${text(resultEvent)}
    return { result, initialTerminalDecline, fastLaneGated, modelAnswer, effectiveBilledUsd, diagnostics };
  };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  compiledPrograms.set(key, compiled);
  return compiled;
}

const DECLINE = '  I cannot build the requested feature in this environment.\nI can explain the limitation instead.  ';
const SMALL_PLAN = 'src/Note.tsx :: Display one synthetic note';
const CLEAN: Record<string, string> = {
  'index.html': '<!doctype html><title>Synthetic starter</title><div id="root"></div>',
  'src/App.tsx': 'export default function App() { return <main>Synthetic starter</main>; }',
};
const INTEGRITY: Record<string, string> = {
  ...CLEAN,
  'package.json': '{"type":"module","scripts":{"start":"node server.js"},"dependencies":{"express":"1.0.0"}}',
  'server.js': "import express from 'express';\nconst server = express();\nserver.set('secret', process.env.SESSION_SECRET);",
  '.env': 'SESSION_SECRET=synthetic-test-value-not-a-credential',
  'src/main.tsx': "import App from './App';\nimport { theme } from './context/Theme';\nimport './shared.css';\nconsole.info(App);",
  'src/App.tsx': "import { theme } from 'context/Theme';\nimport './shared.css';\nexport default function App() { return <main>{theme}</main>; }",
  'src/context/Theme.ts': "export const theme = 'synthetic';",
  'src/index.css': 'body { color: navy; }',
  'src/shared.css': 'main { padding: 4px; }',
  'src/settings.ts': 'export const api = import.meta.env.VITE_API_URL;\nconst password = "synthetic";\nconsole.log("password", password);',
};
const E2E: Record<string, string> = {
  ...CLEAN,
  'playwright.config.ts': "declare module '@playwright/test' { export function defineConfig(v: unknown): unknown; }\nimport { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './e2e' });",
  'e2e/synthetic.spec.ts': "import { test } from '@playwright/test';\ntest('synthetic', () => {});",
  'tsconfig.json': '{"compilerOptions":{"strict":true},"include":["**/*.ts","**/*.tsx"]}',
};
const FIXTURES = [{ name: 'clean scaffold', files: CLEAN }, { name: 'deterministic integrity triggers', files: INTEGRITY }, { name: 'existing E2E shim/config', files: E2E }];
const BASE_USAGE = { inputTokens: 113, outputTokens: 17, cacheReadInputTokens: 7, cacheCreationInputTokens: 3 };
const PER_CALL_USAGE = { inputTokens: 5_000_000, outputTokens: 250_000, cacheReadInputTokens: 20_000, cacheCreationInputTokens: 10_000 };
const SMALL_USAGE = { inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 100, cacheCreationInputTokens: 50 };
const expectedUsage = (calls: number, delta = PER_CALL_USAGE) => Object.fromEntries(Object.entries(BASE_USAGE).map(([key, value]) => [key, value + calls * delta[key as keyof typeof delta]]));

async function runCaller(options: { files: Record<string, string>; replies?: string[]; mutation?: Mutation; abortAfterAnswer?: boolean; abortOnCall?: number; smallUsage?: boolean; existingPreview?: boolean; abortAfterSettlement?: boolean; priorOutcome?: string }) {
  const files = { ...options.files };
  const writtenFiles = new Map<string, string>();
  const finishingPaths = new Set<string>();
  const events: Array<Record<string, any>> = [];
  const passes: string[] = [];
  const lateWriters: Array<ReturnType<ReturnType<typeof createLaneWriteFence>['open']>> = [];
  const abort = new AbortController();
  const buildDiag = new BuildDiagnostics();
  const finalize = vi.spyOn(buildDiag, 'finish');
  if (options.priorOutcome) buildDiag.record({ phase: 'build', severity: 'info', code: options.priorOutcome, message: 'Synthetic existing terminal outcome.', autoResolved: true });
  const accumulatedUsage = { ...BASE_USAGE };
  const writeFile = vi.fn(async (_workspace: string, path: string, content: string) => { files[path] = content; });
  const rawWrite = vi.fn(async (items: Array<{ path: string; content: string }>) => {
    for (const f of items) { await writeFile('synthetic-workspace', f.path, f.content); writtenFiles.set(f.path, f.content); }
  });
  const fence = createLaneWriteFence(rawWrite);
  const open = fence.open.bind(fence);
  vi.spyOn(fence, 'open').mockImplementation((name) => { const writer = open(name); lateWriters.push(writer); return writer; });
  const readFile = vi.fn(async (_workspace: string, path: string) => {
    if (!(path in files)) throw new Error('synthetic file absent');
    return files[path];
  });
  const preview = vi.fn(async () => 'https://synthetic.invalid/preview');
  const repair = vi.fn(async () => []);
  const verify = vi.fn(async () => ({ ok: true, errors: '', ran: true }));
  const commands = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
  const perCallUsage = options.smallUsage ? SMALL_USAGE : PER_CALL_USAGE;
  let replyIndex = 0;
  const generate = vi.fn(async () => {
    for (const key of Object.keys(accumulatedUsage) as Array<keyof typeof accumulatedUsage>) accumulatedUsage[key] += perCallUsage[key];
    if (options.abortAfterAnswer || options.abortOnCall === replyIndex + 1) abortBuild(abort, 'user-stop');
    return (options.replies ?? [DECLINE])[replyIndex++] ?? 'The synthetic response is not a file plan.';
  });
  const runSimple = vi.fn(runSimpleBuild);
  const runOne = vi.fn(runOneShot);
  const fullRunner = vi.fn(async () => ({ ok: false, summary: 'Synthetic runner retained the fallback category.', steps: 0, usage: accumulatedUsage, billedUsd: billedAmountUsd(accumulatedUsage, 'off') }));
  const env = {
    prompt: 'Build a synthetic note display.', workspaceId: 'synthetic-workspace', framework: 'vite-react',
    accumulatedUsage, abort, buildDiag, writtenFiles, finishingPaths,
    laneFence: fence, runSimpleBuild: runSimple, runOneShot: runOne,
    fastGenerate: generate, fastPreview: preview, fastVerify: verify, fastRepair: repair,
    fastWrite: rawWrite, fastLog: (msg: string) => events.push({ type: 'narration', text: msg }),
    runInPass: async (pass: string, action: () => Promise<unknown>) => { passes.push(pass); return action(); },
    writeUnlessFrozen: async (action: () => Promise<unknown>) => { await action(); return true; },
    actuator: { readFile, writeFile, runCommand: commands, browseUrl: preview },
    loadWorkspaceFiles: async () => ({ ...files }), saveWorkspaceFiles: vi.fn(async () => {}),
    readExistingProjectFile: (path: string) => readFile('synthetic-workspace', path),
    fastLaneRequest: 'Build a synthetic note display.', requestNotesText: '', requestNotesSuffix: '',
    scaffold: Object.keys(files), starterEntryPath: undefined, buildIsComplex: false,
    fastLaneReasoningRung: null, onFilesReady: vi.fn(), noteEtaPlannedFiles: vi.fn(), emitSettlingPhase: vi.fn(),
    events: { emit: (event: Record<string, any>) => events.push(event) },
    weakCandidateActive: () => false, powerLevelReqEffective: 'off', analysis: { startTier: 'haiku' },
    recordReasoningStays, laneReasoningStays: [], fastLanePhaseSummary, dominantFastLanePhase,
    classifyForOneShot, oneShotStillViable, oneShotSkipReason, anotherLaneWorthTrying,
    unwrittenEntries, entryFirstHandoffLine, planHandoffText,
    withTimeout: async <T,>(p: Promise<T>) => p,
    billedAmountUsd, freeTierBuildActive: true, tierEscalationPath: [], runner: { run: fullRunner },
    expectsArtifacts: true, builderWroteCount: () => writtenFiles.size, isEditMode: false, editFileTree: [],
    userAskedToBuildAnApp: true, seedStateOf: () => null, readTurnAnswer, modelsOwnWords,
    adAnswerFacts: {}, answeredHolder: {}, recordAnsweredNotBuilt: vi.fn(), adRemovalAnsweredNote: () => '',
    thirdPartyAdFactsAtStart: { players: [] },
    normalizeImportSpecifiers, injectGlobalStylesheetImport, dedupeStylesheetImports, injectDotenvLoad,
    dotenvWiringMessage, missingViteEnvTypes, viteEnvTypesNote, redactCredentialLogs, isImportTurn: false,
    createFinishingPassGuard, effectiveBuildSeconds: 0, buildStartedAt: Date.now(), singleHtmlFileRule: false,
    shouldAutoScaffoldE2e, renderRescueEligible, lastPreviewUrl: options.existingPreview ? 'https://synthetic.invalid/preview' : null,
    findAmbientShimCollisions, stripCollidingAmbientShims, ambientShimNote, withE2eExcluded, e2eExcludeNote,
    noteFinishingWrite: (path: string) => finishingPaths.add(path), userId: null,
    recheckAfterFinishingWrites, postGreenRecheckEnabled, inBuildGreenAt: options.existingPreview ? 1 : 0,
    buildWasStopped, stoppedByUser, outcomeCodeOf, abortCauseOf, providerFailuresLookDegraded, providerFailuresLookMisconfigured,
    buildStarvedItsOutputBudget, providerDegradedMessage,
    // These presentation-only fakes are reached by NON-decline controls, never used to decide admission.
    answerOnlyNow: () => false, assessBuildInput: () => ({ buildable: true }), freeTierUpsellMessage: () => 'SYNTHETIC_UPSELL',
    interruptedBeforeAnyVerdict, zeroBillReasonFor, buildBillingLabel, chargeRecordFields,
    usdInrRate: () => 80, email: undefined, isAgentV3FreeUser: () => false, billingActive: true,
    walletDebit: null, decidedRealCostUsd: 1, decidedSandboxUsd: 0, onlyOpus: false, noClaudeBuild: false,
    leakedClaudeProvider: null, projectContinue: {}, buildId: 'synthetic-build', promptHash: 'synthetic-prompt',
    buildObs: { previewRendered: false }, costBreakdown: null, buildHealth: null,
    beforeFinalOutcome: () => { if (options.abortAfterSettlement) abortBuild(abort, 'user-stop'); },
    emit: (event: Record<string, any>) => events.push(event),
  };
  const state = await new Function(...Object.keys(env), program(options.mutation))(...Object.values(env))();
  return { ...state, files, writtenFiles, events, passes, finalize, generate, runSimple, runOne, fullRunner, rawWrite, writeFile, preview, repair, verify, commands, fence, lateWriters, accumulatedUsage, perCallUsage };
}

async function runCrash(priorOutcome?: string, err: Error = new Error('Synthetic orchestration crash after the answer.')) {
    const crashStart = variable('crash', (n) => text(n).includes('buildExceptionDetails(err)'));
    const crashTry = one(nodes.filter(ts.isTryStatement).filter((n) => n.tryBlock.statements.some((s) =>
      ts.isExpressionStatement(s) && text(s).includes('buildDiagRef?.record({ phase: crash.phase'))), 'crash diagnostics try');
    const buildDiagRef = new BuildDiagnostics();
    buildDiagRef.record({ phase: 'build', severity: 'info', code: 'SIMPLE_BUILD_DECLINED', message: DECLINE, autoResolved: true });
    if (priorOutcome) buildDiagRef.record({ phase: 'build', severity: 'info', code: priorOutcome, message: 'Synthetic earlier terminal outcome.', autoResolved: true });
    const finalize = vi.spyOn(buildDiagRef, 'finish');
    const env = {
      err, buildExceptionDetails,
      buildDiagRef, outcomeCodeOf, userFacingReport, initialTerminalDecline: true,
      lastDiagnostics: new Map(), buildKey: 'synthetic-crash', workspaceId: 'synthetic-workspace', userId: null,
      saveDiagnostics: vi.fn(async () => {}), saveDiagnosticsHistory: vi.fn(async () => {}), saveLatestForUser: vi.fn(async () => {}),
    };
    const compiled = ts.transpileModule(`return async () => { ${siblingsFrom(crashStart, crashTry)} return buildDiagRef.report(); };`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const report = await new Function(...Object.keys(env), compiled)(...Object.values(env))();
    return { report, finalize };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function enableWriters() {
  for (const key of ['AGENTV3_IMPORT_NORMALIZE', 'AGENTV3_CSS_IMPORT_GUARD', 'AGENTV3_DOTENV_GUARD', 'AGENTV3_VITE_ENV_TYPES', 'AGENTV3_CRED_LOG_GUARD', 'AGENTV3_AUTO_E2E']) vi.stubEnv(key, 'on');
  vi.stubEnv('SESSION_COST_CAP_USD', '5');
}
function assertTerminal(r: Awaited<ReturnType<typeof runCaller>>, original: Record<string, string>, calls: number) {
  expect(r.initialTerminalDecline).toBe(true);
  expect(r.result).toMatchObject({ ok: false, steps: 0, summary: DECLINE, modelAnswer: DECLINE, usage: expectedUsage(calls, r.perCallUsage) });
  expect(r.result.usage).toBe(r.accumulatedUsage);
  expect(r.result.billedUsd).toBe(billedAmountUsd(r.accumulatedUsage as BilledUsage, 'off'));
  expect(r.fastLaneGated).toBe(false);
  expect(r.modelAnswer.declined).toBe(true);
  expect(r.generate).toHaveBeenCalledTimes(calls);
  expect(r.fullRunner).not.toHaveBeenCalled();
  expect(r.writeFile).not.toHaveBeenCalled();
  expect(r.rawWrite).not.toHaveBeenCalled();
  expect(r.preview).not.toHaveBeenCalled();
  expect(r.verify).not.toHaveBeenCalled();
  expect(r.repair).not.toHaveBeenCalled();
  expect(r.commands).not.toHaveBeenCalled();
  expect(r.files).toEqual(original);
  expect(r.writtenFiles.size).toBe(0);
  expect(r.passes).toEqual([]);
  expect(r.fence.holder).toBeNull();
  expect(r.finalize).toHaveBeenCalledExactlyOnceWith(false, DECLINE);
  expect(r.effectiveBilledUsd).toBe(0);
  expect(r.diagnostics.billing).toMatchObject({ billedUsd: 0, charged: false });
  const resultEvents = r.events.filter((e: Record<string, any>) => e.type === 'result');
  expect(resultEvents).toHaveLength(1);
  expect(resultEvents[0]).toMatchObject({ ok: false, summary: DECLINE, modelAnswer: DECLINE, billedUsd: 0, billedInr: 0, usage: expectedUsage(calls, r.perCallUsage) });
  const narration = r.events.filter((e: Record<string, any>) => e.type === 'narration').map((e: Record<string, any>) => e.text).join('\n');
  expect(narration).not.toMatch(/try again|stronger engine|SYNTHETIC_UPSELL|add credits/i);
  const codes = r.diagnostics.issues.map((i: { code: string }) => i.code);
  expect(codes).toContain('TURN_DECLINED');
  expect(codes).toContain('UPSELL_SUPPRESSED');
  expect(codes).not.toContain('ONESHOT_SKIPPED');
  expect(codes).not.toContain('OUTCOME_BUILD_FAILED');
  expect(codes).not.toContain('OUTCOME_UNEXPLAINED');
  const outcome = r.diagnostics.issues.find((i: { code: string }) => i.code === 'OUTCOME_INITIAL_DECLINED');
  expect(outcome).toMatchObject({ severity: 'info', autoResolved: true });
  expect(r.diagnostics.rootCause).toBe(outcome.message);
  expect(r.diagnostics.rootCause).toMatch(/initial build lane declined/i);
  expect(r.diagnostics.rootCause).not.toMatch(/no specific error|did not record why|policy/i);
  expect(isAppFinding(outcome)).toBe(false);
  expect(buildFindingSuggestions(r.diagnostics.issues)).toEqual([]);
  expect(buildFindingSuggestions([{ ...outcome, autoResolved: false }])).toEqual([]);
}

describe('initial lane declines reach the real caller without later app work', () => {
  for (const mode of ['simple', 'one-shot'] as const) for (const fixture of FIXTURES) {
    it(`${mode} terminal answer, ${fixture.name}: no next lane/writes/repair/preview, original answer and usage, finalizes free once`, async () => {
      enableWriters();
      const calls = mode === 'simple' ? 1 : 2;
      const r = await runCaller({ files: fixture.files, replies: mode === 'simple' ? [DECLINE] : [SMALL_PLAN, DECLINE], existingPreview: true });
      assertTerminal(r, fixture.files, calls);
      expect(r.result.billedUsd).toBeGreaterThan(5);
      expect(r.runSimple).toHaveBeenCalledTimes(1);
      expect(r.runOne).toHaveBeenCalledTimes(calls - 1);
      expect(r.diagnostics.issues.map((i: { code: string }) => i.code)).toContain(mode === 'simple' ? 'SIMPLE_BUILD_DECLINED' : 'ONESHOT_DECLINED');
      // Real lease rejection: a retained callback cannot mutate even after finalization.
      for (const write of r.lateWriters) await expect(write([{ path: 'late.ts', content: 'synthetic late output' }])).rejects.toBeInstanceOf(LaneAbandonedError);
      expect(r.writeFile).not.toHaveBeenCalled();
    });
  }

  it.each(['simple', 'one-shot'] as const)('%s decline below the cap still suppresses the empty-build retry', async (mode) => {
    enableWriters();
    const r = await runCaller({ files: CLEAN, replies: mode === 'simple' ? [DECLINE] : [SMALL_PLAN, DECLINE], smallUsage: true });
    assertTerminal(r, CLEAN, mode === 'simple' ? 1 : 2);
    expect(r.result.billedUsd).toBeLessThan(5);
  });

  it('a non-decline over the cap retains its existing advice and recorded cost before zero billing', async () => {
    enableWriters();
    const r = await runCaller({ files: CLEAN, replies: ['No file plan was returned.', 'No file blocks were returned.'] });
    expect(r.initialTerminalDecline).toBe(false);
    expect(r.result.usage).toEqual(expectedUsage(2));
    expect(r.result.billedUsd).toBe(billedAmountUsd(r.accumulatedUsage, 'off'));
    expect(r.result.billedUsd).toBeGreaterThan(5);
    expect(r.events.filter((e: Record<string, any>) => /Try again with a simpler prompt/.test(e.text ?? ''))).toHaveLength(1);
    expect(r.fullRunner).toHaveBeenCalledTimes(1);
    expect(r.effectiveBilledUsd).toBe(0);
    expect(r.finalize).toHaveBeenCalledTimes(1);
    expect(outcomeCodeOf(r.diagnostics.issues)).toBe('OUTCOME_UNEXPLAINED');
    expect(r.diagnostics.rootCause).toContain('The engine did not record why');
  });

  it('the same integrity fixture without a decline still executes every existing deterministic writer', async () => {
    enableWriters();
    const r = await runCaller({ files: INTEGRITY, replies: ['No file plan was returned.', 'No file blocks were returned.'] });
    expect(r.initialTerminalDecline).toBe(false);
    expect(r.fullRunner).toHaveBeenCalledTimes(1);
    expect(new Set(r.passes)).toEqual(new Set(['import-specifier-normalize', 'stylesheet-import-wire', 'stylesheet-dedupe', 'dotenv-load-wire', 'vite-env-types', 'credential-log-redact']));
    expect(r.files['server.js']).toContain("import 'dotenv/config'");
    expect(r.files['src/vite-env.d.ts']).toContain('vite/client');
    expect(r.writeFile.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('the same existing E2E fixture without a decline still removes the shim and excludes test sources', async () => {
    enableWriters();
    const r = await runCaller({ files: E2E, replies: ['No file plan was returned.', 'No file blocks were returned.'] });
    expect(r.initialTerminalDecline).toBe(false);
    expect(r.fullRunner).toHaveBeenCalledTimes(1);
    expect(r.passes).toEqual(['ambient-shim-cleanup', 'e2e-tsconfig-exclude']);
    expect(r.files['playwright.config.ts']).not.toContain('declare module');
    expect(JSON.parse(r.files['tsconfig.json']).exclude).toContain('playwright.config.ts');
    expect(r.writeFile).toHaveBeenCalledTimes(2);
  });

  it.each(['I cannot build without an available service.', 'I cannot build it.\n<<FILE src/App.tsx>>\nunfinished', 'A quoted label says "I cannot build".'])('ambiguous or attempted output keeps ordinary fallback: %s', async (answer) => {
    const r = await runCaller({ files: CLEAN, replies: [answer, answer] });
    expect(r.initialTerminalDecline).toBe(false);
    expect(r.generate).toHaveBeenCalledTimes(2);
    expect(r.runOne).toHaveBeenCalledTimes(1);
    expect(r.fullRunner).toHaveBeenCalledTimes(1);
    expect(r.modelAnswer.declined).toBe(false);
  });

  it('a stop arriving with the one-shot answer wins at the caller settlement boundary', async () => {
    const r = await runCaller({ files: CLEAN, replies: [SMALL_PLAN, DECLINE], abortOnCall: 2 });
    expect(r.generate).toHaveBeenCalledTimes(2);
    expect(r.runOne).toHaveBeenCalledTimes(1);
    const laneAnswer = await r.runOne.mock.results[0].value;
    expect(laneAnswer.initialDecline).toMatchObject({ kind: 'initial-lane-decline', modelAnswer: DECLINE });
    expect(r.initialTerminalDecline).toBe(false);
    expect(outcomeCodeOf(r.diagnostics.issues)).not.toBe('OUTCOME_INITIAL_DECLINED');
    expect(r.fullRunner).toHaveBeenCalledTimes(1); // Existing aborted-runner dispatch is preserved.
    expect(r.fence.holder).toBeNull();
    expect(r.writeFile).not.toHaveBeenCalled();
    expect(r.preview).not.toHaveBeenCalled();
    expect(r.finalize).toHaveBeenCalledTimes(1);
  });

  it('a stop arriving with the initial answer retains stop precedence rather than a decline', async () => {
    const r = await runCaller({ files: CLEAN, replies: [DECLINE], abortAfterAnswer: true });
    expect(r.initialTerminalDecline).toBe(false);
    expect(r.runOne).not.toHaveBeenCalled();
    expect(r.diagnostics.issues.map((i: { code: string }) => i.code)).toContain('SIMPLE_BUILD_STOPPED');
    expect(r.writeFile).not.toHaveBeenCalled();
  });
});

describe('the real final outcome branch distinguishes a decline from interruptions and crashes', () => {
  it('an abort after terminal settlement cannot be recorded as an uninterrupted decline', async () => {
    const r = await runCaller({ files: CLEAN, replies: [DECLINE], abortAfterSettlement: true });
    expect(r.initialTerminalDecline).toBe(true);
    expect(outcomeCodeOf(r.diagnostics.issues)).toBe('OUTCOME_UNEXPLAINED');
    expect(r.diagnostics.issues.some((i: { code: string }) => i.code === 'OUTCOME_INITIAL_DECLINED')).toBe(false);
    expect(r.finalize).toHaveBeenCalledTimes(1);
    // This slice deliberately supplies no earlier abort-outcome backfill: the normal-settle branch
    // must retain its conservative existing fallback rather than invent a decline for an abort.
  });

  it('an already-recorded terminal outcome remains authoritative', async () => {
    const r = await runCaller({ files: CLEAN, replies: [DECLINE], priorOutcome: 'OUTCOME_USER_STOPPED' });
    expect(r.initialTerminalDecline).toBe(true);
    expect(outcomeCodeOf(r.diagnostics.issues)).toBe('OUTCOME_USER_STOPPED');
    expect(r.diagnostics.rootCause).toBe('Synthetic existing terminal outcome.');
    expect(r.diagnostics.issues.some((i: { code: string }) => i.code === 'OUTCOME_INITIAL_DECLINED')).toBe(false);
  });

  it.each([
    { name: 'generic exception', error: new Error('Synthetic finalization crash.'), code: 'BUILD_EXCEPTION', outcome: 'OUTCOME_FINALIZATION_FAILED' },
    { name: 'sandbox recovery failure', error: new SandboxRecoveryUnavailableError(), code: 'SANDBOX_RECOVERY_UNAVAILABLE', outcome: 'OUTCOME_SANDBOX_UNAVAILABLE' },
  ])('$name after the recorded initial outcome must supersede that decline', async ({ error, code, outcome }) => {
    const { report, finalize } = await runCrash('OUTCOME_INITIAL_DECLINED', error);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SIMPLE_BUILD_DECLINED', severity: 'info', autoResolved: true }),
      expect.objectContaining({ code: 'OUTCOME_INITIAL_DECLINED', severity: 'info', autoResolved: true, message: 'Synthetic earlier terminal outcome.' }),
      expect.objectContaining({ code, severity: 'error', autoResolved: false }),
      expect.objectContaining({ code: outcome, severity: 'error', autoResolved: false, message: buildExceptionDetails(error).summary }),
    ]));
    expect(outcomeCodeOf(report.issues)).toBe(outcome);
    expect(report.rootCause).toContain(error.message);
    expect(report.rootCause).not.toBe('Synthetic earlier terminal outcome.');
    expect(report.summary).toContain(error.message);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it.each([new Error('Synthetic finalization crash.'), new SandboxRecoveryUnavailableError()])('a crash preserves an unrelated pre-existing outcome', async (error) => {
    const { report } = await runCrash('OUTCOME_PREVIEW_FAILED', error);
    expect(outcomeCodeOf(report.issues)).toBe('OUTCOME_PREVIEW_FAILED');
    expect(report.rootCause).toBe('Synthetic earlier terminal outcome.');
  });

  it('the actual crash diagnostic path still records the exception and unexplained outcome', async () => {
    const { report, finalize } = await runCrash();
    expect(report.issues.map((i: { code: string }) => i.code)).toContain('BUILD_EXCEPTION');
    expect(outcomeCodeOf(report.issues)).toBe('OUTCOME_UNEXPLAINED');
    expect(report.issues.map((i: { code: string }) => i.code)).not.toContain('OUTCOME_INITIAL_DECLINED');
    expect(report.summary).toContain('Synthetic orchestration crash');
    expect(finalize).toHaveBeenCalledTimes(1);
  });
});

describe('each new caller admission has an independent observable reversion witness', () => {
  it.each([
    { mutation: 'simple-handoff', files: CLEAN, replies: [DECLINE], calls: 1 },
    { mutation: 'one-shot-handoff', files: CLEAN, replies: [SMALL_PLAN, DECLINE], calls: 2 },
    { mutation: 'integrity', files: INTEGRITY, replies: [DECLINE], calls: 1 },
    { mutation: 'finishing', files: E2E, replies: [DECLINE], calls: 1 },
    { mutation: 'cost-narration', files: CLEAN, replies: [DECLINE], calls: 1 },
    { mutation: 'diagnostic-outcome', files: CLEAN, replies: [DECLINE], calls: 1 },
  ] as const)('$mutation alone breaks the terminal-effects invariant', async ({ mutation, files, replies, calls }) => {
    enableWriters();
    const r = await runCaller({ files, replies: [...replies], mutation });
    expect(() => assertTerminal(r, files, calls)).toThrow();
    if (mutation === 'integrity' || mutation === 'finishing') expect(r.writeFile.mock.calls.length).toBeGreaterThan(0);
    if (mutation === 'cost-narration') expect(r.events.some((e: Record<string, any>) => /Try again with a simpler prompt/.test(e.text ?? ''))).toBe(true);
    if (mutation === 'simple-handoff') expect(r.runOne).toHaveBeenCalledTimes(1);
    if (mutation === 'diagnostic-outcome') expect(outcomeCodeOf(r.diagnostics.issues)).toBe('OUTCOME_UNEXPLAINED');
    if (mutation === 'one-shot-handoff') expect(r.fullRunner).toHaveBeenCalledTimes(1);
  });
});
