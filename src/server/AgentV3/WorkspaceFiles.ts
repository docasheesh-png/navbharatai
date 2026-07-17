// AgentV3 — collect a built app's source files from the sandbox into a deploy-ready
// map (§12.2). Reuses the EXISTING deploy + git backend: the returned
// `Record<path, content>` is exactly what `/api/pro/deploy` (Vercel/Netlify/
// Cloudflare/GitHub Pages) and `/api/github/push-enhanced` already accept — so v5.0
// gets durable deploy + git push without rebuilding any deployment code.
//
// PURE over a minimal actuator shape (listFiles + readFile) so it is fully unit-
// testable. Mirrors the security filtering of the ZIP export / GitHub push paths:
// never ships node_modules, build output, .git, or live .env secrets; binary and
// oversized files are skipped (a deploy is source/text).

/** The minimal slice of the sandbox actuator this collector needs. */
export interface WorkspaceFileSource {
  listFiles(workspaceId: string): Promise<string[]>;
  readFile(workspaceId: string, filePath: string): Promise<string>;
}

/** The minimal slice of the sandbox actuator the importer needs. */
export interface WorkspaceFileSink {
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
}

export interface CollectedFiles {
  files: Record<string, string>;
  /** Paths intentionally skipped (excluded dir, secret, binary, or too large). */
  skipped: string[];
}

export interface ImportedFiles {
  /** Paths successfully written into the sandbox. */
  written: string[];
  /** Paths rejected (unsafe path, excluded, secret, or too large). */
  skipped: string[];
}

// Raised 4000 → 16000 so a Mitrify-scale (and up to ~50×) imported/collected app is not truncated
// (the "handle a huge app" goal). The 120 MB total-bytes ceiling is the real memory guard and
// usually binds first; the file count is the hard backstop.
const MAX_FILES = 16000;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024; // 120 MB — same ceiling as the ZIP export.
const MAX_FILE_BYTES = 5 * 1024 * 1024;     // 5 MB per text file — larger is almost certainly an asset.

// Directories that must never be deployed/pushed (dependencies, build output, VCS).
const EXCLUDED_DIR = /(^|\/)(node_modules|\.git|dist|build|\.next|\.nuxt|\.cache|\.turbo|coverage|\.vercel|\.netlify)(\/|$)/;

// Live secret files — excluded. Templates (.env.example/.sample/.template) are KEPT
// so the deployed/pushed project still documents the variables it needs.
const SECRET_ENV = /(^|\/)\.env(\.[\w-]+)?$/i;
const ENV_TEMPLATE = /(^|\/)\.env\.(example|sample|template)$/i;

// A NUL byte is the standard heuristic for "this is binary, not source text".
const NUL = String.fromCharCode(0);

function isExcludedPath(path: string): boolean {
  if (EXCLUDED_DIR.test(path)) return true;
  if (SECRET_ENV.test(path) && !ENV_TEMPLATE.test(path)) return true;
  return false;
}

function looksBinary(content: string): boolean {
  return content.includes(NUL);
}

/**
 * Read every deploy-eligible source file from the sandbox into a path→content map.
 * Best-effort: a file that fails to read is skipped, never fatal. Bounded by file
 * count and total size so one runaway workspace cannot exhaust memory.
 */
export async function collectWorkspaceFiles(
  source: WorkspaceFileSource,
  workspaceId: string,
): Promise<CollectedFiles> {
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  const all = await source.listFiles(workspaceId);

  let totalBytes = 0;
  for (const path of all) {
    if (Object.keys(files).length >= MAX_FILES) {
      skipped.push(path);
      continue;
    }
    if (isExcludedPath(path)) {
      skipped.push(path);
      continue;
    }
    let content: string;
    try {
      content = await source.readFile(workspaceId, path);
    } catch {
      skipped.push(path);
      continue;
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES || looksBinary(content)) {
      skipped.push(path);
      continue;
    }
    if (totalBytes + bytes > MAX_TOTAL_BYTES) {
      skipped.push(path);
      continue;
    }
    totalBytes += bytes;
    files[path] = content;
  }

  return { files, skipped };
}

/**
 * A path is safe to import only if it stays inside the workspace: no absolute
 * paths, no `..` traversal, no NUL, and not a dependency/build/VCS dir or a live
 * `.env` secret. Templates (`.env.example` etc.) are allowed.
 */
function isSafeImportPath(path: string): boolean {
  if (!path || path.includes(NUL)) return false;
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) return false; // absolute
  const segments = path.split(/[\\/]/);
  if (segments.some((s) => s === '..')) return false;                     // traversal
  if (EXCLUDED_DIR.test(path)) return false;
  if (SECRET_ENV.test(path) && !ENV_TEMPLATE.test(path)) return false;
  return true;
}

/**
 * Write an imported project (e.g. fetched from GitHub via the existing
 * `/api/github/fetch` route) into the v5.0 sandbox so the agent can edit/update and
 * then deploy/push it back. Best-effort + bounded: an unsafe path or a failed write
 * is skipped, never fatal. Reuses the same size/exclusion guards as the collector.
 */
export async function writeWorkspaceFiles(
  sink: WorkspaceFileSink,
  workspaceId: string,
  files: Record<string, string>,
): Promise<ImportedFiles> {
  const written: string[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  for (const [path, content] of Object.entries(files)) {
    if (written.length >= MAX_FILES) {
      skipped.push(path);
      continue;
    }
    if (!isSafeImportPath(path) || typeof content !== 'string') {
      skipped.push(path);
      continue;
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) {
      skipped.push(path);
      continue;
    }
    try {
      await sink.writeFile(workspaceId, path, content);
    } catch {
      skipped.push(path);
      continue;
    }
    written.push(path);
    totalBytes += bytes;
  }

  return { written, skipped };
}
