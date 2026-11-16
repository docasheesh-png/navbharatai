// Recording a turn's outcome as a revision — the part of "promote" that is not the files themselves.
//
// The files are saved by the existing durable workspace save (the editable head); this records which revision
// they are, and moves the VERIFIED head only when the release rule said `promote`. Nothing here ever throws into
// the build: a store failure is reported as `error` and the user's files are exactly as saved.

import type { EditGateVerdict } from './editRelease';
import type { ReleaseDecision } from './editRelease';
import {
  buildRevision, promoteWithRebase, manifestOf, sourceHashOf, type RevisionRecord, type RevisionStore,
} from './projectRevisions';

export type PromotionOutcome =
  | { outcome: 'promoted'; revisionId: string; baselineId?: string }
  | { outcome: 'duplicate'; revisionId: string }
  | { outcome: 'conflict'; headId: string | null }
  | { outcome: 'skipped'; why: string }
  | { outcome: 'error'; why: string };

export interface PromotionInput {
  store: RevisionStore;
  projectId: string;
  editId: string;
  /** The head when the turn started (null for a legacy or brand-new project). */
  headAtStart: RevisionRecord | null;
  /** The saved source the turn started from — the legacy baseline when there is no head. */
  startFiles: Readonly<Record<string, string>> | null;
  /** What was persisted: the candidate. */
  persisted: Readonly<Record<string, string>>;
  release: ReleaseDecision;
  gate: EditGateVerdict;
  messageId: string;
  messageText: string;
  /** Digest of the exact artifact that was validated, when one exists (never invented). */
  artifactDigest?: string;
  now: number;
}

