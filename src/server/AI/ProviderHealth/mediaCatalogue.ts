// Which image and vision engines exist, in one list (owner t407u).
//
// Chat, professional AI and the builder still own their own ladders. This list is the membership of the
// two image doors and of vision (including PDFs). Health may reorder a door's members; it does not add
// one. Deleting a row here removes that engine from every door that listed it. A door with no adapter
// for a row skips it. The admin on/off switch stays `providerSwitches.ts`: switching a family off
// withdraws its keys, and the rung's existing "no key" path skips it. The drain/disable control is
// separate and still off until an admin turns that path on.
//
// How to add or remove a provider: docs/claude/ADD_OR_REMOVE_A_PROVIDER.md
import { withoutUnplugged } from './providerPlug';

export type MediaDoor = 'vision' | 'generator' | 'app';

export interface MediaCatalogueEntry {
  /** The id the door's ladder already uses. Vision ids match `visionProviderOrder`. */
  id: string;
  /** Health-registry name. The same account shares one row across doors. */
  provider: string;
  /** Kill-switch / drain family. Null means this rung has no family yet (the pro host). */
  family: string | null;
  /** Env names that configure it. Values are never read here. */
  keys: readonly string[];
  doors: readonly MediaDoor[];
}

export const MEDIA_CATALOGUE: readonly MediaCatalogueEntry[] = [
  { id: 'cloudflare', provider: 'CLOUDFLARE', family: 'cloudflare', keys: ['CLOUDFLARE_AI_TOKEN'], doors: ['generator', 'app'] },
  { id: 'pollinations', provider: 'POLLINATIONS', family: 'pollinations', keys: ['POLLINATIONS_API_KEY'], doors: ['generator', 'app'] },
  { id: 'pro-host', provider: 'IMAGE_PRO', family: null, keys: ['IMAGE_PRO_KEY', 'IMAGE_PRO_ENDPOINT'], doors: ['generator'] },
  { id: 'gemini', provider: 'GEMINI', family: 'gemini', keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'], doors: ['generator'] },
  { id: 'grok', provider: 'GROK', family: 'xai', keys: ['GROK_API_KEY', 'XAI_API_KEY'], doors: ['generator', 'app'] },
  { id: 'QUBAX', provider: 'QUBAX', family: 'qubax', keys: ['QUBAX_API_KEY'], doors: ['vision'] },
  { id: 'CHEAPERINFERENCE', provider: 'CHEAPERINFERENCE', family: 'cheaperinference', keys: ['CHEAPERINFERENCE_API_KEY'], doors: ['vision'] },
  { id: 'GLM', provider: 'GLM', family: 'glm', keys: ['GLM_API_KEY'], doors: ['vision'] },
  { id: 'VERTEX', provider: 'VERTEX', family: 'vertex', keys: [], doors: ['vision'] },
  { id: 'GEMINI', provider: 'GEMINI', family: 'gemini', keys: ['GEMINI_API_KEY'], doors: ['vision'] },
  { id: 'GROK', provider: 'GROK', family: 'xai', keys: ['GROK_API_KEY', 'XAI_API_KEY'], doors: ['vision'] },
  { id: 'CLAUDE', provider: 'CLAUDE', family: 'anthropic', keys: ['ANTHROPIC_API_KEY'], doors: ['vision'] },
];

/** The engines one door tries, in the ladder's own cost order. `except` drops rows without reordering the rest. */
export function catalogueSteps(door: MediaDoor, except: readonly string[] = [], unplugged?: readonly string[]): string[] {
  const skip = new Set(except);
  const listed = MEDIA_CATALOGUE.filter((entry) => entry.doors.includes(door) && !skip.has(entry.id));
  return withoutUnplugged(listed, (entry) => entry.family, unplugged).map((entry) => entry.id);
}

/** Keep only the ids this door still lists. An id that was removed drops out; the others stay in their order. */
export function keepListed<T extends string>(ids: readonly T[], door: MediaDoor): T[] {
  const listed = new Set(catalogueSteps(door));
  return ids.filter((id) => listed.has(id));
}

export function mediaFamily(id: string): string | null {
  return MEDIA_CATALOGUE.find((entry) => entry.id === id)?.family ?? null;
}

export function mediaProviderName(id: string): string {
  return MEDIA_CATALOGUE.find((entry) => entry.id === id)?.provider ?? id.trim().toUpperCase();
}
