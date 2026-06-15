/**
 * Build Service — typed frontend client for the engine-backed build/preview API.
 *
 * Wraps the Phase 3/4 endpoints so the Pro UI can drive the real engine
 * (VFS + EditEngine + Verifier + RepairLoop + hybrid preview) instead of the
 * legacy fire-and-forget full-rewrite flow:
 *   - POST /api/build   → generate/edit a multi-file app from a prompt
 *   - POST /api/preview → start a live preview for a set of files
 *
 * Additive: existing call sites are untouched; UI can migrate incrementally.
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

export interface PreviewInfo {
  ok: boolean;
  target: 'static' | 'webcontainer' | 'server-container';
  url?: string;
  sessionId?: string;
  reason?: string;
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
  preview?: PreviewInfo;
}

export interface BuildRequest {
  prompt: string;
  files?: Record<string, string>;
  /** Optional user-supplied model key. */
  userKey?: string;
  /** Also start a live preview of the result. */
  preview?: boolean;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

/** Build or edit a multi-file app from a prompt via the real engine. */
export function buildApp(req: BuildRequest): Promise<BuildResponse> {
  return postJson<BuildResponse>('/api/build', req);
}

/** Start a live preview for a set of files (routes to static / server-container). */
export function startPreview(files: Record<string, string>, projectId = 'project'): Promise<PreviewInfo> {
  return postJson<PreviewInfo>('/api/preview', { projectId, files });
}

/** URL to embed a built static preview in an iframe. */
export function previewIframeSrc(sessionId: string): string {
  return `/preview/${sessionId}`;
}
