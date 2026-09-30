// Autopsy 876afca9 (2026-09-30) — open item closed. The first preview repair reloaded "/", saw it clean,
// called the MIME error "transient" and changed nothing. The cause was a public/index.html shadowing the
// Vite entry, which the dev server serves as-is only for /index.html (measured) — so a reload of "/" really
// did look clean. The platform's own detector already knew the cause; the repair pass was never told.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shadowingEntriesInProject, entryShadowRepairHint } from '../src/server/AgentV3/entryShadow';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CALCULATOR = ['index.html', 'vite.config.ts', 'package.json', 'public/index.html', 'src/main.tsx', 'src/App.tsx'];

describe('the shadow is read from the file list', () => {
  it('the calculator project carries one', () => {
    expect(shadowingEntriesInProject(CALCULATOR)).toEqual(['public/index.html']);
    expect(shadowingEntriesInProject(CALCULATOR.map((p) => `./${p}`))).toEqual(['public/index.html']);
  });

  it('a CRA app (its entry IS public/index.html) never matches', () => {
    expect(shadowingEntriesInProject(['package.json', 'public/index.html', 'src/index.js'])).toEqual([]);
  });

  it('no Vite config, or no root entry, is not this defect', () => {
    expect(shadowingEntriesInProject(['index.html', 'public/index.html'])).toEqual([]);
    expect(shadowingEntriesInProject(['vite.config.ts', 'public/index.html'])).toEqual([]);
  });

  it('a clean Vite project gets no hint at all', () => {
    expect(entryShadowRepairHint(['index.html', 'vite.config.ts', 'public/favicon.svg'])).toBe('');
  });

  it('the hint names the file and says why a clean reload of "/" proves nothing', () => {
    const h = entryShadowRepairHint(CALCULATOR);
    expect(h).toMatch(/^KNOWN CAUSE/);
    expect(h).toContain('Delete public/index.html');
    expect(h).toMatch(/does NOT make it transient/);
  });

  it('`AGENTV3_ENTRY_SHADOW=off` silences it', () => {
    const prev = process.env.AGENTV3_ENTRY_SHADOW;
    process.env.AGENTV3_ENTRY_SHADOW = 'off';
    try { expect(entryShadowRepairHint(CALCULATOR)).toBe(''); }
    finally { if (prev === undefined) delete process.env.AGENTV3_ENTRY_SHADOW; else process.env.AGENTV3_ENTRY_SHADOW = prev; }
  });
});

describe('both repair passes that read the console are told', () => {
  it('the preview verify loop', () => {
    const at = route.indexOf('let repairPrompt = buildPreviewRepairPrompt(verdict.problems, consoleErrs);');
    expect(at).toBeGreaterThan(-1);
    const next = route.slice(at, at + 400);
    expect(next).toContain('repairPrompt = entryShadowRepairHint(await actuator.listFiles(workspaceId)');
  });

  it('the runtime auto-fix', () => {
    expect(route).toContain("fixRunner.run(shadowHint + buildRepairPrompt(captured))");
    expect(route).toContain('const shadowHint = entryShadowRepairHint(await actuator.listFiles(workspaceId)');
  });
});
