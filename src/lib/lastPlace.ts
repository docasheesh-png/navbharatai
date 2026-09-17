// lastPlace — "wahi se start ho": the one memory that takes a person back to the conversation they
// were in, instead of the marketing screen they have already read.
//
// ADMIN 2026-09-17, verbatim: *"user last session jaha chore, next time wahi se start ho!!"*
//
// 🔴 WHAT WAS ACTUALLY BROKEN, read out of the code rather than assumed. Three different things were
// wrong, and only the third is the one the request names:
//
//   1. `activeView` always initialised to `'home'`. Nothing anywhere recorded where the user had
//      been, so every launch started at the landing page — including for someone who has never once
//      wanted the landing page.
//   2. The FREE chat did not restore its transcript at all. `initialNbiMessages()` returned a welcome
//      line or the language picker, full stop. The conversation was saved (to `navbharat_sessions`
//      and Firestore) and then never read back on to the screen.
//   3. 🔴 And `currentSessionId` was a fresh `Date.now()` on EVERY load. So the previous conversation
//      was not merely hidden — it was ORPHANED. The next message opened a brand-new session row, and
//      the user's History filled with one-message fragments of a conversation they thought they were
//      still having. **This is why a restore that only put the messages back would have been worse
//      than the bug**: it would have shown the old transcript and then written it to a new row every
//      single reload.
//
// So resuming is not "remember a tab". It is: remember the PLACE, and make the surface that place
// belongs to genuinely continue — same conversation, same id.
//
// WHY A MODULE AND NOT AN `if` IN App.tsx: the decision has five rules that each have a reason
// (below), and App.tsx is 4,300 lines. A rule nobody can find is a rule that drifts. Pure in, pure
// out, so every rule is visible and pinned by tests.

import { isAuthGatedView } from './authGate';

/** Where the user was, and which conversation they were in. */
export interface LastPlace {
  /** The `ViewType` of the surface — a conversation, never a settings or marketing screen. */
  view: string;
  /**
   * The conversation inside that surface, where the surface has more than one.
   *
   * Free chat keeps many sessions, so it needs this. A professional keeps ONE live conversation
   * under its own key, so its view id is already the whole address and this stays undefined.
   */
  sessionId?: string;
  /** What to call it on the "Continue" card. Never required — a place with no title still resumes. */
  title?: string;
  /** When the user was last there (ms since epoch). */
  at: number;
}

export const LAST_PLACE_KEY = 'navbharat_last_place_v1';

/**
 * How stale a place may be and still be resumed: 30 days.
 *
 * ⚠️ NOT a cache expiry — the conversation itself is never deleted by this, and it stays in History
 * for ever. This bounds only the AUTOMATIC landing. Dropping somebody into a conversation from three
 * months ago, with no memory of it, reads as a bug in the app rather than a convenience: they see a
 * screen they did not ask for and cannot tell why. Past the window they land on Home, where the
 * recent list shows that conversation anyway — one tap, and it is their decision.
 */
export const LAST_PLACE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The two multi-session chat surfaces. Everything else resumable is a professional. */
export const CHAT_SURFACES = ['nbi_chat', 'nbi_pro_chat'] as const;

/**
 * Does this place need a signed-in user?
 *
 * Landing a signed-out person on one shows them a login wall as the first thing the app does, which
 * is the worst possible first frame — so those places are simply not resumed until they sign in. The
 * memory is NOT cleared: signing back in resumes exactly where they were.
 *
 * 🔒 DERIVED FROM `authGate.ts`, NEVER RE-LISTED HERE. The first draft of this module carried its own
 * `['nbi_pro_chat', 'sda_chat']`, which was correct on the day it was written and correct only by
 * coincidence: `AUTH_GATED_VIEWS` also holds `engineer_ai`, and the two lists would have agreed
 * about resumable surfaces purely because no gated view happens to be a professional today. Adding
 * one to that list later would have left this copy stale with nothing failing — and the symptom
 * would be the login wall this rule exists to prevent. One owner for the question, so they cannot
 * drift. (`CLAUDE.md`: do not restate another module's fact — point at the module that owns it.)
 */
