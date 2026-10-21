import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { transformSync } from 'esbuild';
import {
  verbatimTemplateSkipsModel, settleVerbatimTemplate, templateRunResult, templateCountsAsGated, startTemplatePreview,
  type TemplateSettle,
} from '../src/server/AgentV3/templateVerify';
import { findSyntaxErrors } from '../src/server/AgentV3/SyntaxCheck';
import { reviewerShouldRun } from '../src/server/routes/agentv3';

const base = { wroteFiles: true, isImportTurn: false, fastLaneGated: false, reviewFastlaneForced: false, startTierSonnet: true };
const validFiles = { 'src/App.tsx': 'export function App(){ return <div>Hi</div> }\n' };
const preparedSummary = "NavBharatAI's tested template files are prepared for this request and passed the syntax check. No additional app code was generated.";
type SettleInput = Parameters<typeof settleVerbatimTemplate>[0];

function observations() {
  const order: string[] = [];
  const notes: string[] = [];
  const records: Parameters<SettleInput['record']>[0][] = [];
  return {
    order, notes, records,
    narrate: vi.fn((text: string) => { order.push('narrate'); notes.push(text); }),
    record: vi.fn((row: Parameters<SettleInput['record']>[0]) => { order.push('record'); records.push(row); }),
  };
}

function expectPreparedSettlement(settled: TemplateSettle, observed: ReturnType<typeof observations>): void {
  expect(settled).toEqual({ deliver: true, summary: preparedSummary });
  expect(observed.notes).toEqual([preparedSummary]);
  expect(observed.records).toEqual([{ severity: 'info', code: 'GOLDEN_SCAFFOLD', message: preparedSummary }]);
  expect(templateRunResult(undefined, settled)).toEqual({
    ok: true, summary: preparedSummary, steps: 0, billedUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, measured: true },
  });
  const existing = { ok: false, summary: 'Existing lane result' };
  expect(templateRunResult(existing, settled)).toBe(existing);
  expect(templateCountsAsGated(false, settled.deliver)).toBe(true);
  expect(templateCountsAsGated(true, false)).toBe(true);
  expect(templateCountsAsGated(false, false)).toBe(false);
  expect(reviewerShouldRun({ ...base, templateDelivered: settled.deliver })).toBe(false);
  expect(reviewerShouldRun(base)).toBe(true);
}

function sourceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

function expectInOrder(source: string, fragments: string[]): void {
  let last = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, last + 1);
    expect(next, fragment).toBeGreaterThan(last);
    last = next;
  }
}

