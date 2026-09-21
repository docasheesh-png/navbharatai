// Where a Professional AI conversation lives, and what "close" actually means to it.
//
// THE BUG THIS EXISTS TO KILL (admin 2026-08-19: "jab user professional me kisi ai se bat karta hai,
// aur close (x) kar de, to chat close nahi hota"). Pressing ✕ removed the tab, but ProfessionalChat
// restores itself from localStorage on mount — so reopening Lawyer AI put the user straight back into
// the conversation they had just ended. Doctor AI was the ONE professional that behaved correctly,
// because App's closeTab happened to carry a hand-written branch for it; the other ~70 had none. That
// is the real root cause: the close behaviour was a per-screen special case instead of a rule.
//
// WHY NOT SIMPLY DELETE THE KEY. The stored conversation is not a cache — it is the ONLY copy of the
// user's professional history, and it is exactly what ProfessionalHistoryView reads. Deleting it on ✕
// would have made the ✕ button quietly destroy history the user never asked to lose. So closing
// ARCHIVES the conversation and removes it from the open ones: the chat genuinely ends, and the
// transcript is still there in Professional History, where it can also be resumed.
//
// 🔴 ONE PROFESSIONAL, MANY CONVERSATIONS (admin 2026-09-21: *"ek sath ek bar me 5 modes me chat kar
// sakte hai … kabhi kabhi ek hi professional 2 chat me baat karega"*). Until this date a professional
// had exactly ONE live conversation, under `prof_<id>_messages`, and every window of that professional
// would have read and written the same key — two Teacher AI windows typing over each other's
// transcript. Now every open conversation has an ID, minted here when it starts and sent to the server
// with every turn (that id is what keeps one chat's memory out of the other, see
// `server/professionals/conversationId.ts`), and the open conversations of a professional live together
// under `prof_<id>_conversations`.
//
// ⚠️ THE OLD KEY IS STILL READ, NEVER WRITTEN. A conversation that was live before this change sits in
// `prof_<id>_messages`; it is surfaced as the open conversation `LEGACY_CONVERSATION_ID` and moved to
// the new key the first time it is saved. It is sent to the server WITHOUT an id (`serverConversationId`)
// because its memory chunks were written id-less, and the server's rule is that the id-less chunks
// belong to the id-less conversation — so an upgraded user's ongoing chat keeps its own memory, and no
// new chat inherits it.
//
// Everything here is pure over an injected store, so the rules are testable without a browser and the
// key names exist in exactly one place.

export interface ProfMsg {
  role: 'user' | 'assistant';
  content: string;
}

export interface ArchivedConversation {
  /** When the user closed it (ms since epoch) — also this conversation's id within the professional's ARCHIVE. */
  endedAt: number;
  messages: ProfMsg[];
  /**
   * The id the conversation had while it was open, so resuming it continues the SAME conversation on
   * the server (its memory, its attachment recall). Absent on records archived before 2026-09-21 and
   * on a resumed legacy conversation — those resume under a fresh id.
   */
  conversationId?: string;
}

export interface OpenConversation {
  /** The conversation id — see `newConversationId` and `serverConversationId`. */
  id: string;
  messages: ProfMsg[];
  startedAt: number;
  updatedAt: number;
}

/** The minimum of `localStorage` this module needs — so tests need no DOM. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The LEGACY live slot — the one conversation a professional could hold before 2026-09-21. Read for
 * migration and for history; never written any more.
 */
export const activeKey = (id: string): string => `prof_${id}_messages`;

/** Conversations the user has ENDED with ✕, newest first. */
export const archiveKey = (id: string): string => `prof_${id}_archive`;

/** The OPEN conversations of one professional (since 2026-09-21). */
export const conversationsKey = (id: string): string => `prof_${id}_conversations`;

/** How many ended conversations we keep per professional. localStorage is small and shared app-wide. */
export const MAX_ARCHIVED_PER_PROFESSIONAL = 5;

/**
 * How many OPEN conversations one professional may hold in storage. A window that was opened, reloaded
 * away and never closed is still "open" here; without a bound, "New chat" pressed a hundred times would
 * be a hundred stored transcripts. Past it the oldest real conversation is ARCHIVED (never dropped) and
 * a welcome-only one is simply let go. Same number as the window cap, for the same reason.
 */
export const MAX_OPEN_PER_PROFESSIONAL = 5;

/**
 * The id under which the pre-2026-09-21 live conversation is surfaced locally. It is never SENT to the
 * server: `serverConversationId` maps it to `undefined`, which is the server's own name for the same
 * conversation (its memory chunks were written without an id).
 */
