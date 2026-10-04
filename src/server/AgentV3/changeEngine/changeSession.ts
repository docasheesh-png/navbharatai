// CHANGE ENGINE — one change, from the request to its record. The thin seam the build route calls.
//
// The route calls exactly three things, so the 24k-line route grows by a handful of lines:
//
//   beginChange(...)    — before the build: classify the change, load the app's memory, and return the
//                         block the builder sees (requirements on record; open issues on deeper changes)
//                         and the features to re-probe for regression.
//   observeProbes(...)  — when the real browser probe runs: remember what it saw (requested features AND
//                         the re-probed features the app had before).
//   settleChange(...)   — at settle: fold everything into the stored memory in ONE transaction — the
//                         requirement ledger, the issue queue, and a new change record — and return the
//                         admin-report lines.
//
// Nothing here can fail a build, block a build, or change which model runs. Every step is best-effort and
// the whole engine stops at `AGENTV3_CHANGE_ENGINE=off`.

import { classifyChange, describeChangeClassification, type ChangeClassification } from './changeClassifier';
import {
  foldRequestedFeatures, foldProbeResults, regressionProbeFeatures, renderSpecForBuilder, foldRequestedLabels, markLabelsBuilt, labelKey,
  type ProbeOutcome, type SpecItem, type AppSpec,
} from './appSpec';
import {
  foldBuildFindings, queueableFindings, workableIssues, markAssigned, renderIssuesForBuilder,
} from './issueQueue';
import { appendChange, chgId, describeChange, type ChangeRecord, type ChangeStatus, type EngineeringMemory } from './changeLog';
import { loadEngineeringMemory, updateEngineeringMemory } from './engineeringMemoryStore';
import { fenceUntrusted } from '../UntrustedContent';
import { redactSecrets, redactPII } from '../SecretRedactor';
import { redactProvidersText } from '../../lib/providerRedaction';
import type { BuildIssue } from '../BuildDiagnostics';
import type { ProjectGraph } from '../WorkspaceMemory';
import { computeImpactSet, renderImpactForBuilder } from './impactSet';
import { requestedProbeFeatures } from '../FeaturePresence';

export interface ChangeSession {
  workspaceId: string;
  isEdit: boolean;
  classification: ChangeClassification;
  /** Redacted ≤160-char request digest — the only user-derived text this engine stores. */
  summary: string;
  /** Features this request asked for (from the platform's own probe table). */
  requested: Array<{ feature: string; label: string }>;
  declined: string[];
  /** Feature LABELS the builder was handed as the contract (slice 3) — non-probe-able requirements. */
  requestedLabels: string[];
  /** Features the app was SEEN to have before this change — re-probed for regression. */
  regressionTargets: string[];
  /** Issue ids handed to the builder in this build's context. */
  assignedIssueIds: string[];
  /** Probe outcomes observed during this build, merged (last observation per feature wins). */
  probes: Map<string, ProbeOutcome>;
  /** The ledger as it stood when this change began (empty for a new build). */
  priorSpec: AppSpec;
}

export interface BeginResult {
  session: ChangeSession;
  /** Prepended to the build prompt (inside the per-turn user message). '' when there is nothing to say. */
  builderBlock: string;
  /** One admin-report line. */
  reportLine: string;
}

/** The only user-derived text stored: redacted, single-line, capped. */
export function requestDigest(prompt: unknown): string {
  const raw = typeof prompt === 'string' ? prompt : '';
  return redactProvidersText(redactPII(redactSecrets(raw))).replace(/\s+/g, ' ').trim().slice(0, 160);
}

