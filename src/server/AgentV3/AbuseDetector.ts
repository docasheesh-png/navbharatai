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
 * Record an abuse event to Firestore `abuseLedger/{userId}` (best-effort, append-capped) + return
 * whether it was written. Never throws.
 */
export async function recordAbuse(userId: string, assessment: AbuseAssessment, nowIso: string): Promise<boolean> {
  if (process.env.VITEST) return false;
  try {
    const admin = await import('firebase-admin');
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    const db = admin.firestore();
    const ref = db.collection('abuseLedger').doc(userId);
    const snap = await ref.get();
    const events = (snap.exists ? snap.data()?.events : null) || [];
    const next = [...events, { at: nowIso, score: assessment.score, signals: assessment.signals.map((s) => s.kind) }].slice(-50);
    await ref.set({ events: next, lastScore: assessment.score, updatedAt: nowIso }, { merge: true });
    return true;
  } catch (err) {
    console.error('[ABUSE] ledger write failed:', err);
    return false;
  }
}
