import { describe, it, expect, afterEach } from 'vitest';
import { weakAdmissionForTurn } from './weakBuildPreflight';
import { SURPLUS_SCOPE_TIMEOUT_MS } from '../AI/SurplusRegistry/scopeAdmission';
import { WEAK_SCOPE_TIMEOUT_MS } from './weakBuildAdmission';

describe('Surplus scope deadline (05016 DNA)', () => {
  const prev = process.env.AGENTV3_WEAK_SCOPE_POLICY;
  afterEach(() => { process.env.AGENTV3_WEAK_SCOPE_POLICY = prev; });
  it('reasoning-sized deadline exceeds the GLM 5s deadline', () => {
    expect(SURPLUS_SCOPE_TIMEOUT_MS).toBeGreaterThan(WEAK_SCOPE_TIMEOUT_MS);
  });
  it('a slow (>5s) Surplus answer is admitted when the caller passes the Surplus deadline', async () => {
    process.env.AGENTV3_WEAK_SCOPE_POLICY = 'on';
    const ask = (_s: string, _u: string, signal: AbortSignal) => new Promise<{ text: string }>((res, rej) => {
      const t = setTimeout(() => res({ text: 'simple' }), 60);
      signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); });
    });
    const slow = await weakAdmissionForTurn({ prompt: 'Hello page', intent: 'edit_existing', importing: false, tier: 'weak' }, ask, { timeoutMs: 20 });
    expect(slow?.failure?.reason).toBe('scope_timeout');
    const ok = await weakAdmissionForTurn({ prompt: 'Hello page', intent: 'edit_existing', importing: false, tier: 'weak' }, ask, { timeoutMs: 1_000 });
    expect(ok?.scope).toBe('simple');
  });
});
