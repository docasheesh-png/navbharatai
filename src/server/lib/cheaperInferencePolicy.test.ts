import { describe, expect, it } from 'vitest';
import { grantEmail } from '../AgentV3/featureFlag';
import {
  CHEAPERINFERENCE_ADMIN_FIRST_TOKEN_MS,
  CHEAPERINFERENCE_BASE_URL,
  CHEAPERINFERENCE_CHAT_MODEL_CANDIDATES,
  CHEAPERINFERENCE_PAID_FIRST_TOKEN_MS,
  cheaperInferenceAdminStatus,
  cheaperInferenceApiKeyConfigured,
  cheaperInferenceExclusiveAdmin,
  cheaperInferenceMode,
  cheaperInferencePaidRungEnabled,
  cheapinfFirstTokenMs,
  isCheaperInferenceAdmin,
} from './cheaperInferencePolicy';

const adminMail = grantEmail('doc.asheesh@icloud.com', true);
const otherMail = grantEmail('someone@example.com', true);

describe('cheaperInferencePolicy (simple mode)', () => {
  it('defaults to off and never claims production activation is safe', () => {
    expect(cheaperInferenceMode({})).toBe('off');
    expect(cheaperInferencePaidRungEnabled({})).toBe(false);
    expect(cheaperInferenceExclusiveAdmin(adminMail, {})).toBe(false);
    expect(cheaperInferenceAdminStatus({}).activationSafe).toBe(false);
    expect(cheaperInferenceAdminStatus({}).baseUrl).toBe(CHEAPERINFERENCE_BASE_URL);
  });

  it('accepts CHEAPERINFERENCE and CheaperInference spellings; unknown → off', () => {
    expect(cheaperInferenceMode({ CHEAPERINFERENCE: 'admin' })).toBe('admin');
    expect(cheaperInferenceMode({ CheaperInference: 'all' })).toBe('all');
    expect(cheaperInferenceMode({ CHEAPERINFERENCE: 'canary' })).toBe('off');
  });

  it('admin mode is exclusive to verified admin emails and needs a key', () => {
    const env = { CHEAPERINFERENCE: 'admin', CHEAPERINFERENCE_API_KEY: 'ci_live_test' };
    expect(isCheaperInferenceAdmin(adminMail)).toBe(true);
    expect(isCheaperInferenceAdmin(otherMail)).toBe(false);
    expect(cheaperInferenceExclusiveAdmin(adminMail, env)).toBe(true);
    expect(cheaperInferenceExclusiveAdmin(otherMail, env)).toBe(false);
    expect(cheaperInferenceExclusiveAdmin(adminMail, { CHEAPERINFERENCE: 'admin' })).toBe(false);
    expect(cheaperInferencePaidRungEnabled(env)).toBe(false);
  });

  it('all mode enables the paid rung for everyone when a key is set', () => {
    const env = { CHEAPERINFERENCE: 'all', CHEAPERINFERENCE_API_KEY: 'ci_live_test' };
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
