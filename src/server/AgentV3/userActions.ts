// WHAT THE USER MUST DO, IN ONE PLACE — the decision half (admin 2026-09-20).
//
// THE COMPLAINT, verbatim: *"yeh cheez abhi text chat me hi hai, aur bahut sare navbharatai ke response
// me kahi dab jati hai! ab isko bahar rakh do! user se jo jo chahiye woh sab question mark me!"*
//
// The engine ALREADY asks for these things, and asks well. `secret_request` asks for a credential
// mid-build with the exact variable names filled in; `permission_request` genuinely blocks the build on
// the user's yes; `clarify` records the assumptions it made. What none of them has is a HOME. All three
// render as cards inside the message stream, at three different moments, and a long narration pushes
// them out of view. None is written down anywhere, so a reload, a tab change, or coming back tomorrow
// loses the record of what the user was supposed to do. And there is no notion of "I did it" at all.
//
// This module is that record. It is PURE — no I/O — so every rule below is tested directly, and
// `UserActionStore` is the only thing that touches Firestore.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 🔴 THE PRECISION RULE, AND IT OUTRANKS COMPLETENESS (admin, same day: *"yeh ❓ notifications popup
// sirf tab dikhna chahiye jab sach me need ho, nahi to user isko ignore karega!!"*).
//
// A badge that is usually lit is a badge nobody reads — and once a user has learned to ignore it, the
// feature is WORSE than never having been built, because the one genuinely blocking ask is now
// invisible too. So four rules live here, structurally, rather than at the call sites:
//
//   1. A row exists only for something the user must DO. A suggestion is not an action; the reviewer
//      already has its own place for those, and nothing from it reaches this list.
//   2. ONE THING, ONE ROW, FOR EVER. Identity is the THING (this env var, this gate), never the
//      wording — so a build that asks twice updates one row instead of stacking two.
//   3. A ROW CLOSES ITSELF when the thing becomes true. A key that reaches the vault closes its own row
//      as `verified`, so the count going down is a measured fact rather than the user's word.
//   4. A CLOSED ROW IS NOT RE-OPENED by the same build repeating itself, and a row the user declined
//      ("I don't want that provider at all") is never re-opened. Re-asking IS the nagging above.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ LANGUAGE. The tray's own chrome is English, like every other NavBharatAI screen. The TEXT OF A ROW
// is not chrome — it is the engine's own words to the user, generated in the language the user wrote
// in, and it is carried here verbatim. Inventing a translation in this module would be a second,
// untested language path; the engine already answers in the user's language and that is the one to fix
// if a row ever comes back in the wrong one.

import { isUsableEnvName, isPlatformSecret } from './secretRequest';

/** The kinds a row can be. PR 2 adds 'connect' (GitHub / database / domain) and 'external'. */
export type UserActionKind = 'secret' | 'approve' | 'question';

/**
 * Why a row is no longer open.
 *
 * `done` and `not_needed` are DIFFERENT facts and must never be collapsed: the first is the user
 * saying they did it, the second is the user saying they do not want the thing at all. Only the
 * second one bars the engine from ever asking again.
 */
export type UserActionStatus = 'open' | 'done' | 'not_needed' | 'superseded';

/**
 * WHO closed it, and it is the honesty of the whole feature.
 *
 * `verified` means the platform LOOKED and the thing is true (the key is in the vault). `user` means
 * the user pressed Done and we have not checked. Those are not the same claim, the tray says which one
 * it is, and only an unverified `user` close can ever be re-opened by a later build.
 */
export type UserActionClosedBy = 'user' | 'verified' | 'ai' | 'system';

export interface UserAction {
  /** Stable, derived from the THING — see `actionKey`. Two asks for one thing share this id. */
  id: string;
  kind: UserActionKind;
  /** One line, in the user's own language: what they have to do. */
  title: string;
  /** One line on why it is needed. '' when there is nothing honest to add. */
  why: string;
  /** The exact environment variable this row is about (kind 'secret'). */
  envName?: string;
  /** The pending gate this row answers, when a build is waiting on it. */
  callId?: string;
  /** TRUE only while a build is genuinely stopped waiting for it. */
  blocking: boolean;
  /** The build that raised it — a later build may re-open an unverified close, the same one may not. */
  buildId: string;
  status: UserActionStatus;
  createdAt: number;
  closedAt?: number;
  closedBy?: UserActionClosedBy;
}

