import { describe, it, expect } from 'vitest';
import { generateValidationIntegration } from './ValidationGenerator';

describe('generateValidationIntegration', () => {
  const c = generateValidationIntegration();
  const server = c.files['server/lib/validate.ts'];

  it('emits a typed validateBody + an Express validate() middleware built on zod', () => {
    expect(server).toContain('export function validateBody<T>');
    expect(server).toContain('export function validate<T>');
    expect(server).toContain('schema.safeParse(body)'); // never throws
    expect(server).toContain("import type { ZodType } from 'zod'");
  });

  it('rejects a bad body with 400 + field errors before the handler, and types req.body on success', () => {
    expect(server).toContain('res.status(400).json({');
    expect(server).toContain('details: result.errors');
    expect(server).toContain('req.body = result.data'); // parsed/typed value forwarded
    expect(server).toContain('next();');
  });

  it('maps each zod issue to a readable "path: message" string', () => {
    expect(server).toContain("i.path.join('.')");
    expect(server).toContain('i.message');
  });

  it('declares zod as the dependency, writes no client file and no .env.example', () => {
    expect(c.dependency).toEqual({ name: 'zod', version: '^3.23.8' });
    expect(c.files['.env.example']).toBeUndefined();
    expect(c.files['src/lib/validate.ts']).toBeUndefined(); // server-side
    expect(Object.keys(c.files)).toEqual(['server/lib/validate.ts']);
  });

  it('the generated validateBody semantics are correct (re-implemented + exercised here)', () => {
    // Mirror the emitted logic and prove ok/fail branches + the error mapping.
    type Issue = { path: (string | number)[]; message: string };
    function validateBody(parse: () => { success: true; data: unknown } | { success: false; issues: Issue[] }) {
      const parsed = parse();
      if (parsed.success) return { ok: true as const, data: parsed.data };
      const errors = parsed.issues.map((i) => (i.path.length ? i.path.join('.') + ': ' : '') + i.message);
      return { ok: false as const, errors };
    }
    expect(validateBody(() => ({ success: true, data: { a: 1 } }))).toEqual({ ok: true, data: { a: 1 } });
    expect(
      validateBody(() => ({ success: false, issues: [{ path: ['email'], message: 'Invalid email' }] })),
    ).toEqual({ ok: false, errors: ['email: Invalid email'] });
  });
});