export const LEGACY_CONVERSATION_ID = 'legacy';

/** Mint a conversation id. Matches the server's accepted shape (`[A-Za-z0-9_-]{1,64}`). */
export function newConversationId(now = Date.now()): string {
  const rand = (): string => {
    try {
      const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
      if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 12);
    } catch { /* fall through */ }
    return Math.random().toString(36).slice(2, 14);
  };
  return `c_${now.toString(36)}_${rand()}`;
}

/** What the server is told this conversation is called. The legacy conversation is the id-less one. */
export function serverConversationId(id: string): string | undefined {
  return id === LEGACY_CONVERSATION_ID ? undefined : id;
}

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

const isMsgList = (v: unknown): v is ProfMsg[] => Array.isArray(v);

/** The legacy live slot as an open conversation, or null when there is none. */
function readLegacy(store: KeyValueStore, id: string): OpenConversation | null {
  const parsed = readJson<ProfMsg[]>(store, activeKey(id));
  if (!isMsgList(parsed) || parsed.length === 0) return null;
  return { id: LEGACY_CONVERSATION_ID, messages: parsed, startedAt: 0, updatedAt: 0 };
}

function readStoredOpen(store: KeyValueStore, id: string): OpenConversation[] {
  const parsed = readJson<OpenConversation[]>(store, conversationsKey(id));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((c) => c && typeof c.id === 'string' && c.id && isMsgList(c.messages));
}

/**
 * Every OPEN conversation of one professional, newest-first by last activity — including the legacy
 * live slot until its first save moves it (it sorts last: it has no timestamps, and a conversation
 * begun under the new layout is by definition newer).
 */
