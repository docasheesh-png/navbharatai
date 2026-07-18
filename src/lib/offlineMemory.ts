// User-taught memory (write side) — admin ask 2026-07-18: "user khud train kar sake, jo bole woh yaad
// rakhe". HONEST SCOPE: this is NOT machine-learning training (that needs a model + compute + data, which
// is impossible on-device/offline). It is a DETERMINISTIC personal memory the user teaches in plain
// language; entries are stored ONLY on this device (localStorage, never uploaded) and recalled EXACTLY —
// zero hallucination. This module owns parsing a teaching command and mutating the memory list; the READ
// side (scoring/recall/types) lives in `offlineAssistant.ts`, so there is no dependency cycle.
//
// Teaching forms understood (all committed only on an explicit action, e.g. pressing Enter):
//   • "remember [that] <fact>"  /  "note <fact>"  /  "save <fact>"  /  "yaad rakho [ki] <fact>"
//   • "when I ask <X> answer/say/reply <Y>"       (an explicit question → answer pair)
//   • "jab main <X> puchu [to] <Y>"               (the same, in Hinglish)
//   • "<X> means <Y>"  /  "<X> ka matlab <Y>"     (a definition; math equations like "2+2=4" are NOT
//                                                   treated as teaching)

import { tokenize, type UserMemory } from './offlineAssistant';

export type { UserMemory };

export interface ParsedTeaching {
  kind: 'fact' | 'qa';
  /** For 'qa': the phrase the user will ask. */
  trigger?: string;
  /** The answer ('qa') or the fact ('fact'). */
  text: string;
}

const norm = (s: string): string => String(s || '').toLowerCase().trim();

/** localStorage key for the on-device taught memory (versioned so a future format change is safe). */
export const OFFLINE_MEMORY_KEY = 'navbharat_offline_memory_v1';

/** Hard caps so a user can never blow the localStorage quota or store a runaway blob. */
export const MEMORY_MAX_ITEMS = 500;
export const MEMORY_MAX_TEXT = 2000;

// Common filler words dropped from retrieval keywords so recall keys on the meaningful words.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'of', 'to', 'my', 'me', 'i', 'in', 'on', 'at',
  'and', 'or', 'that', 'this', 'it', 'you', 'your', 'for', 'with', 'as', 'if', 'so', 'do', 'does',
  'ki', 'ka', 'ke', 'hai', 'ho', 'kya', 'ko', 'se', 'pe', 'par', 'mera', 'meri', 'mere', 'hoon', 'na',
]);

/** Retrieval keywords for a memory: meaningful words (length ≥ 3, non-stopword), unique, capped. Pure. */
export function makeKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of tokenize(text)) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    if (!seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out.slice(0, 24);
}

const QUESTION_WORDS = /\b(kya|kaun|kaise|kahan|kab|kyun|why|what|who|how|when|where|which)\b|\?/i;
const MATH_SHAPED = /^[\d\s+\-*/%^().]+$/;

/** A definition ("X means Y" / "X = Y") is only teaching when X is a short term, Y is present and is not
 *  itself a question, and it is not a math equation (so "2+2=4" is computed, not "taught"). */
function isDefinitionSafe(trigger: string, answer: string): boolean {
  const t = trigger.trim();
  const a = answer.trim();
  if (!t || !a) return false;
  if (t.split(/\s+/).length > 6) return false;      // a long left side is a sentence, not a term
  if (MATH_SHAPED.test(t) && MATH_SHAPED.test(a)) return false; // an equation, not a definition
  if (QUESTION_WORDS.test(a)) return false;          // "X ka matlab kya hai" is a question, not teaching
  return true;
}

function qa(trigger: string, text: string): ParsedTeaching | null {
  const t = trigger.trim();
  const x = text.trim();
  if (!t || !x) return null;
  return { kind: 'qa', trigger: t, text: x };
}

/**
 * Parse a natural-language teaching command into a memory to store, or null if the input is not a
 * teaching command (the caller then treats it as a normal question). Pure.
 */
