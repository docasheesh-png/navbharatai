// CHAT HISTORY THE WAY CHATGPT, CLAUDE AND GROK DO IT — the rules, in one pure place.
//
// WHY (admin 2026-09-28, verbatim: "chat id wala system hata kar, baki ai me jo system hota hai, wahi
// wala yaha bana do! history me jaisa (chatgpt, claude, grok) karte hai, waise hi navbharatai ka ui/ux
// ho. yeh chat id wala system band karo"). A user report the same day said it plainly: "when we close
// the app and reopen it, it doesn't show, and when we tried to search it asks chat id. Also who
// remembers chat id to search, also chat id doesn't show."
//
// Three things made that true, and each has a rule here:
//
//   1. A chat was reopened by typing a "Universal Chat ID" that no screen ever showed. Every other AI
//      product opens a conversation by tapping it in a list. The ID box is gone; a chat is opened by
//      its own session id, from the list, and nothing asks the user for an identifier ever again.
//
//   2. A reopened chat came back as a collapsed "Previous Conversation (<id>)" block, a "Continuation
//      Workspace" divider and a canned line claiming "Previous workspace context has been successfully
//      loaded". ChatGPT shows the conversation as it was and lets you keep typing. `openedTranscript`
//      is that: the whole thread, in order, with the canned greetings of the old system removed.
//
//   3. A chat could be missing from History: the list read the cloud only, the cloud write waited two
//      seconds, and closing the app inside those two seconds meant it never happened. The copy on the
//      phone was read only when the cloud ERRORED, never when it was merely behind. `mergeDeviceSessions`
//      puts both in one list, newest copy winning, so a conversation the user can see on their phone is
//      in their History on that phone.
//
// And one thing History must NOT show: a conversation that never started. "New chat" used to save a
// row holding only the welcome line, so the list filled with "New Conversation" entries nobody wrote.
// `isEmptyConversation` is the one answer to "is there anything here?", read by the list and by every
// writer, so an empty chat is neither saved nor shown.
//
// PURE — no React, no storage, no clock.

import { sessionIsDoctor } from './sessionRouting';

/** The fields these rules read. Every session shape in the app (full, index row, Firestore doc) fits. */
export interface HistoryRowLike {
  id?: unknown;
  title?: unknown;
  customTitle?: unknown;
  lastUpdated?: unknown;
  messages?: unknown;
  restoredMessages?: unknown;
  files?: unknown;
  /** Index rows carry counts instead of contents (see historyIndex.ts). */
  messageCount?: unknown;
  fileCount?: unknown;
  hasUserMessage?: unknown;
  agent?: unknown;
  current_agent?: unknown;
  original_agent?: unknown;
  currentAgent?: unknown;
  originalAgent?: unknown;
  tab?: unknown;
  profViewId?: unknown;
}

interface MessageLike { id?: unknown; sender?: unknown; text?: unknown; timestamp?: unknown }

/** The placeholder titles a session carries before anybody has typed. */
export const PLACEHOLDER_TITLES: readonly string[] = ['New Conversation', 'New App Build', 'Untitled', ''];

/**
 * Message ids the retired chat-ID system wrote INTO transcripts on every restore. They describe the
 * mechanism, not the conversation ("Previous workspace context has been successfully loaded…"), so a
 * chat opened today drops them rather than repeating them back to the user.
 */
const CANNED_ID_PREFIXES: readonly string[] = ['continuation-greeting-'];

const arr = (x: unknown): MessageLike[] => (Array.isArray(x) ? (x as MessageLike[]) : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

function hasUserMessage(list: MessageLike[]): boolean {
  return list.some((m) => !!m && typeof m === 'object' && m.sender === 'user');
}

/** Rows this module must never judge empty: they carry no transcript of ours to judge by. */
function ownedElsewhere(row: HistoryRowLike): boolean {
  const id = str(row.id);
  if (id.startsWith('v3_')) return true; // NavBharatAI Pro: the transcript lives on the server
  if (row.profViewId) return true; // a professional conversation (local store)
  const agents = [row.agent, row.current_agent, row.original_agent, row.currentAgent, row.originalAgent, row.tab]
    .map((v) => str(v).toLowerCase());
  if (agents.some((a) => a.includes('agentv3') || a === 'engine_builder')) return true;
  return sessionIsDoctor(row as Record<string, unknown>);
}

/**
 * Did this conversation ever start? PURE.
 *
 * A row is EMPTY when nobody has typed in it and it produced no files — the welcome line alone is not a
 * conversation. Built for the uncertain cases too: an index row has no message text, so it answers
 * from its `hasUserMessage` flag, and an older index row without that flag counts as empty only when
 * its count says there is at most the welcome line AND its title is still a placeholder. Anything this module cannot judge (a Pro build, a Doctor AI case, a professional
 * conversation, a row with no information at all) is NEVER empty — hiding a real conversation is the
 * one mistake History must not make.
 */
export function isEmptyConversation(row: HistoryRowLike | null | undefined): boolean {
  if (!row || typeof row !== 'object') return false;
  if (ownedElsewhere(row)) return false;
  const files = row.files && typeof row.files === 'object' ? Object.keys(row.files as object).length
    : typeof row.fileCount === 'number' ? row.fileCount : 0;
  if (files > 0) return false;
  if (Array.isArray(row.messages)) {
    return !hasUserMessage(arr(row.messages)) && !hasUserMessage(arr(row.restoredMessages));
  }
  if (typeof row.hasUserMessage === 'boolean') return !row.hasUserMessage;
  if (typeof row.messageCount === 'number') {
    return row.messageCount <= 1 && PLACEHOLDER_TITLES.includes(str(row.title).trim());
  }
  return false;
}

/** The title a row is shown under: the user's own name for it first, then the saved title. */
export function displayTitle(row: HistoryRowLike | null | undefined): string {
  if (!row) return '';
  const custom = str(row.customTitle).trim();
  if (custom) return custom;
  return str(row.title).trim();
}

/** A rename is a short, single line — never empty, never a paragraph. `null` = nothing to save. */
export const MAX_TITLE_LENGTH = 80;
export function cleanTitle(input: unknown): string | null {
  const t = str(input).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH).trim();
  return t ? t : null;
}

