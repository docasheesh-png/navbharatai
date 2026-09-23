/**
 * A request the validator refuses must say WHY, in words a person can act on.
 *
 * The real failure (admin screenshot, 2026-09-23): a pasted Pro image brief longer than 2,000
 * characters came back as "Invalid request body", and the screen shows the server's `error`
 * verbatim — so the user learned nothing. The limit and the real length were in `issues`, which
 * no screen reads.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  vobject, vstring, vnumber, validateBody, humanizeIssue, bodyErrorMessage,
} from '../src/server/lib/validate';

function run(schema: ReturnType<typeof vobject>, body: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
  const next = vi.fn();
  validateBody(schema)({ body } as any, res, next);
  return { res, next, payload: res.json.mock.calls[0]?.[0] };
}

// The exact shape of the Pro image route's schema (routes/imageGen.ts `proSchema`).
const proLike = vobject({
  prompt: vstring({ optional: true, max: 2_000 }),
  size: vstring({ optional: true, max: 40 }),
  width: vnumber({ optional: true, int: true, min: 256, max: 2048 }),
});

describe('a too-long prompt says how long, and what the limit is', () => {
  it('the failing case: a 2,431-character brief names both numbers and the remedy', () => {
    const { res, next, payload } = run(proLike, { prompt: 'x'.repeat(2_431), size: '1:1' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(payload.error).not.toBe('Invalid request body');
    expect(payload.error).toContain('2,431');
    expect(payload.error).toContain('2,000');
    expect(payload.error).toMatch(/shorten/i);
    expect(payload.error).toMatch(/nothing was charged/i);
    // The machine-readable issues are kept for tooling.
    expect(payload.issues).toEqual(['prompt must be ≤ 2000 chars (got 2431)']);
  });

  it('exactly at the limit passes', () => {
    const { next } = run(proLike, { prompt: 'x'.repeat(2_000) });
    expect(next).toHaveBeenCalled();
  });

  it('a nested, camelCase field reads as words', () => {
    expect(humanizeIssue('messages[0].initImage must be ≤ 10 chars (got 12)'))
      .toMatch(/^Your init image is too long: 12 characters, and the limit is 10\./);
  });

  it('required and too-short read as sentences', () => {
    expect(humanizeIssue('prompt is required')).toBe('Please fill in the prompt and try again.');
    expect(humanizeIssue('code must be ≥ 6 chars')).toMatch(/at least 6 characters/);
  });

  it('a shape no person could type gets a plain fallback, never the raw validator text', () => {
    expect(bodyErrorMessage(['width must be an integer'])).toBe('That request could not be read. Please try again.');
  });

  it('the first ACTIONABLE issue wins over an earlier unreadable one', () => {
    expect(bodyErrorMessage(['width must be an integer', 'prompt must be ≤ 5 chars (got 9)']))
      .toMatch(/prompt is too long: 9 characters/);
  });

  it('🔒 source guard: the 400 no longer hard-codes "Invalid request body"', () => {
    const src = readFileSync('src/server/lib/validate.ts', 'utf8');
    expect(src).not.toMatch(/error:\s*'Invalid request body'/);
    expect(src).toMatch(/error:\s*bodyErrorMessage\(r\.errors\)/);
  });
});
