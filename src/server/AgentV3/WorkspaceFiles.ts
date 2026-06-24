// AgentV3 — collect a built app's source files from the sandbox into a deploy-ready
// map (§12.2). Reuses the EXISTING deploy + git backend: the returned
// `Record<path, content>` is exactly what `/api/pro/deploy` (Vercel/Netlify/
// Cloudflare/GitHub Pages) and `/api/github/push-enhanced` already accept — so v3.0
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

export interface CollectedFiles {
  files: Record<string, string>;
  /** Paths intentionally skipped (excluded dir, secret, binary, or too large). */
  skipped: string[];
}

const MAX_FILES = 4000;
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
