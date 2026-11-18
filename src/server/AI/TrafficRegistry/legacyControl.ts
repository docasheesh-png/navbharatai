/**
 * Traffic Manager V2, P3: the control store's drain/disable reaching the OLDER routing paths (owner-approved,
 * 2026-11-18: "continue, until full work done").
 *
 * 🔒 OFF UNTIL THE ADMIN TURNS IT ON, PATH BY PATH. A path reads provider drain/disable only when the control
 * document's `coverage[path]` is true. An empty store, or coverage left off, is exactly today's routing — and
 * switching one path's coverage off again is the per-path rollback, with no deploy.
 *
 * What a covered path does: before it calls a provider for a NEW attempt it asks `legacyPathAllows`; a provider that
 * is `draining` or `disabled` is skipped like any other unavailable rung, and the path moves on to its next rung.
 *   · it is SKIP ONLY — no rung is added, none is reordered, and the builder never leaves the selected tier;
 *   · an attempt already running finishes; nothing is re-run or charged twice;
 *   · traffic caps are NOT applied here: these paths have no stable logical request id, and a cap that flipped
 *     between attempts of one request would be worse than none. Caps stay gateway-only, said so on the panel.
 */
import type { ControlDoc } from './controlTypes';
import { currentTrafficControl } from './controlSync';
import { FREE_CHAIN_RUNG_PROVIDER } from './snapshot';

export const LEGACY_PATHS = ['free-chain', 'chat-router', 'builder'] as const;
export type LegacyPath = typeof LEGACY_PATHS[number];

/**
 * The engine labels the chat router and the builder report → the kill-switch family they bill. Pool suffixes
 * (`GLM#2`) are the same account. A label not listed is never blocked here (and the census test fails when a
 * builder engine label is added without an entry).
 */
export const ENGINE_FAMILY: Readonly<Record<string, string>> = Object.freeze({
  GLM: 'glm', KIMI: 'kimi', CLAUDE: 'anthropic', CLAUDE_HAIKU: 'anthropic', CLAUDE_OPUS: 'anthropic', ANTHROPIC: 'anthropic',
  OPENAI: 'openai', GROK: 'xai', XAI: 'xai', VERTEX: 'vertex', GEMINI: 'gemini', DEEPSEEK: 'deepseek', GROQ: 'groq',
  SURPLUS: 'surplus', ENGINE_R1: 'router-one', ENGINE_BM: 'bluesminds', ENGINE_MY: 'moyi', ENGINE_QX: 'qubax',
  ENGINE_MF: 'mitrify', ENGINE_DT: 'discountedtokens', QUBAX: 'qubax', MITRIFY: 'mitrify', CLOUDFLARE: 'cloudflare',
  OPENROUTER: 'openrouter', DEEPINFRA: 'deepinfra', CHEAPERINFERENCE: 'cheaperinference', BEDROCK: 'bedrock',
  // The builder's Nemotron rung is served through OpenRouter by default (see registry snapshot, P1).
  NEMOTRON: 'openrouter',
});

export function familyOfEngineName(name: string): string | null {
  const key = String(name ?? '').trim().toUpperCase().replace(/#\d+$/, '');
  return Object.hasOwn(ENGINE_FAMILY, key) ? ENGINE_FAMILY[key] : null;
}

/** Free Chat rung id → family. The two suppliers placed in front of the chain are their own accounts. */
export function familyOfFreeChainRung(id: string): string | null {
  if (id === 'mitrify' || id === 'qubax') return id;
  return Object.hasOwn(FREE_CHAIN_RUNG_PROVIDER, id) ? FREE_CHAIN_RUNG_PROVIDER[id as keyof typeof FREE_CHAIN_RUNG_PROVIDER] : null;
}

/** May this covered path start a NEW attempt on this provider family? */
export function legacyPathAllows(path: LegacyPath, family: string | null, doc: ControlDoc | null = currentTrafficControl()): boolean {
  if (!doc || !family || doc.coverage?.[path] !== true) return true;
  const state = doc.providers[family]?.state;
  return state !== 'draining' && state !== 'disabled';
}
