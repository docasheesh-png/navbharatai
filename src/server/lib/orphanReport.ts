/**
 * Go-live PR 17 — orphan resources: REPORT ONLY.
 *
 * Compares what each provider adapter says exists (`listOwned`) with what our records say we
 * created. Anything a provider has that we have no record of is an orphan candidate; anything we
 * recorded that the provider no longer has is a dangling record. This module NEVER deletes:
 * it has no delete dependency at all, so it cannot. Cleanup is a separate owner decision.
 */
import type { ProviderAdapter } from '../providers/types';

export interface KnownResource { providerKey: string; resourceRef: string; uid: string }

export interface OrphanReport {
  orphans: Array<{ providerKey: string; resourceRef: string; tenantHint?: string }>;
  dangling: KnownResource[];
  skipped: Array<{ providerKey: string; reason: string }>;
}

export async function buildOrphanReport(adapters: Iterable<ProviderAdapter>, known: readonly KnownResource[]): Promise<OrphanReport> {
  const report: OrphanReport = { orphans: [], dangling: [], skipped: [] };
  for (const a of adapters) {
    if (!a.listOwned) { report.skipped.push({ providerKey: a.key, reason: 'adapter cannot list resources' }); continue; }
    let owned: Array<{ resourceRef: string; tenantHint?: string }>;
    try { owned = await a.listOwned(); } catch (e) {
      // A failed listing must not make every record look dangling.
      report.skipped.push({ providerKey: a.key, reason: `listing failed: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
      continue;
    }
    const ownedRefs = new Set(owned.map((o) => o.resourceRef));
    const mine = known.filter((k) => k.providerKey === a.key);
    const knownRefs = new Set(mine.map((k) => k.resourceRef));
    for (const o of owned) if (!knownRefs.has(o.resourceRef)) report.orphans.push({ providerKey: a.key, ...o });
    for (const k of mine) if (!ownedRefs.has(k.resourceRef)) report.dangling.push(k);
  }
  const by = (x: { providerKey: string; resourceRef: string }, y: typeof x) => (x.providerKey + x.resourceRef).localeCompare(y.providerKey + y.resourceRef);
  report.orphans.sort(by); report.dangling.sort(by);
  return report;
}
