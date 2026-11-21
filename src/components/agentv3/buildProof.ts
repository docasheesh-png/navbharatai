// AgentV3 — each build's PROOF, kept per turn (pure, unit-tested).
//
// THE BUG (admin, phone screenshot 2026-11-21): after a build, the Pro chat showed the "NavBharatAI
// checked your app" card, the "Build health: READY · 100/100" row and "Was this build helpful?" —
// all three rendered AFTER the whole timeline, from single state slots. So:
//   • they were PINNED to the bottom: a newer reply appeared ABOVE an older build's proof, and the
//     latest response was no longer the last thing in the chat;
//   • the next send reset those slots, so the previous build's proof vanished, and the new build's
//     proof reappeared pinned at the bottom again.
//
// THE CLASS: a per-turn fact stored in a single per-session slot and rendered outside the timeline.
// The fix gives a proof the same shape the timeline already gives a build's activity (`activityLog`):
// the live proof is derived from the state here, archived into `proofLog` when the next build starts,
// and every proof becomes a block in `buildChatBlocks`, anchored at the last moment of its own turn.

import type { AgentV3ClientState, BuildProof } from './agentV3Types';

/** Memory bound on archived proofs in one session. */
export const PROOF_LOG_CAP = 50;

const latestTs = (rows: ReadonlyArray<{ ts?: number }>): number => {
  let max = 0;
  for (const r of rows) if (typeof r.ts === 'number' && Number.isFinite(r.ts) && r.ts > max) max = r.ts;
  return max;
};

/**
 * The proof of the build currently held in `state`, or null when there is nothing to show yet.
 * The gates are the ones the panel used before (a check card needs at least one step; the health
 * row and the feedback prompt need a finished build), so no proof is shown earlier or later than it
 * was — only in a different place.
 */
export function currentBuildProof(state: Pick<AgentV3ClientState, 'verification' | 'buildHealth' | 'done' | 'ok' | 'workspaceId' | 'buildId' | 'narration' | 'activity'>): BuildProof | null {
  const v = state.verification && state.verification.steps.length > 0 ? state.verification : undefined;
  const buildHealth = state.done ? state.buildHealth : undefined;
  const feedback = state.done && state.ok === true && !!state.workspaceId;
  if (!v && !buildHealth && !feedback) return null;
  const turnEnd = Math.max(latestTs(state.narration), latestTs(state.activity), v?.ts ?? 0);
  // No timestamp at all (a replayed transcript with ts 0): the live build is the newest turn, so it
  // sits last rather than first.
  const anchorTs = turnEnd > 0 ? turnEnd : Number.MAX_SAFE_INTEGER;
  return {
    key: state.buildId ? `build-${state.buildId}` : `ts-${v?.ts ?? anchorTs}`,
    ...(state.buildId ? { buildId: state.buildId } : {}),
    anchorTs,
    ...(v ? { verification: { ok: v.ok, headline: v.headline, steps: v.steps } } : {}),
    ...(buildHealth ? { buildHealth } : {}),
    feedback,
    ...(state.workspaceId ? { workspaceId: state.workspaceId } : {}),
  };
}

/**
 * Archive a settled build's proof into the session log (called by the hook when a new build starts
 * or a live build is re-attached). The same build archived twice (a re-attach replays its own
 * events) replaces its earlier row instead of appearing twice.
 */
export function archiveBuildProof(log: BuildProof[], proof: BuildProof | null): BuildProof[] {
  if (!proof) return log;
  return [...log.filter((p) => p.key !== proof.key), proof].slice(-PROOF_LOG_CAP);
}

/** Every proof the timeline should render, oldest first: the archive plus the live one (which wins). */
export function proofsForTimeline(log: BuildProof[], current: BuildProof | null): BuildProof[] {
  const all = current ? [...log.filter((p) => p.key !== current.key), current] : [...log];
  return all.sort((a, b) => a.anchorTs - b.anchorTs);
}

/** localStorage key that remembers the user dismissed THIS build's check card. */
export const proofDismissedKey = (proofKey: string): string => `nbai:proof-dismissed:${proofKey}`;

export function isProofDismissed(proofKey: string): boolean {
  try { return localStorage.getItem(proofDismissedKey(proofKey)) === '1'; } catch { return false; }
}

export function rememberProofDismissed(proofKey: string): void {
  try { localStorage.setItem(proofDismissedKey(proofKey), '1'); } catch { /* private mode — dismissed for this view only */ }
}

/**
 * localStorage key for the "Was this build helpful?" answer. Per BUILD when the build id is known —
 * the old per-workspace key meant one answer silenced the question for every later build of the
 * same app. Older servers without a build id keep the workspace key they always used.
 */
export function feedbackKey(proof: Pick<BuildProof, 'buildId' | 'workspaceId'>): string | null {
  if (proof.buildId) return `nbai:feedback:build:${proof.buildId}`;
  return proof.workspaceId ? `nbai:feedback:${proof.workspaceId}` : null;
}
