// The provider-neutral vocabulary of an Android build (2026-11-25, dual build providers).
//
// Two providers produce the same thing — a genuine, validated .apk or .aab — by different machines:
//   • native_cloud    — NavBharatAI's own cloud: a disposable E2B sandbox per build (nativeBuildRunner.ts).
//   • github_actions  — the existing, long-hardened flow on the user's own GitHub repository (routes/mobileShip.ts).
// The UI speaks THIS vocabulary, so a status screen never has to know which machine did the work.

export type MobileBuildProviderId = 'native_cloud' | 'github_actions';
export const MOBILE_BUILD_PROVIDERS: readonly MobileBuildProviderId[] = ['native_cloud', 'github_actions'];

export type MobileArtifactKind = 'apk' | 'aab';

/**
 * The normalized states. Only states a provider can PROVE are ever reported — a native build reports
 * `signing` only when the signing sandbox is actually running, never on a timer.
 */
export type MobileBuildState =
  | 'queued'
  | 'preparing'
  | 'building'
  | 'signing'
  | 'validating'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'expired';

export const TERMINAL_STATES: ReadonlySet<MobileBuildState> = new Set(['completed', 'failed', 'cancelled', 'expired']);
export const ACTIVE_STATES: readonly MobileBuildState[] = ['queued', 'preparing', 'building', 'signing', 'validating', 'uploading', 'cancelling'];

export function isTerminalState(s: MobileBuildState): boolean {
  return TERMINAL_STATES.has(s);
}

export function isProviderId(v: unknown): v is MobileBuildProviderId {
  return typeof v === 'string' && (MOBILE_BUILD_PROVIDERS as readonly string[]).includes(v);
}

export function isArtifactKind(v: unknown): v is MobileArtifactKind {
  return v === 'apk' || v === 'aab';
}

/**
 * GitHub's (status, conclusion) pair in the normalized vocabulary — so the GitHub lane can be shown with
 * the same words as the native one. Pure.
 */
export function normalizeGithubRun(status: string | null | undefined, conclusion: string | null | undefined): MobileBuildState {
  if (status === 'completed') {
    if (conclusion === 'success') return 'completed';
    if (conclusion === 'cancelled') return 'cancelled';
    return 'failed';
  }
  if (status === 'queued' || status === 'waiting' || status === 'pending' || status === 'requested') return 'queued';
  return 'building';
}

/** How the delivered binary is signed — always stated, never implied. */
export type SigningType = 'debug' | 'upload_key';

/** What the trusted validation stage read out of the finished binary. */
export interface ArtifactInspection {
  applicationId: string;
  versionCode: number | null;
  versionName: string | null;
  minSdk: number | null;
  targetSdk: number | null;
  abis: string[];
  /** SHA-256 of the signing certificate, upper-case hex with colons, as Play Console shows it. */
  certSha256: string | null;
  signingType: SigningType;
}

/** One build record of the Native Cloud Build (Firestore `mobile_native_builds/{id}`). */
export interface NativeBuildJob {
  id: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  provider: 'native_cloud';
  kind: MobileArtifactKind;
  appName: string;
  appId: string;
  versionCode: number;
  state: MobileBuildState;
  /** The real step the worker reported last (a workflow step name), for the progress line. */
  step: string | null;
  stepIndex: number | null;
  stepCount: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Written by the instance driving the build; a stale heartbeat on an active job means the driver died. */
  heartbeatAt: string | null;
  cancelRequested: boolean;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  failedStep: string | null;
  /** Sandbox ids, so any instance can stop a build's machines (cancel, reconcile). */
  buildSandboxId: string | null;
  signSandboxId: string | null;
  toolchain: string | null;
  signingKeyId: string | null;
  artifact: {
    objectPath: string;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    inspection: ArtifactInspection;
    expiresAt: string;
  } | null;
  billingRef: string | null;
}

/** The browser-safe view of a job — never the sandbox ids, the object path or the key id. */
export interface NativeBuildView {
  id: string;
  provider: 'native_cloud';
  kind: MobileArtifactKind;
  appName: string;
  appId: string;
  versionCode: number;
  state: MobileBuildState;
  step: string | null;
  stepIndex: number | null;
  stepCount: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  failedStep: string | null;
  artifact: { fileName: string; sizeBytes: number; sha256: string; inspection: ArtifactInspection; expiresAt: string } | null;
}

export function toView(job: NativeBuildJob): NativeBuildView {
  return {
    id: job.id,
    provider: job.provider,
    kind: job.kind,
    appName: job.appName,
    appId: job.appId,
    versionCode: job.versionCode,
    state: job.state,
    step: job.step,
    stepIndex: job.stepIndex,
    stepCount: job.stepCount,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    failedStep: job.failedStep,
    artifact: job.artifact
      ? { fileName: job.artifact.fileName, sizeBytes: job.artifact.sizeBytes, sha256: job.artifact.sha256, inspection: job.artifact.inspection, expiresAt: job.artifact.expiresAt }
      : null,
  };
}
