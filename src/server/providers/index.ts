// PROVIDER REGISTRY (go-live PR 9).
//
// Connect-your-own Supabase is wired for real (it is the customer's account and the customer's bill).
// Every NavBharatAI-MANAGED adapter is registered but DISABLED: no reseller authorisation exists yet
// (owner item O-2), so `available()` refuses unless PROVIDERS_MANAGED_ENABLED=on AND the specific
// adapter's authorisation flag is set. Nothing in this PR is called by a route yet.

import { parseEnvFlag } from '../lib/envFlag';
import type { ProviderAdapter, TenantRef } from './types';

export interface ByoSupabaseDeps {
  status: (uid: string) => Promise<{ connected: boolean; orgName: string | null }>;
  provision: (uid: string, input: { workspaceId: string }) => Promise<{ ok: true; projectRef: string; projectName: string; url: string } | { ok: false; status: number; error: string; projectRef?: string }>;
  disconnect: (uid: string) => Promise<boolean>;
}

export function byoSupabaseAdapter(deps: ByoSupabaseDeps): ProviderAdapter {
  return {
    key: 'supabase-byo',
    mode: 'byo',
    available: () => ({ ok: true, reason: '' }),
    async connectionStatus(t: TenantRef) {
      const s = await deps.status(t.uid).catch(() => ({ connected: false, orgName: null }));
      return { connected: s.connected, detail: s.connected ? `Connected${s.orgName ? ` to ${s.orgName}` : ''}` : 'Not connected' };
    },
    async provision({ tenant }) {
      const r = await deps.provision(tenant.uid, { workspaceId: tenant.workspaceId }).catch((e) => ({ ok: false as const, status: 500, error: String((e as Error)?.message ?? 'failed') }));
      if (!r.ok) return { ok: false, retryable: r.status === 202 || r.status >= 500, status: r.status, error: r.error, ...(r.projectRef ? { resourceRef: r.projectRef } : {}) };
      // The keys were written to the vault by provisionDatabaseForUser; only non-secret facts come back.
      return { ok: true, resourceRef: r.projectRef, publicInfo: { projectName: r.projectName, url: r.url }, secretsStored: true };
    },
    async disconnect(t) { return { ok: await deps.disconnect(t.uid).catch(() => false) }; },
  };
}

/** A managed adapter placeholder that refuses everything until authorised. */
export function disabledManagedAdapter(key: string, authFlag: string, env: NodeJS.ProcessEnv = process.env): ProviderAdapter {
  const available = () => {
    if (!(parseEnvFlag(env.PROVIDERS_MANAGED_ENABLED) ?? false)) return { ok: false, reason: 'Managed services from NavBharatAI are not switched on yet.' };
    if (!(parseEnvFlag(env[authFlag]) ?? false)) return { ok: false, reason: `Not authorised to sell this service yet (${authFlag}).` };
    return { ok: true, reason: '' };
  };
  return {
    key, mode: 'managed', available,
    async provision() {
      const a = available();
      // Even when switched on, this placeholder never creates anything: the real wrapper lands in its own PR.
      return { ok: false, retryable: false, status: 503, error: a.ok ? 'This service is not wired yet. Nothing was created or charged.' : `${a.reason} Nothing was created or charged.` };
    },
  };
}

export const MANAGED_ADAPTER_AUTH_FLAGS: Readonly<Record<string, string>> = Object.freeze({
  'supabase-platform': 'PROVIDER_AUTH_SUPABASE_RESELL',
  'nbai-shared': 'PROVIDER_AUTH_NBAI_SHARED',
  'gcp-cloudrun': 'PROVIDER_AUTH_GCP_CLOUDRUN',
});

export function buildRegistry(byo: ByoSupabaseDeps, env: NodeJS.ProcessEnv = process.env): Map<string, ProviderAdapter> {
  const m = new Map<string, ProviderAdapter>();
  m.set('supabase-byo', byoSupabaseAdapter(byo));
  for (const [k, flag] of Object.entries(MANAGED_ADAPTER_AUTH_FLAGS)) m.set(k, disabledManagedAdapter(k, flag, env));
  return m;
}

/** Production wiring for the BYO adapter (lazy imports keep this module test-light). */
export async function liveByoSupabaseDeps(): Promise<ByoSupabaseDeps> {
  const store = await import('../lib/supabaseConnectionStore');
  const flow = await import('../lib/supabaseProvisionFlow');
  return {
    status: (uid) => store.getConnectionStatus(uid),
    provision: (uid, input) => flow.provisionDatabaseForUser(uid, { workspaceId: input.workspaceId }),
    disconnect: (uid) => store.deleteConnection(uid),
  };
}
