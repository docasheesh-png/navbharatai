import { describe, it, expect } from 'vitest';
import { classifyRuntimeError, groupRuntimeErrors, renderRepairGuidance } from './RuntimeErrorClassify';

describe('classifyRuntimeError', () => {
  const cases: Array<[string, string]> = [
    ["TypeError: Cannot read properties of undefined (reading 'name')", 'null-undefined-access'],
    ['TypeError: cart.map is not a function', 'not-a-function'],
    ['Failed to fetch', 'network-fetch'],
    ["Access to fetch at 'https://api.x' has been blocked by CORS policy", 'cors'],
    ['GET https://api.x/orders 404 (Not Found)', 'http-status'],
    ['the server responded with a status of 500 (Internal Server Error)', 'http-status'],
    // The browser-daemon 'response' capture format for a 5xx server error (network-5xx-capture slice).
    ['HTTP 500 from http://localhost:5173/api/orders', 'http-status'],
    ['HTTP 503 from http://localhost:8080/api/checkout', 'http-status'],
    ['Warning: Maximum update depth exceeded', 'react-render'],
    ['Objects are not valid as a React child', 'react-render'],
    ['Invalid hook call. Hooks can only be called inside of the body of a function component', 'react-hooks'],
    ['Rendered more hooks than during the previous render', 'react-hooks'],
    ['Hydration failed because the initial UI does not match', 'hydration'],
    ["does not provide an export named 'default'", 'module-import'],
    ['Failed to fetch dynamically imported module: /src/Page.tsx', 'module-import'],
    ['Uncaught ReferenceError: process is not defined', 'env-config'],
    ['Unexpected token < in JSON at position 0', 'syntax-runtime'],
    ['Some totally unrecognized explosion', 'uncaught'],
  ];

  it('routes each representative real error to its root-cause category', () => {
    for (const [text, id] of cases) {
      expect(classifyRuntimeError(text).id, text).toBe(id);
    }
  });

  it('CORS wins over the generic network match (specific-first ordering)', () => {
    expect(classifyRuntimeError("blocked by CORS policy: No 'Access-Control-Allow-Origin'").id).toBe('cors');
  });

  it('the CORS hint points at the generate_cors recipe (recipe-aware guidance)', () => {
    expect(classifyRuntimeError('blocked by CORS policy').hint).toContain('generate_cors');
  });
});

describe('groupRuntimeErrors', () => {
  it('orders the crash-class group before the network groups, and dedupes', () => {
    const groups = groupRuntimeErrors([
      'Failed to fetch',
      'Failed to fetch', // dup
      "Cannot read properties of undefined (reading 'x')",
      'GET /a 500 (Server Error)',
    ]);
    // The crash-class (priority 2) must come first; the two priority-3 network groups follow (order
    // between equal-priority groups is not contractual, so assert the set, not a brittle exact order).
    expect(groups[0].category.id).toBe('null-undefined-access');
    expect(new Set(groups.map((g) => g.category.id))).toEqual(
      new Set(['null-undefined-access', 'http-status', 'network-fetch']),
    );
    expect(groups.find((g) => g.category.id === 'network-fetch')!.errors).toHaveLength(1); // deduped
  });

  it('returns [] for empty / non-array input', () => {
    expect(groupRuntimeErrors([])).toEqual([]);
    expect(groupRuntimeErrors(undefined as never)).toEqual([]);
  });
});

describe('renderRepairGuidance', () => {
  it('renders a labelled block with the hint and capped errors per group', () => {
    const out = renderRepairGuidance(['Failed to fetch', "Cannot read properties of null (reading 'y')"]);
    expect(out).toContain('▸ Null / undefined access (1)');
    expect(out).toContain('▸ Network request failed (1)');
    expect(out).toContain('- Failed to fetch');
  });

  it('caps errors per group and reports the remainder', () => {
    const many = Array.from({ length: 8 }, (_, i) => `Failed to fetch /r${i}`);
    const out = renderRepairGuidance(many, 3);
    expect(out).toContain('…and 5 more');
  });

  it('is empty when there is nothing to render', () => {
    expect(renderRepairGuidance([])).toBe('');
  });
});
