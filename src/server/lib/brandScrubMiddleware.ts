// WHITE-LABEL BACKSTOP (owner, 2026-10-30): whatever a route forgot, a user-facing API response
// never names a backend vendor/model. Two narrow hooks, on non-admin /api routes only:
//   • res.json for an ERROR status (>= 400): user-visible fields scrubbed (answers are 2xx, untouched);
//   • res.write stream lines that are error / status / stage events (NDJSON or SSE `data:`), never
//     answer content (`c` / token deltas), so a user asking "what is OpenAI?" still gets a real answer.
// The real error is still logged by each route; admin routes keep real names.
import type { Request, Response, NextFunction } from 'express';
import { mentionsVendorBrand, scrubVendorBrandsInPayload } from '../../shared/brandScrub';

const STREAM_EVENT_TYPES = new Set(['error', 'stage', 'status', 'result', 'warning', 'notice', 'failure']);

export function isAdminPath(path: string): boolean {
  return /^\/api\/(?:admin|internal|ops)(?:\/|$|-)/i.test(path) || /\/admin(?:\/|$)/i.test(path);
}

function scrubJsonLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !mentionsVendorBrand(trimmed)) return line;
  try {
    const obj = JSON.parse(trimmed);
    if (!obj || typeof obj !== 'object') return line;
    const isEvent = typeof obj.type === 'string' && STREAM_EVENT_TYPES.has(obj.type);
    const isStatus = 's' in obj || 'error' in obj || 'code' in obj;
    if (!isEvent && !isStatus) return line;
    if (obj.type === 'result' && obj.ok !== false) return line;
    const lead = line.slice(0, line.indexOf('{'));
    const tail = line.slice(line.lastIndexOf('}') + 1);
    return lead + JSON.stringify(scrubVendorBrandsInPayload(obj)) + tail;
  } catch { return line; }
}

/** Scrub error/status events inside one stream chunk (NDJSON lines or SSE `data: {…}` lines). */
export function scrubStreamChunk(chunk: string): string {
  if (!mentionsVendorBrand(chunk)) return chunk;
  return chunk.split('\n').map((line) => {
    const m = /^(data:\s*)(\{.*\})\s*$/.exec(line);
    if (m) return m[1] + scrubJsonLine(m[2]);
    return scrubJsonLine(line);
  }).join('\n');
}

export function brandScrubMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path || req.url || '';
    if (!path.startsWith('/api') || isAdminPath(path)) return next();
    const origJson = res.json.bind(res);
    res.json = ((body: unknown) => origJson(res.statusCode >= 400 ? scrubVendorBrandsInPayload(body) : body)) as Response['json'];
    const origWrite = res.write.bind(res) as (...a: unknown[]) => boolean;
    (res as unknown as { write: (...a: unknown[]) => boolean }).write = (chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === 'string') chunk = scrubStreamChunk(chunk);
      return origWrite(chunk, ...rest);
    };
    next();
  };
}
