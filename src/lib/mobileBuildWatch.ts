/** Polling can outlive a runner's 30-minute job while GitHub queues it. */
export const MOBILE_BUILD_WATCH_MS = 60 * 60 * 1000;

export interface MobileBuildRun {
  id: number;
  status: string;
  conclusion: string | null;
  url: string;
  branch?: string;
  event?: string;
  createdAt?: string;
  displayTitle?: string;
}

export interface MobileBuildArtifact { id: number; name: string; sizeBytes: number }

export interface MobileBuildIdentity {
  seen: ReadonlySet<number>;
  dispatchedAt: number;
  requestId?: string;
  runId?: number;
  pending?: boolean;
}

export function mobileBuildDispatchTime(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Keep the deadline through body consumption, not just until the response headers arrive. */
async function readMobileBuildResponse<T>(url: string, init: RequestInit, timeoutMs: number, read: (response: Response, signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await read(response, controller.signal);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

/** Bound both the response headers and JSON body, so one hung read cannot defeat the watch deadline. */
export function fetchMobileBuildJson(url: string, init: RequestInit = {}, timeoutMs = 45_000): Promise<{ response: Response; data: any }> {
  return readMobileBuildResponse(url, init, timeoutMs, async (response, signal) => {
    const data = await response.json().catch((error) => {
      if (signal.aborted) throw error;
      return null;
    });
    return { response, data };
  });
}

/** Preserve the actual output format; an artifact called release-aab must never save as an APK. */
export function mobileBuildFileName(disposition: string | null, artifactName: string): string {
  let headerName = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (headerName) {
    try { headerName = decodeURIComponent(headerName); } catch { headerName = undefined; }
  }
  headerName ??= disposition?.match(/filename="([^"]+)"/i)?.[1]
    ?? disposition?.match(/filename=([^;]+)/i)?.[1]?.trim();
  const candidate = (headerName || artifactName).split(/[/\\]/).pop() || '';
  if (/\.(apk|aab|ipa)$/i.test(candidate)) {
    return candidate.replace(/[\u0000-\u001f:*?"<>|]/g, '-').replace(/^\.+/, '') || 'app-release.apk';
  }
  return /aab/i.test(artifactName) ? 'app-release.aab'
    : /ipa/i.test(artifactName) ? 'App.ipa'
    : /debug/i.test(artifactName) ? 'app-debug.apk' : 'app-release.apk';
}

/** An HTTP 200 with an empty body or an HTML proxy page is not a downloadable Android app. */
export function fetchMobileBuildFile(url: string, init: RequestInit, artifactName: string, timeoutMs = 5 * 60 * 1000): Promise<{ response: Response; blob: Blob; filename: string }> {
  return readMobileBuildResponse(url, init, timeoutMs, async (response, signal) => {
    if (!response.ok) {
      const data = await response.json().catch((error) => {
        if (signal.aborted) throw error;
        return null;
      });
      throw new Error(data?.error || 'Could not download the app file. Please try again.');
    }
    const blob = await response.blob();
    const prefix = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    // APK, AAB and IPA are ZIP containers. Reject obvious broken transfers before saving a fake app.
    if (blob.size < 4 || prefix[0] !== 0x50 || prefix[1] !== 0x4b || prefix[2] !== 3 || prefix[3] !== 4) {
      throw new Error('The app download was incomplete or invalid. Please download it again.');
    }
    return { response, blob, filename: mobileBuildFileName(response.headers.get('content-disposition'), artifactName) };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The app download took too long or was cancelled. Please try again.');
    }
    throw error;
  });
}

/** Ignore diagnostic archives and zero-byte uploads when deciding whether a built app is ready. */
export function usableMobileBuildArtifacts(value: unknown): MobileBuildArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is MobileBuildArtifact => !!a && Number.isSafeInteger(a.id) && a.id > 0
    && typeof a.sizeBytes === 'number' && a.sizeBytes > 0 && typeof a.name === 'string' && /apk|aab|ipa/i.test(a.name));
}

/** Keep watching the selected run even when a newer run arrives in the list. */
export function selectMobileBuildRun(
  runs: MobileBuildRun[],
  seen: ReadonlySet<number>,
  expected: { branch: string; dispatchedAt: number; runId?: number; requestId?: string },
): MobileBuildRun | undefined {
  return runs.find((run) => {
    if (expected.runId !== undefined) return run.id === expected.runId;
    if (seen.has(run.id)) return false;
    if (run.branch && run.branch !== expected.branch) return false;
    if (run.event && run.event !== 'workflow_dispatch') return false;
    // The server accepted this identifier and the workflow repeats it. Device clock skew must not
    // reject an exact match; timestamps are only a fallback for older workflows without correlation.
    if (expected.requestId) return !!run.displayTitle?.includes(expected.requestId);
    const createdAt = Date.parse(run.createdAt || '');
    // GitHub timestamps have second precision.
    if (Number.isFinite(createdAt) && createdAt < expected.dispatchedAt - 1000) return false;
    return true;
  });
}

/** A dispatch whose response has not arrived cannot safely be cancelled by picking a recent run. */
export async function findMobileBuildToCancel(
  active: MobileBuildIdentity,
  branch: string,
  load: () => Promise<MobileBuildRun[]>,
): Promise<number | undefined> {
  if (active.pending) return undefined;
  if (active.runId !== undefined) return active.runId;
  return selectMobileBuildRun(await load(), active.seen, { branch, ...active })?.id;
}

const ARTIFACT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/** A completed job can precede artifact visibility; retry reads without starting another build. */
export async function collectMobileBuildArtifacts(
  load: () => Promise<MobileBuildArtifact[]>,
  kind: 'apk' | 'aab',
  isActive: () => boolean,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<MobileBuildArtifact[] | null> {
  let lastError = new Error('The build finished, but its app file is not available yet. Retry collecting it in a moment.');
  for (let attempt = 0; attempt <= ARTIFACT_DELAYS_MS.length; attempt++) {
    if (!isActive()) return null;
    try {
      const artifacts = await load();
      if (!isActive()) return null;
      const usable = usableMobileBuildArtifacts(artifacts);
      if (usable.some((a) => a.name.toLowerCase().includes(kind))) return usable;
    } catch (error) {
      if (error instanceof Error) lastError = error;
    }
    if (attempt < ARTIFACT_DELAYS_MS.length) await pause(ARTIFACT_DELAYS_MS[attempt]);
  }
  if (!isActive()) return null;
  throw lastError;
}
