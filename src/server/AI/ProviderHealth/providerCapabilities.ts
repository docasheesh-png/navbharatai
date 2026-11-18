// Which configured services can chat, build, read a picture, or make a picture.
//
// The lists are the ones the product already uses: the vision chain's own order, and the image
// engines ImageAiGenerator already accepts. This file does not add a provider and does not read a key.

/** Providers `visionProviderOrder` can call (visionChain.ts). */
export const VISION_PROVIDER_IDS = ['QUBAX', 'CHEAPERINFERENCE', 'GLM', 'VERTEX', 'GEMINI', 'GROK', 'CLAUDE'] as const;

/** Engines `ImageAiGenerator` accepts (IMAGE_PROVIDER / its own key names). */
export const IMAGE_PROVIDER_IDS = ['navbharatai', 'pollinations', 'openai', 'gemini', 'xai', 'stability'] as const;

export interface ProviderCapabilities {
  chat: boolean;
  build: boolean;
  vision: boolean;
  imageGen: boolean;
  /** Not measured by a probe yet. Absent is not a score of zero. */
  longContext: null;
  hindiProbe: null;
}

export function providerCapabilities(id: string, buildProviders: ReadonlySet<string>): ProviderCapabilities {
  const name = String(id ?? '').trim().toUpperCase().replace(/#\d+$/, '');
  const image = new Set(IMAGE_PROVIDER_IDS.map((x) => x.toUpperCase()));
  const vision = new Set<string>([...VISION_PROVIDER_IDS, 'ENGINE_QX']);
  return {
    chat: !['NAVBHARATAI', 'POLLINATIONS', 'STABILITY'].includes(name),
    build: buildProviders.has(name),
    vision: vision.has(name),
    imageGen: image.has(name) || name === 'GEMINI' || name === 'OPENAI' || name === 'XAI' || name === 'GROK',
    longContext: null,
    hindiProbe: null,
  };
}
