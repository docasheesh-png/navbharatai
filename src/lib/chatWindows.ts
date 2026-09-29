// CHAT WINDOWS — up to five professional conversations open at once, each its own window
// (admin 2026-09-21: *"ek sath ek bar me 5 modes me chat kar sakte hai (banana hai apko), abhi ek hi
// chat hai"*).
//
// A window is a CONVERSATION, not a professional: two Teacher AI windows are two conversations with
// the same expert, and each carries its own conversation id from the moment it opens. That id is what
// the server keys memory and attachment recall on (`professionals/conversationId.ts`), so the
// isolation the admin asked for — *"ek chat ki baat/memory 2nd me na jaye"* — is decided here, at the
// moment a window is minted, and never has to be re-derived by a surface.
//
// ⚠️ THIS IS NOT `openTabs`. The header's tab list is a `ViewType[]` — one slot per view id, a closed
// union — and it stays exactly that. A professional's VIEW is still one tab (it is what `activeView`,
// the parent-close rules and the bottom bar reason about); its WINDOWS are listed here, beside it.
// Widening `ViewType` to carry conversation ids would have put a runtime value into a compile-time
// enum and broken every exhaustive switch over it.
//
// Pure, so the cap and the numbering are unit-tested without React.

import { PROFESSIONAL_CHATS } from '../components/professionals/professionalConfigs';

/**
 * Professionals that are in `PROFESSIONAL_CHATS` (the hub and the Mode sheet list them) but are NOT
 * rendered by the generic chat surface — App renders them through a tool of their own, with its own
 * state. Minting a window for one would mount a second, generic chat beside the real tool.
 *
 * ⚠️ Derived from what App.tsx actually renders, and locked by `fiveChatsAtOnceEachItsOwnWindow.test.ts`:
 * an id here must have its own `activeView === '<id>'` block in App and no generic block; every other
 * professional must have neither. A hand-kept list that drifts from the render is the bug class this
 * repo keeps paying for, which is why the test reads both.
 */
export const OWN_SURFACE_PROFESSIONALS: ReadonlySet<string> = new Set(['repo_analyst']);

/** Is `view` a professional the WINDOW system serves — i.e. one the generic chat surface renders? */
export function isWindowedProfessional(view: string): boolean {
  return view in PROFESSIONAL_CHATS && !OWN_SURFACE_PROFESSIONALS.has(view);
}

/**
 * What a History row knows about the conversation it wants opened: an OPEN one by id, an ENDED one by
 * its archive stamp. App decides the window (and the cap) first and resumes second — never the reverse.
 */
export interface ConversationRef {
  conversationId?: string;
  endedAt?: number;
}

export interface ChatWindow {
  /** The conversation id — minted by `professionalChatStore.newConversationId`, sent with every turn. */
  id: string;
  /** The professional's view id (`teacher_ai`, …) — the surface that renders this window. */
  professionalId: string;
}

/**
 * How many chats may be open at once. The admin's number, verbatim.
 *
 * ⚠️ SINCE 2026-09-22 THE FIVE ARE COUNTED ACROSS EVERY CHAT THE MODE LIST CAN SWITCH TO, not across
 * professional windows alone (admin, approving the redesign: Doctor AI and the Image Generator count,
 * "doctor + 4 = 5"). The FREE chat is the home of the tab and is never counted — it is always there.
 * `chatSlotsUsed` is the one place that arithmetic lives.
 */
export const MAX_OPEN_CHATS = 5;

/**
 * The chats that take a slot WITHOUT being a window: Doctor AI holds one case at a time, the image
 * studio is one view. Each is one row of the Mode list's Recent group while its view is open, so each
 * is one of the five. A view here must also be a mode surface (`isModeSurface`) — the test locks that.
 */
export const SLOT_VIEWS: readonly string[] = ['sda_chat', 'imagegen'];

/**
 * EVERY CHAT CAN HOLD SEVERAL WINDOWS (admin 2026-09-28: *"navbharatai free aur image generate ai free,
 * bas 1 hi open ho rhe hai, waki sabhi professional 2-2 open ho ja rahe hai. sabhi ko ek jaisa karo"*,
 * and asked which way, chose "sab 2-2"). The FREE chat, the image studio and Doctor AI were one chat
 * each; a professional was already a list of windows. These three now are too.
 *
 * They are listed in their OWN list (`viewWindows` in App), not in the professional one, because every
 * reader of the professional list assumes a `PROFESSIONAL_CHATS` entry. The shape is the same
 * (`ChatWindow`, with the view id in `professionalId`), so numbering and closing are the same functions.
 *
 * A view whose tab is open and whose list is empty has ONE implicit window, `DEFAULT_VIEW_WINDOW` —
 * exactly the single chat it always had — so nothing changes until a second window is opened.
 */
export const VIEW_WINDOW_VIEWS: readonly string[] = ['nbi_chat', 'imagegen', 'sda_chat'];

/** The implicit first window of a single-chat view: the chat it always had. */
export const DEFAULT_VIEW_WINDOW = 'main';

/** Can this view hold several windows through the view-window list? */
export function isViewWindowed(view: string): boolean {
  return VIEW_WINDOW_VIEWS.includes(view);
}

