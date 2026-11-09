import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXED_TEXT_CHAIN, FIXED_TEXT_CHAIN_MAX_ATTEMPTS, FIXED_CHAT_SUPPLIER_HTTP_ATTEMPT_CEILINGS, SINGLE_USE_SUPPLIER_HTTP_ATTEMPTS, fixedTextChainEnabled, fixedTextChainRank, fixedTextChainScope, fixedTextChainSelected, withFixedTextChainScope } from './fixedTextChain';
import { CHAT_SERVER_DEADLINE_MS } from '../../lib/chatDeadline';
import { mitrifyChainStatus } from '../lib/mitrify';
afterEach(() => vi.unstubAllEnvs());
describe('server-owned fixed text policy', () => {
  it('separates requested supplier ceilings from current single-use dispatch authority', () => {
    expect(FIXED_CHAT_SUPPLIER_HTTP_ATTEMPT_CEILINGS).toEqual({ MITRIFY: 3, QUBAX: 3 });
    expect(Object.isFrozen(FIXED_CHAT_SUPPLIER_HTTP_ATTEMPT_CEILINGS)).toBe(true);
    expect(SINGLE_USE_SUPPLIER_HTTP_ATTEMPTS).toBe(1);
    expect(FIXED_TEXT_CHAIN_MAX_ATTEMPTS).toBe(12);
    expect(CHAT_SERVER_DEADLINE_MS).toBe(240_000);
  });
  it('defaults off and rejects misspelled selection', () => {
    expect(fixedTextChainEnabled({})).toBe(false);
    expect(fixedTextChainEnabled({ TEXT_CHAIN_POLICY: 'legacy' })).toBe(false);
    expect(fixedTextChainEnabled({ TEXT_CHAIN_POLICY: ' fixed-v1 ' })).toBe(true);
    expect(() => fixedTextChainEnabled({ TEXT_CHAIN_POLICY: 'fixed' })).toThrow('configuration');
    expect(FIXED_TEXT_CHAIN.indexOf('mitrify')).toBe(5);
    expect(FIXED_TEXT_CHAIN.indexOf('qubax')).toBe(6);
    expect(fixedTextChainRank({ providerId: 'QUBAX', modelId: 'reviewed-model', charging: 'metered' })).toBe(6);
    expect(fixedTextChainRank({ providerId: 'QUBAX', modelId: 'reviewed-model', charging: 'verified-free-no-overage' })).toBeUndefined();
  });
  it.each(['builder', 'pro', 'published-app', 'image-generation'])('keeps %s excluded, including nested chat helpers', surface => {
    vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
    expect(fixedTextChainScope(surface, 'text')).toBe(false);
    withFixedTextChainScope(surface, 'text', () => withFixedTextChainScope('chat', 'text', () => expect(fixedTextChainSelected()).toBe(false)));
  });
  it.each(['tool-json', 'vision-pdf', 'embedding', 'voice-session'])('cannot downgrade %s to text in nested work', capability => {
    vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
    withFixedTextChainScope('chat', capability, () => withFixedTextChainScope('chat', 'text', () => expect(fixedTextChainSelected()).toBe(false)));
  });
  it('isolates concurrent requests and retains selection across async nested work', async () => {
    vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
    await Promise.all(['chat', 'professional', 'developer-api', 'builder'].map(surface => withFixedTextChainScope(surface, 'text', async () => {
      await Promise.resolve(); expect(fixedTextChainSelected()).toBe(surface !== 'builder');
    })));
    expect(fixedTextChainSelected()).toBe(false);
  });
  it.each(['health', 'personal', 'confidential', 'public'])('never infers Mitrify eligibility for %s', dataClass => {
    expect(mitrifyChainStatus(dataClass, 'text', { MITRIFY_CHAIN_ENABLED: '1' }).eligible).toBe(false);
  });
  it('keeps Mitrify policy and model in its module without a generic adapter shortcut', () => {
    expect(mitrifyChainStatus('health', 'text', {})).toMatchObject({ reason: 'mitrify-chain-disabled' });
    expect(mitrifyChainStatus('public', 'tool-json', { MITRIFY_CHAIN_ENABLED: '1' })).toMatchObject({ reason: 'mitrify-capability-excluded' });
    expect(mitrifyChainStatus('public', 'text', { MITRIFY_CHAIN_ENABLED: '1', MITRIFY_MODEL: 'custom-policy' })).toMatchObject({ model: 'custom-policy', eligible: false });
    expect(fixedTextChainRank({ providerId: 'MITRIFY', modelId: 'anything', charging: 'verified-free-no-overage' })).toBeUndefined();
  });
});
