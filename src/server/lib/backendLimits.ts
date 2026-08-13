/**
 * backendLimits — the per-plan resource caps for MANAGED backend hosting (user backends running on
 * NavBharatAI's own GCP account, "Deploy to NavBharatAI Cloud").
 *
 * WHY THIS MODULE EXISTS BEFORE THE ENGINE: on the managed tier the platform pays the bill, so an
 * uncapped user app is an uncapped invoice — one crypto-miner or infinite-loop app with unlimited
 * autoscaling could burn the month's margin in a night. Every Cloud Run service the engine creates
 * MUST carry these limits; the deploy builders take them as input, they are never optional.
 *
 * The caps are the SPEND CEILING, enforced by Cloud Run itself (maxInstanceCount × cpu × memory is
 * the worst-case parallel burn), not by our request-side accounting — platform-enforced beats
 * self-reported. Request-side rate limiting still applies at the subdomain router as the first,
 * cheapest gate.
 *
 * PURE + deterministic — no I/O, no env — so every consumer (deploy builder, router, UI copy) is
 * unit-testable and cannot disagree about what a plan allows.
 */

/** The managed-backend plan tiers. MVP ships ONE paid tier; the shape is plural so a bigger tier
 * later is an addition, never a migration. */
export type BackendPlanId = 'managed_backend';

export interface BackendLimits {
  /** Cloud Run vCPU limit per instance (string per the v2 API, e.g. "1"). */
  cpu: string;
  /** Cloud Run memory limit per instance, in MiB. */
  memoryMi: number;
  /** Hard autoscale ceiling — THE spend cap. Never 0 (0 means unlimited on some fields elsewhere). */
  maxInstances: number;
  /** Concurrent requests one instance may serve before Cloud Run scales (within maxInstances). */
  concurrency: number;
  /** Max seconds one request may run. Long enough for a slow cold API call, short enough to kill loops. */
  timeoutSeconds: number;
  /** Router-side per-minute request cap per app (first gate, before Cloud Run ever bills). */
  requestsPerMinute: number;
  /** Max total UNCOMPRESSED source size accepted for a deploy, in MiB (tarball guard). */
  maxSourceMi: number;
  /** Max number of files accepted for a deploy. */
  maxSourceFiles: number;
}

const LIMITS: Record<BackendPlanId, BackendLimits> = {
  managed_backend: {
    cpu: '1',
    memoryMi: 512,
    maxInstances: 2,
    concurrency: 80,
    timeoutSeconds: 120,
    requestsPerMinute: 600,
    maxSourceMi: 20,
    maxSourceFiles: 2000,
  },
};

/** The limits for a plan. Unknown ids get the (only) managed tier — never "unlimited by default". */
export function limitsForPlan(plan: string | null | undefined): BackendLimits {
  return LIMITS[(plan as BackendPlanId) ?? 'managed_backend'] ?? LIMITS.managed_backend;
}

/** Cloud Run v2 `resources.limits` object for a plan — the exact API shape, built in one place. */
export function cloudRunResourceLimits(limits: BackendLimits): Record<string, string> {
  return { cpu: limits.cpu, memory: `${limits.memoryMi}Mi` };
}

export interface SourceSizeVerdict {
  ok: boolean;
  /** Honest, user-facing reason when rejected. */
  reason?: string;
  totalBytes: number;
  fileCount: number;
}

/**
 * Validate a deploy's source files against the plan's caps BEFORE any network work. Pure.
 * Rejection messages name the exact number and the exact cap — never a bare "too large".
 */
export function checkSourceSize(
  files: Readonly<Record<string, string>>,
  limits: BackendLimits,
): SourceSizeVerdict {
  const names = Object.keys(files);
  let total = 0;
  for (const n of names) total += Buffer.byteLength(files[n] ?? '', 'utf8');
  const capBytes = limits.maxSourceMi * 1024 * 1024;
  if (names.length > limits.maxSourceFiles) {
    return {
      ok: false, totalBytes: total, fileCount: names.length,
      reason: `Project has ${names.length} files — the managed tier accepts up to ${limits.maxSourceFiles}. Remove build artifacts (node_modules, dist) and retry.`,
    };
  }
  if (total > capBytes) {
    const mi = (total / (1024 * 1024)).toFixed(1);
    return {
      ok: false, totalBytes: total, fileCount: names.length,
      reason: `Project source is ${mi} MiB — the managed tier accepts up to ${limits.maxSourceMi} MiB. Remove large assets and retry.`,
    };
  }
  return { ok: true, totalBytes: total, fileCount: names.length };
}

/**
 * Paths that must NEVER ship in a deploy tarball, whatever the client sends: installed deps get
 * rebuilt by the container build (shipping them poisons cross-platform binaries), VCS internals and
 * env files leak secrets. Matched on any path segment. Pure.
 */
const FORBIDDEN_SEGMENTS = new Set(['node_modules', '.git', '.env', '.env.local', '.env.production']);

export function stripForbiddenFiles(
  files: Readonly<Record<string, string>>,
): { kept: Record<string, string>; dropped: string[] } {
  const kept: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const segments = path.split('/');
    if (segments.some((s) => FORBIDDEN_SEGMENTS.has(s))) dropped.push(path);
    else kept[path] = content;
  }
  return { kept, dropped };
}
