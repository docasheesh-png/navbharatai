// APK / AAB / iOS BUILD REPORT (admin 2026-08-18: "build report jaise 'apk build report' bhi chahiye…
// jab app build fail ho to, pura likh kar aye, build kyu fail hui! jisko json me download kiya ja sake").
//
// ONE pure builder that turns what GitHub knows about a run (status, steps, the failed job's log) into a
// complete, downloadable JSON report a NON-TECHNICAL user can read: what was built, how long it took,
// which steps ran, and — when it failed — a plain-language explanation of WHY, with the real log lines
// underneath for anyone (or any AI) that wants the detail.
//
// TWO laws govern every string in here:
//   • HONESTY: the "why" comes from the SAME classifier the self-healing loop uses
//     (classifyBuildFailure), so the report and the repair can never tell two different stories. A
//     failure the classifier cannot name says so plainly instead of inventing a cause.
//   • WHITE-LABEL: nothing user-facing may name an AI vendor or model. The classifier's summaries are
//     white-label by construction, and the log excerpt is the user's OWN app's build output (npm,
//     Gradle, their compiler) — the generated workflows never run or mention an AI provider.
//
// PURE — no network, no I/O, injected clock — so every shape below is unit-testable.

import { classifyBuildFailure, failedStepSection, failedStage, normalizeLog } from './mobileBuildRepair';
import { SHIP_WORKFLOWS, isShipWorkflow, workflowPath } from '../../lib/shipWorkflows';

/** A run's step in the user's language (mapped by friendlyBuildStep, GitHub housekeeping hidden). */
export interface BuildReportStep {
  label: string;
  state: 'done' | 'running' | 'pending' | 'failed';
}

/** What GitHub reports about the run itself. */
export interface BuildReportRun {
  id: number | string;
  status: string;              // queued | in_progress | completed
  conclusion: string | null;   // success | failure | cancelled | null
  startedAt?: string | null;
  completedAt?: string | null;
  htmlUrl?: string | null;
}

export interface MobileBuildReport {
  report: string;
  generatedAt: string;
  app: {
    owner: string;
    repo: string;
    workflow: string;
    /** What this build produces, in the user's terms. */
    building: string;
  };
  build: {
    runId: number | string;
    /** One honest word: success | failed | stopped | running | unknown. */
    result: 'success' | 'failed' | 'stopped' | 'running' | 'unknown';
    status: string;
    conclusion: string | null;
    startedAt: string | null;
    completedAt: string | null;
    durationSeconds: number | null;
    link: string | null;
  };
  steps: BuildReportStep[];
  /** Present ONLY when the build failed — the full written "why". */
  failure: null | {
    /** The step that died, in plain language. */
    whatStopped: string;
    /** Which stage of the pipeline it was in (install / webbuild / capacitor / android), when known. */
    stage: string | null;
    /** WHY it failed, written for the person who pressed the button — the classifier's own words. */
    why: string;
    /** True when NavBharatAI's self-healing loop can repair this class itself on the next press. */
    navbharatCanFixItself: boolean;
    /** Structured facts the classifier extracted (e.g. the missing secret's name). */
    detail: Record<string, string> | null;
    /** The real log lines of the failed step — bounded, timestamps stripped. */
    logExcerpt: string[];
  };
}

/**
 * Turn a raw GitHub Actions step name into plain, white-label language for the build-progress view — or
 * null to HIDE it (GitHub's own housekeeping steps, and trivial ones the user does not care about). The
 * generated workflow's own step names are already user-friendly and vendor-free; this also collapses the
 * setup steps and guards against any future technical name leaking to a user (White-Label Law).
 * (Moved here from routes/mobileShip.ts so the live progress view and the build report share ONE mapping.)
 */
export function friendlyBuildStep(rawName: string): string | null {
  const n = (rawName || '').toLowerCase().trim();
  if (!n) return null;
  // GitHub's own housekeeping + trivial / failure-only steps → hidden.
  if (/^set up job$|^complete job$|^post\b/.test(n)) return null;
  if (/checkout/.test(n)) return null;
  if (/remove the keystore|always remove|clean ?up|summary|explain what stopped/.test(n)) return null;

  // Build-machine setup, both platforms.
  if (/set ?up node|setup-node|set ?up java|setup-java|select xcode|xcode-select|install ruby|bundler|bundle install/.test(n)) return 'Getting the build machine ready';

  // iOS-specific — checked BEFORE the Android/generic rules so "cap sync ios", the TestFlight upload and
  // Apple signing are never mislabelled as Android or as a generic "download".
  if (/cocoapods|pod install|cap (add|sync) ios|the ios project|sync the ios/.test(n)) return 'Preparing the iOS project';
  if (/testflight|upload_to_testflight|pilot|\bdeliver\b|app store connect/.test(n)) return 'Uploading to TestFlight';
  if (/certificate|provisioning|keychain|import_certificate|\bmatch\b|code ?sign/.test(n)) return 'Setting up signing';
  if (/\.ipa|xcodebuild|build_app|\bgym\b|archive the app|build the (signed )?ios/.test(n)) return 'Compiling your iOS app';

  // Shared build steps.
  if (/install/.test(n) && /librar/.test(n)) return "Installing your app's libraries";
  if (/build the web app|npm run build/.test(n)) return 'Building your app';

  // Android-specific.
  if (/generate and sync|android project|cap (add|sync)/.test(n)) return 'Preparing the Android project';
  if (/keystore|wire gradle signing/.test(n)) return 'Setting up signing';
  if (/bundle|assemble|installable apk|compil/.test(n)) return 'Compiling your Android app';

  // Generic, either platform.
  if (/signing secret|pre-?flight/.test(n)) return 'Checking your signing key';
  if (/versioncode|build number|stamp.*version|export compliance/.test(n)) return 'Setting the app version';
  if (/upload/.test(n)) return 'Packaging your download';
  // Our step names are white-label by construction; anything unmatched is safe to show as-is.
  return rawName.trim();
}

