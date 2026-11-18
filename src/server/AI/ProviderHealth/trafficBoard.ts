// The AI Engines board: live health joined to the providers Test Chat already lists.
// Prices come from the existing rate card. A missing price stays missing.

import { realRateFor } from '../../AgentV3/providerRates';
import { providerCapabilities, VISION_PROVIDER_IDS, IMAGE_PROVIDER_IDS, type ProviderCapabilities } from './providerCapabilities';
import { canonProvider, trafficProviderViews, type TrafficProviderView, type TrafficState } from './trafficHealth';

export interface TrafficCatalogRow {
  id: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  model: string | null;
}

export interface TrafficAlert {
  provider: string;
  issue: 'needs recharge' | 'key issue' | 'down';
  detail: string;
}

export interface TrafficBoardRow extends TrafficProviderView {
  label: string;
  configured: boolean;
  enabled: boolean;
  price: { inputPerMTok: number; outputPerMTok: number } | null;
  capabilities: ProviderCapabilities;
}

export interface TrafficBoard {
  rows: TrafficBoardRow[];
  alerts: TrafficAlert[];
  vision: readonly string[];
  imageGen: readonly string[];
}

function priceOf(provider: string, model: string | null): TrafficBoardRow['price'] {
  try {
    const rate = realRateFor(provider.replace(/#\d+$/, ''), model ?? undefined);
    if (!rate || !Number.isFinite(rate.inputPerMTok) || !Number.isFinite(rate.outputPerMTok)) return null;
    return { inputPerMTok: rate.inputPerMTok, outputPerMTok: rate.outputPerMTok };
  } catch {
    return null;
  }
}

function alertFor(row: TrafficBoardRow): TrafficAlert | null {
  if (row.state === 'up') return null;
  const detail = row.reason || (row.state === 'suspended' ? 'The provider reported it cannot take calls.' : 'Recent calls timed out or were rejected.');
  if (row.state === 'down') return { provider: row.provider, issue: 'down', detail };
  if (/key|auth|permission/i.test(detail) && !/balance|quota|recharge|credit/i.test(detail)) {
    return { provider: row.provider, issue: 'key issue', detail };
  }
  return { provider: row.provider, issue: 'needs recharge', detail };
}

export function buildTrafficBoard(catalog: TrafficCatalogRow[], buildProviders: readonly string[], now = Date.now()): TrafficBoard {
  const build = new Set(buildProviders.map(canonProvider));
  const views = new Map(trafficProviderViews(now).map((view) => [view.provider, view]));
  const seen = new Set<string>();
  const rows: TrafficBoardRow[] = [];
  const add = (id: string, label: string, configured: boolean, enabled: boolean, model: string | null) => {
    const provider = canonProvider(id);
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    const view = views.get(provider);
    const base: TrafficProviderView = view ?? {
      provider, state: 'up' as TrafficState, reason: null, inFlight: 0, samples: 0, errorRate: {},
      totalP50: null, totalP95: null, firstByteP50: null, firstByteP95: null, model, recoverAt: 0,
      changedAt: 0, lastFailureKind: null,
    };
    rows.push({
      ...base,
      model: base.model ?? model,
      label,
      configured,
      enabled,
      price: priceOf(provider, base.model ?? model),
      capabilities: providerCapabilities(provider, build),
    });
  };
  for (const row of catalog) add(row.id, row.label, row.configured, row.enabled, row.model);
  for (const view of views.values()) if (!seen.has(view.provider)) add(view.provider, view.provider, true, true, view.model);
  const alerts = rows.map(alertFor).filter((item): item is TrafficAlert => item !== null);
  return { rows, alerts, vision: VISION_PROVIDER_IDS, imageGen: IMAGE_PROVIDER_IDS };
}
