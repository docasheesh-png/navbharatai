// A SMALL, LOCAL INDEX OF SESSION HISTORY — so the History screen paints instantly
// (admin 2026-08-31: "history load hone me bahut time lagta hai … agar user ke app me bhi store ho
// jaye to chalega").
//
// WHY IT WAS SLOW, measured against the code rather than guessed:
//
//   HistoryView subscribes with `where('userId','==',uid)` and NO limit, then waits for that first
//   snapshot before rendering anything. And a `chat_sessions` document is not small — App.tsx writes
//   into every one of them:
//     • `messages`         — the full transcript
//     • `restoredMessages` — a SECOND full transcript
//     • `files`            — the entire file contents of a built app
//   So opening a list of TITLES downloads every message and every source file the user has ever had.
//   For someone who has built a few apps that is megabytes, and they watch a skeleton for all of it.
//
//   The sting: the sessions were already on the device in `navbharat_sessions` the whole time — that
//   copy was read ONLY inside the Firestore error handler, so it helped when the network failed and
//   never when the network was merely slow.
//
// WHAT THIS FIXES. The list needs a title, a time, a mode and a couple of flags — a few hundred bytes
// per session. This keeps exactly that, so the screen can render from disk on the first frame while
// Firestore catches up in the background and corrects anything stale.
//
// ⚠️ DELIBERATELY NOT A CACHE OF THE SESSIONS THEMSELVES. Storing transcripts and app files in
// localStorage would refill the same 5MB budget this is trying to stay out of, and `navbharat_sessions`
// already holds the full copies. An index row carries NO message text and NO file contents — opening a
// session still reads the real thing.

/** One row of the list — everything HistoryView renders and filters on, and nothing else. */
export interface HistoryIndexRow {
  id: string;
  title: string;
  lastUpdated: string;
  uci?: string;
  /** Mirrors the fields the filters read (`isV3Session` / `isProSession` / `isSdaSession`). */
  agent?: string;
  current_agent?: string;
  original_agent?: string;
  tab?: string;
  mode?: string;
  isPinned?: boolean;
  /** `isAppSession` only asks WHETHER there are files, never what they are — so a count is enough
   *  and the contents never touch this store. */
  fileCount?: number;
  /** Message count, for the row's subtitle. The text itself is not kept. */
  messageCount?: number;
}

export const HISTORY_INDEX_KEY = 'navbharat_history_index_v1';

/**
 * How many rows to keep. A cap, not a page size: the list is virtualised by the browser and 300 rows
 * of a few hundred bytes is well under a hundred KB, while an uncapped index on a heavy account would
 * creep back toward the quota this exists to avoid.
 */
export const HISTORY_INDEX_MAX = 300;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Reduce a full session to its row. Pure. */
export function toIndexRow(session: Record<string, any>): HistoryIndexRow | null {
  const id = str(session?.id);
  if (!id) return null; // a row with no id cannot be opened, so it is not worth storing
  const files = session?.files;
  const messages = session?.messages;
  return {
    id,
    title: str(session?.title) || 'Untitled',
    lastUpdated: str(session?.lastUpdated),
    uci: str(session?.uci) || undefined,
    agent: str(session?.agent) || undefined,
    current_agent: str(session?.current_agent ?? session?.currentAgent) || undefined,
    original_agent: str(session?.original_agent ?? session?.originalAgent) || undefined,
    tab: str(session?.tab) || undefined,
    mode: str(session?.mode) || undefined,
    isPinned: !!session?.isPinned,
    fileCount: files && typeof files === 'object' ? Object.keys(files).length : 0,
    messageCount: Array.isArray(messages) ? messages.length : 0,
  };
}

/** Newest first, capped. Rows with no timestamp sort last rather than being dropped. */
export function buildHistoryIndex(sessions: unknown, max = HISTORY_INDEX_MAX): HistoryIndexRow[] {
  if (!Array.isArray(sessions)) return [];
  const rows: HistoryIndexRow[] = [];
  for (const s of sessions) {
    const row = toIndexRow(s as Record<string, any>);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => {
    const ta = a.lastUpdated ? Date.parse(a.lastUpdated) : 0;
    const tb = b.lastUpdated ? Date.parse(b.lastUpdated) : 0;
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
  return rows.slice(0, Math.max(0, max));
}

/**
 * Read the index. Returns [] for anything unreadable — a corrupt or absent cache must degrade to
 * "no head start", never to a thrown error on the first frame of a screen.
 */
export function readHistoryIndex(): HistoryIndexRow[] {
  try {
    const raw = localStorage.getItem(HISTORY_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Write the index. Silently gives up when storage refuses (private mode, a full quota) — this is a
 * HEAD START, never the source of truth, so failing to save it must not surface to the user or
 * interrupt the render. Firestore still has everything.
 */
export function writeHistoryIndex(rows: HistoryIndexRow[]): void {
  try {
    localStorage.setItem(HISTORY_INDEX_KEY, JSON.stringify(rows.slice(0, HISTORY_INDEX_MAX)));
  } catch {
    // Quota or a disabled store. Nothing to do and nothing to say.
  }
}
