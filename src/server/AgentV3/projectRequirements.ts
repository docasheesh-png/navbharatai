// PROJECT REQUIREMENTS — the user's standing instructions, kept for as long as the project lives.
//
// 🔴 WHY THIS EXISTS (incident: a complex 3D game was built, then an edit request produced a different game).
//
// An edit is only as faithful as what the builder is told about the project. Three limits in the existing
// memory made "the original brief" unrecoverable after a little activity, not just after 100 messages:
//   1. `WorkspaceMemory` keeps 500 episodes of EVERY kind (request, error, fix, note, audit) and evicts the
//      OLDEST first. A build records dozens of non-request episodes, so the first request — the brief — is the
//      first thing to go.
//   2. `FirestoreWorkspaceMemoryStore` persists only the LAST 100 episodes, and ignores a snapshot older than
//      30 days. After a worker restart the brief is simply not in what comes back.
//   3. `planningRequest` carries the last THREE requests, and drops chat turns.
// So "keep my game a 3D city game with first-person controls" said in message 1 had no durable home.
//
// This module is the home. It is PURE (no I/O, no clock): a ledger of
//   • the BRIEF — the first message that asked for the app, never evicted;
//   • STANDING REQUIREMENTS — constraints the user stated as lasting ("always", "never", "keep", "must",
//     "hamesha", "mat"), each with the id of the message it came from;
//   • CORRECTIONS — a later explicit change that SUPERSEDES the requirement it overlaps (the old one is kept,
//     marked, and never shown to the builder again).
// A one-off request ("make the button blue") is not a standing requirement and is not stored here: it lives in
// the conversation, which stays the canonical record. The ledger can always be REBUILT from that record
// (`rebuildLedger`), so a lost or unreadable copy is recoverable rather than fatal.
//
// Derived facts are never stored as requirements: what the CODE currently contains is read from the current
// revision, so a restore cannot leave a ledger describing code that no longer exists.

export type RequirementKind = 'brief' | 'constraint' | 'correction';

export interface Requirement {
  /** Stable id: `${sourceId}#${index}`. Re-applying the same message yields the same ids. */
  id: string;
  kind: RequirementKind;
  text: string;
  /** The id of the conversation message this came from — every decision is traceable. */
  sourceId: string;
  ts: number;
  /** Significant words, for overlap and supersession. */
  topic: string[];
  supersededBy?: string;
  supersededAt?: number;
}

export interface RequirementLedger {
  version: 1;
  brief: Requirement | null;
  items: Requirement[];
  /** Message ids already folded in, so replays, retries and rebuilds are idempotent. */
  processed: string[];
}

export const MAX_ITEMS = 60;
export const MAX_PROCESSED = 600;
export const BRIEF_MAX_CHARS = 2_000;
export const REQUIREMENT_MAX_CHARS = 320;

export function emptyLedger(): RequirementLedger {
  return { version: 1, brief: null, items: [], processed: [] };
}

// ── what counts as a standing instruction ────────────────────────────────────────────────────────────────

const STANDING_EN = /\b(?:must|always|never|do\s+not|don't|dont|keep|only|ensure|make\s+sure|required?|shall|should\s+(?:always|never|stay|remain)|no\s+matter|at\s+all\s+times|stay|remain|preserve|without\s+(?:changing|removing|breaking))\b/i;
const STANDING_HI = /\b(?:hamesha|hamesa|kabhi\s+nahi|kabhi\s+bhi\s+nahi|mat\s+(?:karna|badalna|hatana|todna)|zaroor|zaruri|jaruri|sirf|hi\s+rakhna|rakhna|rehna\s+chahiye|banaye\s+rakhna|nahi\s+badalna|nahi\s+hatana|change\s+mat)\b/i;
/** A correction: the user changes an earlier decision. */
const CORRECTION = /\b(?:actually|instead|rather|no\s+longer|not\s+anymore|any\s*more|replace|change\s+(?:it|that|this|the|my)\b|switch\s+to|from\s+now\s+on|ab\s+se|ab\s+nahi|ab\s+(?:third|first|second)|badal\s+do|badal\s+de|pehle\s+.{0,40}\s+ab|scrap\s+that|forget\s+(?:that|what))\b/i;

const STOP = new Set((
  'a an the and or but if then else of to in on at by for with from into onto over under is are was were be been being '
  + 'it its this that these those i you we they he she me my our your their us them do does did done can could will would '
  + 'should shall may might must have has had not no yes please pls also too very more most some any each every all '
  + 'hai hain ho hoga hogi tha thi the ka ki ke ko se me mein par pe aur ya bhi hi to toh ye yeh wo woh is us isko usko '
  + 'kar karo karna kare do dena de diye dijiye chahiye chahie mujhe mujhko tum aap hum app game make build create add '
  + 'new change update fix edit now just only want need like'
).split(/\s+/));

/** Lower-case significant words (≥3 chars, not a stop word), lightly stemmed, deduplicated, bounded. */
export function topicOf(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const w = raw.replace(/(?:ing|ed|es|s)$/u, '');
    if (w.length < 3 || STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 16) break;
  }
  return out;
}

