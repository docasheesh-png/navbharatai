// B8 — "how full is the conversation?" (ROADMAP §8B).
//
// Compaction already runs (SessionTimeline.compactTranscriptForModel): as a session grows, old tool
// results are trimmed and old screenshots dropped so the prompt still fits. That is the right
// behaviour — but it is INVISIBLE. From the user's side, a long session just starts producing worse
// answers, the model starts "forgetting" things they said an hour ago, and there is nothing on screen
// to explain why. They conclude the product got worse.
//
// Surfacing the number gives that drop a visible cause and an obvious action ("start a fresh chat for
// the next feature"). It is honest about a real limit rather than hiding it.
//
// 🔒 WHITE-LABEL LAW: the user sees a PERCENTAGE and plain words — never the model, never the vendor,
// never a window size that would identify which engine ran. The window differs per engine, so even
// "200,000 tokens" would leak routing. `describeContextUsage` returns nothing a user could trace back.
//
// Pure — the window lookup is TokenEstimator's existing `modelContextLimit`, not a second map.

import { modelContextLimit } from './TokenEstimator';

export type ContextLevel = 'ok' | 'high' | 'critical';

export interface ContextUsage {
  /** Real input tokens the last model call actually consumed (provider-reported, never estimated). */
  usedTokens: number;
  /** 0–100, clamped. The ONLY number safe to show a user — a raw window size would leak the engine. */
  pct: number;
  level: ContextLevel;
  /** A plain sentence, or '' while there is nothing worth saying. Never names an engine. */
  note: string;
}

/** Past this, quality genuinely starts to suffer as compaction bites harder. */
const HIGH_PCT = 70;
/** Past this, the session is close to the wall and a fresh chat is the real fix. */
const CRITICAL_PCT = 88;

/**
 * Turn one turn's real input-token count into something a user can act on.
 *
 * `usedTokens` must be the PROVIDER-REPORTED count for the call (AgentRunner already has it as
 * `turn.usage.inputTokens`). An estimate would be a number that LOOKS measured on a user-facing meter,
 * which is the same dishonesty the billing law forbids — so a missing/zero count yields level 'ok' and
 * an EMPTY note rather than a guess. Pure.
 */
export function describeContextUsage(usedTokens: number | null | undefined, model: string | null | undefined): ContextUsage {
  const used = typeof usedTokens === 'number' && Number.isFinite(usedTokens) && usedTokens > 0 ? Math.floor(usedTokens) : 0;
  const window = modelContextLimit(model);
  if (used <= 0 || window <= 0) return { usedTokens: 0, pct: 0, level: 'ok', note: '' };

  const pct = Math.max(0, Math.min(100, Math.round((used / window) * 100)));
  if (pct >= CRITICAL_PCT) {
    return {
      usedTokens: used,
      pct,
      level: 'critical',
      note: 'This chat is nearly full. NavBharatAI is having to leave out older parts of the conversation, so it may forget earlier details — start a new chat for your next change, and your app is safe either way.',
    };
  }
  if (pct >= HIGH_PCT) {
    return {
      usedTokens: used,
      pct,
      level: 'high',
      note: 'This chat is getting long. Older messages are being summarised to make room, so very early details may be less exact.',
    };
  }
  // Deliberately silent below the threshold: a meter that always talks becomes wallpaper, and by the
  // time it has something real to say nobody is reading it.
  return { usedTokens: used, pct, level: 'ok', note: '' };
}

/**
 * Should this usage be sent to the client at all?
 *
 * Only when the bucket CHANGED. A per-turn event on every call would be dozens of identical updates in
 * one build for a number that moves slowly — noise on the wire and a re-render for nothing. `null`
 * previous means "nothing sent yet", so the first meaningful reading always goes. Pure.
 */
export function shouldEmitContextUsage(prev: ContextUsage | null, next: ContextUsage): boolean {
  if (next.usedTokens <= 0) return false;
  if (!prev) return next.pct > 0;
  if (prev.level !== next.level) return true;
  // Within a level, only a visible move is worth an update.
  return Math.abs(next.pct - prev.pct) >= 5;
}
