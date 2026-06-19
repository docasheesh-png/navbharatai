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
}

export interface BuildRequest {
  prompt: string;
  files?: Record<string, string>;
  /** Optional user-supplied model key. */
  userKey?: string;
  /** Also start a live preview of the result. */
  preview?: boolean;
  /** This is an edit of an existing app (skips the fresh-build feature loop). */
  isEdit?: boolean;
  /** Claude-Code-style memory: recent conversation turns. */
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** Rolling fact-dense summary of earlier turns. */
  memorySummary?: string;
  /** Log of changes already made this session. */
  editLog?: string[];
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

/** Build or edit a multi-file app from a prompt via the real engine. */
export function buildApp(req: BuildRequest, signal?: AbortSignal): Promise<BuildResponse> {
  return postJson<BuildResponse>('/api/build', req, signal);
}

/** A live progress event streamed from /api/build-stream. */
export interface BuildStreamEvent {
  type: 'status' | 'module' | 'files' | 'complete' | 'error';
  message?: string;
  name?: string;
  state?: 'start' | 'done' | 'failed';
  coverage?: number;
  paths?: string[];
  // present on the final 'complete' event:
  ok?: boolean;
  files?: Record<string, string>;
  fileCount?: number;
  verify?: VerifyReport;
  validation?: ValidationReport;
  previewAllowed?: boolean;
  preview?: PreviewInfo;
  // Refreshed memory to persist for the next turn (Claude-Code-style):
  memorySummary?: string;
  editLog?: string[];
}

/**
 * Streaming build: module-by-module generation with LIVE progress. Calls
 * `onEvent` for every progress event and resolves with the final 'complete'
 * event. The open SSE connection means large multi-module builds don't hit the
 * gateway 504.
 */
export async function buildAppStream(
  req: BuildRequest,
  onEvent: (ev: BuildStreamEvent) => void,
  signal?: AbortSignal,
): Promise<BuildStreamEvent> {
  const res = await fetch('/api/build-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Build stream failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete: BuildStreamEvent | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let ev: BuildStreamEvent;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      if (ev.type === 'error') throw new Error(ev.message || 'Build failed');
      if (ev.type === 'complete') complete = ev;
      onEvent(ev);
    }
  }
  if (!complete) throw new Error('Build stream ended without a result.');
  return complete;
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