export function readOpenConversations(store: KeyValueStore, id: string): OpenConversation[] {
  const stored = readStoredOpen(store, id);
  const legacy = stored.some((c) => c.id === LEGACY_CONVERSATION_ID) ? null : readLegacy(store, id);
  const all = legacy ? [...stored, legacy] : stored;
  return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The messages of ONE open conversation (empty when there is no such conversation). */
export function readConversation(store: KeyValueStore, id: string, conversationId: string): ProfMsg[] {
  return readOpenConversations(store, id).find((c) => c.id === conversationId)?.messages ?? [];
}

/** The most recently active open conversation of a professional, or null — what "open Teacher AI" resumes. */
export function latestOpenConversationId(store: KeyValueStore, id: string): string | null {
  return readOpenConversations(store, id)[0]?.id ?? null;
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

/** Put one conversation into the archive (newest first, capped). Returns whether it was stored. */
function archiveOne(store: KeyValueStore, id: string, record: ArchivedConversation): boolean {
  const next = [record, ...readArchive(store, id)].slice(0, MAX_ARCHIVED_PER_PROFESSIONAL);
  return writeArchive(store, id, next);
}

/**
 * Write the open list. Under quota pressure, welcome-only conversations are let go first (nothing to
 * lose), then the oldest REAL ones are dropped from the open list and ARCHIVED — so a full device still
 * saves the conversation being typed in, and never destroys one the user could have reopened.
 *
 * The archive write comes AFTER the shrunken open list is stored, not before: the old, larger open value
 * is what is filling the quota, so archiving first would fail for exactly the reason we are shedding.
 */
function writeOpen(store: KeyValueStore, id: string, list: OpenConversation[], keepId: string, now: number): boolean {
  let current = [...list];
  const shed: OpenConversation[] = [];
  const archiveShed = () => {
    for (const c of shed) {
      if (hasRealExchange(c.messages)) archiveOne(store, id, { endedAt: now, conversationId: c.id, messages: c.messages });
    }
  };
  for (;;) {
    if (current.length === 0) {
      try { store.removeItem(conversationsKey(id)); } catch { return false; }
      archiveShed();
      return true;
    }
    try {
      store.setItem(conversationsKey(id), JSON.stringify(current));
      archiveShed();
      return true;
    } catch {
      const others = current.filter((c) => c.id !== keepId).sort((a, b) => a.updatedAt - b.updatedAt);
      const victim = others.find((c) => !hasRealExchange(c.messages)) ?? others[0];
      if (!victim) return false;
      shed.push(victim);
      current = current.filter((c) => c.id !== victim.id);
    }
  }
}

/**
 * Save (upsert) one open conversation's messages.
 *
 * The LEGACY conversation is migrated here: its first save writes it under the new key and removes
 * the old one, so a professional never has two copies of one conversation. Over
 * `MAX_OPEN_PER_PROFESSIONAL`, the oldest other conversation is archived (if real) or let go.
 */
export function saveConversation(store: KeyValueStore, id: string, conversationId: string, messages: ProfMsg[], now = Date.now()): boolean {
  const open = readOpenConversations(store, id);
  const existing = open.find((c) => c.id === conversationId);
  const record: OpenConversation = {
    id: conversationId,
    messages,
    startedAt: existing && existing.startedAt > 0 ? existing.startedAt : now,
    updatedAt: now,
  };
  let list = [record, ...open.filter((c) => c.id !== conversationId)];
  while (list.length > MAX_OPEN_PER_PROFESSIONAL) {
    const oldest = list[list.length - 1];
    if (hasRealExchange(oldest.messages)) {
      archiveOne(store, id, { endedAt: now, conversationId: oldest.id, messages: oldest.messages });
    }
    list = list.slice(0, -1);
  }
  const ok = writeOpen(store, id, list, conversationId, now);
  if (ok && conversationId === LEGACY_CONVERSATION_ID) {
    try { store.removeItem(activeKey(id)); } catch { /* the copy under the new key is the one read first */ }
  }
  return ok;
}

/** Remove an open conversation without archiving it (History's delete on an ongoing row, or Clear). */
export function deleteOpenConversation(store: KeyValueStore, id: string, conversationId: string): void {
  const open = readOpenConversations(store, id).filter((c) => c.id !== conversationId);
  writeOpen(store, id, open.filter((c) => c.id !== LEGACY_CONVERSATION_ID), '', Date.now());
  if (conversationId === LEGACY_CONVERSATION_ID) {
    try { store.removeItem(activeKey(id)); } catch { /* ignore */ }
  }
}

/**
 * End ONE open conversation: archive it (if it is a real one) and remove it from the open ones, so
 * its window closes for good and it reappears under History.
 *
 * Returns true when a conversation was archived.
 *
 * THE ONE DELIBERATE TRADE-OFF: if the browser cannot store the archive at all (quota full even for a
 * single conversation), the conversation is STILL removed. The user pressed ✕ and asked for this chat
 * to end; a close button that silently refuses to close is the exact complaint this module was written
 * to answer, and it would be a worse failure than losing one transcript on a device that has run out
 * of room anyway.
 */
export function endConversation(store: KeyValueStore, id: string, conversationId: string, now = Date.now()): boolean {
  const conv = readOpenConversations(store, id).find((c) => c.id === conversationId);
  let archived = false;
  if (conv && hasRealExchange(conv.messages)) {
    archived = archiveOne(store, id, {
      endedAt: now,
      messages: conv.messages,
      // A resumed legacy conversation gets a fresh id (its memory was id-less; a fresh id starts clean).
      ...(conversationId !== LEGACY_CONVERSATION_ID ? { conversationId } : {}),
    });
  }
  deleteOpenConversation(store, id, conversationId);
  return archived;
}

/**
 * End EVERY open conversation of a professional — what closing the professional's TAB (or the tab it
 * was opened from) means now that a professional can hold several. Returns true when any was archived.
 */
export function endProfessionalChat(store: KeyValueStore, id: string, now = Date.now()): boolean {
  let archived = false;
  for (const conv of readOpenConversations(store, id)) {
    if (endConversation(store, id, conv.id, now)) archived = true;
  }
  return archived;
}

/**
 * Bring an ended conversation back as an OPEN one, and say which id it is open under.
 *
 * "Open" on a history row must open THAT conversation — a button that opens a blank chat instead is the
 * fake-button class. It resumes under the id it had (so the server continues the same memory), or a
 * fresh one when the record predates ids. Nothing else is parked: with several windows there is no
 * single live slot to protect. Returns null when the record does not exist or cannot be stored.
 */
export function resumeArchived(store: KeyValueStore, id: string, endedAt: number, now = Date.now()): string | null {
  const wanted = readArchive(store, id).find((c) => c.endedAt === endedAt);
  if (!wanted) return null;
  const conversationId = wanted.conversationId && wanted.conversationId !== LEGACY_CONVERSATION_ID
    ? wanted.conversationId
    : newConversationId(now);
  if (!saveConversation(store, id, conversationId, wanted.messages, now)) return null;
  writeArchive(store, id, readArchive(store, id).filter((c) => c.endedAt !== endedAt));
  return conversationId;
}

/** Delete one ended conversation for good. */
export function deleteArchived(store: KeyValueStore, id: string, endedAt: number): void {
  writeArchive(store, id, readArchive(store, id).filter((c) => c.endedAt !== endedAt));
}
