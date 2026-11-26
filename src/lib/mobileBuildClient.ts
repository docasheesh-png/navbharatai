// The browser's view of the two Android build providers (2026-11-25).
//
// Every server answer enters screen state through a shape check here (the "a server body is not the
// answer until it is checked" rule): a 200 with an unexpected body is shown as a failure, never rendered
// as if it were a build.

import { isRecord } from './serverAnswer';

export type ProviderId = 'native_cloud' | 'github_actions';
export type ArtifactKind = 'apk' | 'aab';
export type BuildState =
  | 'queued' | 'preparing' | 'building' | 'signing' | 'validating' | 'uploading'
  | 'completed' | 'failed' | 'cancelling' | 'cancelled' | 'expired';

const STATES: readonly BuildState[] = ['queued', 'preparing', 'building', 'signing', 'validating', 'uploading', 'completed', 'failed', 'cancelling', 'cancelled', 'expired'];
export const FINISHED: ReadonlySet<BuildState> = new Set(['completed', 'failed', 'cancelled', 'expired']);

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  available: boolean;
  unavailableReason: string | null;
  artifacts: ArtifactKind[];
  requiresGithub: boolean;
  signing: Record<ArtifactKind, string>;
}

export interface Capabilities { providers: ProviderInfo[]; priceInr: number }

export interface Inspection {
  applicationId: string;
  versionCode: number | null;
  versionName: string | null;
  minSdk: number | null;
  targetSdk: number | null;
  abis: string[];
  certSha256: string | null;
  signingType: 'debug' | 'upload_key';
}

export interface BuildView {
  id: string;
  provider: 'native_cloud';
  kind: ArtifactKind;
  appName: string;
  appId: string;
  versionCode: number;
  state: BuildState;
  step: string | null;
  stepIndex: number | null;
  stepCount: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  failedStep: string | null;
  artifact: { fileName: string; sizeBytes: number; sha256: string; inspection: Inspection; expiresAt: string } | null;
}

export interface SigningKeyMeta { appId: string; alias: string; certSha256: string; source: 'imported' | 'generated'; createdAt: string; lastUsedAt: string | null }

const str = (v: unknown): v is string => typeof v === 'string';
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const numOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
const isKind = (v: unknown): v is ArtifactKind => v === 'apk' || v === 'aab';

function isProvider(v: unknown): v is ProviderInfo {
  return isRecord(v) && (v.id === 'native_cloud' || v.id === 'github_actions') && str(v.label) && typeof v.available === 'boolean'
    && strOrNull(v.unavailableReason) && Array.isArray(v.artifacts) && v.artifacts.every(isKind)
    && typeof v.requiresGithub === 'boolean' && isRecord(v.signing) && str(v.signing.apk) && str(v.signing.aab);
}

export function isCapabilities(v: unknown): v is Capabilities {
  return isRecord(v) && Array.isArray(v.providers) && v.providers.length === 2 && v.providers.every(isProvider)
    && typeof v.priceInr === 'number';
}

function isInspection(v: unknown): v is Inspection {
  return isRecord(v) && str(v.applicationId) && numOrNull(v.versionCode) && strOrNull(v.versionName) && numOrNull(v.minSdk)
    && numOrNull(v.targetSdk) && Array.isArray(v.abis) && v.abis.every(str) && strOrNull(v.certSha256)
    && (v.signingType === 'debug' || v.signingType === 'upload_key');
}

export function isBuildView(v: unknown): v is BuildView {
  if (!isRecord(v)) return false;
  const a = v.artifact;
  return str(v.id) && /^nb_[0-9a-f]{32}$/.test(v.id) && v.provider === 'native_cloud' && isKind(v.kind) && str(v.appName) && str(v.appId)
    && typeof v.versionCode === 'number' && STATES.includes(v.state as BuildState) && strOrNull(v.step) && numOrNull(v.stepIndex)
    && numOrNull(v.stepCount) && str(v.createdAt) && strOrNull(v.startedAt) && strOrNull(v.finishedAt) && strOrNull(v.errorCode)
    && strOrNull(v.errorMessage) && strOrNull(v.failedStep)
    && (a === null || (isRecord(a) && str(a.fileName) && typeof a.sizeBytes === 'number' && str(a.sha256) && isInspection(a.inspection) && str(a.expiresAt)));
}

