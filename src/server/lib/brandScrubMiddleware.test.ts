import { describe, it, expect } from 'vitest';
import { scrubStreamChunk, isAdminPath, brandScrubMiddleware } from './brandScrubMiddleware';

describe('brandScrubMiddleware', () => {
  it('scrubs NDJSON error events but not answer content', () => {
    const chunk = JSON.stringify({ type: 'error', message: 'Kimi K2 overloaded' }) + '\n' + JSON.stringify({ type: 'token', text: 'OpenAI is a company' }) + '\n';
    const out = scrubStreamChunk(chunk);
    expect(out).toContain('NavBharatAI overloaded');
    expect(out).toContain('OpenAI is a company');
  });
  it('scrubs SSE status/error lines, keeps answer deltas', () => {
    const out = scrubStreamChunk(`data: ${JSON.stringify({ error: 'Groq 429' })}\n\ndata: ${JSON.stringify({ c: 'Gemini is a model' })}\n\n`);
    expect(out).toContain('NavBharatAI 429');
    expect(out).toContain('Gemini is a model');
  });
  it('treats admin paths as exempt', () => {
    expect(isAdminPath('/api/admin/providers')).toBe(true);
    expect(isAdminPath('/api/chat')).toBe(false);
  });
  it('scrubs error JSON on user routes only', () => {
    const run = (path: string, status: number) => {
      let sent: any; const res: any = { statusCode: status, json: (b: any) => { sent = b; return res; }, write: () => true };
      brandScrubMiddleware()({ path } as any, res, () => {});
      res.json({ error: 'DeepSeek failed', reply: 'DeepSeek failed' });
      return sent;
    };
    expect(run('/api/chat', 503).error).toBe('NavBharatAI failed');
    expect(run('/api/chat', 200).reply).toBe('DeepSeek failed');
    expect(run('/api/admin/x', 503).error).toBe('DeepSeek failed');
  });
});
