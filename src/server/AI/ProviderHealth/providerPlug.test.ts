import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { providerDeclarations, unpluggedFamilies, withoutUnplugged, type ProviderDeclaration } from './providerPlug';
import { catalogueSteps } from './mediaCatalogue';
import { PROVIDER_FAMILIES } from '../../lib/providerSwitches';

const decl = (id: string, unplugged = false): ProviderDeclaration => ({
  id, capabilities: { chat: true, build: true, vision: false, image: false }, priceIn: null, keys: [], adapter: 'free-chain', unplugged,
});

describe('plug-and-play provider removal', () => {
  it('ships with nobody unplugged, and every kill-switch family has one declaration', () => {
    expect(unpluggedFamilies()).toEqual([]);
    const ids = providerDeclarations().map((row) => row.id).sort();
    expect(ids).toEqual(PROVIDER_FAMILIES.map((family) => family.id).sort());
  });

  it('drops one family from chat, the builder, and professional AI, and leaves the rest in order', () => {
    const unplugged = unpluggedFamilies([decl('glm', true), decl('groq')]);
    const chat = withoutUnplugged(
      ['glm45', 'glm47', 'groq', 'deepseek'],
      (id) => (id.startsWith('glm') ? 'glm' : id === 'groq' ? 'groq' : 'deepseek'),
      unplugged,
    );
    expect(chat).toEqual(['groq', 'deepseek']);
    const build = withoutUnplugged(
      [{ provider: 'GLM', model: 'glm-4.7-flashx' }, { provider: 'KIMI', model: 'kimi-k2.7-code' }, { provider: 'GLM', model: 'glm-5.3' }],
      (rung) => (rung.provider === 'GLM' ? 'glm' : 'kimi'),
      unplugged,
    );
    expect(build.map((rung) => rung.model)).toEqual(['kimi-k2.7-code']);
    const professional = withoutUnplugged(
      ['GROK', 'GEMINI', 'VERTEX'],
      (name) => (name === 'GROK' ? 'xai' : name.toLowerCase()),
      ['xai'],
    );
    expect(professional).toEqual(['GEMINI', 'VERTEX']);
  });

  it('drops an unplugged image engine and still returns the other engines', () => {
    expect(catalogueSteps('app', [], ['cloudflare'])).toEqual(['pollinations', 'grok']);
    expect(catalogueSteps('vision', [], ['glm']).includes('GLM')).toBe(false);
    expect(catalogueSteps('vision', [], ['glm'])).toContain('VERTEX');
  });

  it('an empty removal list is the original ladder', () => {
    expect(withoutUnplugged(['a', 'b'], () => 'glm', [])).toEqual(['a', 'b']);
  });

  it('chat, professional AI, the builder, and both image doors ask this list', () => {
    expect(readFileSync('src/server/AI/FreeChain/runtime.ts', 'utf8')).toContain('withoutUnplugged(');
    expect(readFileSync('src/server/AI/Router/AIRouter.ts', 'utf8')).toContain('withoutUnplugged(');
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('presentBuilderRungs(');
    expect(readFileSync('src/server/AI/ProviderHealth/mediaCatalogue.ts', 'utf8')).toContain('withoutUnplugged(');
  });
});
