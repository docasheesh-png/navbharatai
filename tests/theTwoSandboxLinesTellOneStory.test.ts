/**
 * AUTOPSY f496c75b (open since 2026-09-30): SETUP_TIMING said "sandbox=warm" while SANDBOX_SESSION said
 * the machine "came up created-fresh". Both true — the build FOUND a running machine that had itself been
 * created fresh earlier, for another caller — and read side by side they looked like a contradiction.
 * The setup line now says how and when the machine it found came up.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupOriginText } from '../src/server/routes/agentv3';

describe('the setup line says how the machine it found came up', () => {
  const now = 1_000_000;
  it('a warm machine created fresh for the Files tab 42 s earlier', () => {
    expect(setupOriginText('warm', { origin: 'created-fresh', reason: 'files', startedAt: now - 42_000 }, now))
      .toBe('warm (the machine came up created-fresh 42s earlier, started by files)');
  });

  it('a machine this build created itself, or an unknown session, is described as before', () => {
    expect(setupOriginText('created-fresh', { origin: 'created-fresh', reason: 'build', startedAt: now }, now)).toBe('created-fresh');
    expect(setupOriginText('warm', null, now)).toBe('warm');
    expect(setupOriginText(null, null, now)).toBe('unreported');
    expect(setupOriginText('resumed', { origin: 'resumed' }, now)).toBe('resumed');
  });

  it('the SETUP_TIMING line uses it', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('sandbox=${setupOriginText(sandboxOriginOf(actuator, workspaceId), sandboxSessionOf(actuator, workspaceId), Date.now())}');
  });
});
