/** The client's view of /api/admin/provider-switches, and the one shape check it passes before it is shown. PURE. */
export interface ProviderSwitchRowView { id: string; name: string; on: boolean; hasKey: boolean | null }
export interface ProviderSwitchChangeView { at: number; by: string; id: string; on: boolean; reason: string }
export interface ProviderSwitchesView {
  revision: number;
  updatedAt: number | null;
  syncMs: number;
  thisInstance: { at: number | null; ok: boolean; enforcingOff: string[] };
  providers: ProviderSwitchRowView[];
  history: ProviderSwitchChangeView[];
}
const str = (v: unknown): v is string => typeof v === 'string';
const int = (v: unknown): v is number => Number.isInteger(v);
const numOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));

export function isProviderSwitchesView(v: unknown): v is ProviderSwitchesView {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  const t = d.thisInstance as Record<string, unknown> | undefined;
  if (!int(d.revision) || !numOrNull(d.updatedAt) || !int(d.syncMs) || !t || !numOrNull(t.at) || typeof t.ok !== 'boolean'
    || !Array.isArray(t.enforcingOff) || !t.enforcingOff.every(str) || !Array.isArray(d.providers) || !Array.isArray(d.history)) return false;
  return d.providers.every((p) => {
    const x = p as Record<string, unknown>;
    return !!x && str(x.id) && str(x.name) && typeof x.on === 'boolean' && (x.hasKey === null || typeof x.hasKey === 'boolean');
  }) && d.history.every((h) => {
    const x = h as Record<string, unknown>;
    return !!x && typeof x.at === 'number' && str(x.by) && str(x.id) && typeof x.on === 'boolean' && str(x.reason);
  });
}

/**
 * Has THIS server applied the shared state yet? True when every provider the shared state has off is being
 * refused here. A different server may still be up to `syncMs` behind — the panel says so.
 */
export function thisInstanceEnforces(v: ProviderSwitchesView): boolean {
  const want = v.providers.filter((p) => !p.on).map((p) => p.id).sort();
  const have = [...v.thisInstance.enforcingOff].sort();
  return want.length === have.length && want.every((id, i) => id === have[i]);
}

/**
 * What is missing before a switch can be saved, in words, or null. PURE. The server requires 3–300 characters;
 * the button used to sit disabled until then with nothing saying why (admin 2026-11-04: "off ho hi nahi raha").
 */
export function switchReasonProblem(reason: string): string | null {
  const n = reason.trim().length;
  if (n < 3) return 'Type a reason first (at least 3 characters) — for example "balance finished". It is kept in the change history.';
  if (n > 300) return 'The reason is too long — keep it under 300 characters.';
  return null;
}
