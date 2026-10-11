// GT-3. A failed page or journey is a runtime failure. The ok flip can see it
// only when AGENTV3_RUNTIME_RED_FLIP is on (default off).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runtimeProven, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';

describe('a failed journey is not shippable', () => {
  it('runtimeProven is failed when a page failed even though the preview rendered', () => {
    const ev: RuntimeEvidence = {
      buildOk: true,
      preview: 'passed',
      pages: 'failed',
      journeys: 'passed',
      typecheck: 'passed',
      tests: 'passed',
    };
    expect(runtimeProven(ev)).toBe('failed');
  });

  it('the verdict flip names runtimeRed and the flag', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toContain('runtimeRed');
    expect(src).toContain("runtimeRedFlipEnabled() && runtimeProven(gateEvidence) === 'failed'");
  });
});
