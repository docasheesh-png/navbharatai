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

// ── EVERY HOST-EXEC DOOR, NOT ONLY LocalActuator (forensic audit 2026-10-04) ───────────────────────
//
// 🔴 THE SIBLING THIS GUARD MISSED. The header above calls this "the ROOT-CAUSE defense in the actuator
// itself" — and it was, for LocalActuator. A second door spawned user code on the host with no guard at
// all: the 'server-container' preview (`POST /api/preview`, unauthenticated) wrote the caller's files to a
// temp dir and ran `npm install` there in the production server process — so a `preinstall` script in the
// caller's package.json ran as NavBharatAI, with `env: process.env`, i.e. every secret the server holds.
// `SandboxManager.launch` (the same door's dev-server half, also used by PreviewRunner) spawned with the
// full environment too. Both now go through the checks below, so a third door is a one-line call, not a
// re-invention — and `tests/userCodeNeverRunsOnTheHost.test.ts` fails when a new spawn site skips them.

export const HOST_EXEC_REFUSED_CODE = 'HOST_EXEC_REFUSED';

/** Refuse to run user-controlled code in this process outside development (same rule as LocalActuator). */
export function assertHostExecAllowed(door: string, env: NodeJS.ProcessEnv = process.env): void {
  if (localActuatorExecAllowed(env)) return;
  const err = new Error(
    `${door} refuses to run code on the server outside development — it would run a user's app inside ` +
    'the NavBharatAI server process. Previews of apps with a server run in the isolated build sandbox.',
  ) as Error & { code?: string };
  err.code = HOST_EXEC_REFUSED_CODE;
  throw err;
}

/** The only parent variables a child running USER code may inherit — enough to find node/npm, never a secret. */
const HOST_CHILD_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'USER', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA'];

/**
 * The environment for a child process that runs a user's code on the host (dev only, by the guard above).
 * Built from an allowlist, never from `process.env` wholesale: the server's API keys, database credentials
 * and signing secrets are not the user's app's business, even on a developer's laptop.
 */
export function hostChildEnv(extra: Record<string, string> = {}, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = { NODE_ENV: 'development' };
  for (const k of HOST_CHILD_ENV_KEYS) {
    const v = env[k];
    if (typeof v === 'string') out[k] = v;
  }
  return { ...out, ...extra };
}
