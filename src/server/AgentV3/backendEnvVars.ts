// WHAT ENVIRONMENT DOES THE DEPLOYED BACKEND ACTUALLY BOOT WITH? (admin 2026-09-05)
//
// 🔴 THE GAP THIS CLOSES, found by auditing the deploy path rather than by a report — which is the
// only reason it was found before a user hit it. The PREVIEW app is given the user's saved keys: the
// build writes the scoped vault into the sandbox's `.env` before anything runs (routes/agentv3.ts,
// "Vault → App pipe"). The DEPLOYED service was given **nothing** — `buildCreateServiceRequest` had no
// `envVars` field at all. So an app that reads `DATABASE_URL` or `STRIPE_SECRET_KEY` worked perfectly
// in the preview, was created on Render, built successfully, and then **crashed on boot** — while our
// UI reported "deployed". That is the second absolute rule's exact failure mode: it looked done and
// was not.
//
// 🔒 AND THE TRAP THAT MAKES THIS MORE THAN "COPY THE .ENV ACROSS". The sandbox's `.env` is NOT a safe
// source. The build prefers the sandbox's OWN Postgres, so `DATABASE_URL` there routinely points at an
// address that exists only inside that sandbox and dies with it. Copying that value to Render produces
// something worse than a missing variable: a service that boots, connects to nothing, and fails at the
// first request — with a value that LOOKS configured, so nobody suspects it. Values that can only
// resolve inside the sandbox are therefore dropped and NAMED, never shipped.
//
// So the source of truth is the user's VAULT (real credentials they saved, portable by construction),
// and this module answers three questions purely:
//   • which vault entries should the service receive?
//   • which were withheld because they cannot work outside the sandbox?
//   • which variables does the server's own code REQUIRE that we have no value for?
//
// PURE — files and secrets in, plan out. No network, no I/O.

import { extractProcessEnvRefs, isRuntimeProvidedEnv } from './EnvVarAnalysis';

/**
 * The internal marker recording WHICH database the user connected. It is not an app secret and must
 * never reach a deployed service — the build already strips it from the sandbox `.env` for the same
 * reason, and duplicating that rule here would let the two drift.
 */
export const DB_PROVIDER_MARKER = 'ENGINEER_DB_PROVIDER';

/** One variable as Render's API expects it. */
export interface BackendEnvVar {
  key: string;
  value: string;
}

export interface BackendEnvPlan {
  /** What the service should be created with. */
  envVars: BackendEnvVar[];
  /** Vault names deliberately withheld because their value cannot resolve outside the sandbox. */
  sandboxOnly: string[];
  /** Names the server's own code requires and we have no value for. */
  missing: string[];
}

/**
 * Does this value only mean something inside the sandbox?
 *
 * 🔒 THIS IS A VALUE TEST, NOT A NAME TEST, and the difference matters. A user's real hosted Postgres
 * is also called `DATABASE_URL`; refusing by NAME would withhold the one credential the app needs most.
 * Only an address that cannot resolve from another machine is withheld — and every form below is one
 * we have actually seen written into a sandbox `.env`.
 *
 * A non-URL value is never withheld: an API key that happens to contain the word "local" is a real
 * key, and dropping it would break a working app to prevent a problem it does not have. PURE.
 */