export async function beginChange(input: {
  workspaceId: string;
  prompt: string;
  isEdit: boolean;
  requested: Array<{ feature: string; label: string }>;
  declined?: ReadonlyArray<string>;
  /** The contract labels (confirmedContractLabels) — platform-authored feature names. */
  contractLabels?: ReadonlyArray<string>;
  /** The app's import graph (WorkspaceMemory), for the impact set on standard/deep edits. */
  graph?: ProjectGraph | null;
}): Promise<BeginResult> {
  const classification = classifyChange(input.prompt);
  const mem = await loadEngineeringMemory(input.workspaceId);
  // A NEW build in a workspace that held another app is a different app: its old requirements are not
  // this app's, so they are neither shown nor re-probed (they are retired at settle, kept for history).
  const spec: AppSpec = input.isEdit ? mem.spec : { items: [], nextReq: mem.spec.nextReq };
  const regressionTargets = input.isEdit ? regressionProbeFeatures(spec) : [];
  const workable = input.isEdit && classification.depth !== 'light' ? workableIssues(mem.queue) : [];

  const parts: string[] = [];
  const specBlock = input.isEdit ? renderSpecForBuilder(spec, classification.depth) : '';
  if (specBlock) parts.push(specBlock);
  // Slice 4 — where this change lands and what depends on it, from the import graph. Edits only (a new
  // build has no prior graph worth reading), and never on a micro change (one file, no need for a map).
  // File names are the app's own text, so the block travels fenced as data.
  const impact = input.isEdit && classification.depth !== 'light' ? computeImpactSet(input.prompt, input.graph, classification.kinds) : { seeds: [], dependents: [] };
  const impactBlock = renderImpactForBuilder(impact);
  if (impactBlock) parts.push(fenceUntrusted('this app\'s file list', impactBlock));
  const issueBlock = renderIssuesForBuilder(workable);
  // Issue messages can quote the app's own text (a label, a file name), so they travel fenced as data.
  if (issueBlock) parts.push(fenceUntrusted('earlier checks of this app', issueBlock));

  const session: ChangeSession = {
    workspaceId: input.workspaceId,
    isEdit: input.isEdit,
    classification,
    summary: requestDigest(input.prompt),
    requested: input.requested.slice(0, 40),
    declined: [...(input.declined ?? [])],
    requestedLabels: (input.contractLabels ?? []).map((l) => redactSecrets(String(l))).slice(0, 40),
    regressionTargets,
    assignedIssueIds: workable.map((i) => i.id),
    probes: new Map(),
    priorSpec: spec,
  };
  const specLive = spec.items.filter((i) => i.status !== 'dropped').length;
  const reportLine = `${describeChangeClassification(classification)} · ${specLive} requirement(s) on record · ${regressionTargets.length} re-probed for regression · ${workable.length} open issue(s) handed to the builder · impact ${impact.seeds.length} file(s) + ${impact.dependents.length} dependent(s)`;
  return { session, builderBlock: parts.join('\n\n'), reportLine };
}

/** Record what a real-browser probe saw. Later observations of the same feature win (post-heal re-probe). */
export function observeProbes(session: ChangeSession | null, probes: ReadonlyArray<ProbeOutcome>): void {
  if (!session) return;
  for (const p of probes || []) {
    if (p && typeof p.feature === 'string') session.probes.set(p.feature, { feature: p.feature, present: !!p.present, ...(p.via ? { via: p.via } : {}) });
  }
}

/**
 * The regressed requirements a probe would report RIGHT NOW, without writing anything — so the route can
 * record FEATURE_REGRESSED at the moment of the probe, beside the coverage finding it belongs with.
 */
export function regressionsSoFar(session: ChangeSession | null): SpecItem[] {
  if (!session) return [];
  return foldProbeResults(session.priorSpec, [...session.probes.values()], 'pending', Date.now()).regressed;
}

export interface SettleInput {
  ok: boolean;
  stopped: boolean;
  /** Paths written by this build. */
  files: ReadonlyArray<string>;
  /** Release-gate state if the build reached its gate, else undefined. */
  gate?: 'green' | 'yellow' | 'red' | 'unknown';
  /** All issues the build recorded (from the build report). */
  issues: ReadonlyArray<BuildIssue>;
}

export interface SettleResult {
  record: ChangeRecord;
  regressed: SpecItem[];
  reportLines: string[];
}

function statusOf(i: SettleInput): ChangeStatus {
  if (i.stopped) return 'stopped';
  if (!i.ok) return 'failed';
  return i.gate === 'green' ? 'completed' : 'partial';
}

