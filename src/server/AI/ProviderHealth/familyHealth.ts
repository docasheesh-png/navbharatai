/**
 * Traffic Manager V2, P3 — owner improvement #1: "Do not mark an entire upstream family as down because of one
 * provider failure. Distinguish account-specific failures, rate limits, model failures, and verified upstream
 * outages. Use independent evidence before applying family-wide suppression."
 *
 * PURE and DISPLAY-ONLY in P3: it names a suspected shared outage for the admin; no ladder reads it, so it cannot
 * suppress or reorder anything. A later phase may use it to diversify the gateway's fallback order, and only then.
 *
 * The rule:
 *  · only `down` providers count, and only for outage-shaped failures (timeouts, invalid/empty completions, other
 *    transport failures). A `suspended` account (empty balance, revoked key) is that ACCOUNT's problem; a rate
 *    limit never marks a provider down at all. Neither is evidence about the upstream;
 *  · each failing provider is mapped to the outage domains its route depends on (P1's `routeDependencies`); a
 *    reseller's OWN domain (`reseller:x`) and `unknown` are not shared domains;
 *  · a domain is a suspected outage only when at least TWO DIFFERENT providers that depend on it are down within the
 *    window. One provider failing, however often, is that provider's problem.
 */
import { familyOfEngineName, familyOfFreeChainRung } from '../TrafficRegistry/legacyControl';
import { routeDependencies, UNKNOWN } from '../TrafficRegistry/upstreamFamilies';
import type { TrafficErrorKind, TrafficState } from './trafficHealth';

export const FAMILY_WINDOW_MS = 10 * 60 * 1000;
export const FAMILY_MIN_PROVIDERS = 2;

export interface HealthObservation { provider: string; state: TrafficState; kind: TrafficErrorKind; at: number; model?: string | null; source: 'local' | 'shared' }
export interface FamilyVerdict { domain: string; providers: string[]; since: number }

/** The kill-switch family a health row belongs to, from the labels the paths record under. */
export function familyOfHealthProvider(name: string): string | null {
  const raw = String(name ?? '').trim();
  const chain = /^free-chat-chain:(.+)$/i.exec(raw);
  if (chain) return familyOfFreeChainRung(chain[1].toLowerCase());
  return familyOfEngineName(raw);
}

const OUTAGE_KINDS: ReadonlySet<TrafficErrorKind> = new Set<TrafficErrorKind>(['timeout', 'invalid', 'other']);

export function suspectedFamilyOutages(observations: readonly HealthObservation[], now: number): FamilyVerdict[] {
  const byDomain = new Map<string, { providers: Set<string>; since: number }>();
  for (const o of observations) {
    if (o.state !== 'down' || !OUTAGE_KINDS.has(o.kind) || now - o.at > FAMILY_WINDOW_MS) continue;
    const family = familyOfHealthProvider(o.provider);
    if (!family) continue;
    let deps: string[];
    try { deps = routeDependencies(family, o.model ?? '').dependsOn; } catch { continue; }
    for (const d of deps) {
      if (d === UNKNOWN || d.startsWith('reseller:')) continue;
      const entry = byDomain.get(d) ?? { providers: new Set<string>(), since: o.at };
      entry.providers.add(family);
      entry.since = Math.min(entry.since, o.at);
      byDomain.set(d, entry);
    }
  }
  return [...byDomain.entries()].filter(([, e]) => e.providers.size >= FAMILY_MIN_PROVIDERS)
    .map(([domain, e]) => ({ domain, providers: [...e.providers].sort(), since: e.since }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
