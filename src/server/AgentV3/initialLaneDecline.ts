/**
 * An initial text-only lane can answer instead of producing an app. Keep that answer separate from
 * a parser failure so the caller does not buy another attempt. This is deliberately narrower than
 * the existing final-answer heuristic: uncertain prose and attempted artifacts retain recovery.
 * Only initial planning/one-shot responses use it, never concurrent per-file or repair work.
 */
import { looksLikeRefusal, looksLikeHindiRefusal } from '../lib/promptSafety';

export interface InitialLaneDecline {
  readonly kind: 'initial-lane-decline';
  /** Exact original answer, not the statement trimmed/extracted for classification. */
  readonly modelAnswer: string;
}

/** Read raw parser acceptance BEFORE filtering provided files, injecting an entry or applying minimums. */
export function readInitialLaneDecline(text: string, acceptedArtifacts: number): InitialLaneDecline | undefined {
  const body = text.trim();
  if (acceptedArtifacts > 0 || /```|~~~|<+\s*(?:FILE|ENDFILE)\b/i.test(body)) return;
  // Structured/partially formatted output is an attempt the existing fallback can recover.
  if (/[{}\[\]]/.test(body) || /(?:^|\n)[^\n]*\.[a-z0-9]{1,8}\s*(?:::?|->|=>)/i.test(body)) return;
  const initial = body.split(/[.!?।;\n]/u, 1)[0].trim().toLowerCase();
  if (!initial) return;
  if (/["`“”‘’]/u.test(initial) || /(?:^|[^a-z])'|'(?:$|[^a-z])/i.test(initial)) return;
  if (/\b(?:if|unless|until|without|when|whenever|provided|assuming|suppose|could|might|agar|yadi|jab)\b|(?:अगर|यदि|जब|बिना)/u.test(initial)) return;

  // The existing English heuristic permits a gap after the modal. Require a direct action here:
  // "cannot wait to build" and "cannot help but build" are affirmative, not terminal answers.
  const directEnglish = /^(?:i (?:cannot|can't|can not|won't|will not)|i'm not able to|i am not able to)\s+(?:create|build|make|generate|assist|produce|write|provide|help(?:\s+(?:with|you|on|in)\b|$))\b/.test(initial)
    || /^my refusal stands\b/.test(initial);
  // Do not read quoted/reported inability as the speaker declining. Unknown forms keep fallback.
  const reportedHindi = /\b(?:keh|kehna|kehta|kehti|kehte|kah|kaha|bol|bolna|bolta|bolti|soch|matlab|quote)\b|(?:कह|बोल|मतलब)/u.test(initial);
  const directHindi = !reportedHindi && looksLikeHindiRefusal(initial);
  if ((!directEnglish && !directHindi) || !looksLikeRefusal(initial)) return;
  return { kind: 'initial-lane-decline', modelAnswer: text };
}

/** Internal control flow, never inferred from a provider error's message. */
export class InitialLaneDeclinedError extends Error {
  constructor(readonly decline: InitialLaneDecline) {
    super('initial_lane_declined');
    this.name = 'InitialLaneDeclinedError';
  }
}

export function initialLaneDeclineResult(initialDecline: InitialLaneDecline): {
  ok: false; filesWritten: 0; summary: string; reason: string; initialDecline: InitialLaneDecline;
} {
  return { ok: false, filesWritten: 0, summary: initialDecline.modelAnswer, reason: 'initial_lane_declined', initialDecline };
}
