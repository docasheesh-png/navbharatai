/**
 * P-DATA.1 — Runtime request validation (dependency-free).
 *
 * TypeScript types vanish at runtime, so malformed/malicious bodies reach handlers unchecked. This
 * is a small schema layer + Express middleware that validates (and SANITIZES — unknown keys are
 * dropped by default) request bodies/queries before they hit a handler, returning a 400 with
 * precise issues on failure.
 *
 * Deliberately dependency-free (no `zod`), matching this codebase's established no-new-dependency
 * culture (native TOTP, native SBOM, the dep-free logger). It covers the shapes API request bodies
 * actually use — string/number/boolean/enum/array/object/record — and is fully unit-tested.
 */
import type { Request, Response, NextFunction } from 'express';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
export interface Schema<T> { parse(value: unknown, path?: string): ValidationResult<T>; }

const at = (path: string) => (path ? `${path}` : 'value');
const fail = (msg: string): ValidationResult<never> => ({ ok: false, errors: [msg] });
const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });

function optionalGuard<T>(opts: { optional?: boolean } | undefined, value: unknown, path: string):
  ValidationResult<T> | null {
  if (value === undefined || value === null) {
    return opts?.optional ? ok(undefined as unknown as T) : fail(`${at(path)} is required`);
  }
  return null;
}

export function vstring(opts: { min?: number; max?: number; pattern?: RegExp; optional?: boolean } = {}): Schema<string | undefined> {
  return {
    parse(value, path = '') {
      const og = optionalGuard<string | undefined>(opts, value, path);
      if (og) return og;
      if (typeof value !== 'string') return fail(`${at(path)} must be a string`);
      if (opts.min !== undefined && value.length < opts.min) return fail(`${at(path)} must be ≥ ${opts.min} chars`);
      if (opts.max !== undefined && value.length > opts.max) return fail(`${at(path)} must be ≤ ${opts.max} chars`);
      if (opts.pattern && !opts.pattern.test(value)) return fail(`${at(path)} has an invalid format`);
      return ok(value);
    },
  };
}

export function vnumber(opts: { min?: number; max?: number; int?: boolean; optional?: boolean } = {}): Schema<number | undefined> {
  return {
    parse(value, path = '') {
      const og = optionalGuard<number | undefined>(opts, value, path);
      if (og) return og;
      if (typeof value !== 'number' || Number.isNaN(value)) return fail(`${at(path)} must be a number`);
      if (opts.int && !Number.isInteger(value)) return fail(`${at(path)} must be an integer`);
      if (opts.min !== undefined && value < opts.min) return fail(`${at(path)} must be ≥ ${opts.min}`);
      if (opts.max !== undefined && value > opts.max) return fail(`${at(path)} must be ≤ ${opts.max}`);
      return ok(value);
    },
  };
}

export function vboolean(opts: { optional?: boolean } = {}): Schema<boolean | undefined> {
  return {
    parse(value, path = '') {
      const og = optionalGuard<boolean | undefined>(opts, value, path);
      if (og) return og;
      if (typeof value !== 'boolean') return fail(`${at(path)} must be a boolean`);
      return ok(value);
    },
  };
}

export function venum<T extends string>(values: readonly T[], opts: { optional?: boolean } = {}): Schema<T | undefined> {
  return {
    parse(value, path = '') {
      const og = optionalGuard<T | undefined>(opts, value, path);
      if (og) return og;
      if (typeof value !== 'string' || !values.includes(value as T)) {
        return fail(`${at(path)} must be one of: ${values.join(', ')}`);
      }
      return ok(value as T);
    },
  };
}

export function varray<T>(item: Schema<T>, opts: { min?: number; max?: number; optional?: boolean } = {}): Schema<T[] | undefined> {
  return {
    parse(value, path = '') {
      const og = optionalGuard<T[] | undefined>(opts, value, path);
      if (og) return og;
      if (!Array.isArray(value)) return fail(`${at(path)} must be an array`);
      if (opts.min !== undefined && value.length < opts.min) return fail(`${at(path)} must have ≥ ${opts.min} items`);
      if (opts.max !== undefined && value.length > opts.max) return fail(`${at(path)} must have ≤ ${opts.max} items`);
      const out: T[] = [];
      const errors: string[] = [];
      value.forEach((el, i) => {
        const r = item.parse(el, `${at(path)}[${i}]`);
        if (r.ok) out.push(r.value); else errors.push(...r.errors);
      });
      return errors.length ? { ok: false, errors } : ok(out);
    },
  };
}

/** Any plain (non-array, non-null) object — keys/values unvalidated. Use for opaque payloads. */
export function vrecord(opts: { optional?: boolean } = {}): Schema<Record<string, unknown> | undefined> {
  return {
    parse(value, path = '') {
      const og = optionalGuard<Record<string, unknown> | undefined>(opts, value, path);
      if (og) return og;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(`${at(path)} must be an object`);
      return ok(value as Record<string, unknown>);
    },
  };
}

/**
 * Object schema. By default UNKNOWN KEYS ARE DROPPED (sanitization — a malicious extra field never
 * reaches the handler); pass `{ passthrough: true }` to keep them.
 */
export function vobject<S extends Record<string, Schema<any>>>(
  shape: S,
  opts: { passthrough?: boolean; optional?: boolean } = {},
): Schema<Record<string, any>> {
  return {
    parse(value, path = '') {
      const og = optionalGuard<Record<string, any>>(opts, value, path);
      if (og) return og;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(`${at(path)} must be an object`);
      const input = value as Record<string, unknown>;
      const out: Record<string, any> = {};
      const errors: string[] = [];
      for (const key of Object.keys(shape)) {
        const r = shape[key].parse(input[key], path ? `${path}.${key}` : key);
        if (r.ok) { if (r.value !== undefined) out[key] = r.value; }
        else errors.push(...r.errors);
      }
      if (opts.passthrough) {
        for (const key of Object.keys(input)) if (!(key in shape)) out[key] = input[key];
      }
      return errors.length ? { ok: false, errors } : ok(out);
    },
  };
}

/** Express middleware: validate `req.body` against `schema`. 400 on failure; replaces body with the parsed value. */
export function validateBody<T>(schema: Schema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const r = schema.parse(req.body ?? {});
    if (!r.ok) { res.status(400).json({ error: 'Invalid request body', issues: r.errors }); return; }
    req.body = r.value;
    next();
  };
}

/** Express middleware: validate `req.query` against `schema`. 400 on failure (query left intact — it's read-only on some setups). */
export function validateQuery<T>(schema: Schema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const r = schema.parse(req.query ?? {});
    if (!r.ok) { res.status(400).json({ error: 'Invalid query parameters', issues: r.errors }); return; }
    next();
  };
}
