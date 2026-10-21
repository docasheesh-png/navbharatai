import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { transformSync } from 'esbuild';
import { templateInstantPreviewEnabled, isTemplateVerifyJob, shouldUseSlimPrompt, capTemplateVerifyEstimate, TEMPLATE_VERIFY_HIGH_MS } from '../src/server/AgentV3/templateVerify';
import { shouldAutoPublishPreview } from '../src/server/AgentV3/ToolDispatcher';
import { isCommonEnglishWord } from '../src/server/AgentV3/commonEnglishWords';
import { unknownNamesInRequest } from '../src/server/AgentV3/unknownName';
import { GOLDEN_SCAFFOLDS, goldenBuildPrompt, type GoldenScaffold } from '../src/server/AgentV3/goldenScaffolds/registry';

const oldRuntimeClauses = [
  "it compiles, runs, and is already on the user's preview.",
  'It already compiles and runs:',
  'It already compiles cleanly and fully implements the request below.',
  'The live preview has ALREADY been started by the platform.',
];

function expectPreparedPrompt(prompt: string, golden: GoldenScaffold, customised: boolean): void {
  for (const claim of oldRuntimeClauses) expect(prompt).not.toContain(claim);
  if (customised) expect(prompt).toContain('its template files are prepared in this workspace.');
  if (golden.tier === 'pro') {
    expect(prompt).toContain('The tested foundation includes these files:');
  } else if (!customised) {
    expect(prompt).toContain('This tested template is the starting point for the request below.');
    expect(prompt).toContain('Preparing template files does not by itself confirm that the live preview has started or rendered.');
  }
}

function expectThemePreserved(prompt: string): void {
  expect(prompt).toContain("KEEP the template's own working controls");
  expect(prompt).toContain('ThemeToggle in src/theme.tsx');
  expect(prompt).toContain('Auto → Light → Dark through the data-theme attribute');
  expect(prompt).toContain('never replace it with a hand-rolled copy');
}

function expectProExtension(prompt: string): void {
  expect(prompt).toContain('src/lib/ui.tsx holds the shared components (Shell, Card, StatTile, Badge, Button, Field, Select, Modal, Empty)');
  expect(prompt).toContain('src/lib/store.ts holds persistent state (useCollection, inr, shortDate), and src/App.tsx has the working screens.');
  expect(prompt).toContain('READ all three FIRST. It is a STARTING POINT, not the finished app');
  expect(prompt).toContain('BUILD OUT everything the request below asks for that is not there yet');
  expect(prompt).toContain('reusing those existing components and the useCollection pattern');
  expect(prompt).toContain('Add new screens as their own files under src/.');
  expect(prompt).toContain('Do NOT rewrite what already works');
  expect(prompt).toContain('do NOT re-plan a parallel file structure');
  expect(prompt).toContain('NEVER add an import that already exists');
}

