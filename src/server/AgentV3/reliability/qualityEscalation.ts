/**
 * P4b — QUALITY SIGNALS THAT MOVE A BUILD UP THE LADDER (fix/build-reliability, AGENTV3_QUALITY_ESCALATE).
 *
 * The provider chain only ever fell back on an ERROR. The failures that actually sink a weak-tier
 * build are not errors: a model that truncates its writes, an edit_file whose `old_string` is never
 * found, a compile whose error count never goes down. Each of those turns "succeeds", so the same
 * model keeps getting the next turn. This monitor watches those three signals and says when to
 * escalate; the route turns that into `escalateSticky` (upward only, never onto Claude on weak).
 *
 * Thresholds (env-tunable, defaults from the solutions doc):
 *   • truncation ×2   — AGENTV3_ESCALATE_TRUNCATIONS   (turns that hit the output ceiling)
 *   • edit fail ×3    — AGENTV3_ESCALATE_EDIT_FAILS    (consecutive failed edit_file calls)
 *   • tsc not dropping — AGENTV3_ESCALATE_TSC_STALLS   (consecutive tsc readings > 0 that are not lower than the best so far)
 *   • at most AGENTV3_ESCALATE_MAX escalations per build (default 2).
 * PURE: state in, decision out.
 */
import { reliabilityInt } from './flags';

export interface QualityThresholds {
  truncations: number;
  editFails: number;
  tscStalls: number;
  maxEscalations: number;
}

export function qualityThresholds(env: NodeJS.ProcessEnv = process.env): QualityThresholds {
  return {
    truncations: reliabilityInt('AGENTV3_ESCALATE_TRUNCATIONS', 2, 1, env),
    editFails: reliabilityInt('AGENTV3_ESCALATE_EDIT_FAILS', 3, 1, env),
    tscStalls: reliabilityInt('AGENTV3_ESCALATE_TSC_STALLS', 3, 2, env),
    maxEscalations: reliabilityInt('AGENTV3_ESCALATE_MAX', 2, 0, env),
  };
}

export interface TurnQualityObservation {
  /** The turn hit the output-token ceiling. */
  truncated: boolean;
  /** edit_file calls this turn that returned an error. */
  editFailures: number;
  /** edit_file calls this turn that succeeded. */
  editSuccesses: number;
  /** Latest known tsc error count (null = not measured this turn). */
  tscErrors: number | null;
}

export interface QualityDecision {
  escalate: boolean;
  reason?: string;
}

export class QualityMonitor {
  private truncations = 0;
  private editFailStreak = 0;
  private tscBest: number | null = null;
  private tscStalls = 0;
  private lastTsc: number | null = null;
  private escalations = 0;

  constructor(private readonly t: QualityThresholds = qualityThresholds()) {}

  /** Feed one turn; returns whether the build should move up one model now. */
  observe(o: TurnQualityObservation): QualityDecision {
    if (o.truncated) this.truncations += 1;
    if (o.editSuccesses > 0 && o.editFailures === 0) this.editFailStreak = 0;
    this.editFailStreak += Math.max(0, o.editFailures);
    if (o.tscErrors !== null && Number.isFinite(o.tscErrors) && o.tscErrors !== this.lastTsc) {
      // A NEW reading (the same number re-read every turn is not new evidence).
      this.lastTsc = o.tscErrors;
      if (o.tscErrors <= 0) { this.tscBest = 0; this.tscStalls = 0; }
      else if (this.tscBest === null || o.tscErrors < this.tscBest) { this.tscBest = o.tscErrors; this.tscStalls = 1; }
      else this.tscStalls += 1;
    } else if (o.tscErrors !== null && o.tscErrors > 0 && o.tscErrors === this.lastTsc && o.editSuccesses + o.editFailures > 0) {
      // Same count after another round of edits — the fixes are not landing.
      this.tscStalls += 1;
    }
    if (this.escalations >= this.t.maxEscalations) return { escalate: false };
    let reason: string | undefined;
    if (this.truncations >= this.t.truncations) reason = `output was cut off at the token limit ${this.truncations}×`;
    else if (this.editFailStreak >= this.t.editFails) reason = `${this.editFailStreak} edit_file calls in a row could not apply`;
    else if (this.tscStalls >= this.t.tscStalls) reason = `TypeScript errors are not going down (stuck at ${this.lastTsc ?? '?'} for ${this.tscStalls} checks)`;
    return reason ? { escalate: true, reason } : { escalate: false };
  }

  /** The escalation happened (or was refused) — start counting afresh either way, so we never spam. */
  acknowledge(escalated: boolean): void {
    if (escalated) this.escalations += 1;
    this.truncations = 0;
    this.editFailStreak = 0;
    this.tscStalls = 0;
  }

  get escalationCount(): number { return this.escalations; }
}

/**
 * The note the NEXT model reads when it takes over. A model handed a transcript it did not write
 * re-derives (or contradicts) the plan; this tells it what happened, what is on disk, and to read
 * before it edits.
 */
export function handoffNote(input: { fromModel?: string; toModel?: string; reason: string; touchedFiles: readonly string[]; tscErrors?: number | null }): string {
  const files = input.touchedFiles.slice(-15);
  const lines = [
    '🔁 ENGINE HANDOFF (platform note).',
    `The previous engine${input.fromModel ? ` (${input.fromModel})` : ''} was struggling: ${input.reason}.`,
    `You${input.toModel ? ` (${input.toModel})` : ''} are taking over this SAME build — do not restart it.`,
    files.length ? `Files written/edited so far (most recent last): ${files.join(', ')}.` : 'No files have been written yet.',
    typeof input.tscErrors === 'number' && input.tscErrors > 0 ? `TypeScript currently reports ${input.tscErrors} error(s) — run typecheck and fix them first.` : '',
    'Before editing any file above, read_file it — its content on disk is the truth, not the transcript.',
    'Prefer write_file for a file you need to change substantially; keep every file under ~200 lines.',
  ];
  return lines.filter(Boolean).join('\n');
}
