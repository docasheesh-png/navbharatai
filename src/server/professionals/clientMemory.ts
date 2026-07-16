/**
 * Generic per-user memory for the Professional AI framework (admin 2026-07-15:
 * "har professional ko ek real AI agent banao" — every professional should get to
 * know its user, remember them across sessions, and treat them personally).
 *
 * This is the config-driven generalisation of the original Teacher-only student
 * profile. A professional opts in by declaring a `memory` block (intake + fields);
 * the engine then loads/saves a per-user `ClientProfile` keyed to that professional
 * and instructs the persona to (a) take a domain-appropriate introduction on the
 * first meeting, (b) use everything already known on later visits, and (c) report
 * NEW facts in a hidden <user_memory>{json}</user_memory> block at the very end of
 * its reply. The server extracts + strips that block (the user never sees it),
 * validates it against the professional's declared fields, merges it into the stored
 * profile, and injects the profile into the system prompt next turn.
 *
 * This file holds the PURE, dependency-free pieces so the tricky logic is unit-tested
 * without firebase-admin. The Firestore wrapper lives in ClientProfileStore.ts.
 */

/** One remembered field a professional declares. */
export interface MemoryField {
  /** JSON key the model emits and we store, e.g. 'weakSubjects'. */
  key: string;
  /** Human label rendered in the "what you already know" block, e.g. 'Weak subjects'. */
  label: string;
  /** true = a string[] (union-merged); omitted/false = a single scalar string (overwrite-merged). */
  list?: boolean;
  /** Short guidance shown to the model in the save instruction, e.g. 'topics they find hard'. */
  hint?: string;
}

/** A professional's memory declaration (on ProfessionalConfig.memory). */
export interface ProfessionalMemory {
  /**
   * Domain intake: what a real practitioner learns about a new client on the first
   * meeting (e.g. a doctor asks history; a CA asks entity + turnover; a trainer asks
   * goal + equipment). Injected verbatim as the "first meeting" guidance.
   */
  intake: string;
  /** The fields this professional remembers about each user. */
  fields: MemoryField[];
  /** Noun for the person, used in prompt headings (e.g. 'student', 'client', 'patient'). Default 'person'. */
  subject?: string;
}

/** A stored per-user profile: dynamic map of declared field key → scalar or list value. */
export type ClientProfile = Record<string, string | string[]>;

// Bounds — a profile document must stay bounded (never grow forever) but hold as much as safely fits
// (admin 2026-07-15: "grow professional memory as much as you can"). Raised well above the originals
// while staying comfortably inside Firestore's 1 MiB doc limit even across many fields.
const SCALAR_MAX_CHARS = 500;
const ITEM_MAX_CHARS = 240;
const LIST_MAX_ITEMS = 40;

// Distinctive tags so a leaked machine block is unambiguous to strip. `<user_memory>` is the
// current tag; `<student_memory>` is the legacy Teacher-only tag, still stripped defensively so
// an in-flight/older instruction can never leak into a chat.
const MEMORY_BLOCK_RE = /<(user|student)_memory>([\s\S]*?)<\/\1_memory>/gi;

function cleanString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, maxChars) : undefined;
}

function cleanList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = cleanString(item, ITEM_MAX_CHARS);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= LIST_MAX_ITEMS) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Validate + bound a raw (model-emitted) profile update against the professional's
 * declared fields. Unknown keys are dropped, wrong-typed values are dropped, strings
 * are trimmed/bounded, lists are deduped/capped. Returns null when nothing usable survives.
 */
export function sanitizeUpdate(raw: unknown, fields: MemoryField[]): Partial<ClientProfile> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const update: ClientProfile = {};
  for (const field of fields) {
    if (!(field.key in src)) continue;
    if (field.list) {
      const v = cleanList(src[field.key]);
      if (v) update[field.key] = v;
    } else {
      const v = cleanString(src[field.key], SCALAR_MAX_CHARS);
      if (v) update[field.key] = v;
    }
  }
  return Object.keys(update).length > 0 ? update : null;
}

/**
 * Pull the hidden memory block out of a model reply: returns the reply with EVERY such
 * block removed (the user must never see it) plus the raw parsed JSON from the LAST
 * parseable block (models occasionally emit more than one). A missing/malformed block
 * yields raw: null — the reply is still cleaned either way. Callers sanitise `raw`
 * against their declared fields.
 */