function timeOf(row: HistoryRowLike): number {
  const raw = row.lastUpdated;
  const t = typeof raw === 'number' ? raw : typeof raw === 'string' ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * One list from the cloud's rows and THIS DEVICE's saved sessions. PURE.
 *
 * By id, the NEWER copy wins (a tie goes to the cloud, which is the shared truth). A session that only
 * this device has — its cloud write had not landed when the app was closed — is listed too, because the
 * user can see it on this phone and a History that hides it is the "it doesn't show" report exactly.
 * Empty conversations are dropped from both sides. Newest first, the order every list here expects.
 *
 * ⚠️ The honest cost: a chat deleted on ANOTHER device can still be listed on a device that kept a
 * copy, until it is deleted there too. Losing a conversation the user can see is the worse error, so
 * this errs toward showing it.
 */
export function mergeDeviceSessions<T extends HistoryRowLike>(cloud: readonly T[], device: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of Array.isArray(cloud) ? cloud : []) {
    const id = str(row?.id);
    if (id) byId.set(id, row);
  }
  for (const row of Array.isArray(device) ? device : []) {
    const id = str(row?.id);
    if (!id) continue;
    const have = byId.get(id);
    if (!have || timeOf(row) > timeOf(have)) byId.set(id, have ? { ...have, ...row } : row);
  }
  return [...byId.values()]
    .filter((row) => !isEmptyConversation(row))
    .sort((a, b) => timeOf(b) - timeOf(a));
}

/**
 * The conversation exactly as it was, ready to continue. PURE.
 *
 * Folds the retired system's split (`restoredMessages` held everything before the last restore) back
 * into one thread, drops duplicate ids, keeps chronological order, and removes the canned restore
 * greetings. Messages without an id are kept in place rather than dropped — a message is the user's
 * words, and an old record missing an id is still their conversation.
 */
export function openedTranscript<M extends MessageLike>(session: { messages?: unknown; restoredMessages?: unknown } | null | undefined): M[] {
  if (!session) return [];
  const all = [...arr(session.restoredMessages), ...arr(session.messages)] as M[];
  const seen = new Set<string>();
  const out: M[] = [];
  for (const m of all) {
    if (!m || typeof m !== 'object') continue;
    const id = str(m.id);
    if (id && CANNED_ID_PREFIXES.some((p) => id.startsWith(p))) continue;
    if (id) {
      if (seen.has(id)) {
        const at = out.findIndex((x) => str(x.id) === id);
        if (at >= 0) out[at] = m; // last write wins, as before
        continue;
      }
      seen.add(id);
    }
    out.push(m);
  }
  const t = (m: M): number => {
    const raw = m.timestamp;
    const v = raw instanceof Date ? raw.getTime() : typeof raw === 'number' ? raw : new Date(str(raw)).getTime();
    return Number.isFinite(v) ? v : NaN;
  };
  // Chronological when every message is dated; when any is not, the stored order is the only honest
  // order there is, so it is kept exactly (a sort with holes in its key would scramble it).
  const keyed = out.map((m, i) => ({ m, i, t: t(m) }));
  if (keyed.some((k) => Number.isNaN(k.t))) return out;
  return keyed.sort((a, b) => a.t - b.t || a.i - b.i).map((k) => k.m);
}

/**
 * Is `next` the transcript already saved? PURE. Opening a chat must not count as writing in it: without
 * this, the autosave stamps "now" on a conversation the user only LOOKED at, and it jumps to the top of
 * History — which ChatGPT, Claude and Grok never do.
 */
export function sameTranscript(saved: unknown, next: unknown): boolean {
  const a = arr(saved);
  const b = arr(next);
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const last = (l: MessageLike[]) => l[l.length - 1] ?? {};
  const x = last(a);
  const y = last(b);
  return str(x.id) === str(y.id) && str(x.text) === str(y.text) && str(a[0]?.id) === str(b[0]?.id);
}

/**
 * Do two file maps hold the same files? PURE. Compared by key and value, never by reference — a chat
 * opened from History brings its own map object, and "a different object with the same files" is not
 * a change worth re-saving (and re-dating) the conversation for.
 */
export function sameFileMap(a: unknown, b: unknown): boolean {
  const x = a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
  const y = b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  const kx = Object.keys(x);
  if (kx.length !== Object.keys(y).length) return false;
  return kx.every((k) => Object.prototype.hasOwnProperty.call(y, k) && x[k] === y[k]);
}
