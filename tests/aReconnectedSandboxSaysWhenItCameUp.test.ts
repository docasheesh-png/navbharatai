/**
 * failedbr #672 / #677 (queue Q-3222): "Sandbox session: 0.0 min up" for a 40-minute build. A reconnect starts a new
 * session, and the line described only that one, as if it were the build's.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeSession } from '../src/server/AgentV3/sandboxSessions';

const base = { observationId: 'o', sandboxId: 's', origin: 'resumed', reason: 'build', busyMs: 0, ops: 0 } as const;

describe('a reconnected sandbox says when it came up', () => {
  it('a session that began 40 min into the build says so', () => {
    const t0 = 1_000_000;
    const line = describeSession({ ...base, startedAt: t0 + 40 * 60_000 } as never, t0 + 40 * 60_000 + 3_000, t0);
    expect(line).toMatch(/0\.1 min up|0\.0 min up/);
    expect(line).toMatch(/this sandbox came up 40\.0 min into the build \(it reconnected\)/);
  });
  it('🔒 a session that began with the build reads as before', () => {
    const t0 = 1_000_000;
    expect(describeSession({ ...base, startedAt: t0 + 5_000 } as never, t0 + 600_000, t0)).not.toMatch(/reconnected/);
    expect(describeSession({ ...base, startedAt: t0 } as never, t0 + 600_000)).not.toMatch(/reconnected/);
  });
  it('wired: the report line is given the build\'s start', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('message: describeSession(session, Date.now(), billingCtx.buildStartedAt), // Q-3222');
  });
});
