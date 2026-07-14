/**
 * Student-profile memory for Teacher AI (admin 2026-07-14: "teacher ko introduction lena
 * chahiye aur students ke bare me sari jankari apni memory me save karni chahiye").
 *
 * A professional with `memory: 'student_profile'` gets a persistent, per-user profile:
 * the model is instructed to (a) interview a brand-new student like a real teacher on
 * day one, (b) use everything already known on every later visit, and (c) report NEW
 * facts in a hidden <student_memory>{json}</student_memory> block at the end of its
 * reply. The server extracts + strips that block (the user never sees it), merges it
 * into the stored profile, and injects the profile into the system prompt next turn.
 *
 * This file holds the PURE, dependency-free pieces (types, extraction, sanitising,
 * merging, prompt blocks) so the tricky logic is unit-tested without firebase-admin.
 * The Firestore wrapper lives in StudentProfileStore.ts (mirrors VoiceMemoryStore).
 */

export interface StudentProfile {
  /** Student's name. */
  name?: string;
  /** Where they are from / live (city/state). */
  location?: string;
  /** What they do (school student / college student / job + role). */
  occupation?: string;
  /** School / college / institute name. */
  college?: string;
  /** What they are studying — class, course, stream (e.g. "Class 12 PCM", "B.Sc 2nd year"). */
  studying?: string;
  /** Exams they are preparing for (e.g. NEET, JEE, UPSC, boards). */
  targetExams?: string[];
  /** Subjects they want to study. */
  subjects?: string[];
  /** Subjects/topics they find weak or difficult. */
  weakSubjects?: string[];
  /** Preferred language for teaching (e.g. Hindi, Hinglish, English). */
  language?: string;
  /** Other useful teaching facts: learning style, goals, schedule, topic progress. */
  notes?: string[];
}

/** Scalar profile fields (single string values). */
const SCALAR_KEYS = ['name', 'location', 'occupation', 'college', 'studying', 'language'] as const;
/** List profile fields (string arrays). */
const ARRAY_KEYS = ['targetExams', 'subjects', 'weakSubjects', 'notes'] as const;

// Bounds — a profile document must stay small and can never grow unbounded.
const SCALAR_MAX_CHARS = 160;
const ITEM_MAX_CHARS = 120;
const ARRAY_MAX_ITEMS = 12;
const NOTES_MAX_ITEMS = 20;
const NOTE_MAX_CHARS = 300;

const MEMORY_BLOCK_RE = /<student_memory>([\s\S]*?)<\/student_memory>/gi;

function cleanString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.slice(0, maxChars);
}

function cleanArray(value: unknown, maxItems: number, maxChars: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = cleanString(item, maxChars);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Validate + bound a raw (model-emitted) profile update. Unknown keys are dropped,
 * wrong-typed values are dropped, strings/arrays are trimmed, deduped and capped.
 * Returns null when nothing usable survives.
 */
export function sanitizeProfileUpdate(raw: unknown): Partial<StudentProfile> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const update: Partial<StudentProfile> = {};
  for (const key of SCALAR_KEYS) {
    const v = cleanString(src[key], SCALAR_MAX_CHARS);
    if (v) update[key] = v;
  }
  for (const key of ARRAY_KEYS) {
    const maxItems = key === 'notes' ? NOTES_MAX_ITEMS : ARRAY_MAX_ITEMS;
    const maxChars = key === 'notes' ? NOTE_MAX_CHARS : ITEM_MAX_CHARS;
    const v = cleanArray(src[key], maxItems, maxChars);
    if (v) update[key] = v;
  }
  return Object.keys(update).length > 0 ? update : null;
}

/**
 * Pull the hidden <student_memory> block out of a model reply: returns the reply with
 * EVERY such block removed (the student must never see it) plus the sanitised update
 * from the LAST parseable block (models occasionally emit more than one). A missing or
 * malformed block yields update: null — the reply is still cleaned either way.
 */
