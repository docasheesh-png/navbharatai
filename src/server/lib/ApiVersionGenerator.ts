// Roadmap breadth — API versioning recipe.
//
// A real need for any app that exposes an API to clients it doesn't control: evolve the API without breaking
// existing callers. This emits a dependency-free Express middleware that resolves the requested API version
// from a header (X-API-Version, or the standard Accept-Version), validates it against the supported list
// (406 with the supported versions when unknown), falls back to a default, and echoes the resolved version.
// Pure builder → the caller writes the file. No API key, no dependency.

export const API_VERSION_LIB_SOURCE = `import type { Request, Response, NextFunction } from 'express';

// API versioning: resolve the version a client asked for and validate it, so you can run v1 and v2 handlers
// side by side and retire old ones deliberately. Reads X-API-Version (or the standard Accept-Version) header;
// falls back to the default when the client sends none; rejects an unknown version with 406 + the list of
// supported versions. The resolved version is on req.apiVersion and echoed on the response.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiVersion?: string;
    }
  }
}

export interface ApiVersionOptions {
  /** The versions the app currently serves, e.g. ['1','2'] or ['2024-01','2024-06']. Required, non-empty. */
  supported: string[];
  /** Primary header to read. Default 'X-API-Version'. The standard 'Accept-Version' is always read as a fallback. */
  header?: string;
  /** Version used when the client sends none. Default: the first supported version. */
  default?: string;
}

function normalize(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  // Accept "v2" or "2"; trim and drop a leading v/V.
  return String(raw ?? '').trim().replace(/^v/i, '');
}

/** Express middleware. Mount it before your versioned routers; branch on req.apiVersion in a handler,
 *  or mount separate routers and read req.apiVersion for logging/metrics. */
export function apiVersion(opts: ApiVersionOptions) {
  const supported = (opts.supported || []).map((v) => normalize(v)).filter(Boolean);
  if (supported.length === 0) throw new Error('apiVersion: supported must be a non-empty array');
  const primary = (opts.header ?? 'X-API-Version').toLowerCase();
  const fallbackDefault = opts.default != null ? normalize(opts.default) : supported[0];

  return (req: Request, res: Response, next: NextFunction): void => {
    const sent = normalize(req.headers[primary]) || normalize(req.headers['accept-version']);
    const requested = sent || fallbackDefault;

    if (!supported.includes(requested)) {
      res.setHeader('X-API-Version-Supported', supported.join(', '));
      res.status(406).json({
        error: 'unsupported_api_version',
        requested,
        supported,
      });
      return;
    }

    req.apiVersion = requested;
    res.setHeader('X-API-Version', requested);
    next();
  };
}
`;

export interface ApiVersionConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'API versioning wired at server/lib/apiVersion.ts (dependency-free Express middleware). Mount it before your ' +
  'routes: app.use(apiVersion({ supported: ["1","2"] })). It reads the X-API-Version header (or the standard ' +
  'Accept-Version), accepts "v2" or "2", falls back to the default (first supported) when none is sent, and ' +
  'rejects an unknown version with 406 + the supported list. The resolved version is on req.apiVersion (branch ' +
  'on it, or mount separate v1/v2 routers) and echoed on the response header. No dependency, no API key.';

export function generateApiVersionIntegration(): ApiVersionConfig {
  return {
    files: { 'server/lib/apiVersion.ts': API_VERSION_LIB_SOURCE },
    dependencies: [],
    instructions: INSTRUCTIONS,
  };
}
