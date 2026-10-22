import { afterEach, describe, expect, it } from 'vitest';
import { runWithInferenceScope } from '../src/server/AI/inferencePolicy';
const old = process.env.STRICT_FREE_MODULES_ENABLED;
afterEach(() => { if (old === undefined) delete process.env.STRICT_FREE_MODULES_ENABLED; else process.env.STRICT_FREE_MODULES_ENABLED = old; });
describe('actual legacy provider entrypoints cannot dispatch in strict scope', () => {
  it.each(['AnthropicProvider', 'GeminiProvider', 'GlmProvider', 'GrokProvider', 'OpenAiChatProvider', 'VertexProvider'])('%s rejects before touching any SDK client', async name => {
    process.env.STRICT_FREE_MODULES_ENABLED = 'true';
    const module = await import(`../src/server/AI/Router/providers/${name}.ts`);
    // No constructor, credential or SDK client exists: guards must precede all client access.
    const provider = Object.create(module[name].prototype);
    await expect(runWithInferenceScope('free-modules', () => provider.execute('test'))).rejects.toMatchObject({ code: 'STRICT_FREE_CAPABILITY_UNAVAILABLE' });
    await expect(runWithInferenceScope('free-modules', () => provider.executeStream('test', undefined, () => {}))).rejects.toMatchObject({ code: 'STRICT_FREE_CAPABILITY_UNAVAILABLE' });
  });
});