/**
 * Map a run's raw GitHub steps to the user's view: friendly labels, housekeeping hidden, consecutive
 * duplicates collapsed. ONE implementation shared by the live progress route and the build report, so a
 * user can never watch one set of steps and download a report describing another.
 */
export function mapRunSteps(
  rawSteps: Array<{ name?: string; status?: string; conclusion?: string | null }>,
): BuildReportStep[] {
  const steps: BuildReportStep[] = [];
  for (const s of rawSteps) {
    const label = friendlyBuildStep(String(s.name || ''));
    if (!label) continue; // hide GitHub's own housekeeping steps
    const state: BuildReportStep['state'] =
      s.conclusion === 'failure' ? 'failed'
        : s.status === 'completed' ? 'done'
          : s.status === 'in_progress' ? 'running'
            : 'pending';
    // Collapse consecutive duplicates (e.g. setup steps that map to one friendly label).
    const prev = steps[steps.length - 1];
    if (prev && prev.label === label) {
      if (state === 'failed' || state === 'running') prev.state = state;
      else if (prev.state === 'pending' && state === 'done') prev.state = 'done';
      continue;
    }
    steps.push({ label, state });
  }
  return steps;
}

/** What each generated workflow produces, said in the user's terms. */
export function buildingLabel(workflow: string): string {
  if (workflow === SHIP_WORKFLOWS.androidApk) return 'Installable Android app (.apk)';
  if (workflow === SHIP_WORKFLOWS.androidAab) return 'Google Play bundle (.aab)';
  if (workflow === SHIP_WORKFLOWS.iosIpa) return 'iPhone app (.ipa → TestFlight)';
  return 'App build';
}

/** How many log lines the report carries — enough to hold the real error, bounded so a runaway log cannot. */
const LOG_EXCERPT_LINES = 120;
const LOG_LINE_MAX = 400;

/** The failed step's log, cleaned for the report: timestamps stripped, bounded, group markers dropped. */
export function reportLogExcerpt(log: string): string[] {
  const section = failedStepSection(normalizeLog(log));
  return section
    .split('\n')
    .filter((l) => l.trim() && !/^##\[(group|endgroup)\]/.test(l.trim()))
    .slice(-LOG_EXCERPT_LINES)
    .map((l) => (l.length > LOG_LINE_MAX ? `${l.slice(0, LOG_LINE_MAX)}…` : l));
}

/**
 * Build the complete report. `log` is only needed (and only read) when the run genuinely failed; a
 * successful or still-running build produces a report with `failure: null`.
 */
export function buildMobileBuildReport(input: {
  owner: string;
  repo: string;
  workflow: string;
  run: BuildReportRun;
  steps: BuildReportStep[];
  /** The failed job's log — required for a full "why" on a failed run; tolerated absent (honest fallback). */
  log?: string;
  /** Injected clock so the report is testable and reproducible. */
  now?: number;
}): MobileBuildReport {
  const { owner, repo, workflow, run, steps } = input;
  const result: MobileBuildReport['build']['result'] =
    run.conclusion === 'success' ? 'success'
      : run.conclusion === 'failure' ? 'failed'
        : run.conclusion === 'cancelled' ? 'stopped'
          : run.status === 'completed' ? 'unknown'
            : 'running';

  const started = run.startedAt ? Date.parse(run.startedAt) : NaN;
  const completed = run.completedAt ? Date.parse(run.completedAt) : NaN;
  const durationSeconds =
    Number.isFinite(started) && Number.isFinite(completed) && completed >= started
      ? Math.round((completed - started) / 1000)
      : null;

  let failure: MobileBuildReport['failure'] = null;
  if (result === 'failed') {
    const log = input.log || '';
    // The SAME classifier the self-healing loop uses — the report and the repair tell ONE story.
    const wfPath = isShipWorkflow(workflow) ? workflowPath(workflow) : `.github/workflows/${workflow}`;
    const diag = classifyBuildFailure(log, wfPath);
    const failedLabel = steps.find((s) => s.state === 'failed')?.label || 'The build';
    failure = {
      whatStopped: failedLabel,
      stage: failedStage(log),
      why: log.trim()
        ? diag.summary
        : 'The build stopped without leaving a log NavBharatAI could read, so the reason could not be determined.',
      navbharatCanFixItself: log.trim() ? diag.autoFixable : false,
      detail: diag.detail ?? null,
      logExcerpt: log.trim() ? reportLogExcerpt(log) : [],
    };
  }

  return {
    report: 'NavBharatAI app build report',
    generatedAt: new Date(input.now ?? Date.now()).toISOString(),
    app: { owner, repo, workflow, building: buildingLabel(workflow) },
    build: {
      runId: run.id,
      result,
      status: run.status,
      conclusion: run.conclusion,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      durationSeconds,
      link: run.htmlUrl ?? null,
    },
    steps,
    failure,
  };
}
