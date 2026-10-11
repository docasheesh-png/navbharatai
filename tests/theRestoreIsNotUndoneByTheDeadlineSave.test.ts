/**
 * GT-4: a GreenGuard restore must reconcile the build's captured writes, or the
 * deadline/advisory save puts the broken files back over the restore.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reconcileCapturedWrites, restorePlan } from '../src/server/AgentV3/GreenGuard';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

describe('the restore is not undone by the deadline save (GT-4)', () => {
  it('the restore branch reconciles writtenFiles before the snapshot is saved', () => {
    const start = route.indexOf("decision.action === 'restore'");
    const end = route.indexOf('greenGuardRestoreFacts =', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(route.slice(start, end)).toContain('reconcileCapturedWrites(writtenFiles, plan)');
  });

  it('reconcile puts the good content back and drops files the restore removed', () => {
    const captured = new Map<string, string>([['src/A.tsx', 'BROKEN'], ['src/new.tsx', 'x']]);
    const plan = restorePlan(
      { 'src/A.tsx': 'GOOD' },
      { 'src/A.tsx': 'BROKEN', 'src/new.tsx': 'x' },
    );
    reconcileCapturedWrites(captured, plan);
    expect(captured.get('src/A.tsx')).toBe('GOOD');
    expect(captured.has('src/new.tsx')).toBe(false);
  });
});
