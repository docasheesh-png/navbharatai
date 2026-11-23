// One place that says a provider is in or out (owner t407u).
//
// The ladders already know how to call each current provider. This module does not replace those
// ladders and it does not invent a price. A row with `unplugged: true` is dropped by chat, professional
// AI, the builder tier, and image/vision. The other rungs stay in their order. A door that has no
// adapter for an id skips it, so a half-added provider cannot take the reply down.
//
// How to add or remove a provider: docs/claude/ADD_OR_REMOVE_A_PROVIDER.md

import { PROVIDER_FAMILIES } from '../../lib/providerSwitches';

export interface ProviderCapabilities {
  chat: boolean;
  build: boolean;
  vision: boolean;
  image: boolean;
}

export interface ProviderDeclaration {
  id: string;
  capabilities: ProviderCapabilities;
  /** USD per million input tokens when this provider has one rate. Null means the ladder's own price stands. */
  priceIn: number | null;
  /** Env names only. Never a key value. */
  keys: readonly string[];
  /** The existing adapter that already speaks this provider. A new protocol names the new function. */
  adapter: string;
  unplugged: boolean;
}

interface PlugOverlay {
  capabilities: ProviderCapabilities;
  adapter: string;
  priceIn?: number | null;
  unplugged?: boolean;
}

const NONE: ProviderCapabilities = { chat: false, build: false, vision: false, image: false };

/** Edit this table to declare a provider, or set `unplugged: true` to drop it from every wired ladder. */
const PLUG_OVERLAY: Readonly<Record<string, PlugOverlay>> = {
  glm: { capabilities: { chat: true, build: true, vision: true, image: false }, adapter: 'free-chain' },
  gemini: { capabilities: { chat: true, build: false, vision: true, image: true }, adapter: 'vision-chain' },
  vertex: { capabilities: { chat: true, build: false, vision: true, image: false }, adapter: 'professional' },
  xai: { capabilities: { chat: true, build: false, vision: true, image: true }, adapter: 'image-ladder' },
  anthropic: { capabilities: { chat: true, build: true, vision: true, image: false }, adapter: 'tier-ladder' },
  openai: { capabilities: { chat: true, build: true, vision: false, image: true }, adapter: 'tier-ladder' },
  groq: { capabilities: { chat: true, build: false, vision: false, image: false }, adapter: 'free-chain' },
  deepseek: { capabilities: { chat: true, build: false, vision: false, image: false }, adapter: 'free-chain' },
  cloudflare: { capabilities: { chat: true, build: false, vision: false, image: true }, adapter: 'image-ladder' },
  pollinations: { capabilities: { chat: false, build: false, vision: false, image: true }, adapter: 'image-ladder' },
  qubax: { capabilities: { chat: true, build: true, vision: true, image: false }, adapter: 'free-chain' },
  mitrify: { capabilities: { chat: true, build: false, vision: false, image: false }, adapter: 'free-chain' },
  cheaperinference: { capabilities: { chat: true, build: false, vision: true, image: false }, adapter: 'vision-chain' },
  openrouter: { capabilities: { chat: true, build: true, vision: false, image: false }, adapter: 'free-chain' },
  deepinfra: { capabilities: { chat: true, build: false, vision: false, image: false }, adapter: 'free-chain' },
  kimi: { capabilities: { chat: false, build: true, vision: false, image: false }, adapter: 'tier-ladder' },
  nvidia: { capabilities: { chat: true, build: false, vision: false, image: false }, adapter: 'free-chain' },
  modelscope: { capabilities: { chat: true, build: false, vision: false, image: false }, adapter: 'free-chain' },
  llm7: { capabilities: { chat: true, build: false, vision: false, image: false }, adapter: 'free-chain' },
  bluesminds: { capabilities: { chat: true, build: true, vision: false, image: false }, adapter: 'tier-ladder' },
  requesty: { capabilities: { chat: true, build: false, vision: false, image: false }, adapter: 'free-chain' },
  surplus: { capabilities: { chat: false, build: true, vision: false, image: false }, adapter: 'tier-ladder' },
  'router-one': { capabilities: { chat: false, build: true, vision: false, image: false }, adapter: 'tier-ladder' },
  moyi: { capabilities: { chat: false, build: true, vision: false, image: false }, adapter: 'tier-ladder' },
  discountedtokens: { capabilities: { chat: false, build: true, vision: false, image: false }, adapter: 'tier-ladder' },
};

export function providerDeclarations(overlay: Readonly<Record<string, PlugOverlay>> = PLUG_OVERLAY): ProviderDeclaration[] {
  const seen = new Set<string>();
  const out: ProviderDeclaration[] = [];
  for (const family of PROVIDER_FAMILIES) {
    seen.add(family.id);
    const row = overlay[family.id];
    out.push({
      id: family.id,
      capabilities: row?.capabilities ?? NONE,
      priceIn: row?.priceIn ?? null,
      keys: family.keys.filter((key): key is string => typeof key === 'string'),
      adapter: row?.adapter ?? family.id,
      unplugged: row?.unplugged === true,
    });
  }
  for (const [id, row] of Object.entries(overlay)) {
    if (seen.has(id)) continue;
    out.push({ id, capabilities: row.capabilities, priceIn: row.priceIn ?? null, keys: [], adapter: row.adapter, unplugged: row.unplugged === true });
  }
  return out;
}

export function unpluggedFamilies(declarations: readonly ProviderDeclaration[] = providerDeclarations()): string[] {
  return declarations.filter((row) => row.unplugged).map((row) => row.id);
}

/** Drop rungs whose family is unplugged. A family of null stays. Order of the rest is unchanged. */
export function withoutUnplugged<T>(items: readonly T[], familyOf: (item: T) => string | null, unplugged: readonly string[] = unpluggedFamilies()): T[] {
  if (unplugged.length === 0) return [...items];
  const skip = new Set(unplugged);
  return items.filter((item) => {
    const family = familyOf(item);
    return !family || !skip.has(family);
  });
}
