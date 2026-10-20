/**
 * Q-970 (autopsy 303e8a6f, 2026-10-13) — A BUILD IS NAMED BY ITS LADDER, NOT BY CLAUDE.
 *
 * THE DEFECT. Report 303e8a6f was a Weak build (no Claude but the Haiku backstop) whose prompt scored 50,
 * which the analyser files in the old "sonnet" band. `selectBuildModel` — written before the three-ladder
 * rewrite of 2026-09-14 — answered `claude-sonnet-4-6` for it, and the route bound that answer to the one
 * variable every record writer read: the failed and stopped model-call rows, the report's planned model,
 * the prompt audit, the decision trace, the debug tag, the manifest's last fallback and the pre-call
 * context warning. Sonnet is a model a Weak build can never call. The value routed nothing (every rung pins
 * its own model), so the bug was never in what ran — only in what every record SAID ran.
 *
 * THE CLASS (one sentence). A record that names the model a build planned or ran took it from the pre-ladder
 * Claude vocabulary (selectBuildModel / resolveModel / sonnetModel / fastBuildModel) instead of from the
 * tier's own constructed chain, so every tier was filed under a Claude model its ladder does not open on.
 *
 * WHY IT KEPT COMING BACK. It was "fixed" six times, one reader at a time — the llmCall success label
 * (2026-07-17), the manifest (2026-07-19, then 120eb52f), the report headline (honestModelLabel,
 * 2026-07-27), the fast-lane default (healedVerdictStands) and plannedModel (2b0a3ed5) — and the source
 * variable survived each one. This suite fixes the source (the chain carries its own plan,
 * `TurnRunner.plannedModel`) and §6 is the census that fails when a NEW reader of the old vocabulary appears.
 *
 * Nothing here may change what a provider receives: the keep-green suites (tierChainFidelity,
 * OpenAiToolRunner, MultiProviderTurnRunner, agentv3 selectBuildModel, buildReportWiring, autopsy2b0a3ed5,
 * BuildManifest) are the evidence for that, and §6c asserts the request value still reaches `runTurn`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  buildTurnRunner, selectBuildModel, plannerCallLabel, fastLaneProviderLabel, fastLaneCallIdentity,
  buildChainOpensPastOpener, strongStartNotice,
} from '../src/server/routes/agentv3';
import { TIER_LADDERS } from '../src/server/AgentV3/tierLadder';
import { sonnetModel, haikuModel, opusModel, claudeRungModelId } from '../src/server/AgentV3/models';
import {
  plannedModelOf, buildRecordModel, firstRungLabel, describeRunnerChain, chainProviders,
  NO_ENGINE_CONFIGURED, NO_MODEL_CALL_MADE, type ChainRung,
} from '../src/server/AgentV3/runnerChainSummary';
import { makeMultiProviderTurnRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import type { TurnRunner, TurnResult } from '../src/server/AgentV3/ClaudeClient';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { withStopSignal } from '../src/server/AgentV3/stopSignal';
import { withAnswerNotDeliberation } from '../src/server/AgentV3/answerNotDeliberate';
import { contextUsage, tightestContextModel } from '../src/server/AgentV3/TokenEstimator';
import { hasProviderLeak } from '../src/server/lib/providerRedaction';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

// ── env: every ladder key set, as in tierChainFidelity.test.ts ────────────────────────────────────────
const ENV_KEYS = [
  'AGENTV3_CHEAP_FLOOR', 'GLM_API_KEY', 'KIMI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'NEMOTRON_API_KEY', 'AGENTV3_NEMOTRON', 'NEMOTRON_BASE_URL', 'NEMOTRON_ULTRA_MODEL', 'NEMOTRON_SUPER_MODEL',
  'AGENTV3_LADDER_WEAK', 'AGENTV3_LADDER_NORMAL', 'AGENTV3_LADDER_STRONG', 'AGENTV3_DISABLE_HAIKU_BACKSTOP',
  'AGENTV3_SONNET_MODEL', 'AGENTV3_HAIKU_MODEL', 'AGENTV3_OPUS_MODEL', 'AGENTV3_WEAK_PLAN_HAIKU',
] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.GLM_API_KEY = 'test-glm';
  process.env.KIMI_API_KEY = 'test-kimi';
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.NEMOTRON_API_KEY = 'test-nemotron';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
});

const CLAUDE_ID = /sonnet|opus/i;

// ── a minimal sandbox + AgentRunner harness (same shape as AgentRunner.test.ts) ──────────────────────
class NullActuator implements ActuatorPort {
  async readFile(): Promise<string> { throw new Error('ENOENT'); }
  async writeFile(): Promise<void> { /* nothing */ }
  async listFiles(): Promise<string[]> { return []; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
type LlmRow = { model: string; ok: boolean; error?: string };
function runnerOn(client: TurnRunner, rows: LlmRow[], signal?: AbortSignal): AgentRunner {
  const stream = new AgentEventStream();
  const state = new WorkspaceState(stream);
  const dispatcher = new ToolDispatcher(new NullActuator(), 'ws-q970', state, stream);
  return new AgentRunner({
    client,
    dispatcher,
    state,
    events: stream,
    // The route's REAL value on report 303e8a6f's input: Weak, start tier 'sonnet' (score 50).
    model: selectBuildModel('sonnet', 'weak'),
    system: 'You are the Architect.',
    tools: defaultToolCatalog(),
    ...(signal ? { signal } : {}),
    onLlmCall: ((c: LlmRow) => rows.push({ model: c.model, ok: c.ok, error: c.error })) as never,
  });
}
const failing = (msg: string): TurnRunner => ({ runTurn: async () => { throw new Error(msg); } });
const answering = (model?: string): TurnRunner => ({
  runTurn: async (): Promise<TurnResult> => ({
    text: 'done', toolUses: [], stopReason: 'end_turn',
    usage: { inputTokens: 5, outputTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    rawContent: [{ type: 'text', text: 'done' }],
    ...(model ? { model } : {}),
  }),
});
const hanging: TurnRunner = { runTurn: () => new Promise<TurnResult>(() => { /* never answers */ }) };

/** A Weak-shaped chain: the cheap opener, then the Haiku backstop — the rungs report 303e8a6f's ladder starts and ends on. */
function weakChain(first: TurnRunner, last: TurnRunner = failing('haiku also down')) {
  return makeMultiProviderTurnRunner([
    { name: 'GLM', modelId: 'glm-4.7-flashx', runner: first },
    { name: 'CLAUDE_HAIKU', modelId: haikuModel(), runner: last },
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('§1 · the chain says what it plans to call — on the real 303e8a6f input and on every tier', () => {
  it('🔴 303e8a6f: the request value is Sonnet, the chain the build really runs opens on glm-4.7-flashx', () => {
    // The old answer, documented: this is the value that was named in every record.
    expect(selectBuildModel('sonnet', 'weak')).toBe(sonnetModel());
    const client = buildTurnRunner({ tier: 'weak', noClaude: true });
    expect(client.plannedModel).toBe('glm-4.7-flashx');
    expect(client.plannedModel).not.toMatch(CLAUDE_ID);
  });

  it('every tier plans its own ladder\'s first rung', () => {
    expect(buildTurnRunner({ tier: 'weak', noClaude: true }).plannedModel).toBe(TIER_LADDERS.weak[0].model);
    expect(buildTurnRunner({ tier: 'off' }).plannedModel).toBe(TIER_LADDERS.off[0].model);
    expect(buildTurnRunner({ tier: 'mini' }).plannedModel).toBe(TIER_LADDERS.mini[0].model);
    expect(TIER_LADDERS.off[0].model).toBe('glm-4.7-flashx');
    expect(TIER_LADDERS.mini[0].model).toBe('glm-5.3');
  });

  it('a heal and a complex build plan the rung they really open on', () => {
    expect(buildTurnRunner({ tier: 'weak', noClaude: true, heal: true }).plannedModel).toBe('kimi-k2.7-code');
    expect(buildTurnRunner({ tier: 'weak', noClaude: true, complex: true }).plannedModel).toBe('kimi-k2.7-code');
  });

  it('🔒 a Weak build never plans a Sonnet or Opus model, whatever the options', () => {
    const variants = [{}, { heal: true }, { complex: true }, { plan: true }, { afterLeadRung: true }, { fromProvider: 'CLAUDE' as const }];
    for (const v of variants) {
      expect(buildTurnRunner({ tier: 'weak', noClaude: true, ...v }).plannedModel, JSON.stringify(v)).not.toMatch(CLAUDE_ID);
    }
  });

  it('the plan survives the route\'s runner wrappers (stop signal, answer-not-deliberation)', () => {
    const wrapped = withAnswerNotDeliberation(withStopSignal(buildTurnRunner({ tier: 'weak', noClaude: true }), new AbortController().signal));
    expect(wrapped.plannedModel).toBe('glm-4.7-flashx');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('§2 · AgentRunner records the chain\'s plan, never the request\'s Claude id', () => {
  it('🔴 a failed call on a Weak chain is filed under glm-4.7-flashx, not claude-sonnet-4-6', async () => {
    const rows: LlmRow[] = [];
    await runnerOn(weakChain(failing('glm 503')), rows).run('build an AI image generator').catch(() => undefined);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.ok).toBe(false);
      expect(r.model).toBe('glm-4.7-flashx');
      expect(r.model).not.toMatch(CLAUDE_ID);
    }
  });

  it('🔴 a STOPPED call (the 303e8a6f user Stop) is filed under the chain\'s plan too', async () => {
    const rows: LlmRow[] = [];
    const ac = new AbortController();
    const run = runnerOn(weakChain(hanging), rows, ac.signal).run('build an AI image generator');
    setTimeout(() => ac.abort(), 30);
    await run.catch(() => undefined);
    expect(rows.length).toBe(1);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].model).toBe('glm-4.7-flashx');
  });

  it('a rung that answers without naming its model falls back to the plan, not to Sonnet', async () => {
    const rows: LlmRow[] = [];
    await runnerOn(weakChain(answering()), rows).run('hi');
    expect(rows[0]).toMatchObject({ ok: true, model: 'glm-4.7-flashx' });
  });

  it('what ANSWERED still wins over the plan', async () => {
    const rows: LlmRow[] = [];
    await runnerOn(weakChain(answering('glm-4.7-flashx-0412')), rows).run('hi');
    expect(rows[0].model).toBe('glm-4.7-flashx-0412');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('§3 · a tier with no runnable rung names no model at all', () => {
  it('🔴 every key missing ⇒ "none (no engine configured)", and the failed call says so — not Sonnet', async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const client = buildTurnRunner({ tier: 'off' });
    expect(client.plannedModel).toBe(NO_ENGINE_CONFIGURED);
    const rows: LlmRow[] = [];
    await runnerOn(client, rows).run('build').catch(() => undefined);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.model).toBe(NO_ENGINE_CONFIGURED);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('§4 · a Claude rung is named by the id it pins — one function for the pin and the record', () => {
  it('🔴 a Weak planner / fast-lane call that ended on the HAIKU rung is Haiku, not the Sonnet default', () => {
    expect(plannerCallLabel('CLAUDE_HAIKU', fastLaneProviderLabel, sonnetModel()).model).toBe(haikuModel());
    expect(fastLaneCallIdentity(true, 'CLAUDE_HAIKU', sonnetModel()).model).toBe(haikuModel());
  });

  it('the Sonnet and Opus rungs keep their own ids (the existing pins still hold)', () => {
    expect(plannerCallLabel('CLAUDE', fastLaneProviderLabel, sonnetModel()).model).toBe(sonnetModel());
    expect(fastLaneCallIdentity(true, 'CLAUDE', sonnetModel()).model).toBe(sonnetModel());
    expect(fastLaneCallIdentity(true, 'CLAUDE_OPUS', sonnetModel()).model).toBe(opusModel());
    expect(claudeRungModelId('GLM')).toBeUndefined();
  });

  it('🔒 an env-moved Haiku id moves the pinned rung AND the record together', () => {
    process.env.AGENTV3_HAIKU_MODEL = 'claude-haiku-q970-test';
    let chain: ChainRung[] = [];
    buildTurnRunner({ tier: 'weak', noClaude: true, onChain: (c) => { chain = c; } });
    expect(chain.find((r) => r.name === 'CLAUDE_HAIKU')?.modelId).toBe('claude-haiku-q970-test');
    expect(plannerCallLabel('CLAUDE_HAIKU', fastLaneProviderLabel, sonnetModel()).model).toBe('claude-haiku-q970-test');
  });

  it('🔒 ladderRunners pins every Claude rung through claudeRungModelId', () => {
    const route = codeOnlyText(read('src/server/routes/agentv3.ts'));
    const ladder = route.slice(route.indexOf('export function ladderRunners('), route.indexOf('function unavailableTierRunner('));
    for (const p of ['CLAUDE', 'CLAUDE_HAIKU', 'CLAUDE_OPUS']) {
      expect(ladder).toContain(`forceModelRunner(new ClaudeClient(undefined, buildRetry), claudeRungModelId('${p}')), modelId: claudeRungModelId('${p}')`);
    }
    expect(ladder).not.toMatch(/\b(?:sonnetModel|haikuModel|opusModel)\(\)/);
  });

  it('the three aux planners plan through claudeRungModelId, never fastBuildModel()', () => {
    const route = codeOnlyText(read('src/server/routes/agentv3.ts'));
    for (const v of ['rmProvider', 'bpProvider', 'ppProvider']) {
      expect(route).toContain(`planned: claudeRungModelId(${v}) ?? null, family: ${v}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('§5 · the pure readers', () => {
  it('a Stop never claims that the engine was not asked to work', () => {
    const route = codeOnlyText(read('src/server/routes/agentv3.ts'));
    expect(route).not.toContain('so no engine was ever asked to build anything');
    expect(route).toContain('A stopped build does not establish a capability limit');
  });

  it('buildRecordModel: delivered → delivered family → "no call was made" → planned → unknown', () => {
    expect(buildRecordModel({ delivered: 'kimi-k2.7-code', deliveredFamily: 'KIMI', planned: 'glm-4.7-flashx', anyCallMade: true })).toBe('kimi-k2.7-code');
    expect(buildRecordModel({ delivered: '  ', deliveredFamily: 'KIMI', planned: 'glm-4.7-flashx', anyCallMade: true })).toBe('KIMI');
    expect(buildRecordModel({ planned: 'glm-4.7-flashx', anyCallMade: true })).toBe('glm-4.7-flashx');
    expect(buildRecordModel({ anyCallMade: true })).toBe('unknown');
    // A build no model touched does not name a model — not even the one it planned (autopsy 120eb52f).
    expect(buildRecordModel({ planned: 'glm-4.7-flashx', anyCallMade: false })).toBe(NO_MODEL_CALL_MADE);
    expect(NO_MODEL_CALL_MADE).toBe('none (no completed model response recorded)');
    // 2e06d8bd attempted a 113 s call, then cancelled it before any response. An empty ledger
    // cannot truthfully say that no call was made.
    expect(buildRecordModel({ planned: 'glm-4.7-flashx', anyCallMade: false })).not.toContain('no model call was made');
  });

  it('plannedModelOf: the first rung\'s id, else its family; a pool rung reports its model', () => {
    expect(plannedModelOf([{ name: 'GLM#2', reportAs: 'GLM', modelId: 'glm-5.3' }])).toBe('glm-5.3');
    expect(plannedModelOf([{ name: 'CLAUDE_HAIKU' }])).toBe('CLAUDE_HAIKU');
    expect(plannedModelOf([{ name: '  ' }, { name: 'KIMI', modelId: ' kimi-k3 ' }])).toBe('kimi-k3');
    expect(plannedModelOf([])).toBeUndefined();
  });

  it('firstRungLabel is unchanged by the refactor (autopsy 2b0a3ed5 reads it)', () => {
    const chain: ChainRung[] = [{ name: 'GLM', modelId: 'glm-4.7-flashx' }, { name: 'CLAUDE_HAIKU', modelId: haikuModel() }];
    expect(firstRungLabel(chain)).toBe('GLM(glm-4.7-flashx)');
    expect(firstRungLabel([{ name: 'GLM#2', reportAs: 'GLM' }])).toBe('GLM');
    expect(firstRungLabel([])).toBeUndefined();
  });

  it('🔴 the pre-call context warning is measured against the tightest window the prompt may land on', () => {
    // On a Weak build a ~110k-token prompt is 86% of GLM's 128k window. Against the Sonnet id the route
    // used to pass, it read as 55% and said nothing.
    const tightest = tightestContextModel(TIER_LADDERS.weak.map((r) => r.model));
    expect(tightest).toMatch(/^glm-/);
    expect(contextUsage(110_000, tightest).nearLimit).toBe(true);
    expect(contextUsage(110_000, sonnetModel()).nearLimit).toBe(false);
    // A complex build opens on Kimi (256k) with GLM behind it — the tightest is still GLM, never the opener's.
    expect(tightestContextModel(TIER_LADDERS.weak.slice(1).map((r) => r.model))).toMatch(/^glm-/);
    expect(tightestContextModel([])).toBeUndefined();
    const route = codeOnlyText(read('src/server/routes/agentv3.ts'));
    expect(route).toContain('contextUsage(estTokens, tightestContextModel(tierLadder(powerLevelReqEffective).rungs.map((r) => r.model)) ?? \'\')');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// §6 · THE CLASS CENSUS. A source guard on the AST (comments and strings cannot fool it) that fails when a
// NEW reader of the pre-ladder Claude vocabulary appears where a record is written.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The source with every COMMENT removed and everything else byte-for-byte — for the few plain-text pins in
 * this file, so a doc block that mentions a call can never satisfy an assertion about the call. Comments are
 * found as the parser's trivia (not by regex), so a `/*` inside a string or a glob cannot swallow code.
 */
const codeOnlyCache = new Map<string, string>();
function codeOnlyText(src: string): string {
  const hit = codeOnlyCache.get(src);
  if (hit !== undefined) return hit;
  const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cut = new Map<number, number>();
  const visit = (n: ts.Node): void => {
    for (const r of ts.getLeadingCommentRanges(src, n.getFullStart()) ?? []) cut.set(r.pos, r.end);
    for (const r of ts.getTrailingCommentRanges(src, n.getEnd()) ?? []) cut.set(r.pos, r.end);
    for (const c of n.getChildren(sf)) visit(c);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of [...cut.entries()].sort((a, b) => a[0] - b[0])) {
    if (pos < at) continue;
    out += src.slice(at, pos);
    at = end;
  }
  out += src.slice(at);
  codeOnlyCache.set(src, out);
  return out;
}

const LEGACY_HELPERS = new Set(['sonnetModel', 'opusModel', 'haikuModel', 'opusNormalModel', 'fastBuildModel', 'resolveModel', 'selectBuildModel']);

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function lineOf(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}
function walk(n: ts.Node, visit: (n: ts.Node) => void): void {
  visit(n);
  ts.forEachChild(n, (c) => walk(c, visit));
}
/** Every identifier REFERENCED under `n` — not a property name, not the member of a `.x` access. */
function referencedNames(n: ts.Node): string[] {
  const out: string[] = [];
  walk(n, (c) => {
    if (!ts.isIdentifier(c)) return;
    const p = c.parent;
    if (p && ts.isPropertyAccessExpression(p) && p.name === c) return;
    if (p && ts.isPropertyAssignment(p) && p.name === c) return;
    if (p && (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p)) && p.name === c) return;
    out.push(c.text); // a shorthand `{ model }` IS a reference, and is kept
  });
  return out;
}
function calleeText(sf: ts.SourceFile, call: ts.CallExpression | ts.NewExpression): string {
  return call.expression.getText(sf).replace(/\?\./g, '.');
}

const ROUTE_WRITERS: Array<(callee: string) => boolean> = [
  (c) => c.endsWith('.recordLlmCall'),
  (c) => c.endsWith('.setProviderChain'),
  (c) => c === 'decisionTrace.record',
  (c) => ['buildPromptAudit', 'providerDebugTag', 'buildBuildManifest', 'answeringModel', 'contextUsage'].includes(c),
];

describe('§6 · class census over the route and AgentRunner', () => {
  const route = parse('src/server/routes/agentv3.ts');

  it('🔒 (a) no record writer in the route reads a pre-ladder Claude helper or the request value', () => {
    const offenders: string[] = [];
    const seen: Record<string, number> = {};
    walk(route, (n) => {
      if (!ts.isCallExpression(n) && !ts.isNewExpression(n)) return;
      const callee = calleeText(route, n);
      const isWriter = ts.isNewExpression(n) ? callee === 'BuildDiagnostics' : ROUTE_WRITERS.some((m) => m(callee));
      if (!isWriter) return;
      seen[callee] = (seen[callee] ?? 0) + 1;
      for (const a of n.arguments ?? []) {
        for (const name of referencedNames(a)) {
          if (LEGACY_HELPERS.has(name) || name === 'requestModel') offenders.push(`${callee} @${lineOf(route, n)} reads ${name}`);
        }
      }
    });
    expect(offenders).toEqual([]);
    // Not vacuous: the writers this census exists for are all present.
    expect(seen['buildDiag.recordLlmCall']).toBeGreaterThanOrEqual(6);
    expect(seen['buildDiag.setProviderChain']).toBeGreaterThanOrEqual(1);
    expect(seen['decisionTrace.record']).toBeGreaterThanOrEqual(2);
    expect(seen.buildPromptAudit).toBe(1);
    expect(seen.providerDebugTag).toBeGreaterThanOrEqual(2);
    expect(seen.buildBuildManifest).toBe(1);
    expect(seen.answeringModel).toBeGreaterThanOrEqual(5);
    expect(seen.contextUsage).toBeGreaterThanOrEqual(1);
    expect(seen.BuildDiagnostics).toBe(1);
  });

  it('🔒 (a) the report is built without a model — its plan comes from the chain', () => {
    let props: string[] | null = null;
    walk(route, (n) => {
      if (ts.isNewExpression(n) && calleeText(route, n) === 'BuildDiagnostics') {
        const arg = n.arguments?.[0];
        if (arg && ts.isObjectLiteralExpression(arg)) props = arg.properties.map((p) => p.name?.getText(route) ?? '');
      }
    });
    expect(props).not.toBeNull();
    expect(props).not.toContain('model');
  });

  it('🔒 (a) AgentRunner\'s record sites read the chain\'s plan, never the bare request `model`', () => {
    const ar = parse('src/server/AgentV3/AgentRunner.ts');
    const offenders: string[] = [];
    let sites = 0;
    walk(ar, (n) => {
      if (!ts.isCallExpression(n)) return;
      const callee = calleeText(ar, n);
      // `recordOffLoopCall` (#3736) is a record site too: it forwards its `model` straight into onLlmCall, so
      // the thing that must be the chain's plan is what its CALLERS pass. Counting only the forwarder let two
      // callers keep naming the bare request id (found merging #3700 with #3736, 2026-10-14).
      if (!callee.endsWith('.onLlmCall') && callee !== 'describeContextUsage' && callee !== 'recordOffLoopCall') return;
      sites += 1;
      for (const a of n.arguments) for (const name of referencedNames(a)) {
        if (name === 'model' || LEGACY_HELPERS.has(name)) offenders.push(`${callee} @${lineOf(ar, n)} reads ${name}`);
      }
    });
    expect(offenders).toEqual([]);
    expect(sites).toBe(7); // stop row, failure row, success row, context meter, the off-loop recorder + its 2 callers (success, failure)
  });

  it('🔒 (b) every remaining Claude-helper call in the route has a known, non-record role', () => {
    const roles: Record<string, number> = {};
    const unclassified: string[] = [];
    walk(route, (n) => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || !LEGACY_HELPERS.has(n.expression.text)) return;
      const role = roleOf(route, n);
      if (role === 'UNCLASSIFIED') unclassified.push(`${n.expression.text} @${lineOf(route, n)}`);
      const key = `${role}:${n.expression.text}`;
      roles[key] = (roles[key] ?? 0) + 1;
    });
    // A new call of one of these helpers that is not a request parameter, the legacy selector itself, the
    // judge, or an admin-only probe fails here until a reviewer says what it is. That is the whole guard.
    expect(unclassified).toEqual([]);
    // The non-request roles are pinned exactly — each is a place a Claude id may legitimately be named.
    const pinned = Object.fromEntries(Object.entries(roles).filter(([k]) => !k.startsWith('request-param:')));
    expect(pinned).toEqual({
      'legacy-selector:sonnetModel': 3, 'legacy-selector:opusModel': 1, 'legacy-selector:haikuModel': 1,
      'judge:sonnetModel': 1,
      'admin-diag:resolveModel': 4,
      // The `plannedClaudeModel` argument of plannerCallLabel: reached only when the answering name is not a
      // Claude rung, which claudeRungModelId answers first (see §4).
      'planned-claude-fallback:fastBuildModel': 2,
    });
    // Request parameters are what a provider receives and every rung overrides — never a record.
    expect(roles['request-param:selectBuildModel']).toBe(1);
  });

  it('🔒 (b) the request value has exactly three readers, all of them request parameters', () => {
    const readers: string[] = [];
    walk(route, (n) => {
      if (!ts.isIdentifier(n) || n.text !== 'requestModel') return;
      const p = n.parent;
      if (ts.isVariableDeclaration(p) && p.name === n) return;
      let up: ts.Node = n;
      while (ts.isConditionalExpression(up.parent) || ts.isParenthesizedExpression(up.parent)) up = up.parent;
      const prop = up.parent;
      readers.push(prop && ts.isPropertyAssignment(prop) && prop.name.getText(route) === 'model' ? 'model-param' : `OTHER @${lineOf(route, n)}`);
    });
    expect(readers).toEqual(['model-param', 'model-param', 'model-param']); // sub-agent deps, main runner, plan runner
  });

  it('🔒 (c) every AgentRunner in the route runs on a chain that carries its plan', () => {
    const clients: string[] = [];
    walk(route, (n) => {
      if (!ts.isNewExpression(n) || calleeText(route, n) !== 'AgentRunner') return;
      const arg = n.arguments?.[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) { clients.push(`NON-LITERAL @${lineOf(route, n)}`); return; }
      const prop = arg.properties.find((p) => p.name?.getText(route) === 'client');
      if (!prop) { clients.push(`NO CLIENT @${lineOf(route, n)}`); return; }
      clients.push(ts.isShorthandPropertyAssignment(prop) ? 'client' : ts.isPropertyAssignment(prop) ? prop.initializer.getText(route).replace(/\s+/g, ' ') : 'OTHER');
    });
    expect(clients.length).toBe(18);
    for (const c of clients) expect(c).toMatch(/^(?:buildTurnRunner\(|client$|planGrok \?\? client$)/);
    // …and every sub-agent runs on the main client (SubAgent.ts uses deps.client).
    expect(codeOnlyText(read('src/server/routes/agentv3.ts'))).toContain('client, actuator, workspaceId, state, events, model: requestModel, onlyOpus,');
    expect(codeOnlyText(read('src/server/AgentV3/SubAgent.ts'))).toContain('client: deps.client,');
  });

  it('🔒 the request value still reaches the provider call untouched (routing unchanged)', () => {
    const ar = codeOnlyText(read('src/server/AgentV3/AgentRunner.ts'));
    // Both runTurn calls still send the request's `model` — the rename and the records changed nothing sent.
    expect(ar.match(/client\.runTurn\(\{\s*model,/g)?.length).toBe(2);
  });
});

/** The role of one Claude-helper call. Anything that is not structurally one of these is UNCLASSIFIED. */
function roleOf(sf: ts.SourceFile, call: ts.CallExpression): string {
  let fn: ts.Node | undefined = call.parent;
  while (fn && !(ts.isFunctionDeclaration(fn) && fn.name)) fn = fn.parent;
  const fnName = fn && ts.isFunctionDeclaration(fn) ? fn.name!.text : '';
  if (fnName === 'selectBuildModel') return 'legacy-selector';
  if (fnName === 'selectReviewJudge') return 'judge';
  if (fnName === 'agentV3KeyDiag') return 'admin-diag';
  // Inside a route registered behind `requireAdmin`.
  for (let p: ts.Node | undefined = call.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && /^app\.(?:get|post|put|delete)$/.test(p.expression.getText(sf))
      && p.arguments.some((a) => ts.isIdentifier(a) && a.text === 'requireAdmin')) return 'admin-diag';
  }
  let up: ts.Node = call;
  while (ts.isConditionalExpression(up.parent) || ts.isParenthesizedExpression(up.parent)) up = up.parent;
  const p = up.parent;
  if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'model' && ts.isObjectLiteralExpression(p.parent)) {
    const holder = p.parent.parent;
    if (ts.isCallExpression(holder) && ts.isPropertyAccessExpression(holder.expression) && holder.expression.name.text === 'runTurn') return 'request-param';
    if (ts.isNewExpression(holder) && holder.expression.getText(sf) === 'AgentRunner') return 'request-param';
  }
  // `const requestModel = selectBuildModel(…)` and the fast lane's `const fbModel = fastBuildModel()` — both
  // handed only to `runTurn({ model })` / `new AgentRunner({ model })`, and fbModel to fastLaneCallIdentity's
  // Claude-default parameter, which claudeRungModelId answers first.
  if (ts.isVariableDeclaration(p) && ['requestModel', 'fbModel'].includes(p.name.getText(sf))) return 'request-param';
  if (ts.isCallExpression(p) && p.expression.getText(sf) === 'plannerCallLabel') return 'planned-claude-fallback';
  return 'UNCLASSIFIED';
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('§7 · the report: plannedModel comes from the chain, and a provider-less failure says it is a label', () => {
  it('🔴 a report built without meta.model names the Weak chain\'s first rung, never a Claude id', () => {
    const d = new BuildDiagnostics({ buildId: 'q970', prompt: 'Build an AI image generator', framework: 'vite-react' });
    expect(d.report().plannedModel).toBeUndefined(); // honestly absent before the chain exists
    let chain: ChainRung[] = [];
    buildTurnRunner({ tier: 'weak', noClaude: true, onChain: (c) => { chain = c; } });
    d.setProviderChain(describeRunnerChain(chain), chainProviders(chain), firstRungLabel(chain));
    const r = d.report();
    expect(r.plannedModel).toBe('GLM(glm-4.7-flashx)');
    expect(String(r.model)).not.toMatch(CLAUDE_ID);
  });

  it('🔴 a failed call with no provider is marked as the PLANNED label, not a provider that ran', () => {
    const d = new BuildDiagnostics({ buildId: 'q970' });
    d.recordLlmCall({ model: 'glm-4.7-flashx', promptChars: 10, responseChars: 0, finishReason: null, toolCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 1200, ok: false, error: 'All NavBharatAI Pro providers failed (GLM → CLAUDE_HAIKU). Last error: 503' });
    const issue = d.report().issues.find((i) => i.code === 'LLM_CALL_FAILED');
    expect(issue?.detail).toBe('planned model=glm-4.7-flashx — the label, not a provider that ran');
    // A row that DOES name its provider keeps saying so.
    const d2 = new BuildDiagnostics({ buildId: 'q970b' });
    d2.recordLlmCall({ model: 'kimi-k2.7-code', provider: 'kimi', promptChars: 10, responseChars: 0, finishReason: null, toolCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 900, ok: false, error: 'boom' });
    expect(d2.report().issues.find((i) => i.code === 'LLM_CALL_FAILED')?.detail).toBe('provider=kimi');
  });

  it('🔒 the four build-level records share one value', () => {
    const route = codeOnlyText(read('src/server/routes/agentv3.ts'));
    expect(route).toContain('const buildModelForRecord = buildRecordModel({');
    expect(route).toContain('model: buildModelForRecord,'); // prompt audit + manifest
    expect(route.match(/model: buildModelForRecord,/g)?.length).toBe(2);
    expect(route).toContain('providerDebugTag(buildModelForRecord)');
    expect(route).toContain('${deliveredViaProvider ?? buildModelForRecord}');
    expect(route).not.toMatch(/providerDebugTag\(`Claude/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
describe('§8 · the "stronger engine" line is said only when it is true', () => {
  it('🔴 an import whose chain opens on the cheap rung is told nothing about engines', () => {
    expect(strongStartNotice({ largeProject: false, files: 0, isImport: true, opensPastOpener: false })).toBeNull();
    expect(strongStartNotice({ largeProject: true, files: 240, isImport: false, opensPastOpener: false })).toBeNull();
  });

  it('a large project that really opens past the opener gets a vendor-free line', () => {
    const line = strongStartNotice({ largeProject: true, files: 240, isImport: false, opensPastOpener: true });
    expect(line).toContain('240 files');
    expect(line).toMatch(/stronger engine/);
    expect(hasProviderLeak(String(line))).toBe(false);
    const imp = strongStartNotice({ largeProject: false, files: 0, isImport: true, opensPastOpener: true });
    expect(hasProviderLeak(String(imp))).toBe(false);
    expect(strongStartNotice({ largeProject: false, files: 0, isImport: false, opensPastOpener: true })).toBeNull();
  });

  it('🔒 the predicate agrees with the CONSTRUCTED chain on every tier, complex or not', () => {
    for (const tier of ['weak', 'off', 'mini'] as const) {
      const firstOf = (complex: boolean): string | undefined => {
        let chain: ChainRung[] = [];
        buildTurnRunner({ tier, complex, noClaude: tier === 'weak', onChain: (c) => { chain = c; } });
        return chain[0]?.modelId;
      };
      const opensPast = firstOf(true) !== TIER_LADDERS[tier][0].model;
      expect(buildChainOpensPastOpener(tier, true), tier).toBe(opensPast);
      expect(buildChainOpensPastOpener(tier, false), tier).toBe(false);
      expect(firstOf(false)).toBe(TIER_LADDERS[tier][0].model);
    }
    // Weak and Normal open on a cheap flash rung; Strong has none to skip.
    expect(buildChainOpensPastOpener('weak', true)).toBe(true);
    expect(buildChainOpensPastOpener('mini', true)).toBe(false);
  });

  it('🔒 the route emits the line only through strongStartNotice — the old unconditional claim is gone', () => {
    const route = codeOnlyText(read('src/server/routes/agentv3.ts'));
    expect(route).not.toContain('running directly on the strong model');
    expect(route).toContain('opensPastOpener: buildChainOpensPastOpener(powerLevelReqEffective, buildIsComplex)');
  });
});
