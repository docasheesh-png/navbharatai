import { describe, expect, it } from 'vitest';
import { grantEmail } from '../AgentV3/featureFlag';
import {
  CHEAPERINFERENCE_BASE_URL,
  cheaperInferenceAdminStatus,
  cheaperInferenceApiKeyConfigured,
  cheaperInferenceExclusiveAdmin,
  cheaperInferenceMode,
  cheaperInferencePaidRungEnabled,
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
});
