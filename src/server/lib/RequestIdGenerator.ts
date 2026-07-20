// Roadmap breadth — request-id / correlation-id recipe.
//
// The observability trio (logging, tracing, metrics) already exists; the missing primitive is a stable
// CORRELATION ID per request. This middleware reuses an incoming X-Request-Id (from an upstream proxy/gateway)
// or mints a fresh UUID, attaches it to req.id, and echoes it on the response — so every log line and every
// downstream call for one request can carry the same id and be stitched together. Dependency-free (node:crypto
// randomUUID). Pure builder → the caller writes the file. No API key.

export const REQUEST_ID_LIB_SOURCE = `import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// Correlation id per request. Mount this FIRST, before your logger, so every log line for a request shares
// one id. It reuses a trusted incoming header (e.g. from your load balancer) or generates a UUID, puts it on
// req.id, and echoes it back on the response header so a client/downstream can report the same id.

// Augment Express's Request so req.id is typed across your app.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export interface RequestIdOptions {
  /** Header to read an existing id from and to echo on the response. Default 'X-Request-Id'. */
  header?: string;
  /** Trust an inbound id from the client/proxy? Default true. Set false to ALWAYS mint a fresh id
   *  (safer when the header is attacker-controllable and you don't sit behind a trusted proxy). */
  trustInbound?: boolean;
  /** Custom id generator. Default randomUUID(). */
  generate?: () => string;
}

// A request id must be a sane, log-safe token — never trust an arbitrary header value verbatim.
function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._-]+$/.test(value);
}

/** Express middleware that assigns req.id and echoes it on the response header. */
export function requestId(opts: RequestIdOptions = {}) {
  const header = opts.header ?? 'X-Request-Id';
  const headerLower = header.toLowerCase();
  const trustInbound = opts.trustInbound !== false;
  const gen = opts.generate ?? randomUUID;

  return (req: Request, res: Response, next: NextFunction): void => {
    let id: string | undefined;
    if (trustInbound) {
      const raw = req.headers[headerLower];
      const candidate = Array.isArray(raw) ? raw[0] : raw;
      if (isSafeId(candidate)) id = candidate;
    }
    if (!id) id = gen();
    req.id = id;
    res.setHeader(header, id);
    next();
  };
}
`;

export interface RequestIdConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Correlation-id middleware wired at server/lib/requestId.ts (dependency-free node:crypto). Mount it FIRST — ' +
  'app.use(requestId()) — before your logger, so every log line for a request shares one id (req.id) and it is ' +
  'echoed on the response X-Request-Id header. It reuses a trusted inbound id (set trustInbound:false to always ' +
  'mint a fresh one when the header is client-controllable) or generates a UUID; an unsafe/oversized header value ' +
  'is ignored. Pairs with the logging/tracing recipes so one request is traceable end to end. No dependency, no key.';

export function generateRequestIdIntegration(): RequestIdConfig {
  return {
    files: { 'server/lib/requestId.ts': REQUEST_ID_LIB_SOURCE },
    dependencies: [],
    instructions: INSTRUCTIONS,
  };
}
