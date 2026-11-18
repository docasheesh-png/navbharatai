import { describe, expect, it } from 'vitest';
import { grantEmail } from '../AgentV3/featureFlag';
import {
  CHEAPERINFERENCE_ADMIN_FIRST_TOKEN_MS,
  CHEAPERINFERENCE_BASE_URL,
  CHEAPERINFERENCE_CHAT_MODEL_CANDIDATES,
  CHEAPERINFERENCE_PAID_FIRST_TOKEN_MS,
  cheaperInferenceAdminStatus,
  cheaperInferenceApiKeyConfigured,
  cheaperInferenceConfiguredMode,
  cheaperInferenceExclusiveAdmin,
  cheaperInferenceMode,
  cheaperInferencePaidRungEnabled,
  cheaperInferenceSharedAccessPermitted,
  cheapinfFirstTokenMs,
  isCheaperInferenceAdmin,
} from './cheaperInferencePolicy';

const adminMail = grantEmail('doc.asheesh@icloud.com', true);
const otherMail = grantEmail('someone@example.com', true);

describe('cheaperInferencePolicy (simple mode)', () => {
  // Owner t357u (2026-11-16): default ON for all users; only an explicit off value is the kill switch.
  it('defaults to all and still never claims production activation is safe', () => {
    expect(cheaperInferenceMode({})).toBe('all');
    expect(cheaperInferencePaidRungEnabled({})).toBe(false); // no key, nothing to call
    expect(cheaperInferencePaidRungEnabled({ CHEAPERINFERENCE_API_KEY: 'ci_live_test' })).toBe(true);
    expect(cheaperInferenceExclusiveAdmin(adminMail, {})).toBe(false);
    expect(cheaperInferenceAdminStatus({}).activationSafe).toBe(false);
    expect(cheaperInferenceAdminStatus({}).baseUrl).toBe(CHEAPERINFERENCE_BASE_URL);
  });

  it('accepts CHEAPERINFERENCE and CheaperInference spellings; unknown → all; off values → off', () => {
    expect(cheaperInferenceMode({ CHEAPERINFERENCE: 'admin' })).toBe('admin');
    expect(cheaperInferenceMode({ CheaperInference: 'all' })).toBe('all');
    expect(cheaperInferenceMode({ CHEAPERINFERENCE: 'canary' })).toBe('all');
    for (const off of ['off', 'false', '0', 'no']) expect(cheaperInferenceMode({ CHEAPERINFERENCE: off })).toBe('off');
    expect(cheaperInferenceConfiguredMode({})).toBe('off');
    expect(cheaperInferenceConfiguredMode({ CHEAPERINFERENCE: 'admin' })).toBe('admin');
  });

  it('admin mode keeps its exclusive admin path but no longer hides the rung from users', () => {
    const env = { CHEAPERINFERENCE: 'admin', CHEAPERINFERENCE_API_KEY: 'ci_live_test' };
    expect(isCheaperInferenceAdmin(adminMail)).toBe(true);
    expect(isCheaperInferenceAdmin(otherMail)).toBe(false);
    expect(cheaperInferenceExclusiveAdmin(adminMail, env)).toBe(true);
    expect(cheaperInferenceExclusiveAdmin(otherMail, env)).toBe(false);
    expect(cheaperInferenceExclusiveAdmin(adminMail, { CHEAPERINFERENCE: 'admin' })).toBe(false);
    expect(cheaperInferencePaidRungEnabled(env)).toBe(true);
  });

  it('all mode serves every user without the Keak written-permission gate', () => {
    const env = { CHEAPERINFERENCE: 'all', CHEAPERINFERENCE_API_KEY: 'ci_live_test' };
    expect(cheaperInferenceSharedAccessPermitted(env)).toBe(false); // still reported, no longer a gate
    expect(cheaperInferencePaidRungEnabled(env)).toBe(true);
    expect(cheaperInferenceExclusiveAdmin(adminMail, env)).toBe(false);
    expect(cheaperInferenceApiKeyConfigured({ CHEAPERINFERENCE_API_KEY: 'a,b' })).toBe(false);
  });

  it('lists catalog beam ids and gives exclusive admin a long first-content grace', () => {
    expect(CHEAPERINFERENCE_CHAT_MODEL_CANDIDATES).toContain('beam');
    expect(CHEAPERINFERENCE_CHAT_MODEL_CANDIDATES).toContain('beam-1.0-501b-a23b');
    expect(cheapinfFirstTokenMs(true, 6_000)).toBe(CHEAPERINFERENCE_ADMIN_FIRST_TOKEN_MS);
    expect(cheapinfFirstTokenMs(false, 6_000)).toBe(CHEAPERINFERENCE_PAID_FIRST_TOKEN_MS);
    expect(cheapinfFirstTokenMs(true, 90_000)).toBe(90_000);
  });
});
