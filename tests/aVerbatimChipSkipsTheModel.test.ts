import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  verbatimTemplateSkipsModel, settleVerbatimTemplate, templateRunResult, templateCountsAsGated, startTemplatePreview,
} from '../src/server/AgentV3/templateVerify';
import { reviewerShouldRun } from '../src/server/routes/agentv3';

const base = { wroteFiles: true, isImportTurn: false, fastLaneGated: false, reviewFastlaneForced: false, startTierSonnet: true };

describe('Q-963 — a verbatim chip does not run a model', () => {
  it('skips only a seeded simple template with no added words', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'simple', prompt: 'build a hospital ERP nobody has a chip for', env })).toBe(false);
    expect(verbatimTemplateSkipsModel({ preseeded: false, tier: 'simple', prompt: 'x', env })).toBe(false);
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'pro', prompt: 'x', env })).toBe(false);
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'simple', prompt: 'x', env: { AGENTV3_TEMPLATE_NO_MODEL: 'off' } })).toBe(false);
  });

  it('a chip prompt that is exactly the template skips; words added do not', async () => {
    const { GOLDEN_SCAFFOLDS } = await import('../src/server/AgentV3/goldenScaffolds/registry');
    const { STARTER_TEMPLATES } = await import('../src/components/agentv3/starterTemplates');
    const simple = GOLDEN_SCAFFOLDS.find((g) => g.tier === 'simple');
    const chip = STARTER_TEMPLATES.find((t) => t.id === simple?.id);
    expect(simple && chip).toBeTruthy();
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'simple', prompt: chip!.prompt, env: {} })).toBe(true);
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'simple', prompt: `${chip!.prompt} aur Hindi mein`, env: {} })).toBe(false);
  });

  it('a file that does not parse is not delivered', async () => {
    const notes: string[] = [];
    const settled = await settleVerbatimTemplate({
      skip: true,
      files: { 'src/App.tsx': 'const x = <' },
      startPreview: async () => { throw new Error('should not preview'); },
      narrate: (t) => notes.push(t),
      record: () => {},
    });
    expect(settled.deliver).toBe(false);
    expect(notes[0]).toContain('did not parse');
    expect(templateRunResult(undefined, settled)).toBeUndefined();
  });

  it('a file that parses is the whole run, and the reviewer stands down', async () => {
    let previewed = false;
    const settled = await settleVerbatimTemplate({
      skip: true,
      files: { 'src/App.tsx': 'export function App(){ return <div>Hi</div> }\n' },
      startPreview: async () => { previewed = true; },
      narrate: () => {},
      record: () => {},
    });
    expect(settled.deliver).toBe(true);
    expect(previewed).toBe(true);
    const run = templateRunResult<{ ok: boolean; billedUsd: number; steps: number }>(undefined, settled);
    expect(run).toMatchObject({ ok: true, billedUsd: 0, steps: 0 });
    expect(templateCountsAsGated(false, true)).toBe(true);
    expect(templateCountsAsGated(false, false)).toBe(false);
    expect(reviewerShouldRun({ ...base, templateDelivered: true })).toBe(false);
    expect(reviewerShouldRun(base)).toBe(true);
  });

  it('skip false does not touch the preview', async () => {
    let previewed = false;
    const settled = await settleVerbatimTemplate({
      skip: false,
      files: {},
      startPreview: async () => { previewed = true; },
      narrate: () => {},
      record: () => {},
    });
    expect(settled.deliver).toBe(false);
    expect(previewed).toBe(false);
  });

  it('the preview wait does not call the launcher when it is off', async () => {
    let called = false;
    await startTemplatePreview(false, async () => { called = true; });
    expect(called).toBe(false);
  });

  it('the chat handler calls the settle, and adds no branch of its own', () => {
    const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('const verbatimTemplate = await settleVerbatimTemplate({');
    expect(route).toContain('result = templateRunResult(result, verbatimTemplate);');
    expect(route).toContain('fastLaneGated = templateCountsAsGated(fastLaneGated, verbatimTemplate.deliver);');
    expect(route).toContain('templateDelivered: verbatimTemplate.deliver');
  });
});
