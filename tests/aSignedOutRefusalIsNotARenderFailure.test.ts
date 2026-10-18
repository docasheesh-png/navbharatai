// Build d62bf22d (2026-10-17): an imported app booted and rendered, and ONE console line — Chromium's
// echo of a 401 from an auth probe on a signed-out page — made it PREVIEW_NOT_RENDERED, RED and ₹0.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAuthRefusalEcho, splitAuthRefusals } from '../src/server/AgentV3/renderCheckConsole';

const LINE_401 = 'Failed to load resource: the server responded with a status of 401 (Unauthorized)';

describe('a 401/403 answer to a signed-out visitor does not judge a render', () => {
  it('the reported line is an auth refusal echo', () => {
    expect(isAuthRefusalEcho(LINE_401)).toBe(true);
    expect(isAuthRefusalEcho('Failed to load resource: the server responded with a status of 403 (Forbidden)')).toBe(true);
  });

  it('real failures still count: 404, 5xx, crashes, thrown fetches', () => {
    for (const t of [
      'Failed to load resource: the server responded with a status of 404 (Not Found)',
      'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      'Failed to load resource: the server responded with a status of 4010',
      "Uncaught TypeError: Cannot read properties of undefined (reading 'map')",
      'Error: Request failed with status code 401', // the app THREW on it — its own code's problem
      'HTTP 502 from https://preview.example/',
    ]) expect(isAuthRefusalEcho(t)).toBe(false);
  });

  it('splits only the echoes out, keeping order of the rest', () => {
    const r = splitAuthRefusals([LINE_401, 'Uncaught ReferenceError: x is not defined', LINE_401]);
    expect(r.kept).toEqual(['Uncaught ReferenceError: x is not defined']);
    expect(r.authRefusals).toHaveLength(2);
    expect(splitAuthRefusals(undefined as unknown as string[])).toEqual({ kept: [], authRefusals: [] });
  });

  it('every render check in the route reads the console through the same filter', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const reads = src.match(/consoleErrs = (?:renderJudgingConsole\()?filterActionableErrors\(\(await actuator\.getConsoleErrors\(workspaceId, renderCheckConsoleSince\(/g) ?? [];
    expect(reads.length).toBe(3);
    for (const r of reads) expect(r.startsWith('consoleErrs = renderJudgingConsole(')).toBe(true);
  });
});
