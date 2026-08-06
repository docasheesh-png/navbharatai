import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A 6.5-SECOND IMPORT, PAID ON EVERY BOOT, THAT LOOKED LIKE A FLAKY TEST (2026-08-06).
 *
 * `routes/zipUpload` needed exactly one function from `routes/agentv3` — `buildActuator` — and importing
 * it dragged in the ENTIRE AgentV3 engine, the largest module in the repo. Measured: importing
 * `routes/zip` took **6469 ms**, against 43 ms for its own body.
 *
 * That cost two things, one visible and one not:
 *   • every server BOOT paid it, on a path with nothing to do with building apps;
 *   • and whichever of the two zip route tests imported the module FIRST paid the ~5s and randomly
 *     crossed vitest's 5000 ms timeout. In a suite of 12,000 that reads as "a random test sometimes
 *     fails" — the real cause being an import graph nobody looks at. Found with a shuffled run.
 *
 * After: 6469 ms → ~1044 ms (the factory in its own module, loaded lazily at the one call site).
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('The zip routes do not import the build engine', () => {
  const zipUpload = read('src/server/routes/zipUpload.ts');
  const zip = read('src/server/routes/zip.ts');

  it('zipUpload never imports routes/agentv3 at module scope', () => {
    // This single line was the whole 6.5 seconds.
    expect(zipUpload).not.toMatch(/^import[^\n]*from '\.\/agentv3'/m);
    expect(zip).not.toMatch(/^import[^\n]*from '\.\/agentv3'/m);
  });

  it('the actuator is loaded lazily, at the one call site that needs it', () => {
    expect(zipUpload).toContain("await import('./actuatorFactory')");
  });
});

describe('There is still exactly ONE actuator per process', () => {
  const factory = read('src/server/routes/actuatorFactory.ts');
  const agentv3 = read('src/server/routes/agentv3.ts');

  it('the singleton lives in the factory module', () => {
    expect(factory).toContain('let sharedActuator: IEngineerActuator | null = null;');
    expect(factory).toContain('export function buildActuator()');
  });

  it('agentv3 RE-EXPORTS it rather than declaring a second one', () => {
    // Two instances would silently hand a session's next message a cold, empty sandbox — the actuator's
    // per-workspace sandbox map is exactly what makes iterative building work.
    expect(agentv3).toContain("import { buildActuator } from './actuatorFactory';");
    expect(agentv3).toContain('export { buildActuator };');
    expect(agentv3).not.toContain('let sharedActuator');
    expect(agentv3).not.toContain('new E2BActuator()');
  });

  it('every existing importer keeps working — the name is still exported from agentv3', () => {
    expect(agentv3).toMatch(/export \{ buildActuator \};/);
  });
});