export function isBuildAnswer(v: unknown): v is { build: BuildView } {
  return isRecord(v) && isBuildView(v.build);
}

export function isHistoryAnswer(v: unknown): v is { builds: BuildView[] } {
  return isRecord(v) && Array.isArray(v.builds) && v.builds.every(isBuildView);
}

function isKeyMeta(v: unknown): v is SigningKeyMeta {
  return isRecord(v) && str(v.appId) && str(v.alias) && str(v.certSha256) && (v.source === 'imported' || v.source === 'generated')
    && str(v.createdAt) && strOrNull(v.lastUsedAt);
}

export function isKeyAnswer(v: unknown): v is { key: SigningKeyMeta | null } {
  return isRecord(v) && (v.key === null || isKeyMeta(v.key));
}

export interface KeyBackup { base64: string; storePassword: string; keyAlias: string; sha256Fingerprint: string; validUntil: string }

export function isGeneratedKeyAnswer(v: unknown): v is { key: SigningKeyMeta; backup: KeyBackup } {
  return isRecord(v) && isKeyMeta(v.key) && isRecord(v.backup) && str(v.backup.base64) && str(v.backup.storePassword)
    && str(v.backup.keyAlias) && str(v.backup.sha256Fingerprint) && str(v.backup.validUntil);
}

export function isLogsAnswer(v: unknown): v is { lines: string[]; failedStep: string | null } {
  return isRecord(v) && Array.isArray(v.lines) && v.lines.every(str) && strOrNull(v.failedStep);
}

// ── Presentation helpers (pure) ───────────────────────────────────────────────────────────────────

const ANDROID_VERSION: Record<number, string> = {
  21: '5.0', 22: '5.1', 23: '6.0', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11',
  31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16',
};

/** "Android 6.0 (API 23)" — or just the API level when the name is not known. */
export function androidVersionLabel(api: number | null): string {
  if (api === null) return 'Unknown';
  return ANDROID_VERSION[api] ? `Android ${ANDROID_VERSION[api]} (API ${api})` : `API ${api}`;
}

/**
 * Which phones' processors the file supports. An app with no native code runs on every processor
 * architecture; one with native libraries runs only on the ones it ships. Never "works on every phone" —
 * the minimum Android version still applies.
 */
export function architectureLabel(abis: string[]): string {
  if (abis.length === 0) return 'All processor types (no native code)';
  return abis.join(', ');
}

/** The user-facing name of each real state, in the order a build moves through them. */
export function stateLabel(s: BuildState): string {
  switch (s) {
    case 'queued': return 'Waiting for a build machine';
    case 'preparing': return 'Preparing your app';
    case 'building': return 'Compiling your Android app';
    case 'signing': return 'Signing your bundle';
    case 'validating': return 'Checking your app file';
    case 'uploading': return 'Saving your file';
    case 'completed': return 'Ready to download';
    case 'failed': return 'Build failed';
    case 'cancelling': return 'Stopping';
    case 'cancelled': return 'Stopped';
    case 'expired': return 'Expired';
  }
}

/** Progress only where it is real: the worker's own step counter. Never 100 before the file exists. */
export function realProgress(b: BuildView): number | null {
  if (b.state === 'completed') return 100;
  if (b.state === 'signing' || b.state === 'validating' || b.state === 'uploading') return 95;
  if (b.state !== 'building' || !b.stepIndex || !b.stepCount) return null;
  return Math.min(90, Math.round(((b.stepIndex - 1) / b.stepCount) * 90));
}

/** A fresh request id: one per press of "Build", reused if the same press is retried. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const PROVIDER_PREF_KEY = 'nbai.androidBuildProvider';

export function readProviderPreference(storage: Pick<Storage, 'getItem'> | null): ProviderId | null {
  try {
    const v = storage?.getItem(PROVIDER_PREF_KEY);
    return v === 'native_cloud' || v === 'github_actions' ? v : null;
  } catch {
    return null;
  }
}
