import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { mintAdminToken } from './adminAuth';
import { parseDiagnosticInput, requireDiagnosticAdmin, validateDiagnosticRun } from './providerDiagnosticBoundary';
const key = '11111111-1111-4111-8111-111111111111';
const body = { idempotencyKey: key, prompt: 'Reply with hello.' };
function response() {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), locals: {} };
  res.status.mockReturnValue(res);
  return res;
}
afterEach(() => vi.unstubAllEnvs());
describe('diagnostic request boundary', () => {
  it.each(['surplus', 'cheaperinference'])('accepts only the named %s provider', provider => {
    expect(parseDiagnosticInput(provider, body)).toEqual({ provider, ...body });
  });
  it.each(['glm', 'deepinfra', '', undefined])('rejects unsupported provider %s', provider => {
    expect(parseDiagnosticInput(provider, body)).toBeNull();
  });
  it.each(['model', 'baseURL', 'apiKey', 'maxTokens', 'retries', 'budget', 'provider'])('rejects injected %s', field => {
    expect(parseDiagnosticInput('surplus', { ...body, [field]: 'override' })).toBeNull();
  });
  it('accepts long UTF-8 prompts without a diagnostic cap and requires a replay key', () => {
    expect(parseDiagnosticInput('surplus', { ...body, prompt: 'é'.repeat(1024) })).not.toBeNull();
    expect(parseDiagnosticInput('surplus', { ...body, prompt: 'é'.repeat(40000) })).not.toBeNull();
    for (const input of [null, [], {}, { ...body, prompt: ' ' }, { ...body, idempotencyKey: '../old-test' }]) {
      expect(parseDiagnosticInput('surplus', input)).toBeNull();
    }
  });
  it.each(['missing', 'forged', 'expired', 'query', 'body', 'ordinary-user'])('denies %s admin identity before handlers', kind => {
    vi.stubEnv('ADMIN_PASSWORD', 'test-only-password'); vi.stubEnv('ADMIN_USERNAME', 'test-admin');
    const valid = mintAdminToken('test-only-password', 'test-admin', Date.now());
    const headers = kind === 'forged' ? { 'x-admin-token': 'forged' }
      : kind === 'expired' ? { 'x-admin-token': mintAdminToken('test-only-password', 'test-admin', 1) }
      : kind === 'ordinary-user' ? { authorization: 'Bearer ordinary-user' } : {};
    const req = { headers, query: kind === 'query' ? { token: valid } : {}, body: kind === 'body' ? { token: valid } : {} };
    const res = response(); const next = vi.fn();
    requireDiagnosticAdmin(req as Request, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(valid);
  });
  it('allows a verified server-side admin session', () => {
    vi.stubEnv('ADMIN_PASSWORD', 'test-only-password'); vi.stubEnv('ADMIN_USERNAME', 'test-admin');
    const req = { headers: { 'x-admin-token': mintAdminToken('test-only-password', 'test-admin', Date.now()) } };
    const res = response(); const next = vi.fn();
    requireDiagnosticAdmin(req as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce(); expect(res.status).not.toHaveBeenCalled();
  });
  it('rejects invalid input without echoing sensitive fields', () => {
    const res = response(); const next = vi.fn();
    validateDiagnosticRun({ params: { provider: 'surplus' }, body: { ...body, apiKey: 'secret-marker' } } as unknown as Request, res as unknown as Response, next as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400); expect(next).not.toHaveBeenCalled();
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret-marker');
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(body.prompt);
  });
});

it('accepts an explicitly requested output bound for older clients without imposing a default', () => {
  expect(parseDiagnosticInput('surplus', { ...body, maxOutputTokens: 1024 })?.maxOutputTokens).toBe(1024);
});
