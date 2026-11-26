/**
 * ONE FAILED READ NEVER SINKS THE ADMIN ANALYTICS PAGE (admin 2026-11-25: "Could not read the platform analytics: Internal
 * server error … yeh error hatao"). The page's reads are independent; one Promise.all turned any single failure (a missing
 * index, a permission, a timeout) into one opaque 500 with every tile at a fake 0. Each read goes through `settledRead`: a
 * success is returned as is; a failure is NAMED in `unread` (which read, the fields it feeds, its Firestore code) and an
 * empty value stands in — and the page says those numbers are not real. Never throws.
 */
export interface UnreadAnalytics { read: string; fields: string[]; code: string | null; message: string }

export async function settledRead<T>(unread: UnreadAnalytics[], read: string, fields: string[], p: Promise<T>, empty: T, log: (o: object) => void = (o) => console.error('[ADMIN_ANALYTICS_READ_FAILED]', o)): Promise<T> {
  try { return await p; } catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    const code = err?.code != null ? String(err.code) : null;
    const message = String(err?.message ?? e).slice(0, 300);
    unread.push({ read, fields, code, message });
    try { log({ read, code, message }); } catch { /* logging never breaks the page */ }
    return empty;
  }
}