/**
 * At most this many assumptions from one `clarify` become rows.
 *
 * A model listing its assumptions is not rationed, and a chatty one could put a dozen low-value lines
 * in front of the single credential that actually blocks the app. Four is the cap because the tray's
 * job is to be read at a glance; the rest are still in the clarify card's own text.
 */
export const MAX_QUESTIONS_PER_CLARIFY = 4;

/** How many rows one workspace keeps. Closed rows are pruned first; an OPEN row is never dropped. */
export const MAX_ACTIONS = 60;

/** Longest slug taken from free text, before the hash suffix that keeps two long titles distinct. */
const SLUG_MAX = 48;

function collapse(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Lower-cased, punctuation-free identity of a free-text ask. Same discipline as `todoMerge`. */
function normalizeTitle(text: string): string {
  return collapse(text).toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim();
}

function slug(text: string): string {
  return normalizeTitle(text).replace(/ +/g, '-').slice(0, SLUG_MAX).replace(/-+$/, '');
}

/**
 * A short, stable hash of the FULL normalized title (FNV-1a, base36).
 *
 * The slug is capped so an id stays readable, and two different questions can share their first 48
 * characters. Without this suffix they would merge into one row and one of them would be silently
 * lost — the opposite failure from the duplicate rows rule 2 prevents. Pure, no import.
 */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, '0').slice(0, 6);
}

/**
 * The row's identity — the THING, never the wording.
 *
 * A credential is identified by its variable name, so "we need RAZORPAY_KEY_ID" asked in the build and
 * again at the end is ONE row. A free-text ask is identified by its normalized text plus a hash, so
 * re-phrasing genuinely makes a new row while a repeat does not. Doc ids are built from this, so it
 * only ever contains `[a-z0-9:-]`.
 */
export function actionKey(kind: UserActionKind, subject: string): string {
  const s = slug(subject);
  if (kind === 'secret') return `secret:${s}`;
  return `${kind}:${s}-${shortHash(normalizeTitle(subject))}`;
}

/** Which section of the tray a row belongs to. */
export type UserActionGroup = 'blocking' | 'needed' | 'later';

export function groupOf(action: UserAction): UserActionGroup {
  if (action.blocking) return 'blocking';
  return action.kind === 'question' ? 'later' : 'needed';
}

export function openActions(actions: readonly UserAction[]): UserAction[] {
  return actions.filter((a) => a.status === 'open');
}

/** What the badge shows. Zero means the badge is not rendered at all — never an empty badge. */
export function badgeCount(actions: readonly UserAction[]): number {
  return openActions(actions).length;
}

/**
 * Should the tray open ITSELF?
 *
 * Only for a build that is genuinely stopped. A blocking gate hidden behind a badge the user has not
 * noticed is auto-denied after its timeout, which would make this feature the cause of a failure it
 * was built to prevent. Everything else merely lights the badge — auto-opening for "do this later"
 * work is exactly how a user learns to dismiss the thing without reading it.
 */
export function shouldAutoOpen(actions: readonly UserAction[]): boolean {
  return openActions(actions).some((a) => a.blocking);
}

/**
 * May `incoming` re-open the closed row `existing`?
 *
 * The engine derives its asks from the app's own code and the user's vault, so a LATER build asking
 * again means the thing is genuinely still missing — and the only close that can be wrong about that
 * is the unverified one, where the user pressed Done and we never looked. A `verified` close cannot be
 * wrong (the key is in the vault, so the engine would not ask), and `not_needed` is the user declining
 * the thing outright, which rule 4 says is never re-asked. `superseded` means the app itself stopped
 * needing it.
 */
export function mayReopen(existing: UserAction, incoming: UserAction): boolean {
  if (existing.status !== 'done') return false;
  if (existing.closedBy !== 'user') return false;
  return incoming.buildId !== existing.buildId;
}

