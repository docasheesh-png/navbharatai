// Offline AI — a 100% on-device app guide (admin 2026-07-16, enhanced 2026-07-18). Works with NO
// internet: it is grounded entirely in APP_KNOWLEDGE_BASE, which is pure data bundled into the client,
// so it always knows EVERY NavBharatAI feature — where the button is, what it does, how to use it —
// with ZERO hallucination (it only ever returns real KB facts, never a guessed answer). Because it
// reads the same single source of truth every AI reads, any feature added to the KB (mandatory per
// CLAUDE.md for every new feature) AUTOMATICALLY becomes answerable here — no separate sync.
// Retrieval-only + pure → unit-testable and instant; it needs no model download and no network.
//
// ENHANCEMENT (2026-07-18): because there is NO server to fall back to when offline, a query the exact
// matcher misses is a dead end. So retrieval now has a TYPO-TOLERANT fuzzy fallback tier (bounded edit
// distance) that recovers near-miss words like "databse" / "walet" / "deploi" — scored strictly BELOW
// exact hits, so every query that already worked ranks exactly as before. It also resolves each result's
// related features and offers starter suggestions, all from the same real KB data.
//
// HONESTY: this is an app GUIDE, not the full engine. Building apps and full Pro chat need the online
// engine (server + big models) — the UI says so and points the user online for those.

import { APP_KNOWLEDGE_BASE, type AppFeature } from '../server/AppContext/AppKnowledgeBase';
import { DEVICE_KNOWLEDGE_BASE, type DeviceHelp } from './deviceKnowledgeBase';
export type { DeviceHelp } from './deviceKnowledgeBase';

export interface OfflineMatch {
  feature: AppFeature;
  score: number;
}

export interface OfflineAnswer {
  /** 'answer' — a deterministic on-device answer (math/date/greeting/…); 'overview' — a whole-app tour;
   *  'matches' — features for a specific query; 'none' — nothing found. */
  kind: 'answer' | 'overview' | 'matches' | 'none';
  /** A short natural lead-in shown above the cards. */
  lead: string;
  /** The matched features (best first). Empty for 'answer'/'none' (an 'answer' may still add a few). */
  matches: AppFeature[];
  /** For kind 'answer': the computed reply text (never a fabricated fact — only what the device can
   *  truly compute/state offline). Absent for the other kinds. */
  answerText?: string;
  /** For kind 'answer': which category produced it (drives the UI icon). 'memory' = recalled from what
   *  the user taught this device. */
  answerKind?: QuickAnswerKind | 'memory';
  /** Phone/device-settings help entries matching the query (a separate KB from the app features). The UI
   *  renders these as a distinct "Phone help" section with an honest "steps may differ by brand" note. */
  deviceMatches?: DeviceHelp[];
}

/**
 * A single thing the user TAUGHT the Offline AI, persisted on THIS device only (never uploaded). This is
 * a deterministic personal memory — not machine-learning training — so recall returns exactly what the
 * user said, with zero hallucination. A 'qa' has a trigger (what you ask) + text (what it answers); a
 * 'fact' is a free-text note recalled by keyword.
 */
export interface UserMemory {
  id: string;
  kind: 'fact' | 'qa';
  /** For 'qa': the phrase the user asks to get `text` back. */
  trigger?: string;
  /** The answer ('qa') or the fact/note ('fact'). */
  text: string;
  /** Retrieval keywords (from the trigger for 'qa', from the text for 'fact'). */
  keywords: string[];
  createdAt: number;
}

const norm = (s: string): string => String(s || '').toLowerCase().trim();

/** Split text into lowercase word tokens (letters/digits only). Pure. */
function tokens(s: string): string[] {
  return norm(s).split(/[^a-z0-9]+/i).filter(Boolean);
}

/**
 * Bounded Levenshtein edit distance. Returns the true distance when it is ≤ `max`, otherwise returns
 * `max + 1` (an early-exit sentinel — we never care about the exact value once it exceeds the budget).
 * Pure and allocation-light (two rolling rows). Used only for the typo-tolerant fallback tier.
 */
