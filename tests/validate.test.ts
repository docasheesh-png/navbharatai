import { describe, it, expect, vi } from 'vitest';
import {
  vstring, vnumber, vboolean, venum, varray, vobject, vrecord, validateBody, validateQuery,
} from '../src/server/lib/validate';

/**
 * P-DATA.1 — runtime request validation.
 */
describe('validate — primitives', () => {
  it('vstring enforces type, length, pattern, optional', () => {
    expect(vstring().parse('hi')).toEqual({ ok: true, value: 'hi' });
    expect(vstring().parse(5).ok).toBe(false);
    expect(vstring().parse(undefined).ok).toBe(false);
    expect(vstring({ optional: true }).parse(undefined)).toEqual({ ok: true, value: undefined });
    expect(vstring({ min: 2 }).parse('a').ok).toBe(false);
    expect(vstring({ max: 2 }).parse('abc').ok).toBe(false);
    expect(vstring({ pattern: /^\d+$/ }).parse('12a').ok).toBe(false);
  });

  it('vnumber enforces type, int, range', () => {
    expect(vnumber().parse(3)).toEqual({ ok: true, value: 3 });
    expect(vnumber().parse('3').ok).toBe(false);
    expect(vnumber().parse(NaN).ok).toBe(false);
    expect(vnumber({ int: true }).parse(1.5).ok).toBe(false);
    expect(vnumber({ min: 0, max: 10 }).parse(11).ok).toBe(false);
  });

  it('vboolean + venum', () => {
    expect(vboolean().parse(true)).toEqual({ ok: true, value: true });
    expect(vboolean().parse('true').ok).toBe(false);
    expect(venum(['a', 'b'] as const).parse('a').ok).toBe(true);
    expect(venum(['a', 'b'] as const).parse('c').ok).toBe(false);
  });
});

describe('validate — composites', () => {
  it('varray validates items + length', () => {
    expect(varray(vnumber()).parse([1, 2, 3])).toEqual({ ok: true, value: [1, 2, 3] });
    expect(varray(vnumber()).parse([1, 'x']).ok).toBe(false);
    expect(varray(vnumber(), { min: 1 }).parse([]).ok).toBe(false);
    expect(varray(vnumber()).parse('nope').ok).toBe(false);
  });

  it('vrecord accepts plain objects only', () => {
    expect(vrecord().parse({ a: 1 }).ok).toBe(true);
    expect(vrecord().parse([]).ok).toBe(false);
    expect(vrecord().parse(null).ok).toBe(false);
  });

  it('vobject validates shape and DROPS unknown keys by default (sanitization)', () => {
    const schema = vobject({ name: vstring(), age: vnumber({ optional: true }) });
    const r = schema.parse({ name: 'x', age: 5, evil: 'DROP ME' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ name: 'x', age: 5 }); // evil dropped
  });

  it('vobject passthrough keeps unknown keys when asked', () => {
    const schema = vobject({ name: vstring() }, { passthrough: true });
    const r = schema.parse({ name: 'x', extra: 1 });
    if (r.ok) expect(r.value).toEqual({ name: 'x', extra: 1 });
  });

  it('vobject reports a required-field error', () => {
    const r = vobject({ name: vstring() }).parse({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/name is required/);
  });
});

describe('validate — middleware', () => {
  const mkRes = () => {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };

  it('validateBody replaces body with the sanitized value and calls next on success', () => {
    const mw = validateBody(vobject({ name: vstring() }));
    const req: any = { body: { name: 'ok', injected: 'x' } };
    const res = mkRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ name: 'ok' }); // sanitized
    expect(res.status).not.toHaveBeenCalled();
  });

  it('validateBody returns 400 with issues on failure', () => {
    const mw = validateBody(vobject({ name: vstring() }));
    const req: any = { body: {} };
    const res = mkRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].issues.length).toBeGreaterThan(0);
  });

  it('validateQuery 400s on bad query', () => {
    const mw = validateQuery(vobject({ limit: vstring() }));
    const req: any = { query: {} };
    const res = mkRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
