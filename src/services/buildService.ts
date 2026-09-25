/**
 * Build Service — typed frontend client for the engine-backed build/preview API.
 *
 * What remains after the legacy build engine was retired (2026-09-25): the read side of the old
 * build sessions and version history, and the preview helpers. Every build runs in NavBharatAI Pro.
 *   - GET  /api/build-session/:id → a build saved by the retired engine, if any
 *   - GET  /api/build-history/…   → version checkpoints (still written by AgentV3)
 *   - POST /api/preview           → start a live preview for a set of files
 */

export interface ProjectIssue {
  severity: 'error' | 'warning';
  file: string;
  message: string;
}

export interface VerifyReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ProjectIssue[];
}

/** G5 — Structured code review result returned alongside every new build. */
export interface ReviewFinding {
  file: string;
  line?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'security' | 'quality' | 'performance' | 'tech_debt' | 'accessibility';
  description: string;
  fix: string;
}

export interface CodeReviewResult {
  findings: ReviewFinding[];
  summary: string;
  score: number;
  techDebt: string[];
}

export interface PreviewInfo {
  ok: boolean;
  target: 'static' | 'webcontainer' | 'server-container';
  url?: string;
  sessionId?: string;
  reason?: string;
}

export interface GateResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'pending';
  severity: 'critical' | 'major' | 'minor';
  messages: string[];
}

export interface ValidationReport {
  previewAllowed: boolean;
  qualityScore: number;
  gates: GateResult[];
  blockingReasons: string[];
  status: 'PASSED' | 'FAILED' | 'PARTIAL';
}

export interface BuildResponse {
  ok: boolean;
  files: Record<string, string>;
  fileCount: number;
  applied: number;
  failed: number;
  verify: VerifyReport;
  repairAttempts: number;
  baselineSnapshotId: string;
  /** Structured validation report (gates + quality score + preview decision). */
  validation?: ValidationReport;
  /** Preview is a privilege — only true when critical gates pass. */
  previewAllowed?: boolean;
  preview?: PreviewInfo;
  /** G3 — Which execution tier produced this build. */
  tier?: 'vfs' | 'cloudrun' | 'e2b';
  /** G5 — AI code review: security, quality, and tech debt findings. */
  codeReview?: CodeReviewResult;
  /** Phase 4.2 — estimated AI cost for this build (Grok rate-card estimate). */
  costUsd?: number;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

/** G1.2 — Fetch the last completed build result for a sessionId (null if not found). */
export async function fetchBuildSession(sessionId: string): Promise<BuildResponse | null> {
  try {
    const res = await fetch(`/api/build-session/${encodeURIComponent(sessionId)}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json() as BuildResponse;
  } catch {
    return null;
  }
}

/** Start a live preview for a set of files (routes to static / server-container). */
export function startPreview(files: Record<string, string>, projectId = 'project'): Promise<PreviewInfo> {
  return postJson<PreviewInfo>('/api/preview', { projectId, files });
}

/** URL to embed a built static preview in an iframe. */
export function previewIframeSrc(sessionId: string): string {
  return `/preview/${sessionId}`;
}

/**
 * Resolve the right iframe src for a preview result, regardless of runtime:
 *   - static          → /preview/:id (self-contained HTML, incl. in-browser React)
 *   - server-container → /preview-app/:id/ (reverse-proxied dev server)
 * Returns null when there is nothing embeddable (e.g. webcontainer not provisioned).
 */
export function previewSrcFor(preview: PreviewInfo | undefined): string | null {
  if (!preview || !preview.ok || !preview.sessionId) return null;
  if (preview.target === 'static') return `/preview/${preview.sessionId}`;
  if (preview.target === 'server-container') return `/preview-app/${preview.sessionId}/`;
  return preview.url || null;
}

// Phase 2.1 — Version history types and API calls.

export interface VersionMeta {
  id: string;
  sessionId: string;
  commitMessage: string;
  createdAt: string;
  fileCount: number;
  isEdit: boolean;
  tier?: string;
  ok: boolean;
}

export interface VersionEntry extends VersionMeta {
  files: Record<string, string>;
}

/** List all version checkpoints for a workspace (metadata only, newest first). */
export async function listBuildHistory(sessionId: string): Promise<VersionMeta[]> {
  try {
    const res = await fetch(`/api/build-history/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.versions || []) as VersionMeta[];
  } catch {
    return [];
  }
}

/** Fetch a specific version with its full file snapshot. */
export async function fetchBuildVersion(sessionId: string, versionId: string): Promise<VersionEntry | null> {
  try {
    const res = await fetch(`/api/build-history/${encodeURIComponent(sessionId)}/${encodeURIComponent(versionId)}`);
    if (!res.ok) return null;
    return await res.json() as VersionEntry;
  } catch {
    return null;
  }
}
