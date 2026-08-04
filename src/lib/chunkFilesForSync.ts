// ROOT-CAUSE FIX (large zip import silently vanishing, report 2026-07-27): `syncFilesToV3`
// used to send an entire extracted project's file map as ONE JSON POST body. Express's
// `express.json({limit:'30mb'})` (server.ts) and Cloud Run's ~32MB inbound cap reject that
// request outright once the extracted text content crosses ~30MB — which any real app's
// unpacked source does easily, regardless of whether the original ZIP was 100MB or 1GB. The
// request never reached the server, and the failure was swallowed silently (`.catch(() => {})`),
// so the user saw "upload complete" while nothing landed in the workspace.
//
// The structural fix: never put an unbounded payload inside one JSON body. Splitting the file
// map into bounded chunks turns one guaranteed-to-fail giant request into many small requests
// that each comfortably clear the body-size ceiling, regardless of total project size.

const encoder = new TextEncoder();

function byteLength(s: string): number {
  return encoder.encode(s).length;
}

/** Stay well under the server's 30MB JSON body limit, leaving headroom for JSON string escaping. */
export const IMPORT_SYNC_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Split a path→content file map into chunks whose combined raw byte size stays under `maxBytes`.
 * A single file larger than the budget gets its own chunk rather than being dropped. Pure,
 * deterministic, order-preserving. Returns [] for an empty/absent input.
 */
export function chunkFilesForSync(
  files: Record<string, string> | null | undefined,
  maxBytes: number = IMPORT_SYNC_CHUNK_BYTES,
): Record<string, string>[] {
  const entries = Object.entries(files || {}).filter(([, c]) => typeof c === 'string');
  if (entries.length === 0) return [];
  const chunks: Record<string, string>[] = [];
  let current: Record<string, string> = {};
  let currentBytes = 0;
  for (const [path, content] of entries) {
    const size = byteLength(content) + byteLength(path);
    if (currentBytes > 0 && currentBytes + size > maxBytes) {
      chunks.push(current);
      current = {};
      currentBytes = 0;
    }
    current[path] = content;
    currentBytes += size;
  }
  if (Object.keys(current).length > 0) chunks.push(current);
  return chunks;
}

/** Total raw byte size of a file map's content (used to decide when a GitHub backstop applies). */
export function totalFilesBytes(files: Record<string, string> | null | undefined): number {
  let total = 0;
  for (const [path, content] of Object.entries(files || {})) {
    if (typeof content === 'string') total += byteLength(content) + byteLength(path);
  }
  return total;
}
