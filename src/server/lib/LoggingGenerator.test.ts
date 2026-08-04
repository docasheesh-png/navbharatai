import { describe, it, expect } from 'vitest';
import { generateLoggingIntegration } from './LoggingGenerator';

describe('generateLoggingIntegration', () => {
  const c = generateLoggingIntegration();
  const server = c.files['server/lib/logger.ts'];

  it('emits a configured pino logger + a request-logging middleware', () => {
    expect(server).toContain("import pino from 'pino'");
    expect(server).toContain('export const logger = pino({ level: process.env.LOG_LEVEL ?? \'info\' })');
    expect(server).toContain('export function requestLogger(');
    expect(server).toContain("res.on('finish'");
    expect(server).toContain('ms: Date.now() - start'); // duration
  });

  it('logs method/url/status/duration but NEVER headers or body (secret-safe)', () => {
    expect(server).toContain('method: req.method');
    expect(server).toContain('status: res.statusCode');
    // the request-log object must not reference headers or body — a secret must never reach the logs
    expect(server).not.toContain('req.headers');
    expect(server).not.toContain('req.body');
    expect(server).not.toContain('authorization');
  });

  it('declares pino, LOG_LEVEL env + blank .env.example (never overwrites), server-only', () => {
    expect(c.dependency).toEqual({ name: 'pino', version: '^9.5.0' });
    expect(c.envKeys).toEqual(['LOG_LEVEL']);
    expect(c.files['.env.example']).toBe('LOG_LEVEL=\n');
    expect(c.files['src/lib/logger.ts']).toBeUndefined();
    expect(c.instructions).toContain('never leak');
  });

  it('.env.example carries no real value (blank RHS only)', () => {
    for (const line of c.files['.env.example'].split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
  });
});