/**
 * Fold new asks into the stored list. PURE.
 *
 * An open row is refreshed in place (its wording, its gate, whether it blocks) and keeps its id and
 * its original `createdAt`, so the tray never reorders under the user's finger while they read it.
 */
export function mergeUserActions(
  existing: readonly UserAction[],
  incoming: readonly UserAction[],
): UserAction[] {
  const out = existing.map((a) => ({ ...a }));
  const byId = new Map(out.map((a) => [a.id, a] as const));
  for (const next of incoming) {
    const prev = byId.get(next.id);
    if (!prev) {
      out.push({ ...next });
      byId.set(next.id, out[out.length - 1]);
      continue;
    }
    if (prev.status === 'open') {
      prev.title = next.title;
      prev.why = next.why;
      prev.blocking = next.blocking;
      prev.buildId = next.buildId;
      if (next.callId) prev.callId = next.callId;
      continue;
    }
    if (mayReopen(prev, next)) {
      prev.status = 'open';
      prev.title = next.title;
      prev.why = next.why;
      prev.blocking = next.blocking;
      prev.buildId = next.buildId;
      prev.callId = next.callId;
      delete prev.closedAt;
      delete prev.closedBy;
    }
  }
  return capActions(out);
}

/**
 * Hold the list at `MAX_ACTIONS` by dropping the OLDEST CLOSED rows first.
 *
 * An open row is never dropped at any size: losing one would silently remove something the user still
 * has to do, which is the one outcome this whole module exists to prevent. History is the expendable
 * half.
 */
export function capActions(actions: readonly UserAction[]): UserAction[] {
  if (actions.length <= MAX_ACTIONS) return actions.map((a) => ({ ...a }));
  const open = actions.filter((a) => a.status === 'open');
  const closed = actions.filter((a) => a.status !== 'open')
    .sort((a, b) => (b.closedAt ?? b.createdAt) - (a.closedAt ?? a.createdAt));
  const room = Math.max(0, MAX_ACTIONS - open.length);
  const kept = new Set([...open, ...closed.slice(0, room)].map((a) => a.id));
  return actions.filter((a) => kept.has(a.id)).map((a) => ({ ...a }));
}

/** Close one row. Returns the same list when the id is unknown or the row is already closed. */
export function closeAction(
  actions: readonly UserAction[],
  id: string,
  status: Exclude<UserActionStatus, 'open'>,
  by: UserActionClosedBy,
  now: number,
): UserAction[] {
  return actions.map((a) =>
    a.id === id && a.status === 'open' ? { ...a, status, closedBy: by, closedAt: now } : { ...a });
}

/**
 * THE SELF-CLOSING HALF (precision rule 3) — a credential the user already has is not a task.
 *
 * Run against the names actually present in the user's encrypted vault. A row whose variable is there
 * closes as `verified`, without the user pressing anything, so the badge's count is something the
 * platform measured rather than something it was told.
 */
export function verifyAgainstVault(
  actions: readonly UserAction[],
  savedNames: readonly string[],
  now: number,
): UserAction[] {
  const have = new Set(savedNames.map((n) => String(n ?? '').trim().toUpperCase()).filter(Boolean));
  if (have.size === 0) return actions.map((a) => ({ ...a }));
  return actions.map((a) =>
    a.status === 'open' && a.kind === 'secret' && a.envName && have.has(a.envName.toUpperCase())
      ? { ...a, status: 'done' as const, closedBy: 'verified' as const, closedAt: now }
      : { ...a });
}

/**
 * ONE ROW PER CREDENTIAL, not one per request.
 *
 * A request can name several keys, and the same key turns up in a later request naming a different
 * set. Keying a row by the REQUEST would make those two different rows for one missing variable;
 * keying by the variable makes duplication impossible, and lets the user finish them one at a time.
 * The tray still shows keys that share a `callId` in one card, because that is one save and one answer
 * back to the waiting build.
 *
 * 🔒 The platform's OWN credentials can never become a row. `planSecretRequest` already refuses them
 * upstream; this is the second net, at the point the user-visible record is written, because a row
 * saying "add ANTHROPIC_API_KEY" would both teach the user that NavBharatAI resells someone's API and
 * break the white-label law on a screen built for the user to read.
 */
