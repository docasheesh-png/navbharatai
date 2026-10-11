// P-DEPLOY.5 — IS THE RELEASE GATE ACTUALLY WIRED TO ANYTHING? (queue row Q-141, 2026-10-04)
//
// 🔴 THE DEFECT, and it is the second absolute rule broken outright. `ReleaseGate.ts` is correct, its
// store is correct, its route is correct, and `AppKnowledgeBase.ts` told every AI in NavBharatAI:
//
//     "The deploy pipeline checks the public GET /api/release/gate?sha=<commit> before promoting
//      and refuses to deploy when the gate is closed."
//
// It does not. The check lives in `.github/workflows/deploy.yml`, behind
// `if: steps.guard.outputs.ready == 'true'` — which requires the `GCP_SA_KEY` + `GCP_PROJECT_ID`
// repo secrets, and `CLAUDE.md` records that those are NOT set, so that whole workflow skips cleanly
// and deploys nothing. The pipeline that actually ships every merge is the Cloud Build trigger running
// `cloudbuild.yaml`, and it had no gate step at all. **So an admin freezing releases during a live
// incident sees `Frozen: YES` in red on the admin board, and the next merge deploys anyway.**
//
// That is worse than a faked indicator: it is a TRUE reading of a control connected to nothing.
//
// 🔑 THE CLASS: a claim about a pipeline, written in prose, in a file the pipeline cannot see. Nothing
// could ever have caught the drift, because the sentence and the YAML had no relationship. So the fix
// is not a better sentence — it is to make the two CHECK EACH OTHER:
//
//   1. `DEPLOY_PATHS` below is the one place that states which deploy path asks the gate. Every
//      user-facing and admin-facing sentence derives from it.
//   2. `tests/aFreezeThatStopsNothing.test.ts` PARSES `cloudbuild.yaml` and `deploy.yml` and fails CI
//      when this table disagrees with them. The sentence cannot drift from the pipeline again.
//   3. And the honest answer does not rest on a table at all where evidence exists: the gate route
//      records every time a pipeline really asks it, so the admin board can say *"no deploy pipeline
//      has ever asked this endpoint"* — a measurement, not a claim (the fifth rule's step 5).
//
// ⚠️ WHAT IS STILL THE ADMIN'S, stated rather than quietly shipped. `cloudbuild.yaml` now carries the
// check, but it is INERT until the `_RELEASE_GATE_URL` trigger substitution is set, and it exits 0 on
// every path except an explicit `"allowed":false` — because a step that can fail for any other reason
// is a step that can stop every deploy, and no session here can run Cloud Build to prove otherwise.
// Until that substitution is set, a freeze still stops nothing, and this module says so.
//
// PURE — no I/O, no clock of its own. Never throws.

/** One path by which code reaches production, and whether it consults the gate before promoting. */
export interface DeployPath {
  /** The repo file that defines it. */
  file: string;
  /** Is this the path that actually ships every merge today? */
  primary: boolean;
  /** Does the file contain a gate check at all? */
  carriesTheCheck: boolean;
  /**
   * Is that check LIVE without further configuration? `false` means the file has the step but
   * something outside the repo (a secret, a trigger substitution) must be set before it can block.
   */
  liveWithoutConfig: boolean;
  /** What is needed, in the admin's terms, for this path to honour a freeze. */
  needs: string;
}

export const DEPLOY_PATHS: readonly DeployPath[] = [
  {
    file: 'cloudbuild.yaml',
    primary: true,
    carriesTheCheck: true,
    liveWithoutConfig: false,
    needs: 'set the _RELEASE_GATE_URL substitution on the Cloud Build trigger to https://<the live app>/api/release/gate',
  },
  {
    file: '.github/workflows/deploy.yml',
    primary: false,
    carriesTheCheck: true,
    liveWithoutConfig: false,
    needs: 'set the GCP_PROJECT_ID, GCP_SA_KEY and RELEASE_GATE_URL repository secrets (this workflow deploys nothing without the first two)',
  },
];

/** The deploy path that actually ships a merge today. */
export function primaryDeployPath(): DeployPath {
  return DEPLOY_PATHS.find((p) => p.primary) ?? DEPLOY_PATHS[0];
}

/** Can a freeze stop a deploy today, on the evidence of the repo alone? */
export function anyPathEnforcesWithoutConfig(): boolean {
  return DEPLOY_PATHS.some((p) => p.carriesTheCheck && p.liveWithoutConfig);
}

/** How long a recorded pipeline check stays evidence that the wiring works. */
export const CHECK_IS_RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/** What a pipeline check looks like once recorded. All fields optional — the store may hold nothing. */
export interface GateCheckRecord {
  lastCheckedAtMs?: number;
  lastCheckedSha?: string;
  checkCount?: number;
  /**
   * Did the caller IDENTIFY itself as the deploy pipeline (the `X-Release-Gate-Caller` header the
   * Cloud Build step sends)? See `pipelineEvidence` for why this field has to exist.
   */
  viaPipelineHeader?: boolean;
}