export function extractMemory(reply: string): { reply: string; raw: unknown | null } {
  if (!reply || !/<(user|student)_memory>/i.test(reply)) return { reply, raw: null };
  let raw: unknown | null = null;
  for (const match of reply.matchAll(MEMORY_BLOCK_RE)) {
    try {
      const parsed = JSON.parse(match[2]);
      if (parsed && typeof parsed === 'object') raw = parsed;
    } catch { /* malformed JSON in one block — ignore it, keep any earlier valid one */ }
  }
  const cleaned = reply.replace(MEMORY_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  return { reply: cleaned, raw };
}

/** Merge a sanitised update into the existing profile (scalars overwrite; lists union, newest kept, capped). */
export function mergeProfile(existing: ClientProfile, update: Partial<ClientProfile>, fields: MemoryField[]): ClientProfile {
  const merged: ClientProfile = { ...existing };
  for (const field of fields) {
    const fresh = update[field.key];
    if (fresh === undefined) continue;
    if (!field.list) {
      if (typeof fresh === 'string') merged[field.key] = fresh;
      continue;
    }
    const freshList = Array.isArray(fresh) ? fresh : [];
    if (freshList.length === 0) continue;
    const existingList = Array.isArray(existing[field.key]) ? (existing[field.key] as string[]) : [];
    const combined: string[] = [];
    const seen = new Set<string>();
    // Newest facts win the cap: walk fresh-first (then old), reversed, then restore order.
    for (const item of [...existingList, ...freshList].reverse()) {
      const k = item.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      combined.push(item);
      if (combined.length >= LIST_MAX_ITEMS) break;
    }
    merged[field.key] = combined.reverse();
  }
  return merged;
}

/** Whether the profile holds any remembered fact for the declared fields. */
export function hasFacts(profile: ClientProfile | null | undefined, fields: MemoryField[]): boolean {
  if (!profile) return false;
  return fields.some((f) => {
    const v = profile[f.key];
    return f.list ? Array.isArray(v) && v.length > 0 : typeof v === 'string' && v.length > 0;
  });
}

/** Render the stored profile as the "what you already know" system-prompt block ('' when empty). */
export function formatProfileBlock(profile: ClientProfile | null | undefined, memory: ProfessionalMemory): string {
  if (!hasFacts(profile, memory.fields)) return '';
  const p = profile!;
  const subject = memory.subject || 'person';
  const lines: string[] = [];
  for (const f of memory.fields) {
    const v = p[f.key];
    if (f.list) {
      if (Array.isArray(v) && v.length > 0) lines.push(`• ${f.label}: ${v.join(', ')}`);
    } else if (typeof v === 'string' && v) {
      lines.push(`• ${f.label}: ${v}`);
    }
  }
  return `WHAT YOU ALREADY KNOW ABOUT THIS ${subject.toUpperCase()} (remembered from previous sessions — use it naturally, never re-ask it):\n${lines.join('\n')}`;
}

/**
 * The memory behaviour layer injected into the system prompt for a memory-enabled
 * professional. `canPersist` = a signed-in user (facts actually get saved); an
 * anonymous user still gets the introduction, but the persona must never claim
 * cross-session memory it does not have.
 */
export function memoryLayer(canPersist: boolean, memory: ProfessionalMemory): string {
  const subject = memory.subject || 'person';
  const common = `YOUR ${subject.toUpperCase()} — you personally know and remember every ${subject} you work with:
- If a "WHAT YOU ALREADY KNOW ABOUT THIS ${subject.toUpperCase()}" section is present, USE it naturally: greet them by name, tailor everything to their situation, and NEVER re-ask what you already know — ask only what is missing or has changed.
- FIRST MEETING (nothing saved yet): before diving deep, warmly introduce yourself and get to know the ${subject} the way a real professional does at the start of a relationship. ${memory.intake} Ask AT MOST 2 short, friendly questions per message — a natural conversation, never an interrogation or a form. If they arrive with an urgent need, help with that first, then get introduced.`;
  if (!canPersist) {
    return `${common}
- This ${subject} is NOT signed in, so you cannot remember them after this conversation ends. Never claim permanent memory. You may mention once, naturally, that signing in lets you remember them across sessions. Do not output any <user_memory> block.`;
  }
  const keyList = memory.fields.map((f) => `"${f.key}"${f.list ? ':[…]' : ':"…"'}${f.hint ? ` (${f.hint})` : ''}`).join(', ');
  return `${common}
- SAVING NEW FACTS: whenever the ${subject} tells you a NEW or CHANGED personal fact, append at the very END of your reply exactly one block on its own line:
<user_memory>{${keyList}}</user_memory>
  Include ONLY the keys you newly learned or that changed this turn (omit everything already known and unchanged). The block is machine-read and INVISIBLE to the ${subject} — never mention it, never explain it, never put any text after it. When nothing new was learned, output no block at all.`;
}

/** Stable Firestore doc key for a user's profile with a given professional. */
export function profileKey(userId: string, professionalId: string): string {
  return `${userId}__${professionalId.replace(/[^\w-]/g, '_')}`;
}
