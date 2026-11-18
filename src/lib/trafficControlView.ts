/** The client's view of /api/admin/traffic-control, and the one shape check it passes before it is shown. PURE. */
export type SurfaceMode = 'env' | 'legacy';
export type RouteState = 'enabled' | 'draining' | 'disabled';
export interface RouteControlView { state: RouteState; trafficCapPct: number }
export interface AdmissionView {
  required: boolean; capabilityTestAtMs?: number; priceVerifiedAtMs?: number; priceSource?: string;
  securityReviewAtMs?: number; opsTestAtMs?: number; reviewer?: string; expiresAtMs?: number;
}
export interface ModelControlView extends RouteControlView { admission?: AdmissionView }
export interface ControlBodyView {
  global: { gateway: 'on' | 'off' };
  surfaces: Record<string, SurfaceMode>;
  providers: Record<string, RouteControlView>;
  models: Record<string, ModelControlView>;
  /** P3: older routing paths that also obey provider drain/disable. */
  coverage?: Record<string, boolean>;
}
export interface SharedHealthView {
  mode: 'off' | 'observe' | 'on';
  lastPullAtMs: number | null; lastPullOk: boolean; intervalMs: number; writes: number; adopted: number;
  reported: Array<{ provider: string; state: string; kind: string; atMs: number }>;
  families: Array<{ domain: string; providers: string[]; since: number }>;
}
export interface ControlDocView extends ControlBodyView { revision: number; updatedAtMs: number; actor: string; reason: string }
export interface TrafficControlView {
  current: ControlDocView | null;
  thisInstance: { revision: number; enforcingRevision: number; lastReadAtMs: number | null; lastReadOk: boolean; intervalMs: number };
  surfaces: string[];
  providers: Array<{ id: string; name: string; kind: string; family: string }>;
  models: Array<{ key: string; surfaces: string[]; dependsOn: string[] }>;
  admission: Record<string, { required: boolean; gaps: string[] }>;
  paths?: string[];
  sharedHealth?: SharedHealthView;
  history: {
    revisions: Array<{ revision: number; updatedAtMs: number; actor: string; reason: string }>;
    audit: Array<{ atMs: number; actor: string; reason: string; kind: string; fromRevision: number; toRevision: number; changes: string[] }>;
  };
}

const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const int = (v: unknown): v is number => Number.isInteger(v);
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const route = (v: unknown) => rec(v) && ['enabled', 'draining', 'disabled'].includes(v.state as string) && int(v.trafficCapPct);

function isDoc(v: unknown): v is ControlDocView {
  if (!rec(v) || !int(v.revision) || !int(v.updatedAtMs) || !str(v.actor) || !str(v.reason)) return false;
  if (!rec(v.global) || !['on', 'off'].includes(v.global.gateway as string)) return false;
  if (!rec(v.surfaces) || !Object.values(v.surfaces).every(m => m === 'env' || m === 'legacy')) return false;
  return rec(v.providers) && Object.values(v.providers).every(route) && rec(v.models) && Object.values(v.models).every(route);
}

export function isTrafficControlView(v: unknown): v is TrafficControlView {
  if (!rec(v)) return false;
  const t = v.thisInstance;
  if (!(v.current === null || isDoc(v.current)) || !rec(t) || !int(t.revision) || !int(t.enforcingRevision)
    || !(t.lastReadAtMs === null || int(t.lastReadAtMs)) || typeof t.lastReadOk !== 'boolean' || !int(t.intervalMs)) return false;
  if (!strs(v.surfaces) || !Array.isArray(v.providers) || !Array.isArray(v.models) || !rec(v.admission) || !rec(v.history)) return false;
  if (!v.providers.every(p => rec(p) && str(p.id) && str(p.name) && str(p.kind) && str(p.family))) return false;
  if (!v.models.every(m => rec(m) && str(m.key) && strs(m.surfaces) && strs(m.dependsOn))) return false;
  const h = v.history;
  if (v.paths !== undefined && !strs(v.paths)) return false;
  const sh = v.sharedHealth;
  if (sh !== undefined && !(rec(sh) && ['off', 'observe', 'on'].includes(sh.mode as string) && Array.isArray(sh.reported) && Array.isArray(sh.families)
    && sh.reported.every(r => rec(r) && str(r.provider) && str(r.state) && str(r.kind) && int(r.atMs))
    && sh.families.every(f => rec(f) && str(f.domain) && strs(f.providers)))) return false;
  return Array.isArray(h.revisions) && h.revisions.every(r => rec(r) && int(r.revision) && int(r.updatedAtMs) && str(r.actor) && str(r.reason))
    && Array.isArray(h.audit) && h.audit.every(a => rec(a) && int(a.atMs) && str(a.actor) && str(a.reason) && int(a.fromRevision) && int(a.toRevision) && strs(a.changes));
}

/** The body to edit: the saved one, or today's defaults (nothing narrowed). */
export function editableBody(v: TrafficControlView): ControlBodyView {
  const c = v.current;
  return c ? { global: { ...c.global }, surfaces: { ...c.surfaces }, providers: { ...c.providers }, models: { ...c.models }, ...(c.coverage ? { coverage: { ...c.coverage } } : {}) }
    : { global: { gateway: 'on' }, surfaces: {}, providers: {}, models: {} };
}

/** What a save needs before it is sent, in words, or null. */
export function saveProblem(reason: string, totp: string): string | null {
  const n = reason.trim().length;
  if (n < 5) return 'Type a reason first (at least 5 characters). It is kept in the audit log.';
  if (n > 300) return 'The reason is too long. Keep it under 300 characters.';
  if (!/^\d{6}$/.test(totp.trim())) return 'Enter the current 6-digit code from your authenticator app.';
  return null;
}
