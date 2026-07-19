import { describe, it, expect } from 'vitest';
import { generateModerationIntegration, isModerationProvider } from './ModerationGenerator';

describe('generateModerationIntegration — OpenAI', () => {
  const c = generateModerationIntegration('openai');

  it('emits a server-only moderate() via the OpenAI moderation endpoint that fails open', () => {
    const server = c.files['server/lib/moderation.ts'];
    expect(server).toContain('export async function moderate(text: string)');
    expect(server).toContain('https://api.openai.com/v1/moderations');
    expect(server).toContain("'Authorization': 'Bearer ' + KEY");
    expect(server).toContain('return { flagged: false, score: 0 }'); // fails open on error
    expect(server).toContain('OPENAI_API_KEY');
    expect(c.files['src/lib/moderation.ts']).toBeUndefined(); // server-side, no client file
  });

  it('needs no npm dependency (REST via fetch), declares the key + blank .env.example', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual(['OPENAI_API_KEY']);
    expect(c.files['.env.example']).toBe('OPENAI_API_KEY=\n');
    expect(c.instructions).toContain('never stores');
    expect(c.instructions).toContain('fails open');
  });
});

describe('generateModerationIntegration — Perspective', () => {
  const c = generateModerationIntegration('perspective');

  it('emits a TOXICITY check with a tunable threshold', () => {
    const server = c.files['server/lib/moderation.ts'];
    expect(server).toContain('commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=');
    expect(server).toContain('requestedAttributes: { TOXICITY: {} }');
    expect(server).toContain('attributeScores?.TOXICITY?.summaryScore?.value');
    expect(server).toContain('score >= THRESHOLD');
    expect(server).toContain("process.env.PERSPECTIVE_THRESHOLD || '0.8'");
    expect(c.envKeys).toEqual(['PERSPECTIVE_API_KEY', 'PERSPECTIVE_THRESHOLD']);
    expect(c.dependency).toBeUndefined();
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['openai', 'perspective'] as const) {
      const env = generateModerationIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isModerationProvider accepts the two supported providers, rejects everything else', () => {
    expect(isModerationProvider('openai')).toBe(true);
    expect(isModerationProvider('perspective')).toBe(true);
    expect(isModerationProvider('azure')).toBe(false);
    expect(isModerationProvider(undefined)).toBe(false);
  });
});
