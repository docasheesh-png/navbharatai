// THE MEASUREMENT WE ALREADY PAID FOR (admin 2026-08-19).
//
// The runtime verdict rode the LIVE PREVIEW console only, so when that session was not up the build
// reported "runtime UNCHECKED" — while the page-route check had already loaded every page of the same
// app in the sandbox's own real Chromium with pageerror + console listeners attached. These tests pin
// the second source of truth, and the honesty limits on it.

import { describe, it, expect } from 'vitest';
import { runtimeRecordFromPageChecks } from './AutoFix';

describe('runtimeRecordFromPageChecks', () => {
  it('pages loaded clean in a real browser ⇒ runtime VERIFIED, and it says where the proof came from', () => {
    const r = runtimeRecordFromPageChecks(4, [])!;
    expect(r.code).toBe('RUNTIME_VERIFIED');
    expect(r.severity).toBe('info');
    expect(r.autoResolved).toBe(true);
    expect(r.message).toContain('4 page(s)');
    expect(r.message).toContain('real browser');
    // Honest about the source: not a claim that the live preview console was read.
    expect(r.message).toContain('page checks');
  });

  it('errors seen during those loads ⇒ still UNCHECKED, never a false "errors remain"', () => {
    // The page check runs BEFORE the repair pass, so an error it saw may already be fixed. Reporting
    // a repaired error as surviving would be its own dishonesty.
    const r = runtimeRecordFromPageChecks(3, ['TypeError: x is not a function'])!;
    expect(r.code).toBe('RUNTIME_UNCHECKED');
    expect(r.autoResolved).toBe(false);
    expect(r.message).toContain('TypeError: x is not a function');
    expect(r.message).toContain('before the repair pass');
    // The word "clean" may appear — but only ever as the DISCLAIMER, never as a claim.
    expect(r.message).toContain('not a clean-runtime guarantee');
  });

  it('no pages loaded ⇒ null, so the caller keeps its honest "unchecked"', () => {
    expect(runtimeRecordFromPageChecks(0, [])).toBeNull();
    expect(runtimeRecordFromPageChecks(0, ['some error'])).toBeNull();
  });

  it('blank error strings do not count as evidence of a problem', () => {
    const r = runtimeRecordFromPageChecks(2, ['', '   '])!;
    expect(r.code).toBe('RUNTIME_VERIFIED');
  });

  it('a flood of errors is bounded — the report stays readable', () => {
    const many = Array.from({ length: 50 }, (_, i) => `error number ${i} ${'x'.repeat(200)}`);
    const r = runtimeRecordFromPageChecks(9, many)!;
    expect(r.code).toBe('RUNTIME_UNCHECKED');
    expect(r.message.length).toBeLessThan(700);
  });
});
