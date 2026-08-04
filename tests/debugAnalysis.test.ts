import { describe, it, expect } from 'vitest';
import {
  buildDebugSystemPrompt, buildDebugUserPrompt, parseDebugResponse, isValidDebugRequest,
} from '../src/server/lib/debugAnalysis';

/**
 * AI Debugger pure core (admin autopsy 2026-07-20). The tile shipped calling a non-existent
 * /api/debug and masked failures with a canned fake analysis. These tests lock the REAL core:
 * white-label prompts, tolerant-but-honest parsing, and request validation.
 */

describe('buildDebugSystemPrompt', () => {
  it('brands the assistant as NavBharatAI and demands strict JSON', () => {
    const p = buildDebugSystemPrompt();
    expect(p).toContain('NavBharatAI');
    expect(p).toMatch(/ONLY a JSON object/);
    // White-label: the prompt itself must not name any vendor/model.
    for (const leak of ['Grok', 'Gemini', 'Claude', 'GLM', 'Kimi', 'OpenAI', 'Anthropic', 'xAI', 'Google']) {
      expect(p).not.toContain(leak);
    }
  });
});

describe('buildDebugUserPrompt', () => {
  it('includes error, optional code, and optional category, bounded', () => {
    const p = buildDebugUserPrompt('TypeError: x is undefined', 'const y = x.a;', 'JS/TS Error');
    expect(p).toContain('TypeError: x is undefined');
    expect(p).toContain('const y = x.a;');
    expect(p).toContain('JS/TS Error');
    const huge = buildDebugUserPrompt('e'.repeat(50_000));
    expect(huge.length).toBeLessThan(30_000);
  });
});

describe('parseDebugResponse', () => {
  const good = { rootCause: 'null deref', fix: 'use ?.', explanation: ['a', 'b'], prevention: ['c'] };

  it('parses a clean JSON object', () => {
    expect(parseDebugResponse(JSON.stringify(good))).toEqual(good);
  });

  it('parses JSON inside markdown fences and surrounding prose', () => {
    expect(parseDebugResponse('```json\n' + JSON.stringify(good) + '\n```')).toEqual(good);
    expect(parseDebugResponse('Here is my analysis:\n' + JSON.stringify(good) + '\nHope it helps!')).toEqual(good);
  });

  it('coerces malformed field types instead of crashing', () => {
    const r = parseDebugResponse(JSON.stringify({ rootCause: 'x', fix: 42, explanation: 'not-an-array', prevention: [1, 'ok'] }));
    expect(r.rootCause).toBe('x');
    expect(r.fix).toBe('');
    expect(r.explanation).toEqual([]);
    expect(r.prevention).toEqual(['ok']);
  });

  it('HONESTY: unparseable output becomes raw explanation — never a fabricated structure', () => {
    const r = parseDebugResponse('The error means X. Fix it by doing Y.');
    expect(r.rootCause).toBe('');
    expect(r.explanation).toEqual(['The error means X. Fix it by doing Y.']);
    expect(r.fix).toBe('');
  });

  it('empty input yields an empty (not fake) result', () => {
    expect(parseDebugResponse('')).toEqual({ rootCause: '', fix: '', explanation: [], prevention: [] });
  });
});

describe('isValidDebugRequest', () => {
  it('accepts a real request and rejects junk', () => {
    expect(isValidDebugRequest({ error: 'TypeError: boom' })).toBe(true);
    expect(isValidDebugRequest({ error: 'x', code: 'y', errorType: 'React Error' })).toBe(true);
    expect(isValidDebugRequest({ error: '' })).toBe(false);
    expect(isValidDebugRequest({ error: 42 })).toBe(false);
    expect(isValidDebugRequest(null)).toBe(false);
    expect(isValidDebugRequest({ error: 'x', code: 7 })).toBe(false);
  });
});
