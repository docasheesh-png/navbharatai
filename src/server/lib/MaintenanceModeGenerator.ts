// Roadmap breadth — maintenance-mode recipe.
//
// A real production need: flip a flag and every request gets a proper "503 Service Unavailable" with a
// Retry-After header, EXCEPT health checks (so the orchestrator doesn't kill the pod) and an optional
// bypass token (so an operator can verify the fix before reopening). Dependency-free Express middleware +
// an in-memory toggle (seeded from the MAINTENANCE_MODE env). HONEST: the in-memory flag is per-instance;
// for a multi-instance deploy, back it with a shared source via the isEnabled() override. Pure builder.

export const MAINTENANCE_LIB_SOURCE = `import type { Request, Response, NextFunction } from 'express';

// Maintenance mode: when ON, every request gets a 503 + Retry-After, except allow-listed paths (health
// checks) and an optional operator bypass. Seeded from the MAINTENANCE_MODE env var; toggle at runtime
// with setMaintenance(true/false). NOTE: this flag lives in memory, so it is PER-INSTANCE — for a
// multi-instance deploy, pass isEnabled() reading a shared flag (env/DB/Redis) instead of the default.

let enabled = process.env.MAINTENANCE_MODE === 'true' || process.env.MAINTENANCE_MODE === '1';

/** Is maintenance mode currently on (this instance)? */
export function isMaintenance(): boolean {
  return enabled;
}

/** Turn maintenance mode on or off at runtime (e.g. from an admin route). */
export function setMaintenance(on: boolean): void {
  enabled = Boolean(on);
}

export interface MaintenanceOptions {
  /** Seconds to advertise in the Retry-After header. Default 300. */
  retryAfterSeconds?: number;
  /** Paths that ALWAYS pass through (health checks, status). Default ['/health','/healthz','/readyz']. */
  allowPaths?: string[];
  /** Override the flag source — return true when down. Default: the in-memory flag (isMaintenance). */
  isEnabled?: () => boolean;
  /** If set with bypassToken, a request carrying this header = bypassToken skips maintenance (operator check). */
  bypassHeader?: string;
  bypassToken?: string;
  /** Message returned in the 503 body. */
  message?: string;
}

/** Express middleware. Mount it FIRST (before your routes) so nothing runs during maintenance. */
export function maintenanceMiddleware(opts: MaintenanceOptions = {}) {
  const retryAfter = opts.retryAfterSeconds && opts.retryAfterSeconds > 0 ? Math.floor(opts.retryAfterSeconds) : 300;
  const allow = (opts.allowPaths ?? ['/health', '/healthz', '/readyz']).map((p) => p.toLowerCase());
  const check = opts.isEnabled ?? isMaintenance;
  const message = opts.message ?? 'The service is temporarily down for maintenance. Please try again shortly.';
  const bypassHeader = opts.bypassHeader ? opts.bypassHeader.toLowerCase() : '';

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!check()) return next();

    const path = String(req.path || req.url || '').toLowerCase();
    if (allow.some((a) => path === a || path.startsWith(a + '/'))) return next();

    if (bypassHeader && opts.bypassToken) {
      const got = req.headers[bypassHeader];
      const value = Array.isArray(got) ? got[0] : got;
      if (value === opts.bypassToken) return next();
    }

    res.setHeader('Retry-After', String(retryAfter));
    res.status(503).json({ error: 'maintenance', message });
  };
}
`;

export interface MaintenanceConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  envKeys: string[];
  instructions: string;
}

const INSTRUCTIONS =
  'Maintenance mode wired at server/lib/maintenance.ts (dependency-free Express middleware). Mount it FIRST: ' +
  'app.use(maintenanceMiddleware()). When on, every request gets a 503 + Retry-After except health checks ' +
  '(/health,/healthz,/readyz) so the orchestrator does not kill the instance. Toggle with setMaintenance(true/' +
  'false) from an admin route, or seed it with the MAINTENANCE_MODE env var. Add a bypassHeader+bypassToken so ' +
  'an operator can verify the fix before reopening. HONEST: the in-memory flag is per-instance — for a ' +
  'multi-instance deploy, pass isEnabled() reading a shared flag (env/DB/Redis). No dependency, no API key.';

export function generateMaintenanceIntegration(): MaintenanceConfig {
  return {
    files: { 'server/lib/maintenance.ts': MAINTENANCE_LIB_SOURCE },
    dependencies: [],
    envKeys: ['MAINTENANCE_MODE'],
    instructions: INSTRUCTIONS,
  };
}
