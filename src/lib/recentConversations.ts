// recentConversations — the list that answers *"old session kis button ke piche hide na ho"*.
//
// ADMIN 2026-09-17: the app's past conversations were reachable only by pressing something — the
// History button (which opens a popup over the Free chat), or the hamburger, then History. The
// request is that they stop being hidden: *"old session kis button ke piche hide na ho"*.
//
// 🔴 A "RECENT CHATS" BLOCK WAS BUILT ONCE AND THE ADMIN HAD IT REMOVED — 2026-07-01, verbatim
// *"isko hata do, koi matalb ka nahi hai"* (PR #799, removed in `ca8b6786`). That is recorded here
// rather than quietly re-added, because rebuilding a rejected thing under a new name is how a
// product accumulates screens nobody wanted. What was removed was a list of the last 8 chats
// **pinned to the bottom of the hamburger menu** — which is to say, behind a button, inside a menu,
// below the navigation, with no search and no way to tell one "New Conversation" from another. It
// did not make history discoverable and it did not resume anything; the admin was right.
//
// What is different now, and why this is not that:
//   • it is on the screen the app OPENS on, not inside a menu — the literal request;
//   • it spans Free, Pro AND the professionals, which is what the admin's sentence describes
//     (*"free chat ke sath bahut sare, professionals bhi hai"*);
//   • it is ordered by real recency across all three stores (see `lastPlace`'s activity ledger),
//     instead of pinning every ongoing professional above everything else;
//   • and it is the SECOND half of a feature whose first half actually resumes the conversation, so
//     the common case is not tapping this list at all.
//
// 🔒 IT INVENTS NO LIST LOGIC. The rows come from readers that already exist and are already tested
// — `historyIndex` (the local session index), `readProfessionalHistory`, and `resolveSessionSurface`
// for deciding which surface a saved session belongs to. A second opinion about what "Free history"
// means is exactly how two screens start disagreeing.

import { resolveSessionSurface } from './sessionRouting';
import { placeKey } from './lastPlace';
import type { HistoryIndexRow } from './historyIndex';
import type { ViewType } from '../types';

/** What a professional history reader gives us. Structural, so this module needs no import cycle. */
export interface ProfessionalItemLike {
  id: string;
  name: string;
  preview: string;
  /** Present for an ENDED conversation; absent for the one that is still live. */
  endedAt?: number;
}

export type RecentKind = 'free' | 'pro' | 'doctor' | 'professional';

export interface RecentConversation {
  /** Stable React key, and the ledger address this row's time came from. */
  key: string;
  kind: RecentKind;
  /** The surface to open. */
  view: string;
  /** For a Free/Pro session — what `handleRestoreUci` is called with. */
  sessionId?: string;
  /** For an ENDED professional conversation — which one to make live again. */
  profEndedAt?: number;
  title: string;
  /** The badge: "Free chat", "NavBharatAI Pro", or the professional's own name. */
  tag: string;
  /**
   * When it was last touched, or null when genuinely unknown.
   *
   * 🔒 NULL IS NOT ZERO. A live professional conversation from before the activity ledger existed
   * has no recorded time anywhere, and writing a 0 (or a `Date.now()`) would be inventing one — it
   * would either bury a real conversation at the bottom for ever or float an old one to the top.
   * The row renders "Ongoing" instead, which is what it honestly is.
   */
  at: number | null;
}

/** How many rows Home shows. Enough to recognise yesterday's work, short enough not to be a screen. */
export const RECENT_LIMIT = 6;

const FREE_TAG = 'Free chat';
const PRO_TAG = 'NavBharatAI Pro';
const DOCTOR_TAG = 'Doctor AI';

function cleanTitle(raw: string | undefined, fallback: string): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t === 'New Conversation' || t === 'Untitled') return fallback;
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

/** A saved session's time, from its own `lastUpdated`. Unparseable ⇒ null, never 0. */
function sessionTime(row: HistoryIndexRow): number | null {
  if (!row.lastUpdated) return null;
  const t = Date.parse(row.lastUpdated);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** Turn one saved Free/Pro session into a row. */
export function sessionRow(row: HistoryIndexRow): RecentConversation | null {
  if (!row?.id) return null;
  // An empty session is not something to offer somebody — "continue" on a conversation with nothing
  // in it is a button that does nothing visible.
  if ((row.messageCount ?? 0) <= 1) return null;
  const agent = row.current_agent || row.agent || row.original_agent || 'navbharatai';
  const { targetTab, isProSession, isSdaSession } = resolveSessionSurface(agent, row.tab as ViewType | undefined);
  const kind: RecentKind = isSdaSession ? 'doctor' : isProSession ? 'pro' : 'free';
  const tag = kind === 'doctor' ? DOCTOR_TAG : kind === 'pro' ? PRO_TAG : FREE_TAG;
  return {
    key: placeKey(targetTab, row.id),
    kind,
    view: targetTab,
    sessionId: row.id,
    title: cleanTitle(row.title, tag),
    tag,
    at: sessionTime(row),
  };
}

/** Turn one professional conversation (live or ended) into a row. */
export function professionalRow(
  item: ProfessionalItemLike,
  activity: Record<string, number>,
): RecentConversation | null {
  if (!item?.id) return null;
  // An ENDED conversation knows exactly when it ended. A LIVE one has no time of its own, so the
  // activity ledger is the only honest source — and null when even that has nothing.
  const at = item.endedAt ?? activity[placeKey(item.id)] ?? null;
  return {
    key: `${item.id}#${item.endedAt ?? 'live'}`,
    kind: 'professional',
    view: item.id,
    ...(item.endedAt !== undefined ? { profEndedAt: item.endedAt } : {}),
    title: cleanTitle(item.preview, item.name),
    tag: item.name,
    at,
  };
}

/**
 * Newest first. A row with NO known time sorts last rather than being dropped — it is a real
 * conversation, and hiding it would be a worse answer than showing it without a date.
 */
export function sortRecent(rows: RecentConversation[]): RecentConversation[] {
  return [...rows].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

export interface RecentInput {
  sessions: readonly HistoryIndexRow[];
  professionals: readonly ProfessionalItemLike[];
  activity: Record<string, number>;
  limit?: number;
}

/**
 * The merged, ordered, capped list Home renders.
 *
 * The activity ledger OVERRIDES a session's own `lastUpdated` when it is newer, because the ledger
 * is stamped the moment the user is looking at a conversation while `lastUpdated` only moves when a
 * message is written. Somebody who opened a chat, read it and left has genuinely been there most
 * recently, and the list should say so.
 */
export function recentConversations(input: RecentInput): RecentConversation[] {
  const activity = input.activity ?? {};
  const rows: RecentConversation[] = [];

  for (const s of input.sessions ?? []) {
    const row = sessionRow(s);
    if (!row) continue;
    const touched = activity[row.key];
    if (typeof touched === 'number' && touched > (row.at ?? 0)) row.at = touched;
    rows.push(row);
  }
  for (const p of input.professionals ?? []) {
    const row = professionalRow(p, activity);
    if (row) rows.push(row);
  }

  // One conversation must not appear twice. The professional readers list a live conversation and
  // its archived siblings separately, which is correct — they ARE different conversations — but a
  // session row and a ledger entry can describe the same thing.
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));

  const limit = typeof input.limit === 'number' && input.limit > 0 ? input.limit : RECENT_LIMIT;
  return sortRecent(unique).slice(0, limit);
}
