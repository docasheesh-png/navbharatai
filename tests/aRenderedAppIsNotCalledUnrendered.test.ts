// Autopsy 40868260 (2026-10-21): the release gate said "the app did not come up or did not render" over an app a
// real browser had rendered (its console then logged one error). The failure label now covers both truths, and the
// auth module our OWN template generates no longer logs the honest "not configured" state as an error.
import { describe, it, expect } from 'vitest';
import { releaseGate, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';

const failedPreview: RuntimeEvidence = { buildOk: true, preview: 'failed', pages: 'not-run', journeys: 'not-run', typecheck: 'passed', tests: 'not-run' };

describe('the gate does not claim an app "did not render" when it only failed to run cleanly', () => {
  it('the failure sentence names both possibilities', () => {
    const v = releaseGate(failedPreview, { blockers: 1, highSeverity: 0, warnings: 0 }, { a11yIssues: 0, slowRoutes: 0 });
    const text = `${v.headline} ${JSON.stringify(v)}`;
    expect(text).not.toMatch(/did not come up or did not render/);
    expect(text).toMatch(/did not come up, or came up but did not run cleanly/);
  });
});
