// Where a Professional AI conversation lives, and what "close" actually means to it.
//
// THE BUG THIS EXISTS TO KILL (admin 2026-08-19: "jab user professional me kisi ai se bat karta hai,
// aur close (x) kar de, to chat close nahi hota"). Pressing ✕ removed the tab, but ProfessionalChat
// restores itself from localStorage on mount — so reopening Lawyer AI put the user straight back into
// the conversation they had just ended. Doctor AI was the ONE professional that behaved correctly,
// because App's closeTab happened to carry a hand-written branch for it; the other ~70 had none. That
// is the real root cause: the close behaviour was a per-screen special case instead of a rule.
//
// WHY NOT SIMPLY DELETE THE KEY. `prof_<id>_messages` is not a cache — it is the ONLY copy of the
// user's professional history, and it is exactly what ProfessionalHistoryView reads. Deleting it on ✕
// would have made the ✕ button quietly destroy history the user never asked to lose. So closing
// ARCHIVES the conversation and clears the live one: the chat genuinely ends, and the transcript is
// still there in Professional History, where it can also be resumed.
//
// Everything here is pure over an injected store, so the rules are testable without a browser and the
// key names exist in exactly one place (they were previously spelled out in two files).

export interface ProfMsg {
  role: 'user' | 'assistant';
  content: string;
}

export interface ArchivedConversation {
  /** When the user closed it (ms since epoch) — also this conversation's id within the professional. */
  endedAt: number;
  messages: ProfMsg[];
}

/** The minimum of `localStorage` this module needs — so tests need no DOM. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The LIVE conversation — what ProfessionalChat restores on mount. Unchanged key: existing chats keep working. */
export const activeKey = (id: string): string => `prof_${id}_messages`;

/** Conversations the user has ENDED with ✕, newest first. */
export const archiveKey = (id: string): string => `prof_${id}_archive`;

/** How many ended conversations we keep per professional. localStorage is small and shared app-wide. */
export const MAX_ARCHIVED_PER_PROFESSIONAL = 5;

/** localStorage, or null where it is unavailable (private mode, SSR) — callers degrade, never throw. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(store: KeyValueStore, key: string): T | null {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The live messages of one professional (empty when there is no conversation). */
export function readActive(store: KeyValueStore, id: string): ProfMsg[] {
  const parsed = readJson<ProfMsg[]>(store, activeKey(id));
  return Array.isArray(parsed) ? parsed : [];
}

/** The ended conversations of one professional, newest first. */
export function readArchive(store: KeyValueStore, id: string): ArchivedConversation[] {
  const parsed = readJson<ArchivedConversation[]>(store, archiveKey(id));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((c) => c && typeof c.endedAt === 'number' && Array.isArray(c.messages));
}

/**
 * Is this a real conversation, or just the assistant's opening greeting?
 *
 * The greeting is written by the app, not the user, so a professional the user only glanced at must
 * not show up as history — and must not be archived when they close it.
 */
export function hasRealExchange(messages: ProfMsg[]): boolean {
  return messages.some((m) => m?.role === 'user' && String(m?.content || '').trim().length > 0);
}

/**
 * Write the archive, shedding the oldest entries if the browser refuses the write.
 *
 * localStorage is a few MB shared by the whole app, so a full quota is a real state, not a theoretical
 * one. Returns what was actually stored so the caller can be honest about it.
 */
function writeArchive(store: KeyValueStore, id: string, conversations: ArchivedConversation[]): boolean {
  // An EMPTY archive has to be written too — as a removal. Looping down to 1 left the old value in
  // place, so deleting the last ended conversation (or resuming it) silently did nothing.
  if (conversations.length === 0) {
    try { store.removeItem(archiveKey(id)); return true; } catch { return false; }
  }
  for (let keep = conversations.length; keep >= 1; keep--) {
    try {
      store.setItem(archiveKey(id), JSON.stringify(conversations.slice(0, keep)));
      return true;
    } catch {
      // Quota — try again keeping fewer of the OLDEST conversations (the slice keeps the newest).
    }
  }
  return false;
}

/**
 * End the live conversation with `id`: archive it (if it is a real one) and clear the live slot, so the
 * next time the user opens this professional they get a fresh chat.
 *
 * Returns true when a conversation was archived.
 *
 * THE ONE DELIBERATE TRADE-OFF: if the browser cannot store the archive at all (quota full even for a
 * single conversation), the live slot is STILL cleared. The user pressed ✕ and asked for this chat to
 * end; a close button that silently refuses to close is the exact complaint this module was written to
 * answer, and it would be a worse failure than losing one transcript on a device that has run out of
 * room anyway.
 */
export function endProfessionalChat(store: KeyValueStore, id: string, now = Date.now()): boolean {
  const active = readActive(store, id);
  let archived = false;
  if (hasRealExchange(active)) {
    const next = [{ endedAt: now, messages: active }, ...readArchive(store, id)].slice(0, MAX_ARCHIVED_PER_PROFESSIONAL);
    archived = writeArchive(store, id, next);
  }
  try {
    store.removeItem(activeKey(id));
  } catch {
    /* nothing more we can do — the chat still closes on screen */
  }
  return archived;
}

/**
 * Bring an ended conversation back as the live one.
 *
 * "Open" on a history row must open THAT conversation — a button that opens a blank chat instead is the
 * fake-button class. Any conversation currently live is archived first, so resuming an old chat can
 * never overwrite a newer one.
 */
export function resumeArchived(store: KeyValueStore, id: string, endedAt: number, now = Date.now()): boolean {
  const wanted = readArchive(store, id).find((c) => c.endedAt === endedAt);
  if (!wanted) return false;
  endProfessionalChat(store, id, now); // park whatever is live right now
  const remaining = readArchive(store, id).filter((c) => c.endedAt !== endedAt);
  writeArchive(store, id, remaining);
  try {
    store.setItem(activeKey(id), JSON.stringify(wanted.messages));
  } catch {
    return false;
  }
  return true;
}

/** Delete one ended conversation for good. */
export function deleteArchived(store: KeyValueStore, id: string, endedAt: number): void {
  writeArchive(store, id, readArchive(store, id).filter((c) => c.endedAt !== endedAt));
}