describe('BR 778d7c58 autopsy', () => {
  it('instant template preview is default on with an off kill switch', () => {
    expect(templateInstantPreviewEnabled({})).toBe(true);
    expect(templateInstantPreviewEnabled({ AGENTV3_TEMPLATE_INSTANT_PREVIEW: 'off' })).toBe(false);
  });
  it('verify job = simple tier only; slim prompt forced for it', () => {
    expect(isTemplateVerifyJob('simple', {})).toBe(true);
    expect(isTemplateVerifyJob('pro', {})).toBe(false);
    expect(isTemplateVerifyJob(null, {})).toBe(false);
    expect(shouldUseSlimPrompt(false, 'simple', {})).toBe(true);
    expect(shouldUseSlimPrompt(false, 'pro', {})).toBe(false);
    expect(shouldUseSlimPrompt(true, null, {})).toBe(true);
  });
  it('caps a verify ETA without own history; leaves others alone', () => {
    const est = { estimateMs: 300_000, lowMs: 180_000, highMs: 480_000 };
    const c = capTemplateVerifyEstimate(est, true, false);
    expect(c.highMs).toBeLessThanOrEqual(TEMPLATE_VERIFY_HIGH_MS);
    expect(c.lowMs).toBeLessThanOrEqual(c.estimateMs);
    expect(capTemplateVerifyEstimate({ ...est, etaText: '~5 min' }, true, false).etaText).not.toBe('~5 min');
    expect(capTemplateVerifyEstimate(est, false, false)).toBe(est);
    expect(capTemplateVerifyEstimate(est, true, true)).toBe(est);
  });
  it('auto-publishes the preview after a bash that brought the dev server up, once', () => {
    const ok = 'dev server UP on port 5173';
    // Uses the platform health-line parser; a non-health output never triggers.
    expect(shouldAutoPublishPreview('npm ERR! missing script', false, {})).toBe(false);
    expect(shouldAutoPublishPreview(ok, true, {})).toBe(false);
    expect(shouldAutoPublishPreview(ok, false, { AGENTV3_AUTO_PREVIEW: 'off' })).toBe(false);
  });
  it('all-caps ordinary English words are not unknown services; coined names still are', () => {
    expect(isCommonEnglishWord('CALCULATE')).toBe(true);
    expect(unknownNamesInRequest('Panchang app banao jo tithi CALCULATE kare aur muhurat SHOW kare')).toEqual([]);
    expect(unknownNamesInRequest('Ye yese app banao jo data COACT oar sake CALCULATE kare')).toEqual(['COACT']);
  });
  it.each(GOLDEN_SCAFFOLDS)('$id plain prompt distinguishes prepared files from runtime evidence', (golden) => {
    const request = `Original request for ${golden.id}`;
    const prompt = goldenBuildPrompt(golden, request);
    expectPreparedPrompt(prompt, golden, false);
    expect(prompt).toContain(golden.label);
    expect(prompt.endsWith(`\n\n---\n\n${request}`)).toBe(true);
    if (golden.finishNote) expect(prompt).toContain(`\n\n${golden.finishNote}\n\n---`);
    expect(goldenBuildPrompt(golden, request, '   ')).toBe(prompt);
    if (golden.tier === 'pro') {
      expectProExtension(prompt);
    } else {
      expect(prompt).toContain('READ src/App.tsx first. If the request matches the template');
      expect(prompt).toContain('make NO edits unless tsc fails or the request asks for something the template does not do');
      expect(prompt).toContain('a finished template needs no polish');
      expect(prompt).toContain('Before any edit_file, read_file the exact region you will change');
      expect(prompt).toContain('never edit text you have not read');
      expect(prompt).toContain('Otherwise run the type check and finish');
      expect(prompt).toContain('Do NOT rewrite it from scratch');
      expect(prompt).toContain('do NOT re-plan a parallel file structure');
      expect(prompt).toContain('NEVER add an import that already exists');
      expectThemePreserved(prompt);
    }
  });

  it.each(GOLDEN_SCAFFOLDS)('$id custom prompt preserves user priority, truncation, and finish instructions', (golden) => {
    const request = `Unchanged request suffix for ${golden.id}`;
    const addition = `Use Hindi labels and these subjects: ${'x'.repeat(600)} OMITTED_EXTENSION_TAIL`;
    const prompt = goldenBuildPrompt(golden, request, `  ${addition}  `);
    expectPreparedPrompt(prompt, golden, true);
    expect(prompt.startsWith("[CUSTOMISE THIS WORKING TEMPLATE — THE USER'S OWN WORDS COME FIRST]")).toBe(true);
    expect(prompt).toContain(`in their own words: «${addition.slice(0, 600)}»`);
    expect(prompt).not.toContain('OMITTED_EXTENSION_TAIL');
    expect(prompt).toContain("wherever it differs from the suggestion text below, the user's addition wins");
    expect(prompt).toContain("change the template's content, sections, data, labels and language to match it exactly");
    expect(prompt).toContain('READ src/App.tsx first and edit it in place');
    expect(prompt).toContain('read the exact region before each edit_file; write_file a file you replace whole');
    expect(prompt).toContain('and never start over');
    expectThemePreserved(prompt);
    expect(prompt.endsWith(`\n\n---\n\n${request}`)).toBe(true);
    if (golden.finishNote) expect(prompt).toContain(`\n\n${golden.finishNote}\n\n---`);
    if (golden.tier === 'pro') expectProExtension(prompt);
    else expect(prompt).not.toContain('make NO edits');
  });

  // Compile only this real text producer, not another copy of its logic or an extra live import graph.
  // Every mutation is in memory and is checked by the SAME assertions as the all-scaffold matrix.
  it.each([
    ['customisation', 'its template files are prepared in this workspace.', oldRuntimeClauses[0], 'simple', true],
    ['pro foundation', 'The tested foundation includes these files:', oldRuntimeClauses[1], 'pro', false],
    ['simple provenance', 'This tested template is the starting point for the request below.', oldRuntimeClauses[2], 'simple', false],
    ['preview startup', 'Preparing template files does not by itself confirm that the live preview has started or rendered.', oldRuntimeClauses[3], 'simple', false],
  ] as const)('rejects an independent in-memory reversion of %s', (_name, current, old, tier, customised) => {
    const registry = readFileSync(resolve(__dirname, '../src/server/AgentV3/goldenScaffolds/registry.ts'), 'utf8');
    const start = registry.indexOf('const KEEP_THE_SWITCH =');
    expect(start).toBeGreaterThanOrEqual(0);
    const producer = registry.slice(start).replace('export function goldenBuildPrompt', 'function goldenBuildPrompt');
    expect(producer.split(current)).toHaveLength(2);
    const compile = (source: string): typeof goldenBuildPrompt => new Function(
      transformSync(source, { loader: 'ts', target: 'es2022' }).code + '; return goldenBuildPrompt;',
    )();
    const golden = GOLDEN_SCAFFOLDS.find((g) => g.tier === tier)!;
    const extension = customised ? 'Use Hindi labels' : undefined;
    expectPreparedPrompt(compile(producer)(golden, 'Original request', extension), golden, customised);
    const reverted = compile(producer.replace(current, old))(golden, 'Original request', extension);
    expect(() => expectPreparedPrompt(reverted, golden, customised)).toThrow();
  });
});