/**
 * 🔴 MY OWN OVER-CLAIM, FOUND THE DAY THE ADMIN CONFIGURED THE TRIGGER (2026-10-11).
 *
 * `/api/release/gate` is PUBLIC — it has to be, because Cloud Build asks it without logging in. The
 * first version of this recorded a check on **every** GET and then printed *"A deploy pipeline last
 * asked this gate … so a freeze does reach the pipeline."*
 *
 * **Anyone reaching the URL wrote that record:** a browser, an uptime monitor, a crawler, or me
 * testing it. The record stores *that a call happened*; the sentence stated *who made it*. One fact,
 * two readings, and the stronger reading was the one printed — on a SAFETY control, which is the worst
 * possible place for a false verification. It is the same class this module was written to fix, and I
 * shipped it inside the fix.
 *
 * 🔑 So the evidence is now graded by what the call actually carried, and each grade gets its own
 * sentence. Nothing is inferred:
 *   · `pipeline` — the caller sent the `X-Release-Gate-Caller: cloudbuild` header the step sends.
 *   · `commit`   — no header, but a plausible commit SHA, which an idle GET does not have.
 *   · `none`     — neither. **Not recorded at all**, so it can never become evidence.
 */
export type GateEvidence = 'pipeline' | 'commit' | 'none';

/** A git commit SHA as a pipeline sends it — `$COMMIT_SHA` is 40 hex, short forms are 7+. PURE. */
export function isCommitSha(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value.trim());
}

/** How much a single call to the gate is worth as evidence. PURE. */
export function pipelineEvidence(opts: { sha?: unknown; callerHeader?: unknown }): GateEvidence {
  const header = String(opts.callerHeader ?? '').trim().toLowerCase();
  if (header === 'cloudbuild') return 'pipeline';
  if (isCommitSha(opts.sha)) return 'commit';
  return 'none';
}

/**
 * The one honest sentence about whether a freeze would stop a deploy.
 *
 * Evidence FIRST: a pipeline that has really asked this endpoint is proof the wiring works, whatever a
 * table says. Only with no such evidence does it fall back to the repo's own state — and then it says
 * plainly that a freeze stops nothing, and exactly what to set.
 */
export function freezeEnforcementNote(record: GateCheckRecord | null | undefined, nowMs: number): string {
  const at = typeof record?.lastCheckedAtMs === 'number' && Number.isFinite(record.lastCheckedAtMs)
    ? record.lastCheckedAtMs
    : null;

  if (at !== null && nowMs - at <= CHECK_IS_RECENT_MS) {
    const when = new Date(at).toISOString();
    const n = typeof record?.checkCount === 'number' && record.checkCount > 0 ? record.checkCount : 1;
    const sha = typeof record?.lastCheckedSha === 'string' && record.lastCheckedSha ? record.lastCheckedSha.slice(0, 12) : '';
    // Two different facts, two different sentences — never the stronger one by default. See `pipelineEvidence`.
    if (record?.viaPipelineHeader === true) {
      return `The deploy pipeline asked this gate at ${when}${sha ? ` for commit ${sha}` : ''} (${n} check(s) recorded), `
        + 'so a freeze does reach the pipeline.';
    }
    return `This gate was asked at ${when}${sha ? ` for commit ${sha}` : ''} (${n} check(s) recorded). The call carried a `
      + 'commit SHA, which an idle request does not, so it was very likely the deploy pipeline — but it did not identify '
      + 'itself, so this is not proof. A freeze is likely to reach the pipeline.';
  }

  const primary = primaryDeployPath();
  const stale = at !== null
    ? ` The last recorded check was ${new Date(at).toISOString()}, longer ago than the last ${Math.round(CHECK_IS_RECENT_MS / 86_400_000)} days of deploys, so it is no longer evidence.`
    : ' No deploy pipeline has ever asked this endpoint.';

  if (anyPathEnforcesWithoutConfig()) {
    return `⚠️ A FREEZE MAY NOT STOP A DEPLOY.${stale} ${primary.file} carries the check, but nothing has exercised it yet.`;
  }

  return `⚠️ A FREEZE DOES NOT STOP A DEPLOY TODAY.${stale} ${primary.file} is the path that ships every merge, `
    + `and its check is inert until you ${primary.needs}. Until then, freezing records the intent and shows it here — `
    + 'it does not hold the pipeline.';
}

/** Is the admin about to turn a freeze ON (or add an approval requirement) that nothing will honour? */
export function freezeWouldNotHold(config: { frozen?: boolean; approvalRequired?: boolean } | null | undefined): boolean {
  const wants = !!config?.frozen || !!config?.approvalRequired;
  return wants && !anyPathEnforcesWithoutConfig();
}
