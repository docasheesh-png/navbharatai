/**
 * Q-2753 (BR1999: 28 / 21 / 30 / 30; BR2002: 28 / 14 / 23 / 23): one report's file counts disagreed. Each was true
 * about a different set — the project (summary), the build's own changes (CHANGE_RECORDED), every file this turn
 * wrote (FE_BE_PARTITION), the project's paths (manifest) — and CHANGE_RECORDED was the one line that named none.
 */
import { describe, it, expect } from 'vitest';
import { describeChange } from '../src/server/AgentV3/changeEngine/changeLog';
import { partitionFrontendBackend, partitionSummary } from '../src/server/AgentV3/frontendBackendPartition';

describe('every file count in the report names what it counted', () => {
  it('CHANGE_RECORDED says which files it counts', () => {
    const line = describeChange({ id: 'CHG-0001', kind: 'new-app', depth: 'standard', files: new Array(21).fill('src/x.ts'), status: 'done', requirements: [], regressed: [], issues: [] } as never);
    expect(line).toContain("21 file(s) changed by the build (unchanged kit files and the platform's finishing writes not counted)");
  });
  it('FE_BE_PARTITION still says it counts every file this turn wrote', () => {
    expect(partitionSummary(partitionFrontendBackend(['src/App.tsx', 'server/index.ts']))).toContain('file(s) THIS TURN wrote');
  });
});