export function editDistance(a: string, b: string, max = 2): number {
  a = norm(a);
  b = norm(b);
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = new Array<number>(bl + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    // If the entire row already exceeds the budget, no completion can come back under it.
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[bl] <= max ? prev[bl] : max + 1;
}

/** A query token fuzzily matches a target token when it is one/two small typos away. Only longer words
 *  are fuzzed (short words are too collision-prone), and the edit budget scales with length. Pure. */
function fuzzyTokenHit(queryTok: string, targetTok: string): boolean {
  if (queryTok.length < 4 || targetTok.length < 4) return false;
  if (Math.abs(queryTok.length - targetTok.length) > 2) return false;
  const budget = queryTok.length >= 7 ? 2 : 1;
  return editDistance(queryTok, targetTok, budget) <= budget;
}

/** The set of individual keyword + name words (length ≥ 4) a feature can be fuzzily matched against. Pure. */
function fuzzyTargets(f: AppFeature): Set<string> {
  const out = new Set<string>();
  for (const kw of f.keywords || []) for (const t of tokens(kw)) if (t.length >= 4) out.add(t);
  for (const t of tokens(f.name)) if (t.length >= 4) out.add(t);
  return out;
}

// Signals that the user wants a broad "what can this app do / show me everything" tour.
const OVERVIEW_SIGNALS = [
  'what can', 'what all', 'everything', 'all features', 'features list', 'list features', 'show me all',
  'kya kya', 'sab kuch', 'sari features', 'saari features', 'poori app', 'app me kya', 'app kya karti',
  'help', 'madad', 'guide', 'kaha se shuru', 'where to start', 'get started',
];

/** Score one feature against a normalized query. Mirrors the server AppContextInjector weighting so the
 *  offline guide ranks the same way the online AIs do, then adds a typo-tolerant fallback tier that is
 *  always scored BELOW the exact tiers (so a real hit can never be outranked by a fuzzy one). Pure. */
export function scoreFeature(f: AppFeature, msg: string): number {
  let score = 0;
  // Keyword match: a MULTI-WORD phrase is a strong, intentional signal, so a substring hit counts (+3). A
  // SINGLE-WORD keyword must match on a WORD BOUNDARY (a query token), never as a substring — otherwise a
  // short keyword like "ist" (IST timezone) falsely fires inside "min-IST-er", or "pr" inside "PRime",
  // surfacing a misleading card for an unrelated question. This mirrors the description matching below,
  // which already deliberately uses token-set membership for exactly this reason.
  const msgTokens = new Set(tokens(msg));
  for (const kw of f.keywords || []) {
    if (!kw) continue;
    const n = norm(kw);
    if (kw.includes(' ')) {
      if (msg.includes(n)) score += 3;
    } else if (msgTokens.has(n)) {
      score += 2;
    }
  }
  if (f.name && msg.includes(norm(f.name))) score += 4;
  // A word-boundary hit on any query token inside the description is a weak signal. (Word-boundary via a
  // token set — a substring check would falsely fire "art" inside "start".)
  const qWords = tokens(msg).filter((w) => w.length >= 4);
  const descTokens = new Set(tokens(f.description));
  for (const w of qWords) if (descTokens.has(w)) score += 1;
  // TYPO-TOLERANT FALLBACK — recover near-miss words the exact tiers missed. Weighted at 1.5, strictly
  // below an exact single-keyword hit (2), so it only ever surfaces results that would otherwise be lost.
  const targets = fuzzyTargets(f);
  for (const w of qWords) {
    if (targets.has(w)) continue; // already counted as an exact token hit above
    for (const t of targets) {
      if (fuzzyTokenHit(w, t)) { score += 1.5; break; }
    }
  }
  return score;
}

/** How many DISTINCT query words (length ≥ 4) this feature matches — via keyword/name tokens, a
 *  description word, a multi-word keyword phrase, or the typo-tolerant fallback. Breadth of coverage is
 *  the relevance tie-breaker: a feature that answers more of the user's actual words is more relevant
 *  than one matched on a single generic word. Pure. */
export function matchCoverage(f: AppFeature, msg: string): number {
  const qWords = tokens(msg).filter((w) => w.length >= 4);
  if (!qWords.length) return 0;
  const kwTokens = fuzzyTargets(f); // keyword + name words (length ≥ 4)
  const descTokens = new Set(tokens(f.description));
  const phrases = (f.keywords || []).filter((k) => k.includes(' ')).map(norm);
  let n = 0;
  for (const w of qWords) {
    let hit = kwTokens.has(w) || descTokens.has(w) || phrases.some((p) => p.includes(w));
    if (!hit) for (const t of kwTokens) if (fuzzyTokenHit(w, t)) { hit = true; break; }
    if (hit) n++;
  }
  return n;
}

/** Rank features for a query (best first, score > 0). Ties on score break by how many of the user's
 *  distinct words the feature covers (breadth of relevance), so a specific multi-term match outranks a
 *  feature that only caught one generic word. Pure. */
export function searchFeatures(query: string, limit = 6): OfflineMatch[] {
  const msg = norm(query);
  if (!msg) return [];
  return APP_KNOWLEDGE_BASE
    .map((f) => ({ feature: f, score: scoreFeature(f, msg), coverage: matchCoverage(f, msg) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage)
    .map(({ feature, score }) => ({ feature, score }))
    .slice(0, limit);
}

function isOverviewQuery(msg: string): boolean {
  return OVERVIEW_SIGNALS.some((s) => msg.includes(s));
}

/** Score a phone/device-help entry against a query — curated keywords + title, with typo tolerance. Keyed
 *  on specific device words (wifi, bluetooth, battery, …) so it does not fire on ordinary app queries.
 *  Pure. */
export function scoreDeviceHelp(h: DeviceHelp, msg: string): number {
  let score = 0;
  for (const kw of h.keywords || []) {
    if (kw && msg.includes(norm(kw))) score += kw.includes(' ') ? 3 : 2;
  }
  if (h.title && msg.includes(norm(h.title))) score += 4;
  // Typo-tolerant fallback over keyword + title words (scored below an exact keyword hit). We deliberately
  // do NOT score generic title words (e.g. "not", "working", "phone", "screen") — those are shared across
  // many entries and would cross-match unrelated problems; curated keywords carry the real signal.
  const qWords = tokens(msg).filter((w) => w.length >= 4);
  const targets = new Set<string>();
  for (const kw of h.keywords || []) for (const t of tokens(kw)) if (t.length >= 4) targets.add(t);
  for (const t of tokens(h.title)) if (t.length >= 4) targets.add(t);
  for (const w of qWords) {
    if (targets.has(w)) continue;
    for (const t of targets) if (fuzzyTokenHit(w, t)) { score += 1.5; break; }
  }
  return score;
}

/** Rank phone/device-help entries for a query (best first). Requires a real keyword-level signal
 *  (score ≥ 2) so it never fires on a single generic/fuzzy word crossing over from another entry. Pure. */
export function searchDeviceHelp(query: string, limit = 4): { help: DeviceHelp; score: number }[] {
  const msg = norm(query);
  if (!msg) return [];
  return DEVICE_KNOWLEDGE_BASE
    .map((h) => ({ help: h, score: scoreDeviceHelp(h, msg) }))
    .filter((m) => m.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The curated tour shown for a broad/empty/"what can you do" query — the app's headline surfaces. */
function overviewFeatures(): AppFeature[] {
  const wantIds = [
    'agentv3_builder', 'nbi_chat', 'professionals', 'download_app', 'support_contact',
    'billing', 'agentv3_github_import', 'agentv3_export',
  ];
  const byId = new Map(APP_KNOWLEDGE_BASE.map((f) => [f.id, f]));
  const picked = wantIds.map((id) => byId.get(id)).filter(Boolean) as AppFeature[];
  // Top up to 8 with the first entries if any curated id is missing (KB drift-safe).
  for (const f of APP_KNOWLEDGE_BASE) { if (picked.length >= 8) break; if (!picked.includes(f)) picked.push(f); }
  return picked.slice(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ON-DEVICE QUICK ANSWERS — real, deterministic replies the device can genuinely compute WITHOUT a
// model or the network (admin ask 2026-07-18: "chhoti moti question ka offline answer aa jaye"). These
// are NOT a fake "offline AI brain": every answer here is either a true computation (arithmetic, the
// device clock) or a fixed, honest statement about NavBharatAI itself. Open-knowledge questions ("capital
// of France") are deliberately NOT answered here — that needs the online engine, and faking it would
// break the "real features only / be honest" rules. All pure and unit-tested.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export type QuickAnswerKind = 'math' | 'datetime' | 'greeting' | 'thanks' | 'identity';

export interface QuickAnswer {
  kind: QuickAnswerKind;
  lead: string;
  text: string;
  /** Optional follow-on features (e.g. for greeting/identity, a few headline surfaces to tap). */
  features?: AppFeature[];
}

/** Round away binary-float noise and drop trailing zeros. Pure. */
function formatNumber(n: number): string {
  const r = Math.round(n * 1e10) / 1e10;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * Evaluate a compact arithmetic string (digits, `. + - * / % ^ ( )`) with correct precedence, via a
 * small recursive-descent parser. NO eval()/new Function() (those are the exact injection sinks the
 * builder's own security scan forbids). Returns the number, or null on any parse error / divide-by-zero.
 * Pure.
 */
export function evalArithmetic(input: string): number | null {
  const s = input.replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];

  function parseExpression(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const right = parseTerm();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[i++];
      const right = parseFactor();
      if (right === null) return null;
      if (op === '*') left = left * right;
      else { if (right === 0) return null; left = op === '/' ? left / right : left % right; }
    }
    return left;
  }
  function parseFactor(): number | null {
    const base = parseUnary();
    if (base === null) return null;
    if (peek() === '^') {
      i++;
      const exp = parseFactor(); // right-associative
      if (exp === null) return null;
      return Math.pow(base, exp);
    }
    return base;
  }
  function parseUnary(): number | null {
    if (peek() === '+') { i++; return parseUnary(); }
    if (peek() === '-') { i++; const v = parseUnary(); return v === null ? null : -v; }
    return parsePrimary();
  }
  function parsePrimary(): number | null {
    if (peek() === '(') {
      i++;
      const v = parseExpression();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    let num = '';
    while (i < s.length && /[\d.]/.test(s[i])) num += s[i++];
    if (num === '' || Number.isNaN(Number(num))) return null;
    return Number(num);
  }

  const result = parseExpression();
  if (i !== s.length) return null; // trailing garbage → not a clean expression
  return result === null || !Number.isFinite(result) ? null : result;
}

/** Strip a leading natural-language wrapper ("what is", "calculate", "kitna hai", …) off a math query. */
function stripMathLead(s: string): string {
  return s
    .replace(/^(what\s+is|what's|whats|calculate|compute|solve|evaluate|how much is|how much|kitna hai|kitne|kitna|value of)\s+/i, '')
    .replace(/[?=\s]+$/, '')
    .trim();
}

/** Try to answer a math question. Returns a QuickAnswer for any MATH-SHAPED input (so a math query never
 *  falls through to "feature not found") — including an honest "not a valid calculation" for a bad one —
 *  or null when the input is not a calculation at all. Pure. */
function tryMath(raw: string): QuickAnswer | null {
  let s = stripMathLead(norm(raw));
  s = s
    .replace(/\bmultiplied by\b/g, '*').replace(/\bdivided by\b/g, '/').replace(/\bdivide by\b/g, '/')
    .replace(/\btimes\b/g, '*').replace(/\binto\b/g, '*').replace(/\bplus\b/g, '+')
    .replace(/\bminus\b/g, '-').replace(/\bmod\b/g, '%');

  // "A % of B" / "A percent of B" → A/100 * B
  const pct = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(-?\d+(?:\.\d+)?)$/);
  if (pct) {
    const val = (parseFloat(pct[1]) / 100) * parseFloat(pct[2]);
    return { kind: 'math', lead: 'Calculated on your device', text: `${pct[1]}% of ${pct[2]} = ${formatNumber(val)}` };
  }

  const compact = s.replace(/\s+/g, '');
  // Math-shaped = only math characters, at least one digit, and at least one BINARY operator (a leading
  // unary sign like "-5" alone is not a calculation). Parentheses allowed anywhere.
  const onlyMathChars = /^[-+*/%^().\d]+$/.test(compact);
  const hasDigit = /\d/.test(compact);
  const hasBinaryOp = /[+*/%^]/.test(compact) || /[\d)]-/.test(compact);
  if (!onlyMathChars || !hasDigit || !hasBinaryOp) return null;

  const val = evalArithmetic(compact);
  if (val === null) {
    return { kind: 'math', lead: 'Calculator', text: "That doesn't look like a valid calculation — check for a divide-by-zero or a typo." };
  }
  return { kind: 'math', lead: 'Calculated on your device', text: `${compact} = ${formatNumber(val)}` };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDate(d: Date): string { return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function formatTime(d: Date): string {
  let h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

const TIME_TRIGGERS = ['what time', 'current time', 'time now', 'time kya', 'kitne baje', 'kitna baje', 'abhi kitne baje', 'what is the time', "what's the time", 'whats the time'];
const DATE_TRIGGERS = [
  "today's date", 'todays date', 'today date', 'what is the date', "what's the date", 'whats the date',
  'what date', 'current date', "aaj ki date", 'aaj ki tareekh', 'aaj ki tarikh', 'date kya', 'taarikh',
  'what day is it', 'what day is today', 'which day is today', 'what day', 'aaj kaun sa din', 'aaj konsa din',
  'kaun sa din', 'konsa din', 'din kya hai',
];

/** Answer a date/time/day question from the device clock (a real, offline-available fact). Pure given `now`. */
function tryDateTime(raw: string, now: Date): QuickAnswer | null {
  const s = norm(raw);
  if (TIME_TRIGGERS.some((t) => s.includes(t))) {
    return { kind: 'datetime', lead: 'Current time (your device clock)', text: `It's ${formatTime(now)}.` };
  }
  if (DATE_TRIGGERS.some((t) => s.includes(t))) {
    return { kind: 'datetime', lead: "Today's date (your device clock)", text: `Today is ${formatDate(now)}.` };
  }
  return null;
}

const GREETINGS = new Set(['hi', 'hii', 'hiii', 'hey', 'heyy', 'hello', 'helo', 'hlo', 'yo', 'hola', 'namaste', 'namaskar', 'namastey']);
const THANKS_TRIGGERS = ['thank you', 'thanks', 'thankyou', 'thank u', 'thnx', 'thx', 'dhanyavaad', 'dhanyawad', 'shukriya', 'shukria'];
const IDENTITY_TRIGGERS = [
  'who are you', 'what are you', 'who r u', 'who are u', 'tum kaun ho', 'tum kaun', 'aap kaun ho', 'aap kaun',
  'what is navbharatai', 'what is navbharat', 'navbharatai kya hai', 'kya hai navbharatai', 'about you',
  'your name', 'tumhara naam', 'who made you', 'who created you', 'kisne banaya',
];

function tryConversational(raw: string): QuickAnswer | null {
  const s = norm(raw).replace(/[!.?,]+$/g, '').trim();
  const words = s.split(/\s+/);

  if (IDENTITY_TRIGGERS.some((t) => s.includes(t))) {
    return {
      kind: 'identity',
      lead: 'About me',
      text: "I'm NavBharatAI's Offline AI — a 100% on-device guide. I know every feature of NavBharatAI and can answer quick things offline (calculations, date & time, and where to find features). For building apps and full chat, please go online.",
      features: overviewFeatures().slice(0, 4),
    };
  }
  if (THANKS_TRIGGERS.some((t) => s === t || s.startsWith(t + ' ') || s.includes(' ' + t))) {
    return { kind: 'thanks', lead: 'Anytime', text: "You're welcome! 😊 Ask me anything about NavBharatAI — I'm here even without internet." };
  }
  // Greeting: the message IS a greeting (short), not a sentence that merely contains "hi".
  if (words.length <= 2 && words.some((w) => GREETINGS.has(w))) {
    return {
      kind: 'greeting',
      lead: 'Hello',
      text: "Namaste! 🙏 I'm NavBharatAI's on-device guide. Ask me where a feature is, how to do something, or a quick calculation — I work even without internet.",
      features: overviewFeatures().slice(0, 4),
    };
  }
  return null;
}

/** The on-device quick-answer resolver: math → date/time → greeting/thanks/identity. Returns null when
 *  the query is not one of these deterministic categories (the caller then does feature retrieval). Pure
 *  given `now`. */
export function quickAnswer(query: string, now: Date = new Date()): QuickAnswer | null {
  const msg = norm(query);
  if (!msg) return null;
  return tryMath(query) || tryDateTime(query, now) || tryConversational(query);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// USER-TAUGHT MEMORY (read side) — recall what the user taught THIS device. Deterministic: returns the
// exact stored text, never a generated guess. The WRITE side (parsing a teaching command, adding /
// removing memories) lives in `offlineMemory.ts` to keep this module free of any dependency cycle.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Score a taught memory against a query: a strong boost when the query matches a 'qa' trigger, plus
 *  keyword overlap with typo tolerance. Pure. */
export function scoreMemory(m: UserMemory, query: string): number {
  const q = norm(query);
  if (!q) return 0;
  let s = 0;
  if (m.trigger) {
    const t = norm(m.trigger);
    if (t && q === t) s += 10;
    else if (t && (q.includes(t) || t.includes(q))) s += 6;
  }
  const qWords = new Set(tokens(q).filter((w) => w.length >= 3));
  for (const kw of m.keywords || []) {
    if (qWords.has(kw)) { s += 2; continue; }
    for (const w of qWords) if (fuzzyTokenHit(w, kw)) { s += 1; break; }
  }
  return s;
}

/** The single best taught memory for a query (score ≥ threshold), else null. Pure. */
export function recallMemory(memories: UserMemory[], query: string, threshold = 3): UserMemory | null {
  let best: UserMemory | null = null;
  let bestScore = 0;
  for (const m of memories || []) {
    const s = scoreMemory(m, query);
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return bestScore >= threshold ? best : null;
}

// Re-exported so the user-memory (write-side) module shares ONE tokenizer + typo-tolerance impl
// (rule 4: centralize, never duplicate). `tokenize` splits text into words; `fuzzyWordMatch` is the
// bounded-edit-distance word matcher used across retrieval and memory recall.
export { tokens as tokenize, fuzzyTokenHit as fuzzyWordMatch };

/**
 * Answer a user's offline question. Order: a deterministic on-device answer (real math / device clock /
 * an honest statement about NavBharatAI) → something the user TAUGHT this device → the app knowledge
 * base. Never invents an open-knowledge fact — returns real features, a real computation, the user's own
 * taught text, or an honest "not found". Pure given `now` and `memories`.
 */
export function answerOffline(query: string, now: Date = new Date(), memories: UserMemory[] = []): OfflineAnswer {
  const msg = norm(query);
  if (!msg || isOverviewQuery(msg)) {
    return {
      kind: 'overview',
      lead: 'Here\'s what NavBharatAI can do — tap any card to open it, or ask me "where is X / how do I Y".',
      matches: overviewFeatures(),
    };
  }
  // Deterministic on-device answer (calculation, date/time, greeting, identity) — real, never faked.
  const quick = quickAnswer(query, now);
  if (quick) {
    return { kind: 'answer', lead: quick.lead, answerText: quick.text, answerKind: quick.kind, matches: quick.features ?? [] };
  }
  // Something the user taught this device (recalled exactly — zero hallucination).
  const recalled = recallMemory(memories, msg);
  const deviceMatches = searchDeviceHelp(msg).map((m) => m.help);
  // App-feature matches. When this is clearly a PHONE-settings query (device help matched), keep only
  // strongly-relevant features (score ≥ 4 — a name or multi-keyword hit) so weak description-word matches
  // don't dilute the phone answer; otherwise show the normal ranked matches.
  const featureScored = searchFeatures(msg);
  const matches = (deviceMatches.length ? featureScored.filter((m) => m.score >= 4) : featureScored).map((m) => m.feature);
  if (recalled) {
    return {
      kind: 'answer',
      answerKind: 'memory',
      lead: recalled.kind === 'qa' ? 'You taught me this' : 'From what you taught me',
      answerText: recalled.text,
      matches, // still offer any related app features below the taught answer
      deviceMatches,
    };
  }
  if (matches.length === 0 && deviceMatches.length === 0) {
    return {
      kind: 'none',
      lead: 'I couldn\'t find that. I can help you navigate NavBharatAI, fix a phone-settings problem (Wi-Fi, battery, notifications…), do a quick calculation or the date, or remember something if you teach me ("remember …"). For general questions, please go online.',
      matches: [],
    };
  }
  const lead = deviceMatches.length
    ? (matches.length ? 'Here\'s help for your phone — plus matching NavBharatAI features:' : 'Here\'s how to sort that on your phone:')
    : (matches.length === 1 ? 'Here it is:' : `Found ${matches.length} matching feature${matches.length > 1 ? 's' : ''}:`);
  return { kind: 'matches', lead, matches, deviceMatches };
}

export interface NavTarget { view?: string; settingsScreen?: string }

// Curated id → in-app target for the headline features, so the Offline AI can render a WORKING
// "Open →" button today without hand-editing all 180 KB entries. A feature's OWN `nav` field (added
// to its KB entry) always WINS — so any future feature gets a working jump the moment its entry sets
// `nav`, and this map is only the fallback for the core surfaces that already exist.
const CURATED_NAV: Record<string, NavTarget> = {
  agentv3_builder: { view: 'nbi_pro_chat' },
  agentv3_export: { view: 'nbi_pro_chat' },
  agentv3_github_import: { view: 'nbi_pro_chat' },
  agentv3_zip_import: { view: 'nbi_pro_chat' },
  nbi_chat: { view: 'nbi_chat' },
  nbi_pro_chat: { view: 'nbi_pro_chat' },
  professionals: { view: 'professionals' },
  billing: { view: 'billing' },
  git: { view: 'git' },
  history: { view: 'history' },
  files: { view: 'files' },
  preview: { view: 'preview' },
  studio: { view: 'studio' },
  offline_ai: { view: 'offline_ai' },
  support_contact: { view: 'settings', settingsScreen: 'root' },
  'admin-metrics': { view: 'settings', settingsScreen: 'metrics' },
  general_settings: { view: 'settings', settingsScreen: 'general' },
  database: { view: 'settings', settingsScreen: 'database' },
  connections: { view: 'settings', settingsScreen: 'connections' },
  secrets: { view: 'settings', settingsScreen: 'secrets' },
  // The Settings terminal was removed (admin 2026-08-11) — it was a second doorway to Code
  // Studio's own terminal. `ide_terminal` now carries the target, so asking "terminal kahan hai"
  // still lands somewhere real instead of navigating nowhere.
  ide_terminal: { view: 'studio' },
  settings_logs: { view: 'settings', settingsScreen: 'logs' },
  voice_to_app: { view: 'voice' },
  ai_debugger: { view: 'debugger' },
  ai_image_gen: { view: 'imagegen' },
  bot_builder: { view: 'botbuilder' },
};

/** The direct-navigation target for a feature: its own KB `nav` first, else the curated fallback, else
 *  null (the UI then shows the textual `path` as honest guidance — never a dead button). Pure. */
export function navFor(feature: AppFeature): NavTarget | null {
  const own = feature.nav;
  if (own && (own.view || own.settingsScreen)) return own;
  return CURATED_NAV[feature.id] ?? null;
}

const KB_BY_ID = new Map(APP_KNOWLEDGE_BASE.map((f) => [f.id, f]));

/** Resolve a feature's `relatedFeatures` ids to their real KB entries (drops any dangling id, and never
 *  returns the feature itself). Powers the "Related" chips so the user can hop across connected features
 *  without retyping. Pure, and always real KB data — no fabrication. */
export function relatedFeaturesOf(feature: AppFeature, limit = 4): AppFeature[] {
  const out: AppFeature[] = [];
  for (const id of feature.relatedFeatures || []) {
    if (id === feature.id) continue;
    const f = KB_BY_ID.get(id);
    if (f && !out.includes(f)) out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

/** A few real starter questions shown when the box is empty or a search comes up short, so the user
 *  always has a next tap. Each `query` resolves to a real KB result. Pure/static. */
export const SUGGESTED_QUERIES: { label: string; query: string }[] = [
  { label: 'Build an app', query: 'build an app' },
  { label: 'Wallet & billing', query: 'wallet billing' },
  { label: 'Database', query: 'database' },
  { label: 'Deploy', query: 'deploy' },
  { label: 'Wi-Fi not working', query: 'wifi not working' },
  { label: 'Battery draining', query: 'battery draining' },
  { label: 'Voice chat', query: 'voice chat' },
  { label: 'Download the app', query: 'download app' },
];

/** The howToUse text as clean, numbered-friendly steps (splits on "1. 2." or sentences). Pure. */
export function howToSteps(howToUse: string): string[] {
  const t = String(howToUse || '').trim();
  if (!t) return [];
  const byNumber = t.split(/\s*(?:\d+\.\s+)/).map((s) => s.trim()).filter(Boolean);
  if (byNumber.length > 1) return byNumber;
  return t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}