export function parseTeaching(query: string): ParsedTeaching | null {
  const raw = String(query || '').trim();
  if (!raw) return null;

  // "when I ask X answer Y"
  let m = raw.match(/^(?:remember\s+)?(?:that\s+)?when\s+i\s+(?:ask|say)\s+(.+?)[,]?\s+(?:answer|reply|say|respond(?:\s+with)?)\s+(.+)$/i);
  if (m) return qa(m[1], m[2]);

  // "jab main X puchu/kahu [to] Y"
  m = raw.match(/^jab\s+(?:main|mai|mein)\s+(.+?)\s+(?:pucho|puchu|poochu|poocho|kahu|kahoon|bolu|bolun)\s+(?:to\s+|tab\s+)?(.+)$/i);
  if (m) return qa(m[1], m[2]);

  // "X means Y" / "X ka matlab [hai] Y" / "X ka jawab [hai] Y"
  m = raw.match(/^(.+?)\s+(?:means|ka\s+matlab(?:\s+hai)?|ka\s+jawab(?:\s+hai)?)\s+(.+)$/i);
  if (m && isDefinitionSafe(m[1], m[2])) return qa(m[1], m[2]);

  // "X = Y" (definition), but never a math equation
  m = raw.match(/^([^=]{1,60})=\s*(.+)$/);
  if (m && isDefinitionSafe(m[1], m[2])) return qa(m[1], m[2]);

  // "remember/note/save/yaad rakho [that/ki] <fact>"
  m = raw.match(/^(?:remember|note|save|yaad\s+rakho|yaad\s+rakhna|yaad\s+rkhna|yad\s+rakho)\b[:\-]?\s*(?:that\s+|ki\s+)?(.+)$/i);
  if (m && m[1].trim()) return { kind: 'fact', text: m[1].trim() };

  return null;
}

/** Build a UserMemory from a parsed teaching (keywords from the trigger for 'qa', from the text for
 *  'fact'; text is length-capped). Pure. */
export function buildMemory(parsed: ParsedTeaching, id: string, now: number): UserMemory {
  const text = parsed.text.slice(0, MEMORY_MAX_TEXT).trim();
  const keywords = parsed.kind === 'qa' ? makeKeywords(parsed.trigger || '') : makeKeywords(text);
  return { id, kind: parsed.kind, trigger: parsed.trigger?.trim(), text, keywords, createdAt: now };
}

/**
 * Add a taught memory to the list. A 'qa' with the same (normalized) trigger REPLACES the old one; an
 * identical 'fact' is not duplicated. Oldest entries are dropped past MEMORY_MAX_ITEMS. Returns a NEW
 * list (never mutates the input). Pure.
 */
export function addMemory(list: UserMemory[], parsed: ParsedTeaching, id: string, now: number): UserMemory[] {
  const mem = buildMemory(parsed, id, now);
  const kept = (list || []).filter((m) => {
    if (parsed.kind === 'qa' && m.kind === 'qa' && norm(m.trigger || '') === norm(parsed.trigger || '')) return false;
    if (parsed.kind === 'fact' && m.kind === 'fact' && norm(m.text) === norm(mem.text)) return false;
    return true;
  });
  const next = [...kept, mem];
  return next.length > MEMORY_MAX_ITEMS ? next.slice(next.length - MEMORY_MAX_ITEMS) : next;
}

/** Remove one taught memory by id. Returns a NEW list. Pure. */
export function removeMemory(list: UserMemory[], id: string): UserMemory[] {
  return (list || []).filter((m) => m.id !== id);
}

/** Load taught memories from localStorage (safe: returns [] on any error or malformed data). */
export function loadMemories(storage?: Pick<Storage, 'getItem'>): UserMemory[] {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!store) return [];
    const raw = store.getItem(OFFLINE_MEMORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed entries (defensive against a hand-edited/older blob).
    return parsed.filter((m): m is UserMemory =>
      m && typeof m.id === 'string' && (m.kind === 'fact' || m.kind === 'qa') &&
      typeof m.text === 'string' && Array.isArray(m.keywords));
  } catch {
    return [];
  }
}

/** Persist taught memories to localStorage (safe: swallows quota/serialization errors). */
export function saveMemories(list: UserMemory[], storage?: Pick<Storage, 'setItem'>): void {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!store) return;
    store.setItem(OFFLINE_MEMORY_KEY, JSON.stringify(list));
  } catch {
    /* offline / quota — non-fatal, memory simply isn't persisted this time */
  }
}
