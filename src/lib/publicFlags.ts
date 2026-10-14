/**
 * Browser side of /api/public-flags. Every flag is FALSE until the server says otherwise, and on
 * any error, so a failed fetch always shows today's UI.
 */
import { useEffect, useState } from 'react';

export interface PublicFlags { walletV2Ui: boolean; planModelPro: boolean; byoLifecycle: boolean }
export const PUBLIC_FLAGS_OFF: PublicFlags = Object.freeze({ walletV2Ui: false, planModelPro: false, byoLifecycle: false });

export function parsePublicFlags(raw: unknown): PublicFlags {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { walletV2Ui: o.walletV2Ui === true, planModelPro: o.planModelPro === true, byoLifecycle: o.byoLifecycle === true };
}

let cached: Promise<PublicFlags> | null = null;
export function fetchPublicFlags(): Promise<PublicFlags> {
  cached ??= fetch('/api/public-flags', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then(parsePublicFlags)
    .catch(() => PUBLIC_FLAGS_OFF);
  return cached;
}

export function usePublicFlags(): PublicFlags {
  const [f, setF] = useState<PublicFlags>(PUBLIC_FLAGS_OFF);
  useEffect(() => { let live = true; void fetchPublicFlags().then((x) => { if (live) setF(x); }); return () => { live = false; }; }, []);
  return f;
}
