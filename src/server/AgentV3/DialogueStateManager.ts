// AgentV3 — P-AI.3 dialogue / multi-turn state manager.
//
// IntentClassifier answers "what KIND of turn is this?" (chat / new_build / edit_existing).
// This adds the orthogonal axis "where in the lifecycle are we?" — REQUIREMENTS → PLANNING →
// BUILDING → DEBUGGING → DEPLOYED — and turns that phase into a short posture instruction injected
// into the Architect prompt. So a "still broken, the button does nothing" follow-up makes the agent
// adopt a debugging posture (reproduce → locate → minimal fix) instead of treating it like a fresh
// feature request. Pure + deterministic → unit-testable; the route wires it additively (no phase ⇒
// no change), so it can never alter or break an existing turn.

export type DialoguePhase = 'requirements' | 'planning' | 'building' | 'debugging' | 'deployed';

/** Signals the route already computes, passed in so this module stays pure (no I/O). */
export interface DialogueSignals {
  /** Intent from IntentClassifier. */
  intent: 'chat' | 'new_build' | 'edit_existing';
  /** The user's current message. */
  prompt: string;
  /** Whether the workspace already has files (an established project). */
  hasExistingFiles: boolean;
  /** Whether plan-mode is active for this turn. */
  planning?: boolean;
}

// Words that mark a DEBUGGING turn — the user is reporting something broken, not asking for a feature.
const DEBUG_RE =
  /\b(error|errors|bug|bugs|broken|broke|crash(?:es|ing|ed)?|not\s+working|doesn'?t\s+work|isn'?t\s+working|won'?t\s+(?:work|load|run|build|start)|does\s+nothing|doing\s+nothing|no\s+response|nothing\s+happens?|fails?|failing|failed|exception|stack\s*trace|undefined|null|blank\s+(?:screen|page)|white\s+screen|console\s+error|throws?|stuck|hang(?:s|ing)?)\b/i;

// Words that mark a DEPLOYED/ship turn. NOTE the `production` guard: a build prompt routinely says
// "production-clean / production-ready / production-grade / production quality" as a QUALITY bar, NOT a
// deploy request — ShopSphere (App #12) ended with "Production-clean, mobile-responsive" and was
// misclassified as DEPLOY/SHIP, so the builder got a "the user wants to publish" posture on a fresh
// build. The negative lookahead keeps a real "deploy to production" signal while ignoring the quality
// compounds.
const DEPLOY_RE = /\b(deploy|deployed|publish|published|go\s+live|going\s+live|ship\s+it|host(?:ing|ed)?|production(?![-\s](?:clean|ready|grade|quality|level|worthy|ise|ize))|make\s+it\s+live)\b/i;

/**
 * Infer the conversation phase from the current signals. Deterministic. Order matters: an explicit
 * debug/deploy intent in the wording wins over the coarse new/edit distinction.
 */
export function inferPhase(signals: DialogueSignals): DialoguePhase {
  const prompt = String(signals.prompt || '');

  // A reported failure is DEBUGGING regardless of new/edit (only meaningful once a project exists).
  if (signals.hasExistingFiles && DEBUG_RE.test(prompt)) return 'debugging';

  // An explicit ship request is DEPLOYED.
  if (DEPLOY_RE.test(prompt)) return 'deployed';

  // Editing an established project = iterating on the BUILD.
  if (signals.intent === 'edit_existing' || (signals.intent === 'new_build' && signals.hasExistingFiles)) {
    return 'building';
  }

  // A fresh build: PLANNING when plan-mode is on, else straight to BUILDING. A very short/vague first
  // ask with no project yet is REQUIREMENTS (the agent should clarify/scope before diving in).
  if (signals.intent === 'new_build') {
    if (signals.planning) return 'planning';
    if (prompt.trim().split(/\s+/).filter(Boolean).length <= 4) return 'requirements';
    return 'building';
  }

  // Fallback (e.g. chat) — treat as requirements-gathering posture.
  return 'requirements';
}

const PHASE_GUIDANCE: Record<DialoguePhase, string> = {
  requirements:
    'CONVERSATION PHASE — REQUIREMENTS: the request is brief or open-ended and no project exists yet. ' +
    'Briefly confirm the core scope (what the app is, the 2-3 must-have features) and reasonable defaults ' +
    'before building — do not over-ask, just enough to build the right thing.',
  planning:
    'CONVERSATION PHASE — PLANNING: produce a lean, concrete plan first (the user is reviewing it before ' +
    'the build runs). Plan the real work (files/features), not meta-steps.',
  building:
    'CONVERSATION PHASE — BUILDING: this continues an existing project. Make targeted, additive changes; ' +
    'preserve working code and existing files; never rebuild from scratch for an incremental ask.',
  debugging:
    'CONVERSATION PHASE — DEBUGGING: the user is reporting something broken. First REPRODUCE/understand the ' +
    'reported failure, then LOCATE the exact cause (read the relevant files, check console/build errors), ' +
    'then make the MINIMUM fix and verify it actually resolves the issue. Do not add unrelated features.',
  deployed:
    'CONVERSATION PHASE — DEPLOY/SHIP: the user wants to publish. Ensure the app builds cleanly, then use the ' +
    'real deploy path; share the returned URL. Never claim it is live unless a deploy actually returned a URL.',
};

/**
 * The injectable posture instruction for a phase, or '' for the default fresh build (BUILDING with no
 * special posture is already the prompt's baseline, so we skip it to avoid redundant tokens).
 */
export function phaseGuidance(phase: DialoguePhase): string {
  if (phase === 'building') return ''; // baseline behaviour — no extra instruction needed
  return PHASE_GUIDANCE[phase];
}

/** Convenience: infer the phase and return its guidance in one call. Pure. */
export function dialoguePhaseContext(signals: DialogueSignals): { phase: DialoguePhase; guidance: string } {
  const phase = inferPhase(signals);
  return { phase, guidance: phaseGuidance(phase) };
}
