// U-4 (verified recipe modules) — request-validation generator (zod).
//
// One of the most important production concerns and a frequent source of real bugs: a route trusts the
// request body, and a missing/mis-typed field crashes it with a cryptic `undefined` — or worse, bad data
// is written straight to the database. This generator adds a real input-validation layer for the user's app:
// a validateBody() helper + an Express-style validate(schema) middleware that reject a malformed body with a
// clear 400 listing exactly which fields are wrong, BEFORE the handler runs. Built on zod (the industry
// standard) so schemas are type-safe and self-documenting. PURE builder; complete code, no TODO stubs.
// Unit-tested.

export interface ValidationConfig {
  files: Record<string, string>;
  /** zod is the one dependency (the standard schema validator). */
  dependency: { name: string; version: string };
  instructions: string;
}

const VALIDATE_SERVER = `import type { ZodType } from 'zod';

// Validate an unknown request body against a zod schema. Returns a typed result — never throws — so callers
// decide how to respond. On failure it lists each bad field as "path: message" for a clear 400.
export function validateBody<T>(
  schema: ZodType<T>,
  body: unknown,
): { ok: true; data: T } | { ok: false; errors: string[] } {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors = parsed.error.issues.map((i) => (i.path.length ? i.path.join('.') + ': ' : '') + i.message);
  return { ok: false, errors };
}

// Express middleware: reject a malformed body with 400 + the field errors BEFORE the handler runs; on success
// it replaces req.body with the parsed (typed, stripped) value and continues.
export function validate<T>(schema: ZodType<T>) {
  return (
    req: { body: unknown },
    res: { status: (code: number) => { json: (b: unknown) => void } },
    next: () => void,
  ): void => {
    const result = validateBody(schema, req.body);
    if (!result.ok) {
      res.status(400).json({ error: 'Invalid request', details: result.errors });
      return;
    }
    req.body = result.data;
    next();
  };
}
`;

const INSTRUCTIONS =
  'Request validation wired at server/lib/validate.ts (add the dependency zod). Define a schema and guard a ' +
  "route: `import { z } from 'zod'; import { validate } from './lib/validate'; " +
  "app.post('/users', validate(z.object({ email: z.string().email(), age: z.number().int().min(0) })), " +
  '(req, res) => { /* req.body is now typed + validated */ });`. A malformed body is rejected with a 400 ' +
  'listing exactly which fields are wrong, before your handler runs — so bad input never crashes a route or ' +
  'reaches your database. Use validateBody(schema, body) directly if you are not on Express.';

export function generateValidationIntegration(): ValidationConfig {
  return {
    files: { 'server/lib/validate.ts': VALIDATE_SERVER },
    dependency: { name: 'zod', version: '^3.23.8' },
    instructions: INSTRUCTIONS,
  };
}
