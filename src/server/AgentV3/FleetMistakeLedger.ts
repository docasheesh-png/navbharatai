// AgentV3 — Fleet Mistake Ledger: one user's solved mistake protects EVERY user.
//
// WHY (the step beyond MistakeLedger, admin direction 2026-08-07: "isko aur jyada accha banao").
// The per-user MistakeLedger stops a user repeating THEIR OWN past mistake — but user #1001's very
// first build still walks into the exact failure user #7 solved months ago, because nothing carries
// a proven fix ACROSS users. The systems that actually get safer over time all share one property:
// aviation does not make every pilot crash once to learn a lesson — one investigated failure becomes
// a checklist item for every cockpit in the world. This module is that checklist.
//
// PRIVACY BY CONSTRUCTION (what makes cross-user sharing safe):
//   • The KEY is `errorSignature`, which already strips paths, numbers, hex and quoted strings —
//     "listen EADDRINUSE :::5173" and ":::3000" share one anonymous identity.
//   • The stored SAMPLE and FIX pass through `redactSecrets` + `redactPII` before they are written,
//     so a key or email that leaked into an error message can never travel to another user's prompt.
//   • NO user id, workspace id, or prompt text is ever stored — a fleet record is only: "this failure
//     shape exists, it has been seen N times, and THIS fix proved to work."
//
// SAME DISCIPLINES AS THE PER-USER LEDGER (one house style, no drift):
//   • a fix is recorded only when the build that followed it actually SUCCEEDED;
//   • `repeatsAfterFix` counts fleet-wide repeats after a fix was known — the honest self-measurement;
//   • both call sites are best-effort — the fleet can never break or slow a build.
//
// Storage: one Firestore doc PER SIGNATURE (`fleet_mistakes_v3/{hash(signature)}`), so lookups are
// direct key gets (no queries) and concurrent builds from different users touch different docs.
//
// Kill switch: AGENTV3_FLEET_LEDGER=off disables both read and write instantly, no deploy.

import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { redactSecrets, redactPII } from './SecretRedactor';
import {
  mistakeKey,
  formatKnownMistakes,
  matchedMistakes,
  MAX_GUARDS,
  type MistakeRecord,
} from './MistakeLedger';

export const FLEET_COLLECTION = 'fleet_mistakes_v3';

/** How many distinct signatures one build may look up / write (bounds Firestore work per build). */
export const MAX_FLEET_LOOKUPS = 6;
export const MAX_FLEET_WRITES = 6;

const FLEET_HEADER =
  'KNOWN MISTAKE (solved before on NavBharatAI) — this exact failure has a proven fix. Do NOT rediscover it from scratch:';

/** The fleet stores the SAME record shape as the per-user ledger — one definition of a mistake. */
export type FleetMistakeRecord = MistakeRecord;

/** Trim to a single readable line (same discipline as the per-user ledger). PURE. */
function line(text: string, max: number): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Sanitize text before it may travel to ANOTHER user's build prompt: secrets first, then PII.
 * The signature key is already anonymous by construction; this guards the human-readable
 * sample/fix, where an error message could have echoed a key, email or phone number. PURE.
 */
export function sanitizeForFleet(text: string, max = 400): string {
  return line(redactPII(redactSecrets(text ?? '')), max);
}

/**
 * A Firestore-safe doc id for a signature (signatures contain spaces, slashes and `<path>` tokens
 * that are illegal or ambiguous in doc ids). Deterministic, collision-resistant. PURE.
 */
export function fleetDocId(signature: string): string {
  return createHash('sha256').update(signature).digest('hex').slice(0, 32);
}

/**
 * Fold one SIGHTING of an error into a fleet record (create or increment). When a proven fix already
 * exists, the sighting increments `repeatsAfterFix` — the fleet-wide honesty counter. PURE.
 */
export function mergeFleetSighting(
  prev: FleetMistakeRecord | null,
  errorText: string,
  ts = Date.now(),
): FleetMistakeRecord | null {
  const signature = mistakeKey(errorText);
  if (!signature) return null;
  if (prev && prev.signature === signature) {
    return {
      ...prev,
      seen: (prev.seen || 0) + 1,
      lastSeen: ts,
      repeatsAfterFix: prev.provenFix ? (prev.repeatsAfterFix || 0) + 1 : prev.repeatsAfterFix || 0,
    };
  }
  return { signature, sample: sanitizeForFleet(errorText, 180), seen: 1, lastSeen: ts, repeatsAfterFix: 0 };
}

/**
 * Fold a PROVEN fix into a fleet record — only ever called for a build that succeeded (the caller
 * enforces it, same as the per-user store). The fix text is sanitized before it can be stored. PURE.
 */
export function mergeFleetProvenFix(
  prev: FleetMistakeRecord | null,
  errorText: string,
  fix: string,
  ts = Date.now(),
): FleetMistakeRecord | null {
  const signature = mistakeKey(errorText);
  const cleanFix = sanitizeForFleet(fix, 400);
  if (!signature || !cleanFix) return prev;
  if (prev && prev.signature === signature) {
    return { ...prev, provenFix: cleanFix, fixedAt: ts };
  }
  return {
    signature,
    sample: sanitizeForFleet(errorText, 180),
    seen: 1,
    lastSeen: ts,
    provenFix: cleanFix,
    fixedAt: ts,
    repeatsAfterFix: 0,
  };
}

