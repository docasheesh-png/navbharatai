import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the client build never inlines a server key (UI-S2)', () => {
  it('vite.config.ts does not define process.env.GEMINI_API_KEY', () => {
    const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(vite).not.toContain('process.env.GEMINI_API_KEY');
  });
});