describe('Q-963 — a verbatim chip does not run a model', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('skips only a seeded simple template with no added words', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'simple', prompt: 'build a hospital ERP nobody has a chip for', env })).toBe(false);
    expect(verbatimTemplateSkipsModel({ preseeded: false, tier: 'simple', prompt: 'x', env })).toBe(false);
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'pro', prompt: 'x', env })).toBe(false);
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'simple', prompt: 'x', env: { AGENTV3_TEMPLATE_NO_MODEL: 'off' } })).toBe(false);
  });

  it('an exact chip skips only after a simple seed; extensions, pro, disabled, and missing seeds do not', async () => {
    const { GOLDEN_SCAFFOLDS } = await import('../src/server/AgentV3/goldenScaffolds/registry');
    const { STARTER_TEMPLATES } = await import('../src/components/agentv3/starterTemplates');
    for (const golden of GOLDEN_SCAFFOLDS) {
      const chip = STARTER_TEMPLATES.find((t) => t.id === golden.id);
      expect(chip).toBeDefined();
      const input = { preseeded: true, tier: golden.tier, prompt: chip!.prompt, env: {} };
      expect(verbatimTemplateSkipsModel(input)).toBe(golden.tier === 'simple');
      expect(verbatimTemplateSkipsModel({ ...input, preseeded: false })).toBe(false);
      expect(verbatimTemplateSkipsModel({ ...input, prompt: `${chip!.prompt} aur Hindi mein` })).toBe(false);
      expect(verbatimTemplateSkipsModel({ ...input, env: { AGENTV3_TEMPLATE_NO_MODEL: 'off' } })).toBe(false);
    }
  });

  it('a file that does not parse is not delivered or previewed', async () => {
    const observed = observations();
    const startPreview = vi.fn(async () => {});
    const settled = await settleVerbatimTemplate({
      skip: true, files: { 'src/App.tsx': 'const x = <' }, startPreview, ...observed,
    });
    expect(settled).toEqual({ deliver: false, summary: '' });
    expect(startPreview).not.toHaveBeenCalled();
    expect(observed.notes).toEqual(['The tested template did not parse (1 file(s): src/App.tsx) — the engine will build it instead of shipping a file that cannot run.']);
    expect(observed.records).toEqual([{ severity: 'info', code: 'GOLDEN_SCAFFOLD', message: observed.notes[0] }]);
    expect(templateRunResult(undefined, settled)).toBeUndefined();
  });

  // OPEN policy, deliberately preserved: these adapter outcomes still deliver after syntax alone.
  // A literal correction must neither call that runtime proof nor silently change delivery/gates.
  it.each(['positive resolution', 'disabled launcher', 'rejected launcher', 'resolved tool error'] as const)(
    'keeps prepared-only narration and existing settlement policy after %s', async (outcome) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const observed = observations();
      const dispatch = vi.fn(async () => ({ is_error: true, content: 'Preview NOT published' }));
      const launcher = vi.fn((): Promise<void> => {
        observed.order.push('launcher');
        if (outcome === 'rejected launcher') return Promise.reject(new Error('preview launch rejected'));
        // This is the actual route adapter shape: a resolved error body is discarded, not thrown.
        if (outcome === 'resolved tool error') return dispatch().then(() => undefined);
        return Promise.resolve();
      });
      const startPreview = vi.fn(() => {
        observed.order.push('startPreview');
        return startTemplatePreview(outcome !== 'disabled launcher', launcher);
      });
      const settled = await settleVerbatimTemplate({ skip: true, files: validFiles, startPreview, ...observed });
      expect(startPreview).toHaveBeenCalledOnce();
      expect(launcher).toHaveBeenCalledTimes(outcome === 'disabled launcher' ? 0 : 1);
      expect(dispatch).toHaveBeenCalledTimes(outcome === 'resolved tool error' ? 1 : 0);
      expect(observed.order).toEqual(outcome === 'disabled launcher'
        ? ['startPreview', 'narrate', 'record'] : ['startPreview', 'launcher', 'narrate', 'record']);
      expectPreparedSettlement(settled, observed);
    },
  );

  it('a pending launcher settles at the existing 20-second bound without claiming startup or rendering', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const observed = observations();
    let signalStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => { signalStarted = resolveStarted; });
    const launcher = vi.fn(() => { signalStarted(); return new Promise<void>(() => {}); });
    let finished = false;
    const pending = settleVerbatimTemplate({
      skip: true, files: validFiles, startPreview: () => startTemplatePreview(true, launcher), ...observed,
    }).then((settled) => { finished = true; return settled; });
    // The real syntax check is asynchronous. Start measuring only after it invokes the launcher.
    await started;
    expect(launcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(19_999);
    expect(finished).toBe(false);
    expect(observed.notes).toEqual([]);
    expect(observed.records).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expectPreparedSettlement(await pending, observed);
    expect(finished).toBe(true);
    expect(launcher).toHaveBeenCalledOnce();
  });

  it.each(['direct rejection', 'synchronous launcher throw'] as const)('%s retains the checked-failure fallback', async (failure) => {
    const observed = observations();
    const launcher = vi.fn((): Promise<void> => {
      if (failure === 'synchronous launcher throw') throw new Error('launcher threw synchronously');
      return Promise.reject(new Error('unwrapped preview rejection'));
    });
    const settled = await settleVerbatimTemplate({
      skip: true, files: validFiles,
      startPreview: () => failure === 'direct rejection' ? launcher() : startTemplatePreview(true, launcher),
      ...observed,
    });
    expect(launcher).toHaveBeenCalledOnce();
    expect(settled).toEqual({ deliver: false, summary: '' });
    expect(observed.notes).toEqual([]);
    const reason = failure === 'direct rejection' ? 'unwrapped preview rejection' : 'launcher threw synchronously';
    expect(observed.records).toEqual([{
      severity: 'info', code: 'GOLDEN_SCAFFOLD',
      message: `The template could not be checked (${reason}) — the engine will build it.`,
    }]);
    expect(templateRunResult(undefined, settled)).toBeUndefined();
    expect(templateCountsAsGated(false, settled.deliver)).toBe(false);
    expect(reviewerShouldRun({ ...base, templateDelivered: settled.deliver })).toBe(true);
  });

  it('skip false does not check, preview, narrate, or record a prepared result', async () => {
    const observed = observations();
    const startPreview = vi.fn(async () => {});
    const settled = await settleVerbatimTemplate({
      skip: false, files: { 'src/App.tsx': 'const x = <' }, startPreview, ...observed,
    });
    expect(settled).toEqual({ deliver: false, summary: '' });
    expect(startPreview).not.toHaveBeenCalled();
    expect(observed.notes).toEqual([]);
    expect(observed.records).toEqual([]);
    expect(templateRunResult(undefined, settled)).toBeUndefined();
  });

  it('the preview wait does not call the launcher when it is off', async () => {
    const launcher = vi.fn(async () => {});
    await startTemplatePreview(false, launcher);
    expect(launcher).not.toHaveBeenCalled();
  });

  it('the chat handler keeps the existing settle adapter, result, gating, and reviewer wiring', () => {
    const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    const settle = sourceBetween(route, 'const verbatimTemplate = await settleVerbatimTemplate({', '// FREE-TIER: never escalate');
    expect(settle).toContain('skip: verbatimTemplateSkipsModel({ preseeded: goldenPreseeded, tier: goldenPreseededTier, prompt })');
    expect(settle).toContain("startPreview: () => startTemplatePreview(templateInstantPreviewEnabled(), () => dispatcher.dispatch({ id: 'template-verify-preview', name: 'update_preview', input: { port: 5173 } }, 'architect', { signal: abort.signal }).then(() => undefined))");
    expect(settle).toContain('result = templateRunResult(result, verbatimTemplate);');
    expect(settle).toContain('fastLaneGated = templateCountsAsGated(fastLaneGated, verbatimTemplate.deliver);');
    expect(route).toContain('templateDelivered: verbatimTemplate.deliver');
  });

  it('only accepted, completed seed writes reach the preparation prompt; dispatch remains fire-and-forget', () => {
    const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    const seed = sourceBetween(route, 'let goldenPreseeded = false;', '// ── GAME KIT SEED');
    const refused = sourceBetween(seed, 'if (!nobodysWorkHere) {', 'if (nobodysWorkHere) {');
    expect(refused).toContain("code: 'GOLDEN_SCAFFOLD_SKIPPED'");
    expect(refused).not.toContain('goldenBuildPrompt(');
    expect(refused).not.toContain('goldenPreseeded = true');
    expectInOrder(seed, [
      "process.env.AGENTV3_GOLDEN_SCAFFOLD !== 'off' && intent === 'new_build' && !projectModuleRef && !isImportTurn",
      'if (nobodysWorkHere) {',
      "await finalSteps.step('template write', () => Promise.all(Object.entries(goldenFiles).map(([gp, gc]) => actuator.writeFile(workspaceId, gp, gc))));",
      'writtenFiles.set(gp, gc);',
      "await finalSteps.step('template save', () => saveWorkspaceFiles(workspaceId, goldenFiles).catch(() => {}));",
      'goldenPreseeded = true;',
      'if (templateInstantPreviewEnabled()) {',
      "void dispatcher.dispatch({ id: 'template-instant-preview', name: 'update_preview'",
      '.catch(() => { /* the builder\'s own preview path still runs */ });',
      'buildPrompt = goldenBuildPrompt(golden, buildPrompt, chipExtensionTextOf(prompt));',
      '} catch (seedErr) {',
    ]);
    // This proves write rejection precedes the flag, not that every outer-catch path leaves it false.
    // Later observation can throw after the flag; best-effort save is not a persistence receipt.
  });

  it('preserves real health-gated publication and the separate browser-render proof', () => {
    const dispatcher = readFileSync(resolve(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    const publish = sourceBetween(dispatcher, "case 'update_preview': {", "case 'task': {");
    expect(publish).toContain('if (previewRefreshIsRedundant(this.lastPublishedPreview, port, this.changeCount()))');
    expect(publish).toContain('is already published and no file has changed since');
    expect(publish).toContain("if (chk.stdout.includes('PORT_UP')) return true;");
    expectInOrder(publish, [
      'let portReady = await pollPort(6_000);',
      'const verdict = parseDevServerHealthLine(healOut);',
      'if (verdict?.up) { portReady = true; healConfirmedUp = true; }',
      'this.actuator.getPortUrl(this.workspaceId, port)',
      'const url = applyPreviewDomain(rawUrl);',
      'if (!portReady) {',
      'Preview NOT published.',
      'this.previewFails = 0;',
      'this.previewPublished = true;',
      "this.events?.emit({ type: 'preview', url, ts: Date.now() });",
      'Live preview published (port ${port} verified UP).',
    ]);
    expect(publish).not.toContain('markAppRendered(');
    const errors = sourceBetween(dispatcher, 'if (err instanceof ToolRefusal) {', '\n  /**\n   * Browser tools');
    expect(errors).toContain('return { tool_use_id: call.id, content: err.message, is_error: true };');
    expect(errors).toContain('return { tool_use_id: call.id, content: `Error: ${message}`, is_error: true };');
    const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    const render = sourceBetween(route, 'const markAppRendered =', '\n      /**');
    expect(render).toContain("if (source === 'browser') browserRenderProven = true;");
    expect(render).toContain('const proof = appRenderedRecord(source, where);');
    expect(render).toContain('if (proof) buildDiag.record(proof);');
    const reader = sourceBetween(route, 'const renderProvenNow =', '// ── 🔴 DELIVERY PROOF:');
    expect(reader).toContain('if (previewVerifiedRendered) return true;');
    expect(reader).toContain('return renderProvenInLedger(buildDiag.evidenceLedger());');
    const proof = readFileSync(resolve(__dirname, '../src/server/AgentV3/renderProof.ts'), 'utf8');
    const writer = proof.slice(proof.indexOf('export function appRenderedRecord('));
    expect(writer).toContain("if (source !== 'browser') return null;");
    expect(writer).toContain('code: APP_RENDERED_CODE');
  });

  it('rejects an independent in-memory reversion of the settlement preview claim', async () => {
    const source = readFileSync(resolve(__dirname, '../src/server/AgentV3/templateVerify.ts'), 'utf8');
    const producer = sourceBetween(source, 'export async function settleVerbatimTemplate(', '/** The run result')
      .replace('export async function', 'async function');
    const literal = preparedSummary.replace("'", "\\'");
    expect(producer.split(literal)).toHaveLength(2);
    const compile = (text: string): typeof settleVerbatimTemplate => new Function(
      'findSyntaxErrors', transformSync(text, { loader: 'ts', target: 'es2022' }).code + '; return settleVerbatimTemplate;',
    )(findSyntaxErrors);
    const observe = async (settle: typeof settleVerbatimTemplate) => {
      const observed = observations();
      const settled = await settle({ skip: true, files: validFiles, startPreview: async () => {}, ...observed });
      return { settled, observed };
    };
    const current = await observe(compile(producer));
    expectPreparedSettlement(current.settled, current.observed);
    const oldSummary = "Your app is NavBharatAI\\'s tested template for this request. It is already on the preview — nothing else was generated.";
    const reverted = await observe(compile(producer.replace(literal, oldSummary)));
    expect(() => expectPreparedSettlement(reverted.settled, reverted.observed)).toThrow();
  });
});
