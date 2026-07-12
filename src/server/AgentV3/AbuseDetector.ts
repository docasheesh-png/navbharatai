/**
 * P-AI.10 — Adversarial input / abuse detection.
 *
 * Complements the existing defenses (CommandGovernance blocks shell, UntrustedContent fences
 * injection, the rate limiter throttles volume) with a dedicated PROMPT-pattern classifier:
 * jailbreak/override phrasing ("ignore previous instructions", "developer mode", system-prompt
 * extraction), prompt-stuffing (massive repetition), and abnormally long prompts.
 *
 * DESIGN — detect + record, don't hard-block. A long or repetitive prompt can be legitimate, so
 * this never blocks a build by itself (that would break real users); it emits a signal + telemetry
 * the caller can act on (audit, ledger, rate-tier drop). Pure `assessPrompt` is unit-tested.
 */

import { loadFirebaseAdmin } from '../lib/firebaseAdminModule';
import { getServerDb } from '../lib/serverDb';

export type AbuseKind = 'jailbreak' | 'prompt-extraction' | 'repetition-stuffing' | 'excessive-length';

export interface AbuseSignal { kind: AbuseKind; detail: string }

export interface AbuseAssessment {
  signals: AbuseSignal[];
  /** 0 (clean) .. 100 (clearly abusive). */
  score: number;
  isAbusive: boolean;
}

const JAILBREAK_RES: Array<{ detail: string; re: RegExp }> = [
  { detail: 'ignore-previous-instructions', re: /\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior|earlier)\s+(?:instructions|prompts?|messages?|rules?)/i },
  { detail: 'disregard-instructions', re: /\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior|your)\b/i },
  { detail: 'override-role', re: /\byou\s+are\s+now\s+(?:a\s+|an\s+|in\s+)?/i },
  { detail: 'developer-mode', re: /\bdeveloper\s+mode\b/i },
  { detail: 'dan-jailbreak', re: /\b(?:DAN|do\s+anything\s+now)\b/i },
  { detail: 'no-restrictions', re: /\b(?:without|no)\s+(?:any\s+)?(?:restrictions|rules|filters|guidelines|limitations)\b/i },
];

const EXTRACTION_RES: Array<{ detail: string; re: RegExp }> = [
  { detail: 'reveal-system-prompt', re: /\b(?:print|reveal|repeat|show|output|display|tell\s+me)\b[^.\n]{0,40}\b(?:your\s+)?(?:system\s+)?(?:prompt|instructions|rules|guidelines)\b/i },
  { detail: 'repeat-words-above', re: /\brepeat\s+the\s+words?\s+above\b/i },
];

const WEIGHTS: Record<AbuseKind, number> = {
  jailbreak: 50,
  'prompt-extraction': 50,
  'repetition-stuffing': 40,
  'excessive-length': 25,
};

export interface AbuseOptions {
  /** Prompt length (chars) above which it's flagged as excessive. Default 20000. */
  maxLength?: number;
  /** Score at/above which the prompt is considered abusive. Default 50. */
  threshold?: number;
}

/** Detect prompt-stuffing: a single line repeated many times, or one line dominating the prompt. */
function repetitionSignal(prompt: string): AbuseSignal | null {
  const lines = prompt.split('\n').map((l) => l.trim()).filter((l) => l.length >= 8);
  if (lines.length < 10) return null;
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l, (counts.get(l) || 0) + 1);
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  if (max >= 10 && max / lines.length >= 0.5) {
    return { kind: 'repetition-stuffing', detail: `one line repeated ${max}×` };
  }
  return null;
}

/** Assess a user prompt for abuse signals. Pure. */
export function assessPrompt(prompt: string | null | undefined, opts: AbuseOptions = {}): AbuseAssessment {
  const maxLength = opts.maxLength ?? 20_000;
  const threshold = opts.threshold ?? 50;
  const text = String(prompt || '');
  const signals: AbuseSignal[] = [];

  for (const { detail, re } of JAILBREAK_RES) if (re.test(text)) signals.push({ kind: 'jailbreak', detail });
  for (const { detail, re } of EXTRACTION_RES) if (re.test(text)) signals.push({ kind: 'prompt-extraction', detail });
  const rep = repetitionSignal(text);
  if (rep) signals.push(rep);
  if (text.length > maxLength) signals.push({ kind: 'excessive-length', detail: `${text.length} chars` });

  // Score = capped sum of distinct-kind weights (don't double-count the same kind).
  const kinds = new Set(signals.map((s) => s.kind));
  let score = 0;
  for (const k of kinds) score += WEIGHTS[k];
  score = Math.min(100, score);

  return { signals, score, isAbusive: score >= threshold };
}