export function secretActions(
  callId: string,
  secrets: ReadonlyArray<{ name?: unknown; why?: unknown }>,
  buildId: string,
  now: number,
): UserAction[] {
  const seen = new Set<string>();
  const out: UserAction[] = [];
  for (const s of secrets ?? []) {
    const name = collapse(s?.name);
    if (!isUsableEnvName(name) || isPlatformSecret(name)) continue;
    const id = actionKey('secret', name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: 'secret',
      title: name,
      why: collapse(s?.why),
      envName: name,
      callId,
      // A credential never stops the build: the ask is answerable later, and the build carries on
      // building everything that does not depend on it.
      blocking: false,
      buildId,
      status: 'open',
      createdAt: now,
    });
  }
  return out;
}

/** The one ask that genuinely stops a build until the user answers. */
export function approveAction(
  callId: string,
  action: unknown,
  buildId: string,
  now: number,
): UserAction | null {
  const title = collapse(action);
  if (!title) return null;
  return {
    id: actionKey('approve', title),
    kind: 'approve',
    title,
    why: '',
    callId,
    blocking: true,
    buildId,
    status: 'open',
    createdAt: now,
  };
}

/**
 * The assumptions the engine made, as rows the user can correct.
 *
 * Non-blocking by construction: `clarify` never stops a build, and turning it into something that
 * looks urgent would be a lie about what is happening. Capped, de-duplicated, and empty lines dropped.
 */
export function questionActions(
  questions: readonly unknown[],
  buildId: string,
  now: number,
): UserAction[] {
  const seen = new Set<string>();
  const out: UserAction[] = [];
  for (const q of questions ?? []) {
    const title = collapse(q);
    if (!title) continue;
    const id = actionKey('question', title);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: 'question',
      title,
      why: 'I assumed an answer and carried on building. Tell me if it is wrong.',
      blocking: false,
      buildId,
      status: 'open',
      createdAt: now,
    });
  }
  return out.slice(0, MAX_QUESTIONS_PER_CLARIFY);
}

/** The shape this module reads off the build's event stream. Deliberately loose — it is wire data. */
export interface UserActionSourceEvent {
  type?: unknown;
  callId?: unknown;
  action?: unknown;
  prompt?: unknown;
  secrets?: unknown;
  questions?: unknown;
}

/**
 * ONE mapping from a build event to rows, so the recorder that persists them holds no policy at all.
 *
 * Every other event type yields nothing. That is the point: this list is what the user must DO, and
 * adding a case here is the deliberate act of deciding that some new event belongs in front of them.
 */
export function actionsFromEvent(
  event: UserActionSourceEvent,
  buildId: string,
  now: number,
): UserAction[] {
  switch (event?.type) {
    case 'secret_request':
      return secretActions(
        collapse(event.callId),
        Array.isArray(event.secrets) ? (event.secrets as Array<{ name?: unknown; why?: unknown }>) : [],
        buildId,
        now,
      );
    case 'permission_request': {
      const one = approveAction(collapse(event.callId), event.action, buildId, now);
      return one ? [one] : [];
    }
    case 'clarify':
      return questionActions(Array.isArray(event.questions) ? event.questions : [], buildId, now);
    default:
      return [];
  }
}

/**
 * A gate that is no longer waiting is no longer blocking — whoever answered it.
 *
 * The build resolves a permission gate through its own channel, and it also gives up on one after its
 * timeout. Either way the row must stop claiming the build is stopped, or the tray would keep opening
 * itself for a build that has long since moved on. The row itself stays open when nobody answered it,
 * because "the engine asked and gave up" is still something the user should see.
 */
export function releaseGate(
  actions: readonly UserAction[],
  callId: string,
  answered: boolean,
  now: number,
): UserAction[] {
  return actions.map((a) => {
    if (a.callId !== callId || a.status !== 'open') return { ...a };
    if (answered && a.kind === 'approve') {
      return { ...a, status: 'done' as const, closedBy: 'user' as const, closedAt: now, blocking: false };
    }
    return { ...a, blocking: false };
  });
}
