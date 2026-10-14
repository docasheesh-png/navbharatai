// PROVIDER ADAPTER CONTRACT (go-live PR 9, audit 2026-10-13).
//
// Every service NavBharatAI sells or connects goes through one of these. Adapters WRAP the code that
// already works (supabaseProvisionFlow, platformDatabase, sharedDataStore, cloudRunHosting) — they do
// not re-implement it. Secrets never come back through this interface: `provision` stores them through
// the injected secret sink and returns only non-secret references.

export interface TenantRef { uid: string; workspaceId: string }

export type ProvisionOutcome =
  | { ok: true; resourceRef: string; publicInfo: Record<string, string>; secretsStored: boolean }
  | { ok: false; retryable: boolean; status: number; error: string; resourceRef?: string };

export type ResourceState = 'creating' | 'ready' | 'failed' | 'gone' | 'unknown';

export interface ProviderAdapter {
  key: string;
  mode: 'managed' | 'byo';
  /** Whether this adapter may be used right now (flags, authorisation, configuration). */
  available(): { ok: boolean; reason: string };
  /** BYO only: is the user's connection present and usable? */
  connectionStatus?(tenant: TenantRef): Promise<{ connected: boolean; detail: string }>;
  provision(req: { tenant: TenantRef; skuId: string; idempotencyKey: string }): Promise<ProvisionOutcome>;
  status?(resourceRef: string): Promise<ResourceState>;
  disconnect?(tenant: TenantRef): Promise<{ ok: boolean }>;
  deprovision?(tenant: TenantRef, resourceRef: string): Promise<{ ok: boolean }>;
  /** Resources this adapter believes exist, for orphan reconciliation (report-only). */
  listOwned?(): Promise<Array<{ resourceRef: string; tenantHint?: string }>>;
}
