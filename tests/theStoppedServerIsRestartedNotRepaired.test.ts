/**
 * AUTOPSY 3a0a8f7f (2026-09-23) — three defects from one IP Pharmacy handover build, each locked here.
 *
 * 1. A stopped preview server reached the runtime-error loop as "2 runtime error(s)" (the browser's
 *    `HTTP 502 from <preview>` and Chromium's echo of it) and bought a full paid repair pass whose only
 *    act was `npm run dev`. The preview verify loop learned that rule on 2026-08-12; its sibling never did.
 * 2. `PROVIDER_TIME_WASTED` counted a call cut off by OUR OWN lane cap as a provider "error" — the one
 *    thing its own comment said it excluded.
 * 3. A reviewer we stopped waiting for kept making paid calls, because the timeout only ended our wait.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { partitionServerDown, type RuntimeError } from '../src/server/AgentV3/AutoFix';
import { wasteKindFor } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { BUDGET_REACHED_MESSAGE } from '../src/server/AgentV3/turnDeadline';

const PREVIEW = 'https://5173-i5p22b6gb9sp6qg6ng1fs.e2b.app';
const e = (kind: string, text: string): RuntimeError => ({ t: 1, kind, text });

describe('partitionServerDown — a stopped server is not an app defect', () => {
  it('the exact pair from the report is server-down, and nothing is left for a repair', () => {
    const { serverDown, app } = partitionServerDown([
      e('httperror', `HTTP 502 from ${PREVIEW}/`),
      e('console', 'Failed to load resource: the server responded with a status of 502 ()'),
    ], PREVIEW);
    expect(serverDown).toHaveLength(2);
    expect(app).toHaveLength(0);
  });

  it('a refused connection to the preview is server-down too', () => {
    const r = partitionServerDown([e('requestfailed', `${PREVIEW}/src/main.tsx — net::ERR_CONNECTION_REFUSED`)], PREVIEW);
    expect(r.serverDown).toHaveLength(1);
  });

  it('a 500 is the app\'s own server saying something broke — it stays with the app', () => {
    const r = partitionServerDown([e('httperror', `HTTP 500 from ${PREVIEW}/api/save`)], PREVIEW);
    expect(r.serverDown).toHaveLength(0);
    expect(r.app).toHaveLength(1);
  });

  it('another origin being down is the app\'s problem, not our server', () => {
    const r = partitionServerDown([e('httperror', 'HTTP 502 from https://api.example.com/x')], PREVIEW);
    expect(r.app).toHaveLength(1);
  });

  it('Chromium\'s URL-less echo alone vouches for nothing', () => {
    const r = partitionServerDown([e('console', 'Failed to load resource: the server responded with a status of 502 ()')], PREVIEW);
    expect(r.app).toHaveLength(1);
  });

  it('a real crash beside a stopped server still reaches the repair', () => {
    const r = partitionServerDown([
      e('httperror', `HTTP 503 from ${PREVIEW}/`),
      e('pageerror', "Cannot read properties of undefined (reading 'map')"),
    ], PREVIEW);
    expect(r.serverDown).toHaveLength(1);
    expect(r.app.map((x) => x.kind)).toEqual(['pageerror']);
  });

  it('with no preview URL there is no origin to match, so nothing is called server-down', () => {
    const r = partitionServerDown([e('httperror', `HTTP 502 from ${PREVIEW}/`)], '');
    expect(r.serverDown).toHaveLength(0);
  });

  it('a look-alike host is not the preview', () => {
    const r = partitionServerDown([e('httperror', `HTTP 502 from ${PREVIEW}.evil.com/`)], PREVIEW);
    expect(r.serverDown).toHaveLength(0);
  });
});

describe('wasteKindFor — our own clock is not a provider\'s waste', () => {
  it('a budget-ended call is not waste at all', () => {
    expect(wasteKindFor(new Error(`This build's time budget ended (${BUDGET_REACHED_MESSAGE}).`))).toBeNull();
  });
  it('a real provider failure still counts', () => {
    expect(wasteKindFor(new Error('Request timed out.'))).toBe('timeout');
    expect(wasteKindFor(new Error('500 internal error'))).toBe('error');
  });
});

/** 🔒 REVERSION GUARDS, read from the route — behaviour tests cannot see a guard that is never called. */
describe('the wiring in routes/agentv3.ts', () => {
  const src = readFileSync(new URL('../src/server/routes/agentv3.ts', import.meta.url), 'utf8');

  it('the runtime loop splits server-down BEFORE it announces a repair', () => {
    const split = src.indexOf('const split = partitionServerDown(captured, internalPreviewUrl(lastPreviewUrl));');
    const announce = src.indexOf('runtime error(s) — auto-fixing (attempt');
    expect(split).toBeGreaterThan(0);
    expect(announce).toBeGreaterThan(split);
    expect(src.slice(split, announce)).toContain("'npm run dev'");
    expect(src.slice(split, announce)).toContain("code: 'PREVIEW_SERVER_RESTARTED'");
  });

  it('the final runtime verdict ignores a stopped server too', () => {
    expect(src).toContain('const finSplit = partitionServerDown(filterActionableErrors(fin.errors), internalPreviewUrl(lastPreviewUrl));');
  });

  it('the reviewer gets its own signal and it is aborted when the review is over', () => {
    expect(src).toContain('signal: reviewAbort.signal,');
    const fin = src.indexOf('stopListening();\n            // Whatever the outcome');
    expect(fin).toBeGreaterThan(0);
    expect(src.slice(fin, fin + 600)).toContain('reviewAbort.abort();');
  });

  it('the provider runner decides waste through wasteKindFor', () => {
    const runner = readFileSync(new URL('../src/server/AgentV3/providers/MultiProviderTurnRunner.ts', import.meta.url), 'utf8');
    expect(runner).toContain('const kind = wasteKindFor(err);');
  });
});
