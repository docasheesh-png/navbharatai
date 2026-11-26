/**
 * Which admin-analytics reads failed in the server's answer (admin 2026-11-25: "Could not read the platform analytics:
 * Internal server error … yeh error hatao"). The server now settles each of its reads on its own and names the ones that
 * failed in `unread`; the page shows the rest as real and says exactly which numbers are not. A server body is checked
 * here, at the one place it enters state — anything malformed is dropped, never trusted. PURE.
 */
export interface AnalyticsUnread { read: string; fields: string[]; code: string | null; message: string }

export function analyticsUnreadOf(body: unknown): AnalyticsUnread[] {
  const list = body && typeof body === 'object' ? (body as { unread?: unknown }).unread : undefined;
  if (!Array.isArray(list)) return [];
  const out: AnalyticsUnread[] = [];
  for (const u of list.slice(0, 12)) {
    if (!u || typeof u !== 'object') continue;
    const r = u as Record<string, unknown>;
    if (typeof r.read !== 'string' || !r.read.trim()) continue;
    out.push({
      read: r.read.slice(0, 120),
      fields: Array.isArray(r.fields) ? r.fields.filter((f): f is string => typeof f === 'string').slice(0, 12) : [],
      code: typeof r.code === 'string' ? r.code.slice(0, 60) : null,
      message: typeof r.message === 'string' ? r.message.slice(0, 300) : '',
    });
  }
  return out;
}