/** Pure core of settle — exported so the scenario tests drive the exact fold the store runs. */
export function foldSettle(mem: EngineeringMemory, session: ChangeSession, input: SettleInput, now: number): { mem: EngineeringMemory; result: SettleResult } {
  const changeId = chgId(mem.nextChg);
  let spec = mem.spec;
  if (!session.isEdit) {
    spec = { nextReq: spec.nextReq, items: spec.items.map((i) => (i.status === 'dropped' ? i : { ...i, status: 'dropped' as const, lastChange: changeId })) };
  }
  spec = foldRequestedFeatures(spec, session.requested, changeId, new Set(session.declined));
  const probedFeatures = new Set(session.requested.map((r) => r.feature));
  spec = foldRequestedLabels(spec, session.requestedLabels ?? [], changeId, (label) => {
    const ids = requestedProbeFeatures(label);
    return ids.length > 0 && ids.every((f) => probedFeatures.has(f.feature));
  });
  const probeFold = foldProbeResults(spec, [...session.probes.values()], changeId, now);
  spec = probeFold.spec;
  // A non-probe-able requirement is BUILT only by a build that passed its release gate — never by a claim.
  let builtNow: SpecItem[] = [];
  if (input.ok && !input.stopped && input.gate === 'green') {
    const m = markLabelsBuilt(spec, (session.requestedLabels ?? []).map((l) => labelKey(l)), changeId);
    spec = m.spec;
    builtNow = m.built;
  }

  let queue = markAssigned(mem.queue, session.assignedIssueIds, changeId);
  const findings = queueableFindings(input.issues).map((f) => ({ ...f, message: redactProvidersText(redactSecrets(f.message)) }));
  // Checks ran only when the build reached its release gate without being stopped. A stopped or failed
  // build fixes nothing in this ledger: "we did not look" is never "it is gone".
  const checksRan = !!input.gate && input.ok && !input.stopped;
  const qFold = foldBuildFindings(queue, { findings, changeId, now, checksRan });
  queue = qFold.queue;

  const reqIds = new Set<string>();
  for (const r of session.requested) { const it = spec.items.find((i) => i.feature === r.feature); if (it) reqIds.add(it.id); }
  for (const it of [...probeFold.verified, ...probeFold.regressed, ...probeFold.restored, ...builtNow]) reqIds.add(it.id);
  for (const l of session.requestedLabels ?? []) { const it = spec.items.find((i) => i.feature === labelKey(l)); if (it) reqIds.add(it.id); }
  const issueIds = [...qFold.opened, ...qFold.reopened, ...qFold.fixed, ...qFold.verified].map((i) => i.id);

  const record: ChangeRecord = {
    id: changeId, ts: now, summary: session.summary,
    kind: session.classification.kind, risk: session.classification.risk, depth: session.classification.depth,
    requirements: [...reqIds].slice(0, 40), issues: [...new Set(issueIds)].slice(0, 40),
    files: input.files.slice(0, 40), status: statusOf(input),
    ...(input.gate ? { gate: input.gate } : {}),
    regressed: probeFold.regressed.map((i) => i.id),
  };
  const next: EngineeringMemory = { ...appendChange({ ...mem, spec, queue }, record, changeId), nextChg: mem.nextChg + 1 };
  const reportLines = [describeChange(record)];
  if (qFold.opened.length || qFold.fixed.length || qFold.verified.length || qFold.reopened.length) {
    reportLines.push(`Issue queue: ${qFold.opened.length} opened, ${qFold.reopened.length} reopened, ${qFold.fixed.length} fixed, ${qFold.verified.length} verified · ${queue.issues.filter((i) => i.status !== 'verified').length} open`);
  }
  return { mem: next, result: { record, regressed: probeFold.regressed, reportLines } };
}

/** Fold this change into the stored memory. Best-effort; null when nothing could be recorded. */
export async function settleChange(session: ChangeSession | null, input: SettleInput): Promise<SettleResult | null> {
  if (!session) return null;
  let result: SettleResult | null = null;
  const saved = await updateEngineeringMemory(session.workspaceId, (mem) => {
    const out = foldSettle(mem, session, input, Date.now());
    result = out.result;
    return out.mem;
  });
  return saved ? result : null;
}