export function isSandboxLocalValue(value: string): boolean {
  const v = String(value ?? '').trim();
  if (!v) return false;
  // Only addresses can be sandbox-local. Anything without a host part is a credential, not a location.
  if (!/[:/]/.test(v)) return false;
  return /(^|[@/:])(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(:\d+)?([/?#]|$)/i.test(v)
    || /\.e2b\.app(:\d+)?([/?#]|$)/i.test(v)
    || /(^|[^a-z0-9.-])(127\.0\.0\.1|localhost)([^a-z0-9.-]|$)/i.test(v);
}

/**
 * Which `process.env` names does this app's own code REQUIRE — i.e. read with no fallback of its own?
 *
 * 🔒 A READ WITH A FALLBACK IS NOT A REQUIREMENT, and treating it as one is how a truthful warning
 * becomes noise nobody reads. `process.env.PORT || 3000` is a working default, not a missing setting;
 * so a name counts as required only when at least ONE of its reads has no `||` / `??` behind it.
 *
 * Runtime-provided names (PORT, NODE_ENV, …) are never required of the user — the host supplies them,
 * and asking for them would send someone hunting for a value they must not set. PURE.
 */
export function requiredBackendEnvNames(files: Record<string, string>): string[] {
  const required = new Set<string>();
  const optional = new Set<string>();
  for (const [path, content] of Object.entries(files ?? {})) {
    if (typeof content !== 'string') continue;
    for (const name of extractProcessEnvRefs(path, content)) {
      if (isRuntimeProvidedEnv(name)) continue;
      // Every read of this name in this file: does at least one lack a fallback?
      const reads = new RegExp(
        `process\\.env(?:\\.${name}\\b|\\[\\s*['"\`]${name}['"\`]\\s*\\])\\s*([|?]{2})?`,
        'g',
      );
      let m: RegExpExecArray | null;
      while ((m = reads.exec(content)) !== null) {
        if (m[1]) optional.add(name);
        else required.add(name);
      }
    }
  }
  // A name read WITHOUT a fallback anywhere is required, even if another site defaults it — the
  // undefended read is the one that breaks.
  return [...required].sort();
}

/**
 * The environment a newly-created backend service should boot with, plus the honest gaps.
 *
 * The vault is the source (see the header for why the sandbox `.env` is not), the marker is stripped,
 * sandbox-only addresses are withheld and named, and anything the code demands that we cannot supply
 * is reported rather than discovered later as a crash. PURE.
 */
export function planBackendEnv(
  vaultSecrets: Record<string, string> | null | undefined,
  files: Record<string, string> | null | undefined,
): BackendEnvPlan {
  const envVars: BackendEnvVar[] = [];
  const sandboxOnly: string[] = [];
  const supplied = new Set<string>();
  for (const [key, value] of Object.entries(vaultSecrets ?? {})) {
    if (key === DB_PROVIDER_MARKER) continue;
    if (typeof value !== 'string' || value === '') continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;   // same rule the vault itself enforces
    if (isSandboxLocalValue(value)) { sandboxOnly.push(key); continue; }
    envVars.push({ key, value });
    supplied.add(key);
  }
  envVars.sort((a, b) => a.key.localeCompare(b.key));
  sandboxOnly.sort();
  const missing = requiredBackendEnvNames(files ?? {}).filter((n) => !supplied.has(n));
  return { envVars, sandboxOnly, missing };
}

/**
 * One honest sentence about the environment the service was given — or '' when there is nothing worth
 * saying, which is the ordinary case and must stay silent.
 *
 * 🔒 IT NEVER CLAIMS THE APP WILL FAIL. A required variable we could not supply is a strong hint, not
 * a verdict: the value may be set already in the host's own dashboard, and telling a user their
 * working app is broken is its own kind of dishonesty. The deploy verification is what states what
 * actually happened; this states only what we did and did not send. PURE.
 */
export function backendEnvNote(plan: BackendEnvPlan): string {
  const parts: string[] = [];
  if (plan.sandboxOnly.length > 0) {
    parts.push(
      `${plan.sandboxOnly.join(', ')} could not be carried over — ${plan.sandboxOnly.length === 1 ? 'its value points' : 'their values point'} `
      + 'at the preview machine, which is not reachable once your app is live. Save the real '
      + `${plan.sandboxOnly.length === 1 ? 'address' : 'addresses'} under Settings → Secrets & API Keys.`,
    );
  }
  if (plan.missing.length > 0) {
    parts.push(
      `Your app reads ${plan.missing.join(', ')} and we had no value saved for `
      + `${plan.missing.length === 1 ? 'it' : 'them'}. If your app needs `
      + `${plan.missing.length === 1 ? 'it' : 'them'} to run, save `
      + `${plan.missing.length === 1 ? 'it' : 'them'} under Settings → Secrets & API Keys and deploy again.`,
    );
  }
  return parts.join(' ');
}
