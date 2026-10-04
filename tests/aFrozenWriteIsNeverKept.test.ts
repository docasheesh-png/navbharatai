/**
 * Q-132: "some passes write the durable store directly, bypassing Green Freeze" — recorded 2026-09 with five
 * route sites. Re-audited 2026-10-04: every one now records a file only after its sandbox write LANDED
 * (`writeUnlessFrozen`, or a write that throws a refusal before the record), and the dispatcher's heal sites
 * go through `landHealWrite`. This census keeps it that way: after the route first latches green, no site may
 * swallow a sandbox write's failure and then keep the content anyway.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('census: after green, a refused write is never kept', () => {
  it('no swallowed sandbox write is followed by a record, past the first green latch', () => {
    const lines = readFileSync('src/server/routes/agentv3.ts', 'utf8').split('\n');
    const latch = lines.findIndex((l) => /\blatchGreen\(workspaceId/.test(l));
    expect(latch).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (let i = latch; i < lines.length; i++) {
      // A sandbox write whose failure is swallowed on the same line…
      if (!/try \{ await actuator\.writeFile\([^;]*\); \} catch/.test(lines[i])) continue;
      // …is fine inside GreenGuard's own restore, which IS the freeze's allowlisted writer.
      const zone = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
      if (/runInPass\('green-guard-restore'/.test(zone)) continue;
      // …and must not be followed by keeping the content.
      const after = lines.slice(i + 1, i + 4).join('\n');
      if (/writtenFiles\.set\(|saveWorkspaceFiles\(workspaceId|mergeWorkspaceFiles\(workspaceId|onFileWrite\?\.\(/.test(after)) offenders.push(`agentv3.ts:${i + 1}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the shared helper keeps every other failure and drops only a freeze refusal', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('return !(err instanceof GreenFreezeError);');
    expect((route.match(/writeUnlessFrozen\(/g) || []).length).toBeGreaterThanOrEqual(10);
  });
});
