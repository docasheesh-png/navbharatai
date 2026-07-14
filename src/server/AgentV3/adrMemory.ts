// GA-6 — Persistent engineering memory, ADR slice.
//
// Every AgentV3 build implicitly chooses an architecture (framework + database + styling + language)
// but the LIVE engine never captured that decision, never persisted it per-project, and never read a
// prior decision back into the next build. (An ADR generator exists — AppMakerLab/intelligence/
// ADRManager — but it is DEAD to AgentV3: it needs `RankedPattern[]` scores this engine never
// produces, and its only callers are in the dormant AppMakerLab engine.)
//
// This slice captures the REAL detected stack of a successful build as a numbered, dated ADR markdown
// file dropped into the workspace (`docs/decisions/ADR-NNN.md`), persists the record per project, and
// injects a compact digest of prior ADRs back into the Architect prompt on the next build — so the AI
// remembers "this project is a React + Tailwind + Firestore app" instead of re-deciding from scratch.
//
// HONESTY: we do NOT fabricate pattern scores or a ranked list of "alternatives" (AgentV3 has none) —
// that would be a fake ADR. We reuse only `adrId` + the markdown skeleton and record the genuinely
// detected stack, with an explicit "not ranked by this engine" note in the Alternatives section.
//
// Design mirrors UserPreferenceStore.ts: PURE CORE (fully unit-tested, no I/O) + a Firestore wrapper
// that VITEST-skips, is best-effort, and never throws. Collection: `adrDecisions/{userId__projectId}`.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { adrId } from '../AppMakerLab/intelligence/ADRManager';
import { detectDatabase, detectStyling, detectLanguage, summarizePattern } from './UserPreferenceStore';

/** One captured architecture decision — the real detected stack of a successful build. */
export interface AdrRecord {
  number: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  framework: string | null;
  database: string | null;
  styling: string | null;
  language: string | null;
  pattern: string | null;
  /** Short human rationale (the app type + what drove the stack). */
  rationale: string;
}

/** The durable per-project ADR log. */
export interface StoredAdr {
  records: AdrRecord[];
  updatedAt?: string;
}

const MAX_ADR = 50;
const DIGEST_LIMIT = 5;

/**
 * Build one ADR record from a successful build's produced files + framework + prompt. Pure.
 * Returns null when NOTHING about the stack is detectable — we never write a fake/empty ADR.
 */
export function buildAdrRecord(input: {
  framework?: string | null;
  files: Record<string, string>;
  prompt?: string | null;
  priorCount: number;
  nowIso: string;
}): AdrRecord | null {
  const files = input.files || {};
  const framework = input.framework && input.framework.trim() ? input.framework : null;
  const database = detectDatabase(files);
  const styling = detectStyling(files);
  const language = detectLanguage(files);
  const pattern = summarizePattern(input.prompt);
  // Nothing detectable → no ADR (honesty: don't record a decision we didn't observe).
  if (!framework && !database && !styling && !language && !pattern) return null;
  const stackBits = [framework, language, styling, database].filter(Boolean).join(' + ');
  const rationale = pattern
    ? `A ${pattern} app built on ${stackBits || 'the detected stack'}.`
    : `Built on ${stackBits || 'the detected stack'}.`;
  return {
    number: Math.max(0, Math.floor(input.priorCount)) + 1,
    date: String(input.nowIso).slice(0, 10),
    framework, database, styling, language, pattern,
    rationale,
  };
}

/** Render an ADR record as the workspace markdown file. Pure — mirrors ADRManager's skeleton. */
export function renderAdrMarkdown(rec: AdrRecord): { path: string; content: string } {
  const id = adrId(rec.number);
  const stack = [
    rec.framework ? `framework: ${rec.framework}` : '',
    rec.language ? `language: ${rec.language}` : '',
    rec.styling ? `styling: ${rec.styling}` : '',
    rec.database ? `database: ${rec.database}` : '',
  ].filter(Boolean).join(', ') || 'not detected';
  const lines: string[] = [
    `# ${id}: Architecture of this project`,
    '',
    `- **Status:** Accepted`,
    `- **Date:** ${rec.date}`,
    '',
    '## Context',
    rec.rationale,
    '',
    '## Decision',
    `Use the following stack — ${stack}.`,
    '',
    '## Alternatives considered',
    '- _Not ranked by this engine; the decision reflects the shipped stack + this user\'s preferences._',
    '',
    '## Consequences',
    `The project is built on the stack above. A materially different rebuild will append a new ADR.`,
    '',
  ];
  return { path: `docs/decisions/${id}.md`, content: lines.join('\n') };
}

