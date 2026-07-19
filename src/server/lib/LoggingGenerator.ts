// U-4 (verified recipe modules) — structured-logging generator (pino).
//
// A built app that only has console.log has no real observability — in production you cannot search, filter
// by level, or ship logs to a log service. This generator adds a real structured logger: a configured pino
// instance (JSON output, level from LOG_LEVEL) plus a lightweight Express request-logging middleware that
// records method/url/status/duration for every request. It deliberately logs NO headers or body, so an
// Authorization header or a password field can never leak into the logs (honest, secret-safe by
// construction). PURE builder; complete code, no TODO stubs. Unit-tested.

export interface LoggingConfig {
  files: Record<string, string>;
  envKeys: string[];
  /** pino is the one dependency (fast structured JSON logger). */
  dependency: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const LOGGER_SERVER = `import pino from 'pino';

// Structured JSON logger. Set LOG_LEVEL in .env to control verbosity (trace|debug|info|warn|error|fatal;
// defaults to info). In production JSON logs are searchable and shippable to a log service.
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Express request logger: one structured line per request with method, url, status and duration. It logs
// NO headers and NO body on purpose, so secrets (an Authorization header, a password field) never leak into
// your logs. Register it early: app.use(requestLogger).
export function requestLogger(
  req: { method?: string; url?: string },
  res: { statusCode?: number; on: (event: string, cb: () => void) => void },
  next: () => void,
): void {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(
      { method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - start },
      'request',
    );
  });
  next();
}
`;

const INSTRUCTIONS =
  'Structured logging wired at server/lib/logger.ts (add the dependency pino). Import { logger, ' +
  "requestLogger } from './lib/logger'; register app.use(requestLogger) early so every request is logged " +
  '(method, url, status, duration — never headers/body, so secrets never leak), and use logger.info/warn/' +
  "error({ ...context }, 'message') instead of console.log so your logs are structured JSON. Set LOG_LEVEL " +
  'in .env to control verbosity (defaults to info); NavBharatAI never stores it.';

export function generateLoggingIntegration(): LoggingConfig {
  return {
    files: {
      'server/lib/logger.ts': LOGGER_SERVER,
      [ENV_EXAMPLE]: 'LOG_LEVEL=\n',
    },
    envKeys: ['LOG_LEVEL'],
    dependency: { name: 'pino', version: '^9.5.0' },
    instructions: INSTRUCTIONS,
  };
}