/**
 * P-PE.3 — Jailbreak hard-block. The UNAMBIGUOUS abuse kinds: a deliberate attempt to override the
 * agent or extract its system prompt. (Length/repetition are excluded — they can be legitimate, so
 * they never contribute to a hard block, only to the advisory score.)
 */
export const JAILBREAK_KINDS: ReadonlySet<AbuseKind> = new Set<AbuseKind>(['jailbreak', 'prompt-extraction']);

/** A persisted ledger event. `signals` holds the abuse-kind strings recorded for that attempt. */
export interface AbuseLedgerEvent { at: string; score: number; signals: string[] }

/** True if this ledger event records an unambiguous jailbreak/extraction attempt. Pure. */
export function isJailbreakEvent(event: { signals?: string[] } | null | undefined): boolean {
  const signals = event?.signals;
  if (!Array.isArray(signals)) return false;
  return signals.some((s) => JAILBREAK_KINDS.has(s as AbuseKind));
}

/** Count jailbreak/extraction events within `windowMs` of `nowMs`. Pure; tolerates bad timestamps. */
export function countJailbreakViolations(
  events: ReadonlyArray<{ at?: string; signals?: string[] }> | null | undefined,
  nowMs: number,
  windowMs: number,
): number {
  if (!Array.isArray(events)) return 0;
  const cutoff = nowMs - windowMs;
  let n = 0;
  for (const e of events) {
    if (!isJailbreakEvent(e)) continue;
    const t = e?.at ? Date.parse(e.at) : NaN;
    // A missing/unparseable timestamp is counted as in-window (conservative — never under-counts abuse).
    if (Number.isNaN(t) || t >= cutoff) n += 1;
  }
  return n;
}

/** Number of jailbreak attempts (within the window) that triggers a hard block. */
export const HARD_BLOCK_THRESHOLD = 3;
/** Rolling window for the hard-block count. */
export const HARD_BLOCK_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface AbuseEvaluation {
  /** Whether the event was written to the ledger. */
  recorded: boolean;
  /** Whether THIS request should be hard-blocked (≥ threshold jailbreak attempts in the window). */
  blocked: boolean;
  /** Total jailbreak/extraction attempts in the window, including this one. */
  violations: number;
}

const FAIL_OPEN: AbuseEvaluation = { recorded: false, blocked: false, violations: 0 };

/**
 * Record an abuse event to `abuseLedger/{userId}` AND decide whether the user has crossed the
 * jailbreak hard-block threshold (P-PE.3). Reuses the same ledger as P-AI.10 — no parallel store.
 *
 * FAIL-OPEN by design: a degraded Firestore (or VITEST) returns {blocked:false}, so the safety
 * gate can NEVER lock out a legitimate user because of an infra hiccup. Hard-block counts ONLY the
 * unambiguous jailbreak/extraction kinds — never length/repetition. Never throws.
 */
export async function evaluateAbuse(
  userId: string,
  assessment: AbuseAssessment,
  nowIso: string,
): Promise<AbuseEvaluation> {
  if (process.env.VITEST) return FAIL_OPEN;
  try {
    const admin = await loadFirebaseAdmin();
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    const db = getServerDb(); // shared collision-free handle → navbharat-prod
    if (!db) return FAIL_OPEN; // no DB → fail open (never block a build on infra)
    const ref = db.collection('abuseLedger').doc(userId);
    const snap = await ref.get();
    const events: AbuseLedgerEvent[] = (snap.exists ? snap.data()?.events : null) || [];

    const currentKinds = assessment.signals.map((s) => s.kind);
    const currentIsJailbreak = currentKinds.some((k) => JAILBREAK_KINDS.has(k));
    const nowMs = Date.parse(nowIso);
    const priorViolations = countJailbreakViolations(events, Number.isNaN(nowMs) ? Date.now() : nowMs, HARD_BLOCK_WINDOW_MS);
    const violations = priorViolations + (currentIsJailbreak ? 1 : 0);
    const blocked = currentIsJailbreak && violations >= HARD_BLOCK_THRESHOLD;

    const next = [...events, { at: nowIso, score: assessment.score, signals: currentKinds }].slice(-50);
    await ref.set({ events: next, lastScore: assessment.score, updatedAt: nowIso }, { merge: true });
    return { recorded: true, blocked, violations };
  } catch (err) {
    console.error('[ABUSE] ledger evaluate failed:', err);
    return FAIL_OPEN;
  }
}

/**
 * Record an abuse event to Firestore `abuseLedger/{userId}` (best-effort, append-capped) + return
 * whether it was written. Never throws. (Kept for callers that only need to record, not block.)
 */
export async function recordAbuse(userId: string, assessment: AbuseAssessment, nowIso: string): Promise<boolean> {
  return (await evaluateAbuse(userId, assessment, nowIso)).recorded;
}