function overlap(a: readonly string[], b: readonly string[]): { shared: number; jaccard: number } {
  if (a.length === 0 || b.length === 0) return { shared: 0, jaccard: 0 };
  const sb = new Set(b);
  let shared = 0;
  for (const w of a) if (sb.has(w)) shared++;
  return { shared, jaccard: shared / (a.length + b.length - shared) };
}

function sentencesOf(text: string): string[] {
  return String(text ?? '')
    .split(/(?<=[.!?।])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

/** Is this sentence a lasting instruction (as opposed to a one-off request)? PURE. */
export function isStandingInstruction(sentence: string): boolean {
  const s = String(sentence ?? '');
  return STANDING_EN.test(s) || STANDING_HI.test(s);
}

/** Does this sentence change an earlier decision? PURE. */
export function isCorrection(sentence: string): boolean {
  return CORRECTION.test(String(sentence ?? ''));
}

export interface LedgerMessage {
  /** The conversation message's id (or a stable derived one — see `messageIdFor`). */
  id: string;
  text: string;
  ts: number;
  /** The caller's verdict that this message asked for the app (the first one becomes the brief). */
  isBuildRequest?: boolean;
}

export function messageIdFor(_index: number, text: string): string {
  // A stable id for a transcript that carries none. It depends on the CONTENT only, never the position: the same
  // words get the same id whether they are read from a rebuilt transcript or recorded live a moment earlier, so a
  // message can never be folded in twice under two names.
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `m-${(h >>> 0).toString(36)}`;
}

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function trim(items: Requirement[]): Requirement[] {
  if (items.length <= MAX_ITEMS) return items;
  // Evict superseded ones first (oldest first), then the oldest active constraint. The brief is not in `items`.
  const out = items.slice();
  while (out.length > MAX_ITEMS) {
    const i = out.findIndex((r) => r.supersededBy);
    out.splice(i >= 0 ? i : 0, 1);
  }
  return out;
}

/**
 * Fold ONE user message into the ledger. Immutable and idempotent: the same message id folded twice changes
 * nothing, so a retry, a reconnect or a rebuild cannot duplicate a requirement. PURE.
 */
export function applyMessage(ledger: RequirementLedger, msg: LedgerMessage): RequirementLedger {
  const text = String(msg?.text ?? '');
  const id = String(msg?.id ?? '');
  if (!id || !text.trim() || ledger.processed.includes(id)) return ledger;

  let brief = ledger.brief;
  let items = ledger.items.slice();
  const processed = [...ledger.processed, id].slice(-MAX_PROCESSED);

  if (!brief && msg.isBuildRequest) {
    brief = { id: `${id}#brief`, kind: 'brief', text: clip(text, BRIEF_MAX_CHARS), sourceId: id, ts: msg.ts, topic: topicOf(text) };
  }

  sentencesOf(text).forEach((sentence, index) => {
    // The brief's own sentences are part of the brief; only an explicit lasting instruction is promoted out of it.
    if (!isStandingInstruction(sentence) && !isCorrection(sentence)) return;
    const topic = topicOf(sentence);
    if (topic.length === 0) return;
    const reqId = `${id}#${index}`;
    const active = items.filter((r) => !r.supersededBy);

    // A repeat of something already active refreshes nothing and adds nothing.
    if (active.some((r) => r.text.toLowerCase() === clip(sentence, REQUIREMENT_MAX_CHARS).toLowerCase() || overlap(r.topic, topic).jaccard >= 0.8) && !isCorrection(sentence)) return;

    const correction = isCorrection(sentence);
    if (correction) {
      // The correction supersedes every ACTIVE requirement it clearly overlaps (≥2 shared words, or one shared
      // word when either side is short) — and a correction that overlaps nothing is simply a new requirement.
      for (const old of active) {
        const o = overlap(old.topic, topic);
        if (o.shared >= 2 || (o.shared >= 1 && (old.topic.length <= 3 || topic.length <= 3))) {
          const i = items.findIndex((r) => r.id === old.id);
          if (i >= 0) items[i] = { ...old, supersededBy: reqId, supersededAt: msg.ts };
        }
      }
    }
    items.push({ id: reqId, kind: correction ? 'correction' : 'constraint', text: clip(sentence, REQUIREMENT_MAX_CHARS), sourceId: id, ts: msg.ts, topic });
  });

  return { version: 1, brief, items: trim(items), processed };
}

/**
 * Rebuild the ledger from the canonical conversation, oldest first. The result is a function of the messages
 * alone, so it is the recovery path when the stored ledger is missing, unreadable or stale. PURE.
 */
export function rebuildLedger(messages: readonly LedgerMessage[]): RequirementLedger {
  let ledger = emptyLedger();
  for (const m of messages) ledger = applyMessage(ledger, m);
  return ledger;
}

export function activeRequirements(ledger: RequirementLedger): Requirement[] {
  return ledger.items.filter((r) => !r.supersededBy);
}

/** True when the two ledgers hold the same brief and the same active requirements. PURE. */
export function sameRequirements(a: RequirementLedger, b: RequirementLedger): boolean {
  const key = (l: RequirementLedger) => JSON.stringify([l.brief?.text ?? '', activeRequirements(l).map((r) => r.text)]);
  return key(a) === key(b);
}

/**
 * The bounded block the builder reads. Active requirements only (a superseded one is history, not an
 * instruction), each tagged with its source message so a decision can be traced. Empty when there is nothing
 * to say. PURE.
 */
export function renderRequirements(ledger: RequirementLedger, maxChars = 2_400): string {
  const active = activeRequirements(ledger);
  if (!ledger.brief && active.length === 0) return '';
  const lines: string[] = [
    '[PROJECT MEMORY — the user\'s own words, kept for the life of this project. An edit must respect every line below unless the user\'s CURRENT message explicitly changes it.]',
  ];
  if (ledger.brief) lines.push(`Original brief [${ledger.brief.sourceId}]: ${ledger.brief.text}`);
  // A correction that replaces a requirement stated INSIDE the brief must cancel that sentence of the brief,
  // or the builder is handed two contradictory instructions in the user's own words.
  const cancelled = ledger.items.filter((r) => r.supersededBy && ledger.brief && r.sourceId === ledger.brief.sourceId);
  if (cancelled.length > 0) {
    lines.push('Parts of the brief that NO LONGER apply (the user changed them later — do not follow them):');
    for (const r of cancelled) lines.push(`- ${r.text} → replaced by [${r.supersededBy?.split('#')[0]}]`);
  }
  if (active.length > 0) {
    lines.push('Standing requirements (newest last):');
    for (const r of active) lines.push(`- [${r.sourceId}] ${r.text}`);
  }
  let out = lines.join('\n');
  if (out.length > maxChars) {
    // Keep the brief and the NEWEST requirements; drop the oldest requirement lines first.
    const headLen = (ledger.brief ? 2 : 1) + (cancelled.length > 0 ? 1 + cancelled.length : 0);
    const head = lines.slice(0, headLen);
    const rest = lines.slice(headLen + (active.length > 0 ? 1 : 0));
    let kept = rest.slice();
    while (kept.length > 0 && (head.concat(['Standing requirements (newest last):'], kept).join('\n')).length > maxChars) kept = kept.slice(1);
    out = head.concat(kept.length > 0 ? ['Standing requirements (newest last):', ...kept] : []).join('\n');
    if (out.length > maxChars) out = `${out.slice(0, maxChars - 1)}…`;
  }
  return out;
}

/**
 * Pull the user's text and ids out of a stored transcript (Anthropic-style messages), skipping assistant turns
 * and tool results. A message without an id gets a stable derived one. PURE.
 */
export function userMessagesOf(messages: readonly unknown[]): LedgerMessage[] {
  const out: LedgerMessage[] = [];
  (Array.isArray(messages) ? messages : []).forEach((raw, index) => {
    const m = raw as { role?: unknown; content?: unknown; id?: unknown; ts?: unknown; createdAt?: unknown } | null;
    if (!m || m.role !== 'user') return;
    let text = '';
    if (typeof m.content === 'string') text = m.content;
    else if (Array.isArray(m.content)) {
      text = m.content
        .map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
        .filter(Boolean)
        .join('\n');
    }
    text = text.trim();
    if (!text) return;
    const id = typeof m.id === 'string' && m.id ? m.id : messageIdFor(index, text);
    const tsRaw = typeof m.ts === 'number' ? m.ts : typeof m.createdAt === 'number' ? m.createdAt : 0;
    out.push({ id, text, ts: tsRaw > 0 ? tsRaw : index + 1 });
  });
  return out;
}