/** True when `rec`'s stack differs from the most recent prior record (so a rebuild that changed
 *  nothing does NOT append a duplicate ADR). Pure. */
export function stackChanged(prev: AdrRecord | null | undefined, rec: AdrRecord): boolean {
  if (!prev) return true;
  return prev.framework !== rec.framework
    || prev.database !== rec.database
    || prev.styling !== rec.styling
    || prev.language !== rec.language;
}

/** Append `rec` to the log (capped, newest last). Pure — returns a NEW array. */
export function foldAdr(existing: AdrRecord[] | null | undefined, rec: AdrRecord, cap = MAX_ADR): AdrRecord[] {
  const base = Array.isArray(existing) ? existing : [];
  const next = [...base, rec];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** A compact read-back block of the latest ADRs for the Architect prompt, or '' when empty. Pure. */
export function adrDigest(records: ReadonlyArray<AdrRecord> | null | undefined, limit = DIGEST_LIMIT): string {
  if (!records || records.length === 0) return '';
  const latest = records.slice(-limit);
  const lines = latest.map((r) => {
    const stack = [r.framework, r.language, r.styling, r.database].filter(Boolean).join(' + ') || 'unknown stack';
    return `- ${adrId(r.number)} (${r.date}): ${stack}${r.pattern ? ` — ${r.pattern}` : ''}`;
  });
  return [
    'PRIOR ARCHITECTURE DECISIONS (this project\'s past builds — keep new work consistent with the',
    'established stack unless the user explicitly asks to change it):',
    ...lines,
  ].join('\n');
}

/**
 * Firestore-backed persistence around the pure core. VITEST-skip, best-effort, never throws —
 * mirrors UserPreferenceStore.
 */
class AdrStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  private docId(userId: string, projectId: string): string {
    return `${userId}__${projectId}`;
  }

  /** Load a project's ADR log (null when none / unavailable). */
  async get(userId: string | null, projectId: string | null): Promise<StoredAdr | null> {
    const db = this.getDb();
    if (!db || !userId || !projectId) return null;
    try {
      const snap = await db.collection('adrDecisions').doc(this.docId(userId, projectId)).get();
      return snap.exists ? (snap.data() as StoredAdr) : null;
    } catch {
      return null;
    }
  }

  /** Load + render the injectable digest in one call ('' when none). Never throws. */
  async contextFor(userId: string | null, projectId: string | null): Promise<string> {
    try {
      const stored = await this.get(userId, projectId);
      return adrDigest(stored?.records ?? []);
    } catch {
      return '';
    }
  }

  /**
   * Record one SUCCESSFUL build's architecture decision. Appends a new ADR only when the stack is
   * detectable AND differs from the latest prior ADR (a no-change rebuild appends nothing). Returns
   * the appended record when written, null otherwise. Best-effort, transactional, never throws.
   */
  async record(
    userId: string | null,
    projectId: string | null,
    input: { framework?: string | null; files: Record<string, string>; prompt?: string | null },
    nowIso: string,
  ): Promise<AdrRecord | null> {
    const db = this.getDb();
    if (!db || !userId || !projectId) return null;
    try {
      const ref = db.collection('adrDecisions').doc(this.docId(userId, projectId));
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? (snap.data() as StoredAdr) : null;
        const records = Array.isArray(prev?.records) ? prev!.records : [];
        const rec = buildAdrRecord({ ...input, priorCount: records.length, nowIso });
        if (!rec) return null;
        // Skip a duplicate ADR when the stack did not change from the last decision.
        if (!stackChanged(records[records.length - 1] ?? null, rec)) return null;
        const nextRecords = foldAdr(records, rec);
        tx.set(ref, { records: nextRecords, updatedAt: nowIso }, { merge: false });
        return rec;
      });
    } catch (err) {
      console.error('[ADR-MEMORY] record failed:', err);
      return null;
    }
  }
}

export const adrStore = new AdrStore();