export function extractStudentMemory(reply: string): { reply: string; update: Partial<StudentProfile> | null } {
  if (!reply || !/<student_memory>/i.test(reply)) return { reply, update: null };
  let update: Partial<StudentProfile> | null = null;
  for (const match of reply.matchAll(MEMORY_BLOCK_RE)) {
    try {
      const parsed = sanitizeProfileUpdate(JSON.parse(match[1]));
      if (parsed) update = parsed;
    } catch { /* malformed JSON in one block — ignore it, keep any earlier valid one */ }
  }
  const cleaned = reply.replace(MEMORY_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  return { reply: cleaned, update };
}

/** Merge a sanitised update into the existing profile (scalars overwrite; arrays union, newest kept, capped). */
export function mergeStudentProfile(existing: StudentProfile, update: Partial<StudentProfile>): StudentProfile {
  const merged: StudentProfile = { ...existing };
  for (const key of SCALAR_KEYS) {
    if (update[key]) merged[key] = update[key];
  }
  for (const key of ARRAY_KEYS) {
    const fresh = update[key];
    if (!fresh || fresh.length === 0) continue;
    const maxItems = key === 'notes' ? NOTES_MAX_ITEMS : ARRAY_MAX_ITEMS;
    const combined: string[] = [];
    const seen = new Set<string>();
    // Newest facts win the cap: walk from the end (fresh first, then old), then restore order.
    for (const item of [...(existing[key] ?? []), ...fresh].reverse()) {
      const k = item.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      combined.push(item);
      if (combined.length >= maxItems) break;
    }
    merged[key] = combined.reverse();
  }
  return merged;
}

/** Whether the profile holds any remembered fact at all. */
export function hasProfileFacts(profile: StudentProfile | null | undefined): boolean {
  if (!profile) return false;
  return SCALAR_KEYS.some((k) => !!profile[k]) || ARRAY_KEYS.some((k) => (profile[k]?.length ?? 0) > 0);
}

/** Render the stored profile as the "what you already know" system-prompt block ('' when empty). */
export function formatStudentProfileBlock(profile: StudentProfile | null | undefined): string {
  if (!hasProfileFacts(profile)) return '';
  const p = profile!;
  const lines: string[] = [];
  if (p.name) lines.push(`• Name: ${p.name}`);
  if (p.location) lines.push(`• From: ${p.location}`);
  if (p.occupation) lines.push(`• Does: ${p.occupation}`);
  if (p.college) lines.push(`• School/College: ${p.college}`);
  if (p.studying) lines.push(`• Studying: ${p.studying}`);
  if (p.targetExams?.length) lines.push(`• Preparing for: ${p.targetExams.join(', ')}`);
  if (p.subjects?.length) lines.push(`• Subjects: ${p.subjects.join(', ')}`);
  if (p.weakSubjects?.length) lines.push(`• Weak subjects/topics (give these extra care): ${p.weakSubjects.join(', ')}`);
  if (p.language) lines.push(`• Prefers to learn in: ${p.language}`);
  if (p.notes?.length) lines.push(...p.notes.map((n) => `• Note: ${n}`));
  return `WHAT YOU ALREADY KNOW ABOUT THIS STUDENT (remembered from previous sessions — use it naturally):\n${lines.join('\n')}`;
}

/**
 * The memory behaviour layer injected into the system prompt when a professional has
 * student-profile memory. `canPersist` = a signed-in user (facts actually get saved);
 * an anonymous user still gets the day-one introduction, but the teacher must never
 * claim cross-session memory it does not have.
 */
export function studentMemoryLayer(canPersist: boolean): string {
  const common = `YOUR STUDENT — you personally know and remember every student you teach:
- If a "WHAT YOU ALREADY KNOW ABOUT THIS STUDENT" section is present, USE it: greet them by name, teach at their level, pitch examples to their course/exam, give extra patience and practice on their weak subjects. NEVER re-ask what you already know — ask only what is missing or has changed.
- FIRST MEETING (no saved details yet): before diving deep into teaching, warmly introduce yourself and get to know the student the way a real teacher does on day one — across the first few messages learn: their name; where they are from; what they do (school/college/job); their school or college; what they are studying (class/course/stream); which exam(s) they are preparing for; which subjects they want to study; which subjects or topics feel weak. Ask AT MOST 2 short, friendly questions per message — a natural conversation, never a form. If they arrive with an urgent doubt, help with that first, then get introduced.`;
  if (!canPersist) {
    return `${common}
- This student is NOT signed in, so you cannot remember them after this conversation ends. Never claim permanent memory. You may mention once, naturally, that signing in lets you remember them across sessions. Do not output any <student_memory> block.`;
  }
  return `${common}
- SAVING NEW FACTS: whenever the student tells you a NEW or CHANGED personal/study fact, append at the very END of your reply exactly one block on its own line:
<student_memory>{"name":"…","location":"…","occupation":"…","college":"…","studying":"…","targetExams":["…"],"subjects":["…"],"weakSubjects":["…"],"language":"…","notes":["…"]}</student_memory>
  Include ONLY the keys you newly learned or that changed this turn (omit everything already known and unchanged). "notes" is for other teaching-relevant facts: learning style, goals, daily schedule, progress on a topic, what confused them. The block is machine-read and INVISIBLE to the student — never mention it, never explain it, never put any text after it. When nothing new was learned, output no block at all.`;
}

/** Stable Firestore doc key for a user's profile with a given professional. */
export function profileKey(userId: string, professionalId: string): string {
  return `${userId}__${professionalId.replace(/[^\w-]/g, '_')}`;
}
