/**
 * BR2388 — a supplier-free, admin-only reason behind a folded "build engine temporarily unavailable".
 *
 * The public boundary (buildEngineError.ts) deliberately says nothing, and that is right for users. It
 * was also all the build report and the server log said: BR2388 shows 28 Router One refusals as
 * "28 other: The build engine is temporarily unavailable" and a Surplus death as
 * "mid_build_engine_unavailable" — not which gate refused, nor which stage failed with what HTTP status.
 *
 * This keeps a small enumerated reason in a WeakMap (never an own property, never serialized, never in
 * the error message), so the public error, the user's chat copy and the user's report are unchanged.
 * Only enumerated tokens and an integer HTTP status are accepted: an upstream body, URL, key or
 * provider name can never become a value here — anything else is dropped, not escaped.
 */
export interface EngineSafeDiag {
  /** Router One pre-dispatch gate, e.g. `reserve_fenced_unresolved`. */
  gate?: string;
  /** Surplus scope-failure stage/reason (scopeFailureDiagnostic.ts) and the public safe reason. */
  stage?: string;
  reason?: string;
  safe?: string;
  /** Last HTTP status seen for this call, integer 100–599 only. */
  status?: number;
}

const diags = new WeakMap<object, Readonly<EngineSafeDiag>>();
const TOKEN = /^[a-z][a-z0-9_]{0,47}$/;
const KEYS = ['gate', 'stage', 'reason', 'safe'] as const;

/** Keep only enumerated tokens and an integer HTTP status; everything else is dropped. */
export function sanitizeEngineSafeDiag(diag: EngineSafeDiag | undefined): EngineSafeDiag {
  const out: EngineSafeDiag = {};
  if (!diag || typeof diag !== 'object') return out;
  for (const k of KEYS) {
    const v = diag[k];
    if (typeof v === 'string' && TOKEN.test(v)) out[k] = v;
  }
  if (Number.isSafeInteger(diag.status) && (diag.status as number) >= 100 && (diag.status as number) <= 599) out.status = diag.status;
  return out;
}

export function tagEngineSafeDiag<T>(error: T, diag: EngineSafeDiag): T {
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
    const clean = sanitizeEngineSafeDiag(diag);
    if (Object.keys(clean).length) diags.set(error as object, Object.freeze(clean));
  }
  return error;
}

export function readEngineSafeDiag(error: unknown): Readonly<EngineSafeDiag> | undefined {
  return error !== null && (typeof error === 'object' || typeof error === 'function') ? diags.get(error as object) : undefined;
}

/** `gate=… stage=… reason=… safe=… status=…` (only the present fields), or '' when nothing is known. */
export function engineSafeDiagText(diag: EngineSafeDiag | undefined): string {
  const d = sanitizeEngineSafeDiag(diag);
  const parts: string[] = [];
  for (const k of KEYS) if (d[k] !== undefined) parts.push(`${k}=${d[k]}`);
  if (d.status !== undefined) parts.push(`status=${d.status}`);
  return parts.join(' ');
}

/** The admin-report marker: `[engine-diag: gate=…]`, or '' when nothing is known. */
export function formatEngineSafeDiag(error: unknown): string {
  const text = engineSafeDiagText(readEngineSafeDiag(error));
  return text ? `[engine-diag: ${text}]` : '';
}

/** Append the admin-only marker to a report detail. Unchanged when the error carries no diag. */
export function withEngineSafeDiag(detail: string, error: unknown): string {
  const marker = formatEngineSafeDiag(error);
  return marker ? `${detail} ${marker}` : detail;
}

/** The user's report never carries the marker (userFacingReport strips it). */
const MARKER_RE = /\s*\[engine-diag:[^\]]*\]/g;
export function stripEngineSafeDiag(text: string): string {
  return text.replace(MARKER_RE, '');
}

/**
 * A rung error that says "this rung cannot succeed again in THIS build" (BR2388: Router One's spend
 * lock is held by an unresolved earlier call). The multi-provider runner retires only the rung that
 * threw, for that runner's run — it never benches a family, another key, or another build.
 */
const restOfBuild = new WeakSet<object>();
export function markRestOfBuildSkip<T>(error: T): T {
  if (error !== null && typeof error === 'object') restOfBuild.add(error as object);
  return error;
}
export function isRestOfBuildSkip(error: unknown): boolean {
  return error !== null && typeof error === 'object' && restOfBuild.has(error as object);
}

/**
 * BR2388 review — the transport (fetch) threw before ANY HTTP response existed. Set by
 * routerOneAccountingFetch on the error it rethrows (the SDK keeps it as `cause`). Billing reads it,
 * together with the absence of a status, output and usage, to settle a call that never got a response.
 */
const transportNoResponse = new WeakSet<object>();
export function markTransportNoResponse<T>(error: T): T {
  if (error !== null && typeof error === 'object') transportNoResponse.add(error as object);
  return error;
}
export function isTransportNoResponse(error: unknown): boolean {
  return error !== null && typeof error === 'object' && transportNoResponse.has(error as object);
}