/**
 * Render the fleet guard block for the given current errors — reuses the per-user formatter (same
 * tested wording, bounds and dedupe) with a fleet header, so there is ONE guidance format. PURE.
 */
export function formatFleetMistakes(records: readonly FleetMistakeRecord[], errorTexts: string[]): string {
  return formatKnownMistakes({ mistakes: [...records] }, errorTexts, FLEET_HEADER);
}

/** The unique signatures (in first-seen order) for a set of error texts, bounded. PURE. */
export function uniqueSignatures(errorTexts: readonly string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const text of errorTexts ?? []) {
    const sig = mistakeKey(typeof text === 'string' ? text : '');
    if (sig && !seen.has(sig)) { seen.add(sig); out.push(sig); }
    if (out.length >= limit) break;
  }
  return out;
}

/** Kill switch — `AGENTV3_FLEET_LEDGER=off` disables the fleet entirely (default ON). */
export function fleetLedgerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_FLEET_LEDGER || '').trim().toLowerCase() !== 'off';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Persistence. Doc-per-signature so different failures never contend on one hot document and a
// lookup is a direct key get. Mirrors the fail-open discipline of MistakeLedgerStore: any Firestore
// problem returns ''/null and the build proceeds untouched.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

class FleetMistakeLedgerStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    if (this.db) return this.db;
    try {
      this.db = getServerDb();
      return this.db;
    } catch {
      return null;
    }
  }

  /**
   * The fleet guard for the errors this project is hitting NOW — '' when the fleet knows nothing
   * about them (or the switch is off), so an unmatched build is byte-identical to today. Never throws.
   */
  async guardFor(errorTexts: string[]): Promise<string> {
    return (await this.guardDetailFor(errorTexts)).text;
  }

  /**
   * The fleet guard PLUS the guarded signatures, so the caller can record the guard in the admin
   * report and measure at build end whether a fleet-guarded failure recurred anyway. Never throws.
   */
  async guardDetailFor(errorTexts: string[]): Promise<{ text: string; signatures: string[] }> {
    const none = { text: '', signatures: [] as string[] };
    try {
      if (!fleetLedgerEnabled()) return none;
      const db = this.getDb();
      if (!db || !errorTexts?.length) return none;
      const sigs = uniqueSignatures(errorTexts, Math.max(MAX_FLEET_LOOKUPS, MAX_GUARDS));
      if (sigs.length === 0) return none;
      const snaps = await db.getAll(...sigs.map((s) => db.collection(FLEET_COLLECTION).doc(fleetDocId(s))));
      const records = snaps
        .map((s) => (s.exists ? (s.data() as FleetMistakeRecord) : null))
        .filter((r): r is FleetMistakeRecord => !!r && typeof r.signature === 'string');
      if (records.length === 0) return none;
      // The formatter selects (dedupes/caps/solved-only) — report exactly what it selected.
      const hits = matchedMistakes({ mistakes: [...records] }, errorTexts);
      if (hits.length === 0) return none;
      return { text: formatFleetMistakes(records, errorTexts), signatures: hits.map((h) => h.signature) };
    } catch {
      return none;
    }
  }

  /**
   * Fold one build's outcome into the fleet — anonymously (no user id is ever passed in, so none can
   * be stored). Same proven-fix rule as the per-user store: a fix is recorded only when the build
   * SUCCEEDED. Per-signature read-modify-write; a lost race only under-counts `seen`, never corrupts
   * a fix. Never throws.
   */
  async recordBuild(
    input: { ok: boolean; errors: string[]; fix?: string | null },
    ts = Date.now(),
  ): Promise<void> {
    try {
      if (!fleetLedgerEnabled()) return;
      const db = this.getDb();
      if (!db) return;
      const errors = (input.errors ?? []).filter((e) => typeof e === 'string' && e.trim());
      if (errors.length === 0) return;
      const bySig = new Map<string, string>(); // signature → first sample text
      for (const e of errors) {
        const sig = mistakeKey(e);
        if (sig && !bySig.has(sig)) bySig.set(sig, e);
        if (bySig.size >= MAX_FLEET_WRITES) break;
      }
      await Promise.all(
        [...bySig.values()].map(async (errorText) => {
          try {
            const ref = db.collection(FLEET_COLLECTION).doc(fleetDocId(mistakeKey(errorText)));
            const snap = await ref.get();
            let rec = snap.exists ? (snap.data() as FleetMistakeRecord) : null;
            rec = mergeFleetSighting(rec, errorText, ts);
            if (input.ok && input.fix && input.fix.trim()) {
              rec = mergeFleetProvenFix(rec, errorText, input.fix, ts);
            }
            if (rec) await ref.set(rec, { merge: false });
          } catch { /* one doc failing must not stop the others */ }
        }),
      );
    } catch (err) {
      console.error('[FLEET-LEDGER] recordBuild failed:', err);
    }
  }
}

export const fleetMistakeLedgerStore = new FleetMistakeLedgerStore();