export async function recordTurnRevision(i: PromotionInput): Promise<PromotionOutcome> {
  if (i.release.action !== 'promote') return { outcome: 'skipped', why: i.release.reasons.join('; ') || i.release.action };
  try {
    let parentId = i.headAtStart?.id ?? null;
    let baselineId: string | undefined;
    // A legacy project: establish its first baseline from the saved source the edit started from, labelled for
    // what it is (saved source identity — no browser proof of that earlier state).
    if (!i.headAtStart && i.startFiles && Object.keys(i.startFiles).length > 0) {
      const baseline = buildRevision({
        projectId: i.projectId, parentId: null, editId: `${i.editId}:baseline`, kind: 'baseline', files: i.startFiles,
        validation: { previewGreen: false, checks: ['legacy-saved-source'] }, now: i.now - 1,
      });
      const b = await i.store.promote(i.projectId, null, baseline);
      if (b.ok) { parentId = b.rev.id; baselineId = b.rev.id; } else parentId = b.head?.id ?? null;
    }
    const rev = buildRevision({
      projectId: i.projectId, parentId, editId: i.editId,
      kind: parentId === null ? 'baseline' : 'edit',
      files: i.persisted, messageId: i.messageId, messageText: i.messageText,
      gate: { verdict: i.gate.verdict, stats: { ...i.gate.stats }, reasons: i.gate.reasons.map((r) => r.rule) },
      validation: { previewGreen: true, checks: ['edit-gate', 'preview-render'], ...(i.artifactDigest ? { artifactDigest: i.artifactDigest } : {}) },
      now: i.now,
    });
    // On a conflict another edit advanced the head. The files this turn saved are already the editable head;
    // the verified head is NOT moved over the other edit's work, and the caller says so.
    const r = await promoteWithRebase(i.store, i.projectId, { expectedParentId: parentId, rev }, async () => null);
    if (r.ok) return r.duplicate ? { outcome: 'duplicate', revisionId: r.rev.id } : { outcome: 'promoted', revisionId: r.rev.id, ...(baselineId ? { baselineId } : {}) };
    return { outcome: 'conflict', headId: r.head?.id ?? null };
  } catch (e) {
    return { outcome: 'error', why: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

import { assessEditCandidate, rejectionMessage } from './editPromotionGate';
import { decideRelease } from './editRelease';
import type { BaseVerification } from './projectRevisions';

export interface HeldEditReport {
  /** Replaces the build's summary: the user asked for a change and did not get it, so that is the news. */
  summary: string;
  narration: string;
  finding: { phase: 'build'; severity: 'warning'; code: 'EDIT_PROMOTION_HELD'; message: string; detail: string; autoResolved: boolean };
}

/** What to tell the user, and the report, when the gate held an edit and the base was put back. PURE. */
export function heldEditReport(gate: EditGateVerdict, restoreComplete: boolean): HeldEditReport {
  const why = gate.reasons.map((r) => r.detail).join(' ');
  const summary = restoreComplete
    ? rejectionMessage(gate)
    : `I did not apply this change, because it would have replaced your existing app instead of editing it. ${why} I could not fully confirm that your earlier version was put back, so please open your version history and check it before your next change — the earlier version is saved there.`;
  return {
    summary,
    narration: `🛡️ ${summary}`,
    finding: {
      phase: 'build', severity: 'warning', code: 'EDIT_PROMOTION_HELD',
      message: 'The edit produced a candidate that replaces the project instead of editing it, so it was not promoted: the project keeps its verified version and the candidate is kept under the attempt key.',
      detail: `${why} · stats=${JSON.stringify(gate.stats)} · restore-complete=${restoreComplete}`.slice(0, 600),
      autoResolved: restoreComplete,
    },
  };
}

export interface SettleEditInput extends Omit<PromotionInput, 'release' | 'gate'> {
  base: Readonly<Record<string, string>> | null;
  previewGreen: boolean;
  provenBroken: boolean;
  baseCheck: BaseVerification;
  requirementsOk: boolean;
  buildOk: boolean;
  userMessage: string;
}

/** The turn-end record: compare, decide the release, record the revision. Never throws. */
export async function settleEditRevision(i: SettleEditInput): Promise<{ outcome: PromotionOutcome; finding: { phase: 'build'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean } }> {
  const gate = assessEditCandidate({ base: i.base ?? {}, candidate: i.persisted, userMessage: i.userMessage });
  const release = decideRelease({ gate, previewGreen: i.previewGreen, provenBroken: i.provenBroken, base: i.baseCheck, requirementsOk: i.requirementsOk, buildOk: i.buildOk });
  const outcome = await recordTurnRevision({ ...i, gate, release });
  switch (outcome.outcome) {
    case 'promoted': return { outcome, finding: { phase: 'build', severity: 'info', code: 'EDIT_PROMOTED', message: `This turn is now the project's verified version (revision ${outcome.revisionId.slice(0, 8)}${outcome.baselineId ? `, on a baseline recorded from the saved source` : ''}).`, autoResolved: true } };
    case 'duplicate': return { outcome, finding: { phase: 'build', severity: 'info', code: 'EDIT_PROMOTED', message: `This edit was already promoted (revision ${outcome.revisionId.slice(0, 8)}); the repeat changed nothing.`, autoResolved: true } };
    case 'conflict': return { outcome, finding: { phase: 'build', severity: 'warning', code: 'EDIT_PROMOTION_NOT_RECORDED', message: 'Another edit advanced the project\'s verified version while this one ran, so this turn was NOT promoted over it. Its files are saved as the editable project.', autoResolved: false } };
    case 'error': return { outcome, finding: { phase: 'build', severity: 'warning', code: 'EDIT_PROMOTION_NOT_RECORDED', message: `The verified-version record could not be written (${outcome.why}). The user's files are saved as before; the verified version did not move.`, autoResolved: false } };
    default: return { outcome, finding: { phase: 'build', severity: 'info', code: 'EDIT_NOT_PROMOTED', message: `This turn was not promoted to the verified version: ${outcome.why}.`, autoResolved: true } };
  }
}

import { candidateReplacesBase } from './editRelease';
import { restorePlan } from './GreenGuard';

export interface HoldResult {
  held: boolean;
  /** What is durable after the hold (the restored tree), or null when nothing was held. */
  persisted: Record<string, string> | null;
  removed: string[];
  summary: string | null;
  narration: string | null;
  finding: HeldEditReport['finding'] | null;
}

const NOT_HELD: HoldResult = { held: false, persisted: null, removed: [], summary: null, narration: null, finding: null };

/**
 * The turn-end hold, in one call: if the candidate replaces its base, keep the candidate under its own key and put
 * the base back. The route supplies the three effects it owns (they touch the sandbox and the store); everything
 * else — the decision, the plan, the words — is here. Never throws: a failed restore is reported, and the
 * candidate is still not promoted.
 */
export async function holdReplacementIfAny<O extends { removed: string[] }>(i: {
  base: Readonly<Record<string, string>> | null;
  candidate: Readonly<Record<string, string>>;
  userMessage: string;
  protectPaths: Iterable<string>;
  keepCandidate: () => Promise<unknown>;
  putBaseBack: (plan: ReturnType<typeof restorePlan>) => Promise<O>;
  treeAfter: (plan: ReturnType<typeof restorePlan>, outcome: O) => Record<string, string>;
  wasComplete: (plan: ReturnType<typeof restorePlan>, outcome: O) => boolean;
}): Promise<HoldResult> {
  const gate = candidateReplacesBase(i.base, i.candidate, i.userMessage);
  if (!gate || !i.base) return NOT_HELD;
  try {
    const plan = restorePlan(i.base as Record<string, string>, i.candidate as Record<string, string>, new Set(i.protectPaths));
    await i.keepCandidate().catch(() => {});
    const outcome = await i.putBaseBack(plan);
    const report = heldEditReport(gate, i.wasComplete(plan, outcome));
    return { held: true, persisted: i.treeAfter(plan, outcome), removed: outcome.removed, summary: report.summary, narration: report.narration, finding: report.finding };
  } catch (err) {
    const report = heldEditReport(gate, false);
    return { held: true, persisted: null, removed: [], summary: report.summary, narration: report.narration, finding: { ...report.finding, detail: `${report.finding.detail} · restore failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`, autoResolved: false } };
  }
}

/** The bill after a hold: nothing was delivered, so nothing is charged. */
export function billAfterHold(billedUsd: number, heldSummary: string | null): number {
  return heldSummary === null ? billedUsd : 0;
}
/** The result's summary after a hold: the user is told their change was not applied. */
export function summaryAfterHold<T extends { summary?: unknown }>(result: T, heldSummary: string | null): T {
  return heldSummary === null ? result : { ...result, summary: heldSummary };
}

/**
 * A restore from the existing version history is a NEW history event, never a rewrite: a `restore` revision whose
 * parent is the current head and whose `restoredFrom` names the verified revision with the same files, when one
 * exists. It is recorded either way — so the next edit has a head to be verified against — and it is labelled for
 * what it is: `previewGreen` is carried from the revision it restores, and is false when no verified revision
 * matches (an old version nobody browser-checked). No model is called. Never throws.
 */
export async function recordRestoreRevision(i: {
  store: RevisionStore;
  projectId: string;
  restored: Readonly<Record<string, string>>;
  versionName: string;
  editId: string;
  now: number;
}): Promise<{ recorded: boolean; restoredFrom: string | null; why?: string }> {
  try {
    const head = await i.store.head(i.projectId);
    const hash = sourceHashOf(manifestOf(i.restored));
    if (head && head.sourceHash === hash) return { recorded: false, restoredFrom: head.id, why: 'the project already is that revision' };
    const earlier = (await i.store.list(i.projectId, 200)).find((r) => r.sourceHash === hash && r.validation.previewGreen) ?? null;
    const rev = buildRevision({
      projectId: i.projectId, parentId: head?.id ?? null, editId: i.editId, kind: 'restore', files: i.restored,
      messageText: `Restored: ${i.versionName}`, ...(earlier ? { restoredFrom: earlier.id } : {}),
      validation: {
        previewGreen: earlier !== null,
        checks: [earlier ? 'restore-of-verified-revision' : 'restore-of-unverified-version'],
        ...(earlier?.validation.artifactDigest ? { artifactDigest: earlier.validation.artifactDigest } : {}),
      },
      now: i.now,
    });
    const r = await i.store.promote(i.projectId, head?.id ?? null, rev);
    return r.ok ? { recorded: true, restoredFrom: earlier?.id ?? null } : { recorded: false, restoredFrom: earlier?.id ?? null, why: 'another change advanced the head first' };
  } catch (e) {
    return { recorded: false, restoredFrom: null, why: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

/** The paths of a file map, or none when there is no map. */
export function pathsOf(files: Readonly<Record<string, string>> | null): string[] {
  return files ? Object.keys(files) : [];
}
/** What is durable after a hold: the restored tree if one was made, else what it was. */
export function persistedAfterHold(hold: Pick<HoldResult, 'persisted'>, persisted: Record<string, string>): Record<string, string> {
  return hold.persisted ?? persisted;
}
