/**
 * failedbr #1916 (2026-11-08): "Fix this error and continue building the app: network error" — the browser's word for a
 * dropped connection offered as "Fix with AI" — became a five-minute build on an app that had rendered at 56 s, and the
 * model's `npm test` in an app with no test script ("Missing script: test") became the gate's one blocker.
 */
import { describe, expect, it } from 'vitest';
import { errorCanBeFixedByEditingTheApp, isClientConnectionError } from '../src/lib/platformFixRequest';
import { BuildDiagnostics, isMissingOptionalScript } from '../src/server/AgentV3/BuildDiagnostics';

describe('a dropped connection is not an app error', () => {
  it.each(['network error', 'Network Error', 'Failed to fetch', 'TypeError: Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'net::ERR_CONNECTION_RESET'])('%s: no Fix with AI', (m) => {
    expect(isClientConnectionError(m)).toBe(true);
    expect(errorCanBeFixedByEditingTheApp({ message: m })).toBe(false);
  });
  it.each(['network error in src/api.ts: fetch returned 500', 'error TS2304: Cannot find name fetchData', 'Failed to fetch products: 404'])('%s: still offered', (m) => {
    expect(errorCanBeFixedByEditingTheApp({ message: m })).toBe(true);
  });
});

describe('an app with no test or lint script was asked for one: not a blocker', () => {
  const MISSING = 'npm error Missing script: "test"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run';
  it('the report\'s own command', () => {
    expect(isMissingOptionalScript('npm test', '', MISSING)).toBe(true);
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm test', exitCode: 1, stderr: MISSING, durationMs: 300 });
    expect(d.shippingIssueCount('error')).toBe(0);
  });
  it('a missing build script stays a failure, and so does a test run that really fails', () => {
    expect(isMissingOptionalScript('npm run build', '', 'npm error Missing script: "build"')).toBe(false);
    expect(isMissingOptionalScript('npm test', '', 'FAIL src/App.test.tsx\n  1 failed')).toBe(false);
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm run build', exitCode: 1, stderr: 'npm error Missing script: "build"', durationMs: 300 });
    expect(d.shippingIssueCount('error')).toBe(1);
  });
});
