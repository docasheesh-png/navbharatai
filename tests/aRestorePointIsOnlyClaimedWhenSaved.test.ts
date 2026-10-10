/**
 * A restore point is claimed only when the save actually landed (GT-17, GT-7).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('in-build green does not claim a snapshot it did not save', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const start = route.indexOf('if (outcome.kind === \'proven\')');
  const block = route.slice(start, start + 1800);

  it('sets inBuildGreenAt only inside if (st === \'saved\')', () => {
    const saved = block.indexOf("if (st === 'saved')");
    const at = block.indexOf('inBuildGreenAt = Date.now()');
    expect(saved).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(saved);
    expect(block.slice(0, saved)).not.toContain('inBuildGreenAt = Date.now()');
  });

  it('the green save replaces, and a failed scan does not save', () => {
    expect(block).toContain("saveWorkspaceFiles(greenWorkspaceKey(workspaceId), files, { mode: 'replace' })");
    expect(block).toContain('if (!scanOk)');
    expect(block).toContain('IN_BUILD_GREEN_SKIPPED_PARTIAL_SCAN');
    expect(block).toContain('IN_BUILD_GREEN_NOT_SAVED');
  });
});
