import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { seedKeptSentence, abortSummary } from '../src/server/AgentV3/buildAbortCause';

// Autopsy b001fd78 (Q1): a user-stopped build told the user the template was "still in your workspace and preview"
// while the release gate said no preview ever ran. The abort sentences know the files, not the preview.
describe('stop messages claim only what they can verify', () => {
  it('seedKeptSentence never mentions a preview', () => {
    expect(seedKeptSentence('platform-template')).not.toMatch(/preview/i);
    expect(seedKeptSentence('kept-seed')).not.toMatch(/preview/i);
  });

  it('a user-stop on a seeded template names the workspace, not a preview', () => {
    const s = abortSummary('user-stop', { builtSomething: false, seed: 'platform-template' });
    expect(s).toContain('still in your workspace');
    expect(s).not.toMatch(/and preview/i);
  });

  it('source guard: no "workspace and preview" claim anywhere in the AgentV3 server', () => {
    const files = ['buildAbortCause.ts', 'cancelledBuildBilling.ts'];
    for (const f of files) {
      expect(readFileSync(`src/server/AgentV3/${f}`, 'utf8')).not.toMatch(/workspace and preview/);
    }
  });
});
