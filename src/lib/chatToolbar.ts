// THE COMPOSER TOOLBAR — one row of controls, identical above every AI's input box.
//
// ADMIN 2026-08-10: "NavBharatAI Free me — ON SEND, SEARCH, CLEAR option hai (input box ke just
// upar). Yeh sabhi jagah hona chahiye (Export wale ko hata sakte hai, agar kisi kaam ka nahi ho to)."
// Then, asked directly about Export: "han kato!"
//
// WHY THIS FILE EXISTS AT ALL. The row already existed — in exactly one place, hand-written inside a
// 1,700-line chat component, with its preference read straight from localStorage at the call site.
// Copying that block into three more screens is how the four input boxes drifted apart in the first
// place: the same button ends up with a different label here, a different confirm there, and a
// preference that four screens each store under their own key. So the DECISIONS live here, once —
// what the send toggle says, whether the row has anything to show, what "clear" asks before it
// destroys a conversation, and how a search actually matches — and the React component is a thin
// shell over them. PURE: no React, no DOM, no storage; every input is passed in.
//
// EXPORT IS DELIBERATELY ABSENT. It downloaded the transcript as a .md file, which is not something
// people do with a chat on a phone, and it was the one button in the row that acted on the past
// rather than the message being written. The admin cut it; nothing here replaces it.

export type ChatToolbarLang = 'en' | 'hi';

/** Where the send-on-Enter preference lives. ONE key for every AI — the whole point of unifying. */
export const SEND_ON_ENTER_KEY = 'chat_sendOnEnter';

/**
 * Read the preference. Defaults to TRUE (Enter sends) because that is what the existing free chat
 * did, and silently flipping a habit on every user would be a worse change than any inconsistency.
 * A storage that throws (private mode, disabled cookies) must not break a chat, so it degrades to
 * the default rather than propagating. PURE apart from the reader it is handed.
 */
export function readSendOnEnter(get: (k: string) => string | null | undefined): boolean {
  try {
    return get(SEND_ON_ENTER_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** The toggle's own label — short enough for a phone, and it says what the key does, not its state. */
export function sendToggleLabel(sendOnEnter: boolean): string {
  return sendOnEnter ? '↵ Send' : '⇧↵ Send';
}

/** The tooltip. Spells out BOTH halves, since the label alone cannot say what the other key now does. */
export function sendToggleTitle(sendOnEnter: boolean, lang: ChatToolbarLang = 'en'): string {
  if (lang === 'hi') {
    return sendOnEnter
      ? 'Enter दबाने पर मैसेज चला जाएगा · नई लाइन के लिए Shift+Enter'
      : 'Shift+Enter दबाने पर मैसेज जाएगा · Enter से नई लाइन बनेगी';
  }
  return sendOnEnter
    ? 'Enter sends the message · Shift+Enter starts a new line'
    : 'Shift+Enter sends the message · Enter starts a new line';
}

/**
 * Should Enter send RIGHT NOW? One rule for all four AIs, instead of each keydown handler
 * re-deriving it slightly differently.
 *
 * `shiftKey` inverts the preference rather than always meaning "new line": with the toggle off, the
 * user has explicitly asked for Shift+Enter to be the send key, and ignoring that would leave them
 * with no way to send from the keyboard at all. A composer that is empty or already sending never
 * sends — that is what produced duplicate turns and empty bubbles on the screens that forgot to check.
 */
export function enterShouldSend(opts: {
  key: string;
  shiftKey: boolean;
  sendOnEnter: boolean;
  hasContent: boolean;
  isBusy: boolean;
  /** True while an IME composition is active — Enter there COMMITS the candidate, it does not send. */
  isComposing?: boolean;
}): boolean {
  if (opts.key !== 'Enter' || opts.isComposing) return false;
  if (!opts.hasContent || opts.isBusy) return false;
  return opts.sendOnEnter ? !opts.shiftKey : opts.shiftKey;
}

/**
 * Does the row have anything worth showing? Search and Clear both act on a conversation, so on an
 * empty one they are dead controls — and a dead control that does nothing when tapped teaches the
 * user not to trust the row. The send toggle alone is still worth showing: it configures the message
 * being typed right now, which exists before any message has been sent.
 */
export function toolbarActionsVisible(messageCount: number): boolean {
  return messageCount > 0;
}

/** What Clear asks before it destroys a conversation. Never silent — this is not undoable. */
export function clearConfirmText(messageCount: number, lang: ChatToolbarLang = 'en'): string {
  if (lang === 'hi') {
    return `पूरी बातचीत हटा दें? ${messageCount} मैसेज मिट जाएंगे और वापस नहीं आएंगे।`;
  }
  return `Clear this conversation? ${messageCount} message${messageCount === 1 ? '' : 's'} will be deleted and cannot be brought back.`;
}

export interface SearchableMsg {
  text?: string;
  content?: string;
}

/**
 * Filter a transcript by a search query.
 *
 * Case-insensitive substring, deliberately: a chat search is a "where did I say that?" tool, and
 * regex or word-boundary matching would silently miss `useState` inside `useState(0)` — which is
 * exactly the kind of thing people search a build chat for. An empty or whitespace-only query
 * returns the transcript UNCHANGED rather than nothing, so opening the box does not blank the screen.
 *
 * Reads `text` OR `content` because the four AIs disagree on the field name; unifying the field is a
 * bigger refactor than this row, and accepting both is honest about that. PURE.
 */
export function filterMessages<T extends SearchableMsg>(messages: readonly T[], query: string): T[] {
  const list = [...(messages ?? [])];
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((m) => `${m?.text ?? ''}${m?.content ?? ''}`.toLowerCase().includes(q));
}

/** "3 of 41" — so a search that finds nothing says so, instead of looking like a broken screen. */
export function searchResultLabel(found: number, total: number, lang: ChatToolbarLang = 'en'): string {
  if (found === 0) return lang === 'hi' ? 'कुछ नहीं मिला' : 'No matches';
  return lang === 'hi' ? `${total} में से ${found}` : `${found} of ${total}`;
}
