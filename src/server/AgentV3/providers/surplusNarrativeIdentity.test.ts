import { describe, expect, it } from 'vitest';
import { guardSurplusNarrative, SERVICE_IDENTITY_REPLY, SURPLUS_SERVICE_IDENTITY_INSTRUCTION, withServiceIdentity } from './surplusNarrativeIdentity';
import { PublicBuildEngineError } from '../../lib/buildEngineError';
const identity = { model: 'reviewed-model.v1', providerId: 'reviewed-provider' };
describe('service identity narrative boundary', () => {
  it('states service identity without claiming foundation-model ownership/training', () => {
    expect(SURPLUS_SERVICE_IDENTITY_INSTRUCTION).toContain('You are NavBharatAI Pro');
    expect(SURPLUS_SERVICE_IDENTITY_INSTRUCTION).toContain('Never claim NavBharatAI trained, owns, or authored');
    expect(SURPLUS_SERVICE_IDENTITY_INSTRUCTION).toContain('never falsely deny a provider relationship');
    expect(withServiceIdentity('Existing task')).toBe(SURPLUS_SERVICE_IDENTITY_INSTRUCTION + '\n\nExisting task');
    expect(withServiceIdentity()).toBe(SURPLUS_SERVICE_IDENTITY_INSTRUCTION);
  });
  it.each([
    'I am reviewed-model.v1.', "I'm Surplus.", 'I am an AI assistant powered by reviewed-provider.',
    'My model is reviewed-model.v1.', 'My provider is reviewed-provider.',
    'This service is routed through Surplus Intelligence.', 'Our build engine uses reviewed-provider.',
    'NavBharatAI Pro runs on reviewed-model.v1.', 'We are served by Surplus.',
    'I am running on `reviewed-model.v1`.', 'Main reviewed-model.v1 hoon.',
    'Mera provider hai reviewed-provider.', 'मैं reviewed-model.v1 हूँ।',
  ])('rewrites explicit own identity/routing: %s', text => {
    expect(guardSurplusNarrative(text, identity)).toBe(SERVICE_IDENTITY_REPLY);
  });
  it.each([
    'Integrate Surplus Intelligence into your app.', 'I am adding reviewed-provider support to your app.',
    'I use reviewed-model.v1 in the example integration you requested.',
    'Compare reviewed-model.v1 with another model for my application.',
    'The Surplus API can be used by your app with your credentials.',
    'Your service is powered by reviewed-provider.', 'The example response says "I am Surplus".',
    'I am a helpful assistant.', 'A surplus of inventory was reported.',
    '> I am Surplus.\n', '    I am Surplus.\n',
  ])('preserves legitimate discussion/integration/quotation: %s', text => {
    expect(guardSurplusNarrative(text, identity)).toBe(text);
  });
  it('preserves unrelated sentences on the same line as a disclosure', () => {
    const following = ' Your OpenAI integration is ready; set OPENAI_API_KEY in settings.';
    expect(guardSurplusNarrative('I am Surplus.' + following, identity)).toBe(SERVICE_IDENTITY_REPLY + following);
    expect(guardSurplusNarrative('Build ready. I am Surplus. Your integration is ready.', identity))
      .toBe('Build ready. ' + SERVICE_IDENTITY_REPLY + ' Your integration is ready.');
    expect(guardSurplusNarrative('I am Surplus. My provider is reviewed-provider. Keep this sentence.', identity))
      .toBe(SERVICE_IDENTITY_REPLY + ' ' + SERVICE_IDENTITY_REPLY + ' Keep this sentence.');
  });
  it('preserves fenced code byte-for-byte, including longer/tilde/unclosed fences', () => {
    for (const fence of ['```', '~~~~', '````']) {
      const code = `${fence}ts\nconst narrative = "I am Surplus.";\nI am reviewed-model.v1.\n${fence}\n`;
      expect(guardSurplusNarrative('I am Surplus.\n' + code + 'My model is reviewed-model.v1.', identity))
        .toBe(SERVICE_IDENTITY_REPLY + '\n' + code + SERVICE_IDENTITY_REPLY);
      expect(guardSurplusNarrative(fence + '\nI am Surplus.', identity)).toBe(fence + '\nI am Surplus.');
    }
  });
  it('guards only the active model family alias, not unrelated brands or integration discussion', () => {
    const selected = { model: 'deepseek-v4.1', providerId: 'seller-a' };
    expect(guardSurplusNarrative('I am DeepSeek.', selected)).toBe(SERVICE_IDENTITY_REPLY);
    expect(guardSurplusNarrative('I am DeepSeek.', identity)).toBe('I am DeepSeek.');
    expect(guardSurplusNarrative('I am Claude.', selected)).toBe('I am Claude.');
    expect(guardSurplusNarrative('Add a DeepSeek integration to your app.', selected)).toBe('Add a DeepSeek integration to your app.');
    expect(guardSurplusNarrative('```js\nconst name = "I am DeepSeek.";\n```', selected)).toBe('```js\nconst name = "I am DeepSeek.";\n```');
  });
  it.each([['qwen3.8-flash', 'Qwen'], ['qwen3-coder-next', 'Qwen'], ['minimax-m2.5', 'MiniMax']])('scopes the %s candidate family without censoring integrations', (model, family) => {
    const selected = { model, providerId: 'seller-a' };
    expect(guardSurplusNarrative(`I am ${family}. Keep your app instructions.`, selected)).toBe(SERVICE_IDENTITY_REPLY + ' Keep your app instructions.');
    const integration = `Add ${family} to my application using the documented API.`;
    expect(guardSurplusNarrative(integration, selected)).toBe(integration);
    const code = '```js\nconst label = "I am ' + family + '.";\n```';
    expect(guardSurplusNarrative(code, selected)).toBe(code);
    expect(guardSurplusNarrative(`I am ${family}.`, identity)).toBe(`I am ${family}.`);
  });
  it('escapes exact model identifiers rather than treating punctuation as regex', () => {
    expect(guardSurplusNarrative('I am reviewed-modelXv1.', identity)).toBe('I am reviewed-modelXv1.');
    expect(guardSurplusNarrative('I am model[1]+.', { model: 'model[1]+', providerId: 'provider' })).toBe(SERVICE_IDENTITY_REPLY);
    expect(guardSurplusNarrative('I am SurplusPlus.', identity)).toBe('I am SurplusPlus.');
  });
  it('preserves line endings and handles the whole transport text bound without truncating files', () => {
    expect(guardSurplusNarrative('I am Surplus.\r\nBuild ready.\r\n', identity)).toBe(SERVICE_IDENTITY_REPLY + '\r\nBuild ready.\r\n');
    const code = '```\n' + 'x'.repeat(4 * 1024 * 1024 - 8) + '\n```';
    expect(guardSurplusNarrative(code, identity)).toBe(code);
    expect(() => guardSurplusNarrative(code + 'x', identity)).toThrow(PublicBuildEngineError);
  });
});
