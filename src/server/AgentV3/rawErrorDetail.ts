/**
 * Owner 2026-10-29 (DNA debugging): the REAL technical cause behind a folded public
 * build-engine error, kept in a WeakMap (never an own property, never serialized) so the
 * public boundary stays supplier-free. Surfaced ONLY to surplusFallbackDisabledFor() profiles.
 */
const raw = new WeakMap<object, string>();

function describe(error: unknown): string {
  try {
    if (error instanceof Error) {
      const e = error as Error & { status?: unknown; code?: unknown; cause?: unknown };
      const bits = [`${e.name}: ${e.message}`];
      if (e.status !== undefined) bits.push(`status=${String(e.status)}`);
      if (e.code !== undefined) bits.push(`code=${String(e.code)}`);
      const inner = readRawErrorDetail(error);
      if (inner) bits.push(`inner=${inner}`);
      else if (e.cause instanceof Error) bits.push(`cause=${e.cause.name}: ${e.cause.message}`);
      return bits.join(' · ').slice(0, 1500);
    }
    return String(error).slice(0, 1500);
  } catch { return 'unprintable error'; }
}

export function tagRawErrorDetail<T>(publicError: T, original: unknown, extra?: string): T {
  if (publicError !== null && typeof publicError === 'object' && publicError !== original) {
    const d = describe(original);
    raw.set(publicError, extra ? `${d} · ${extra}` : d);
  }
  return publicError;
}

export function readRawErrorDetail(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' ? raw.get(error) : undefined;
}

/** Best text for a developer: raw detail if tagged, else the error itself. */
export function rawErrorText(error: unknown): string {
  return readRawErrorDetail(error) ?? describe(error);
}
