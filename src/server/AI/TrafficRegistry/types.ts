/**
 * Traffic Manager V2, P1: the shapes of the read-only registry snapshot.
 *
 * Nothing here routes, gates or bills. The snapshot only DESCRIBES what NavBharatAI already calls, read from the
 * code that already defines it (the kill-switch families, the API provider directory, the Free Chat chain, the
 * builder tier ladders, the reseller gateways). Later phases read it; this phase changes no request.
 */

/** Where a fact in the snapshot was read from. Every record names its sources so nothing is a hidden copy. */
export type RegistrySource = 'provider-switch' | 'api-directory' | 'free-chain' | 'builder-ladder' | 'reseller-gateway';

/** Which NavBharatAI surface uses a model, as far as the static sources say. */
export type RegistrySurface = 'chat' | 'builder';

/**
 * How we know what a provider depends on.
 *  · direct      — the provider serves from its own infrastructure (it IS the upstream).
 *  · model-route — a reseller whose model id names the serving host (e.g. `deepinfra/...` on Requesty).
 *  · unverified  — a reseller or router whose serving host is not known to us. It is NEVER treated as
 *                  independent of the model's own maker, and when even that is unknown, of anything.
 */
export type UpstreamEvidence = 'direct' | 'model-route' | 'unverified';

export interface ProviderRecord {
  /** Same id as the kill switch (`providerSwitches.ts`) and the API provider directory. */
  id: string;
  name: string;
  /** 'direct' serves its own models; 'reseller' forwards to someone else's. */
  kind: 'direct' | 'reseller';
  /** Its own outage domain. For a direct provider this is the upstream family; for a reseller, `reseller:<id>`. */
  family: string;
  evidence: UpstreamEvidence;
  /** Has a working kill switch today. */
  killSwitch: boolean;
  /** Listed in the API provider directory (billing link, balance). */
  inDirectory: boolean;
  /** The directory's live balance probe, when the provider has a documented balance API. */
  balanceProbe: string | null;
  sources: RegistrySource[];
}

export interface ModelRecord {
  /** `<providerId>/<modelId>` — unique in the snapshot. */
  key: string;
  providerId: string;
  modelId: string;
  /** Who made the weights, from the model id (`zhipu`, `deepseek`, `openai`, …) or `unknown`. */
  maker: string;
  /**
   * Every outage domain this route may share. Two routes are independent fallbacks ONLY when these sets are
   * disjoint and neither contains `unknown` (see `independentRoutes`).
   */
  dependsOn: string[];
  evidence: UpstreamEvidence;
  surfaces: RegistrySurface[];
  /**
   * Every configured price for this route, one per way NavBharatAI buys it. The same model can be bought on
   * different terms (Gemini Flash-Lite is both a free rung and a paid rung), so prices are never merged into one.
   * Empty means the route is priced at dispatch elsewhere (the builder's rate card, a supplier's own receipt).
   */
  offers: Array<{ via: string; inPerM: number; outPerM: number; source: 'free-chain-config' }>;
  sources: RegistrySource[];
}

export interface RegistrySnapshot {
  /** Bumped when the snapshot's SHAPE changes, never by content. */
  schemaVersion: 1;
  providers: ProviderRecord[];
  models: ModelRecord[];
  /** Facts the static sources could not settle, said plainly (e.g. a router whose serving host is unknown). */
  notes: string[];
}
