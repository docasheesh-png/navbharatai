// SECURITY Phase 2.3 (admin-approved 2026-07-07) — LocalActuator production guard.
//
// LocalActuator runs the agent's bash commands with `child_process.exec` INSIDE the NavBharatAI
// server process — an agent (or a prompt-injected instruction) can therefore execute arbitrary code
// on the host. That is acceptable only in dev/CI; in production the build MUST run in an isolated
// sandbox (E2B or Docker). The engineer route already 503s in prod without a sandbox, but that is one
// call site — this guard is the ROOT-CAUSE defense in the actuator itself, so LocalActuator can never
// execute a shell command in a non-dev environment no matter which code path constructs it.
//
// Allowed ONLY when: an explicit opt-in flag is set (ALLOW_LOCAL_ACTUATOR=true), or under unit tests
// (VITEST), or NODE_ENV is development/test/unset (local dev). Any other NODE_ENV (production,
// staging, …) is refused. Pure + unit-tested.

export function localActuatorExecAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ALLOW_LOCAL_ACTUATOR === 'true') return true; // explicit operator opt-in
  if (env.VITEST) return true;                          // unit tests never reach real prod
  const node = (env.NODE_ENV || '').toLowerCase();
  return node === '' || node === 'development' || node === 'test';
}

/** Throw a clear, actionable error when LocalActuator would execute a shell command outside dev. */
export function assertLocalActuatorExecAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (!localActuatorExecAllowed(env)) {
    throw new Error(
      'LocalActuator refuses to run shell commands outside development — it executes code in the ' +
      'server process. Configure a real sandbox (E2B_API_KEY or DOCKER_ENABLED=true), or set ' +
      'ALLOW_LOCAL_ACTUATOR=true to explicitly opt in.',
    );
  }
}
