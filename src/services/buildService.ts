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
  /** Opt into the agentic edit engine for this request (Phase-1 rollout flag). */
  agentic?: boolean;
  /**
   * Phase 85 — Design-to-Code: base64-encoded design images (Figma exports,
   * screenshots, mockups). Claude vision analyzes the images and generates UI code
   * that matches the design layout and style.
   */
  designImages?: string[];
  /** G3 — User's personal E2B API key; unlocks real cloud VM execution (billed to user). */
  userE2bKey?: string;
  /** G3 — GitHub token from Settings → Connections; lets the agent clone/push repos. */
  githubToken?: string;
  /** G3 — DB credentials from Settings → Database; injected into the agent sandbox. */
  dbConfig?: { provider: string; credentials: Record<string, string> };
  /** G1.2 — Stable session ID so the server can persist + restore build results. */
  sessionId?: string;
  /** Phase 4.2 — Firebase UID of the authenticated user (for per-user cost tracking). */
  userId?: string;
}

/**
 * Internal-testing opt-in for the agentic edit engine (Phase-1 rollout).
 * Enabled ONLY for the current browser/session — never for all users — via either
 * a `?agentic=1` URL param or `localStorage.nb_agentic_engine = '1'`. This lets an
 * admin exercise the new engine on the live site while everyone else keeps the
 * existing pipeline untouched. The server still falls back transparently on any
 * engine error, so this is safe to leave on.
 */
export function isAgenticEngineEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('agentic');
    if (q === '1' || q === 'true') return true;
    if (q === '0' || q === 'false') return false;
    return window.localStorage.getItem('nb_agentic_engine') === '1';
  } catch {
    return false;
  }
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

/** A live progress event streamed from /api/build-stream. */
export interface BuildStreamEvent {
  type: 'status' | 'module' | 'files' | 'file' | 'complete' | 'error' | 'terminal' | 'preview_url' | 'plan' | 'plan_step_start' | 'plan_step_done' | 'thinking' | 'screenshot' | 'providers_unavailable';
  message?: string;
  name?: string;
  state?: 'start' | 'done' | 'failed';
  coverage?: number;
  paths?: string[];
  // file event (G12 — real-time file content as agent writes each file)
  fileName?: string;
  // terminal event (Phase 7 — real bash output from E2B sandbox)
  command?: string;
  output?: string;
  exitCode?: number;
  // preview_url event (Phase 10 — real E2B dev server URL)
  url?: string;
  // plan events (Phase 68 — PlannerAgent step visibility)
  steps?: string[];
  stepIndex?: number;
  description?: string;
  // thinking event (Phase 69 — CoT step-by-step reasoning visible in UI)
  content?: string;
  // screenshot event (Phase 79 — live preview screenshot from E2B browser)
  base64?: string;
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
  /** True when the build was cut short by the server soft deadline — the files are
   *  real but incomplete, so the client can auto-continue for a full result. */
  partial?: boolean;
  /** G3 — Which execution tier ran this build: in-memory VFS, server container, or E2B cloud VM. */
  tier?: 'vfs' | 'cloudrun' | 'e2b';
  /** G5 — AI code review: security, quality, and tech debt findings for new builds. */
  codeReview?: CodeReviewResult;
  /** Phase 4.2 — estimated AI cost for this build (Grok rate-card estimate). */
  costUsd?: number;
  /** Phase 5.5 — when all AI providers are down, how long to wait before retrying (ms). */
  retryAfterMs?: number;
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
  // Attach the Firebase ID token so the server can attribute build cost/history to the
  // VERIFIED identity (it no longer trusts a userId body field). Dynamic import keeps this
  // module free of firebase at load time (unit tests import it without initializing auth).
  // Best-effort: a signed-out user simply builds anonymously (unattributed), as before.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { auth } = await import('../lib/firebase');
    const tok = await auth.currentUser?.getIdToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } catch { /* best-effort — anonymous build still proceeds */ }
  const res = await fetch('/api/build-stream', {
    method: 'POST',
    headers,
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
