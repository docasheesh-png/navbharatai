import { describe, it, expect } from 'vitest';
import { RepairPlanner } from '../src/server/AppMakerLab/autorepair/RepairPlanner';
import {
  FailureClassification,
  RepairStrategy,
  RepairActionType,
} from '../src/server/AppMakerLab/autorepair/AutoRepairTypes';
import type { RootCause } from '../src/server/AppMakerLab/autorepair/AutoRepairTypes';

function rootCause(file: string, reason = 'test reason'): RootCause {
  return { file, symbol: undefined, dependencyPath: [], reason, confidence: 0.9 };
}

describe('RepairPlanner.plan', () => {
  const planner = new RepairPlanner();

  it('INSTALL_DEPENDENCY strategy produces an INSTALL_DEPENDENCY action targeting package.json', () => {
    const actions = planner.plan(FailureClassification.DEPENDENCY_ERROR, RepairStrategy.INSTALL_DEPENDENCY, rootCause('src/App.tsx'));
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe(RepairActionType.INSTALL_DEPENDENCY);
    expect(actions[0].targetFile).toBe('package.json');
  });

  it('INSTALL_DEPENDENCY reason includes the rootCause.reason', () => {
    const actions = planner.plan(FailureClassification.DEPENDENCY_ERROR, RepairStrategy.INSTALL_DEPENDENCY, rootCause('src/App.tsx', 'axios missing'));
    expect(actions[0].reason).toContain('axios missing');
  });

  it('UPDATE_IMPORT strategy produces an UPDATE_IMPORT action at the rootCause file', () => {
    const actions = planner.plan(FailureClassification.TYPESCRIPT_ERROR, RepairStrategy.UPDATE_IMPORT, rootCause('src/utils.ts'));
    expect(actions[0].type).toBe(RepairActionType.UPDATE_IMPORT);
    expect(actions[0].targetFile).toBe('src/utils.ts');
  });

  it('UPDATE_TYPE strategy also produces an UPDATE_IMPORT action', () => {
    const actions = planner.plan(FailureClassification.TYPESCRIPT_ERROR, RepairStrategy.UPDATE_TYPE, rootCause('src/types.ts'));
    expect(actions[0].type).toBe(RepairActionType.UPDATE_IMPORT);
  });

  it('REFACTOR_DEPENDENCY produces an UPDATE_CONFIGURATION action', () => {
    const actions = planner.plan(FailureClassification.ARCHITECTURE_VIOLATION, RepairStrategy.REFACTOR_DEPENDENCY, rootCause('src/service.ts'));
    expect(actions[0].type).toBe(RepairActionType.UPDATE_CONFIGURATION);
  });

  it('unknown strategy (NONE) returns an empty action list', () => {
    const actions = planner.plan(FailureClassification.UNKNOWN, RepairStrategy.NONE, rootCause('src/App.tsx'));
    expect(actions).toHaveLength(0);
  });

  it('riskScore for package.json is higher than for a plain file', () => {
    const pkgActions = planner.plan(FailureClassification.DEPENDENCY_ERROR, RepairStrategy.INSTALL_DEPENDENCY, rootCause('src/App.tsx'));
    const tsActions = planner.plan(FailureClassification.TYPESCRIPT_ERROR, RepairStrategy.UPDATE_IMPORT, rootCause('src/App.tsx'));
    // package.json base risk = 1+5=6; .tsx file = 1 (no .ts suffix, not .tsx suffix)
    expect(pkgActions[0].riskScore).toBeGreaterThan(tsActions[0].riskScore);
  });
});