export function needsSignIn(view: string): boolean {
  return isAuthGatedView(view);
}

/** The minimum of `localStorage` this module needs — so tests need no DOM. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `localStorage`, or null where it is unavailable (private mode, SSR). Callers degrade, never throw. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Is this view a place worth coming back to?
 *
 * `professionalIds` is INJECTED rather than imported so the rule is testable without the 70-entry
 * registry — and, more importantly, so the answer comes from the registry itself instead of a
 * pattern. A regex on `_ai` would have been shorter and would have matched **`other_ai`**, which is
 * the builder-TOOLS hub and not a conversation at all: the app would have "resumed" somebody into a
 * grid of tools they never opened.
 */
export function isResumableView(view: string, professionalIds: readonly string[]): boolean {
  if (!view) return false;
  if ((CHAT_SURFACES as readonly string[]).includes(view)) return true;
  return professionalIds.includes(view);
}

/**
 * Read the remembered place. Returns null for anything unreadable or malformed.
 *
 * A corrupt record must degrade to "no memory" — today's behaviour, landing on Home — never to a
 * thrown error on the first frame of the app.
 */
export function readLastPlace(store: KeyValueStore | null): LastPlace | null {
  if (!store) return null;
  try {
    const raw = store.getItem(LAST_PLACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastPlace> | null;
    if (!parsed || typeof parsed.view !== 'string' || !parsed.view) return null;
    const at = typeof parsed.at === 'number' && Number.isFinite(parsed.at) ? parsed.at : 0;
    if (at <= 0) return null; // an undated place cannot be aged out, so it is not trusted to land on
    return {
      view: parsed.view,
      at,
      ...(typeof parsed.sessionId === 'string' && parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
      ...(typeof parsed.title === 'string' && parsed.title ? { title: parsed.title } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Remember a place. A view that is not a conversation is IGNORED rather than stored.
 *
 * 🔒 That guard lives here, not at the call site. App.tsx records on every view change, so the one
 * place this can be got wrong is the one place it is decided — otherwise a new screen added next
 * year silently becomes something the app can dump people into on launch.
 */
export function recordLastPlace(
  store: KeyValueStore | null,
  place: LastPlace,
  professionalIds: readonly string[],
): boolean {
  if (!store) return false;
  if (!isResumableView(place.view, professionalIds)) return false;
  if (!Number.isFinite(place.at) || place.at <= 0) return false;
  // The ledger is stamped from HERE rather than from a second call in App.tsx. Two facts, one call
  // site: a caller that remembered the place but forgot to stamp the time would leave the Home list
  // ordering a conversation the app itself had just resumed into.
  touchPlaceActivity(store, placeKey(place.view, place.sessionId), place.at);
  try {
    store.setItem(LAST_PLACE_KEY, JSON.stringify({
      view: place.view,
      at: place.at,
      ...(place.sessionId ? { sessionId: place.sessionId } : {}),
      ...(place.title ? { title: place.title } : {}),
    }));
    return true;
  } catch {
    return false; // quota or a disabled store — a memory we cannot save is not worth an error
  }
}

/**
 * A tiny ledger of WHEN each place was last used: `{ [view or "view#sessionId"]: timestamp }`.
 *
 * 🔑 WHY THIS EXISTS AT ALL, and it is not a cache. The Home list has to order conversations from
 * THREE stores that share no clock. Free and Pro sessions carry a `lastUpdated`. A professional's
 * LIVE conversation carries nothing — `prof_<id>_messages` is a bare message array, and only an
 * ENDED one gets an `endedAt`. So before this, "which professional did I talk to most recently?"
 * was a question the app could not answer, and `freeHistoryMerge` had to pin every live
 * professional above everything dated and render it as "Ongoing".
 *
 * That convention is right for a HISTORY list. It is wrong for a "recent" list, where five
 * professionals touched last month would sit above the chat from five minutes ago.
 *
 * ⚠️ DELIBERATELY NOT STORED ON THE TRANSCRIPT. `prof_<id>_messages` is the ONLY copy of a user's
 * professional history; changing its shape to add a timestamp risks their data for an ordering
 * nicety. A separate ledger cannot corrupt anything — at worst it is missing, and the list falls
 * back to exactly the old ordering.
 */
export const PLACE_ACTIVITY_KEY = 'navbharat_place_activity_v1';

/** How many places to remember times for. A cap, not a page size — the list shows a handful. */
export const PLACE_ACTIVITY_MAX = 60;

/** The ledger key for a place. A chat surface is addressed by its session; a professional by itself. */
export function placeKey(view: string, sessionId?: string): string {
  return sessionId ? `${view}#${sessionId}` : view;
}

/** Read the ledger. `{}` for anything unreadable — a missing ledger means "no times", never an error. */
export function readPlaceActivity(store: KeyValueStore | null): Record<string, number> {
  if (!store) return {};
  try {
    const raw = store.getItem(PLACE_ACTIVITY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Stamp a place as used now, keeping the newest `PLACE_ACTIVITY_MAX` entries.
 *
 * Never moves a stamp BACKWARDS: two tabs open on the same account must not let the older one
 * un-recent a conversation the newer one is actually in.
 */
export function touchPlaceActivity(store: KeyValueStore | null, key: string, at: number): void {
  if (!store || !key || !Number.isFinite(at) || at <= 0) return;
  const ledger = readPlaceActivity(store);
  if ((ledger[key] ?? 0) >= at) return;
  ledger[key] = at;
  const trimmed = Object.entries(ledger)
    .sort((a, b) => b[1] - a[1])
    .slice(0, PLACE_ACTIVITY_MAX);
  try {
    store.setItem(PLACE_ACTIVITY_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    /* quota — ordering degrades to the old convention, nothing breaks */
  }
}

/** Forget where the user was — pressing "New chat" is them saying they want a clean start. */
export function clearLastPlace(store: KeyValueStore | null): void {
  if (!store) return;
  try { store.removeItem(LAST_PLACE_KEY); } catch { /* nothing to forget with */ }
}

export interface LandingInput {
  lastPlace: LastPlace | null;
  /**
   * True when the URL already names a destination — `/admin`, `/store`, a shared app link, `?view=`.
   *
   * 🔒 AN EXPLICIT LINK ALWAYS WINS. Someone who opened a link has stated where they want to be; a
   * remembered place is only a guess about where they might want to be. Overriding the first with
   * the second would break every share link in the product the moment this shipped.
   */
  hasDeepLink: boolean;
  signedIn: boolean;
  professionalIds: readonly string[];
  now: number;
  maxAgeMs?: number;
}

export interface Landing {
  view: string;
  sessionId?: string;
}

/**
 * Where should this launch land? `null` means "leave today's behaviour alone" — Home, or whatever
 * the URL already decided.
 */
export function decideLanding(input: LandingInput): Landing | null {
  const { lastPlace, hasDeepLink, signedIn, professionalIds, now } = input;
  if (hasDeepLink) return null;
  if (!lastPlace) return null;
  if (!isResumableView(lastPlace.view, professionalIds)) return null;
  if (needsSignIn(lastPlace.view) && !signedIn) return null;
  const maxAge = typeof input.maxAgeMs === 'number' && input.maxAgeMs > 0 ? input.maxAgeMs : LAST_PLACE_MAX_AGE_MS;
  const age = now - lastPlace.at;
  // A place stamped in the FUTURE (a device clock ahead of ours) is negative-aged. Treated as fresh
  // rather than discarded: the clock is wrong, the conversation is real, and refusing to resume it
  // would punish the user for their phone's settings.
  if (age > maxAge) return null;
  return {
    view: lastPlace.view,
    ...(lastPlace.sessionId ? { sessionId: lastPlace.sessionId } : {}),
  };
}
