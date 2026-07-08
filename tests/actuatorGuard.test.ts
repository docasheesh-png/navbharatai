import { describe, it, expect } from 'vitest';
import { localActuatorExecAllowed, assertLocalActuatorExecAllowed } from '../src/server/lib/actuatorGuard';

// SECURITY Phase 2.3 — LocalActuator runs the agent's bash commands with child_process.exec in the
// SERVER process (arbitrary RCE surface). It is allowed only in dev/CI or with an explicit opt-in;
// any real (production/staging) NODE_ENV is refused, so a misconfigured prod can't run agent shell
// commands on the host. These lock the pure allow-decision + the throw.

const env = (over: Record<string, string | undefined>): NodeJS.ProcessEnv => over as NodeJS.ProcessEnv;

describe('localActuatorExecAllowed — dev/CI only unless explicitly opted in', () => {
  it('THE VULN: refuses in production (and any non-dev NODE_ENV) without an opt-in', () => {
    expect(localActuatorExecAllowed(env({ NODE_ENV: 'production' }))).toBe(false);
    expect(localActuatorExecAllowed(env({ NODE_ENV: 'staging' }))).toBe(false);
    expect(localActuatorExecAllowed(env({ NODE_ENV: 'PRODUCTION' }))).toBe(false); // case-insensitive
  });
  it('allows dev / test / unset NODE_ENV (local + CI)', () => {
    expect(localActuatorExecAllowed(env({ NODE_ENV: 'development' }))).toBe(true);
    expect(localActuatorExecAllowed(env({ NODE_ENV: 'test' }))).toBe(true);
    expect(localActuatorExecAllowed(env({}))).toBe(true); // unset → local dev
  });
  it('explicit opt-in (ALLOW_LOCAL_ACTUATOR=true) overrides even production', () => {
    expect(localActuatorExecAllowed(env({ NODE_ENV: 'production', ALLOW_LOCAL_ACTUATOR: 'true' }))).toBe(true);
  });
  it('VITEST is always allowed (unit tests never reach real prod)', () => {
    expect(localActuatorExecAllowed(env({ NODE_ENV: 'production', VITEST: 'true' }))).toBe(true);
  });
});

describe('assertLocalActuatorExecAllowed — throws a clear, actionable error when refused', () => {
  it('throws in production (no opt-in), naming the sandbox env vars', () => {
    expect(() => assertLocalActuatorExecAllowed(env({ NODE_ENV: 'production' }))).toThrow(/E2B_API_KEY|DOCKER_ENABLED|ALLOW_LOCAL_ACTUATOR/);
  });
  it('does NOT throw in dev / with opt-in', () => {
    expect(() => assertLocalActuatorExecAllowed(env({ NODE_ENV: 'development' }))).not.toThrow();
    expect(() => assertLocalActuatorExecAllowed(env({ NODE_ENV: 'production', ALLOW_LOCAL_ACTUATOR: 'true' }))).not.toThrow();
  });
});
