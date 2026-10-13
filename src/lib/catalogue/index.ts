// THE SKU CATALOGUE — one place every sellable thing is described (go-live PR 8, audit 2026-10-13).
//
// PURE. No env, no clock, no I/O, so the browser and the server read the identical catalogue.
//
// Phase 1 of the move: the catalogue is DERIVED from the existing constants (hostingTiers.ts,
// hostingAddons.ts, sharedData's ops cap), so no price or quota changes and nothing that reads the old
// constants breaks. A test pins the two views equal. Later PRs move callers onto `skuById` and then flip
// the direction (constants derived from the catalogue).
//
// Prices are integer PAISE here (no float money). `sellable` mirrors today's switch; a paid SKU that
// needs a third-party reseller authorisation also names it in `requiresAuthorization` and stays
// unsellable until that is recorded (owner item O-2).

import { HOSTING_TIERS, FREE_PUBLISHED_APPS, FREE_FRONTEND_GB, FREE_BACKEND_APPS, HOSTING_OVERAGE_INR_PER_GB } from '../hostingTiers';
import { HOSTING_ADDONS } from '../hostingAddons';

export type SkuCategory = 'plan' | 'frontend' | 'backend' | 'database' | 'domain' | 'traffic';
export type SkuMode = 'managed' | 'byo';
export type SkuPeriod = 'once' | '30d' | 'metered';

export interface Sku {
  id: string;
  version: number;
  category: SkuCategory;
  mode: SkuMode;
  /** Adapter key (src/server/providers). Never shown to users (white-label). */
  providerKey: string;
  name: string;
  summary: string;
  pricePaise: number;
  period: SkuPeriod;
  quotas: Readonly<Record<string, number>>;
  sellable: boolean;
  /** Env flag that must be on for this SKU to be offered. Null = governed by the legacy switches. */
  flag: string | null;
  /** A commercial authorisation that must exist before this SKU may be sold. */
  requiresAuthorization: string | null;
  /** Where the legacy constant lives, for the pin test and for readers. */
  legacyRef: string;
}

const paise = (inr: number): number => Math.round(inr * 100);

const ADDON_META: Record<string, { category: SkuCategory; providerKey: string; auth: string | null }> = {
  extra_site: { category: 'frontend', providerKey: 'nbai-static', auth: null },
  extra_domain: { category: 'domain', providerKey: 'nbai-domain', auth: null },
  server: { category: 'backend', providerKey: 'gcp-cloudrun', auth: null },
  shared_db: { category: 'database', providerKey: 'nbai-shared', auth: null },
  dedicated_db: { category: 'database', providerKey: 'supabase-platform', auth: 'supabase-reseller' },
  traffic_gb: { category: 'traffic', providerKey: 'nbai-meter', auth: null },
};

export const FREE_SKU: Sku = {
  id: 'plan.free', version: 1, category: 'plan', mode: 'managed', providerKey: 'nbai-plan',
  name: 'Free', summary: 'Build and publish small apps.', pricePaise: 0, period: '30d',
  quotas: { publishedApps: FREE_PUBLISHED_APPS, frontendGb: FREE_FRONTEND_GB, backendApps: FREE_BACKEND_APPS },
  sellable: false, flag: null, requiresAuthorization: null, legacyRef: 'hostingTiers.FREE_*',
};

export const SKUS: readonly Sku[] = Object.freeze([
  FREE_SKU,
  ...HOSTING_TIERS.map((t): Sku => ({
    id: `plan.${t.id}`, version: 1, category: 'plan', mode: 'managed', providerKey: 'nbai-plan',
    name: t.name, summary: t.tagline, pricePaise: paise(t.priceInr), period: '30d',
    quotas: {
      publishedApps: t.publishedApps, backendApps: t.backendApps, domains: t.domains,
      frontendGb: t.includedFrontendGb, backendGb: t.includedBackendGb, days: t.days,
    },
    sellable: true, flag: null, requiresAuthorization: null, legacyRef: `hostingTiers.${t.id}`,
  })),
  ...HOSTING_ADDONS.map((a): Sku => {
    const m = ADDON_META[a.id] ?? { category: 'backend' as SkuCategory, providerKey: 'unknown', auth: null };
    return {
      id: `addon.${a.id}`, version: 1, category: m.category, mode: 'managed', providerKey: m.providerKey,
      name: a.name, summary: a.summary, pricePaise: paise(a.priceInr), period: a.id === 'traffic_gb' ? 'metered' : '30d',
      quotas: { max: a.max, days: a.days, ...(a.id === 'shared_db' ? { ops: 20_000 } : {}) },
      sellable: a.sellable && !m.auth, flag: null, requiresAuthorization: m.auth, legacyRef: `hostingAddons.${a.id}`,
    };
  }),
  {
    id: 'byo.supabase', version: 1, category: 'database', mode: 'byo', providerKey: 'supabase-byo',
    name: 'Your own Supabase', summary: 'Connect your Supabase account. Its bill stays with you; NavBharatAI charges nothing for it.',
    pricePaise: 0, period: 'once', quotas: {}, sellable: true, flag: null, requiresAuthorization: null, legacyRef: 'supabaseIntegration',
  },
]);

export const OVERAGE_PAISE_PER_GB = paise(HOSTING_OVERAGE_INR_PER_GB);

export function skuById(id: string | null | undefined): Sku | null {
  return SKUS.find((s) => s.id === id) ?? null;
}

/** May this SKU be offered now? Unsellable, unauthorised, or flag-off ⇒ no. PURE (env passed in). */
export function skuOffered(sku: Sku | null, env: Record<string, string | undefined> = {}): boolean {
  if (!sku || !sku.sellable || sku.requiresAuthorization) return false;
  if (sku.flag && !/^(1|true|on|yes)$/i.test(String(env[sku.flag] ?? ''))) return false;
  return true;
}

export function rupees(pricePaise: number): string {
  const r = pricePaise / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString('en-IN') : r.toFixed(2)}`;
}