/** The windows a single-chat view has right now: its own list, else its implicit one while its tab is open. */
export function viewWindowsFor(viewWindows: readonly ChatWindow[], openViews: readonly string[], view: string): ChatWindow[] {
  if (!isViewWindowed(view) || !openViews.includes(view)) return [];
  const own = viewWindows.filter((w) => w.professionalId === view);
  return own.length > 0 ? own : [{ id: DEFAULT_VIEW_WINDOW, professionalId: view }];
}

/**
 * How many of the five are taken: every professional window, every Doctor AI and image window, and
 * every FREE window after the first (the first FREE chat is the tab's home and was never counted).
 */
export function chatSlotsUsed(windows: ChatWindow[], openViews: readonly string[], viewWindows: readonly ChatWindow[] = []): number {
  const slotViews = SLOT_VIEWS.reduce((n, v) => n + viewWindowsFor(viewWindows, openViews, v).length, 0);
  const extraFree = Math.max(0, viewWindowsFor(viewWindows, openViews, 'nbi_chat').length - 1);
  return windows.length + slotViews + extraFree;
}

/** Is there room for one more chat (a new window, a Doctor AI case, the image studio)? */
export function chatSlotFree(windows: ChatWindow[], openViews: readonly string[], viewWindows: readonly ChatWindow[] = []): boolean {
  return chatSlotsUsed(windows, openViews, viewWindows) < MAX_OPEN_CHATS;
}

/**
 * The list after opening one more window of a single-chat view. The implicit first window is written
 * out explicitly at the same time, so it keeps its place (and its number) beside the new one. PURE.
 */
export function addViewWindow(viewWindows: readonly ChatWindow[], openViews: readonly string[], view: string, id: string): ChatWindow[] {
  const current = viewWindowsFor(viewWindows, openViews, view);
  const others = viewWindows.filter((w) => w.professionalId !== view);
  return [...others, ...current, { id, professionalId: view }];
}

export interface OpenOutcome {
  windows: ChatWindow[];
  /** True when the window is now open (newly, or because it already was). */
  opened: boolean;
  /** Why it was not opened. Only 'cap' exists today — an honest refusal, never a silent no-op. */
  reason?: 'cap';
}

/**
 * Open a window. Re-opening a window that is already open is a no-op that still reports `opened`
 * (the caller then simply focuses it); a NEW window past the cap is refused with a reason the surface
 * must show — a "New chat" that quietly does nothing is the fake-button class.
 *
 * `openViews` (the open tab ids) is what makes the cap count Doctor AI and the image studio too.
 */
export function openWindow(windows: ChatWindow[], win: ChatWindow, openViews: readonly string[] = [], viewWindows: readonly ChatWindow[] = []): OpenOutcome {
  if (windows.some((w) => w.id === win.id)) return { windows, opened: true };
  // `openViews` is what lets Doctor AI and the image studio count (2026-09-22). A caller that omits it
  // gets the window-only count, which is LOOSER than the truth — so App passes `openTabs` at every
  // call site, and the wiring test reads that it does.
  if (!chatSlotFree(windows, openViews, viewWindows)) return { windows, opened: false, reason: 'cap' };
  return { windows: [...windows, win], opened: true };
}

/** Close one window. `closed` is null when no such window was open. */
export function closeWindow(windows: ChatWindow[], id: string): { windows: ChatWindow[]; closed: ChatWindow | null } {
  const closed = windows.find((w) => w.id === id) ?? null;
  return { windows: closed ? windows.filter((w) => w.id !== id) : windows, closed };
}

/** Every open window of one professional, in the order they were opened. */
export function windowsOf(windows: ChatWindow[], professionalId: string): ChatWindow[] {
  return windows.filter((w) => w.professionalId === professionalId);
}

/**
 * Which window to focus after `closed` went away, given the windows that REMAIN.
 *
 * The last window of the same professional first — closing one Teacher chat lands you on the other
 * Teacher chat, the same rule the header applies when a tab closes ("land on the one beside it") —
 * else the last window overall, else nothing (the caller then closes the professional's tab).
 */
export function nextActiveAfterClose(remaining: ChatWindow[], closed: ChatWindow): ChatWindow | null {
  const sameExpert = windowsOf(remaining, closed.professionalId);
  if (sameExpert.length > 0) return sameExpert[sameExpert.length - 1];
  return remaining.length > 0 ? remaining[remaining.length - 1] : null;
}

/**
 * The chip label for a window: the professional's name, numbered only when that professional has more
 * than one window open ("Teacher AI", "Teacher AI (2)"). The number is the window's position among its
 * siblings, so it is stable while both are open and never re-uses a number a closed sibling had — no:
 * it is positional, so closing (1) makes (2) become the only one and drop its number. That is the
 * honest reading of "which of my Teacher chats is this?" once there is only one.
 */
export function windowLabel(windows: ChatWindow[], id: string, name: string): string {
  const win = windows.find((w) => w.id === id);
  if (!win) return name;
  const siblings = windowsOf(windows, win.professionalId);
  if (siblings.length < 2) return name;
  return `${name} (${siblings.findIndex((w) => w.id === id) + 1})`;
}

/** What the surface says when the cap refuses a new window. One sentence, one place. */
export function capMessage(): string {
  return `${MAX_OPEN_CHATS} chats are open. Close one to open another.`;
}
