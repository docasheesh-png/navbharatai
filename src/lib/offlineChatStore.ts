// On-device chat persistence for the Offline AI (admin ask 2026-07-18: "chats yaad rakhe … user kabhi bhi
// delete kar sake"). The chat transcript is saved ONLY on this device (localStorage, never uploaded) so
// the conversation survives app restarts, and the user can wipe it anytime. Stored LEAN: we keep the text
// + which feature/phone-help cards a bot turn referenced (by id, rehydrated from the bundled KBs on load)
// — never the full objects — so it stays small and never blows the storage quota. Pure & testable; the
// component injects nothing and uses the default localStorage.

/** A persisted chat message — the minimal, serializable shape (cards are stored by id, not inline). */
export interface PersistedChatMsg {
  id: string;
  role: 'user' | 'bot';
  text: string;
  /** Deterministic-answer category, if any (math | datetime | greeting | thanks | identity | memory). */
  answerKind?: string;
  /** True when the bot honestly offered an "Ask online" action. */
  online?: boolean;
  /** Ids of app-feature cards this bot turn showed (rehydrated from APP_KNOWLEDGE_BASE on load). */
  featureIds?: string[];
  /** Ids of phone-help cards this bot turn showed (rehydrated from DEVICE_KNOWLEDGE_BASE on load). */
  deviceIds?: string[];
}

/** localStorage key for the on-device chat transcript (versioned so a format change is safe). */
export const OFFLINE_CHAT_KEY = 'navbharat_offline_chat_v1';

/** Keep only the most recent messages so history can never grow unbounded on the device. */
export const CHAT_MAX_MESSAGES = 80;

/** Trim a transcript to the last CHAT_MAX_MESSAGES (never mutates the input). Pure. */
export function capTranscript(list: PersistedChatMsg[]): PersistedChatMsg[] {
  return list.length > CHAT_MAX_MESSAGES ? list.slice(list.length - CHAT_MAX_MESSAGES) : list.slice();
}

/** Load the saved transcript (safe: returns [] on any error or malformed data). */
export function loadChat(storage?: Pick<Storage, 'getItem'>): PersistedChatMsg[] {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!store) return [];
    const raw = store.getItem(OFFLINE_CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed entries (defensive against a hand-edited / older blob).
    return parsed.filter((m): m is PersistedChatMsg =>
      m && typeof m.id === 'string' && (m.role === 'user' || m.role === 'bot') && typeof m.text === 'string');
  } catch {
    return [];
  }
}

/** Persist the transcript (capped; safe: swallows quota/serialization errors). */
export function saveChat(list: PersistedChatMsg[], storage?: Pick<Storage, 'setItem'>): void {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!store) return;
    store.setItem(OFFLINE_CHAT_KEY, JSON.stringify(capTranscript(list)));
  } catch {
    /* offline / quota — non-fatal, the transcript simply isn't persisted this time */
  }
}

/** Wipe the saved transcript (the user's "clear chat" / delete control). Safe. */
export function clearChat(storage?: Pick<Storage, 'removeItem'>): void {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    store?.removeItem(OFFLINE_CHAT_KEY);
  } catch {
    /* non-fatal */
  }
}
