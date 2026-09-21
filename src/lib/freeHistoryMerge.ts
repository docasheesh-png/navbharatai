// freeHistoryMerge — ONE history list for the FREE surface (admin 2026-08-25: "navbharatai free ki
// history me sabhi (free + professionals) ki history ayegi, tag ke sath").
//
// Professional conversations live in localStorage (`prof_<id>_…`), free/doctor sessions live in
// Firestore `chat_sessions` — two stores that can only meet in the view. These helpers turn the
// professional items into PSEUDO-SESSION rows shaped like the Firestore ones, so HistoryView renders
// one merged, tagged list without a second rendering path. PURE, so the merge rules are test-pinned.

export interface ProfHistoryLike {
  id: string;
  name: string;
  preview: string;
  /** Present for an ENDED (archived) conversation; absent for an open one. */
  endedAt?: number;
  /** Present for an OPEN conversation — a professional can hold several (2026-09-21). */
  conversationId?: string;
}

export interface ProfessionalPseudoSession {
  /** Namespaced so it can never collide with a Firestore doc id. */
  id: string;
  title: string;
  lastUpdated: string | null;
  profViewId: string;
  profEndedAt?: number;
  /** The open conversation this row is — what "Open" must show. Absent on an ended row. */
  profConversationId?: string;
  profName: string;
  /** True for a conversation that is still open — it has no end time, it is simply "ongoing". */
  profLive: boolean;
}

export function professionalRows(items: ProfHistoryLike[], _now: number): ProfessionalPseudoSession[] {
  return (items ?? []).map((it) => ({
    id: `prof:${it.id}#${it.endedAt ?? it.conversationId ?? 'live'}`,
    title: it.preview?.trim() || it.name,
    lastUpdated: it.endedAt ? new Date(it.endedAt).toISOString() : null,
    profViewId: it.id,
    ...(it.endedAt ? { profEndedAt: it.endedAt } : {}),
    ...(it.conversationId ? { profConversationId: it.conversationId } : {}),
    profName: it.name,
    profLive: !it.endedAt,
  }));
}

/**
 * Newest first — with the LIVE professional conversations pinned to the top. A live buffer stores no
 * timestamp (it never needed one before this view), so its honest sort key is "ongoing right now",
 * not an invented date; the row also RENDERS "Ongoing" rather than a fabricated time.
 */
export function sortMergedRows<T extends { lastUpdated?: string | null; profLive?: boolean }>(rows: T[], now: number): T[] {
  const ts = (r: T): number => {
    if (r.profLive) return now + 1; // ahead of everything dated
    const t = r.lastUpdated ? new Date(r.lastUpdated).getTime() : 0;
    return Number.isFinite(t) ? t : 0;
  };
  return [...rows].sort((a, b) => ts(b) - ts(a));
}
