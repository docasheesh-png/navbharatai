// NAVBHARAT CLOUD — WHO a user's app and a user's build run AS (P0, 2026-10-06).
//
// 🔴 THE VULNERABILITY. `buildServiceSpec` set no `serviceAccount`, so every hosted app ran as the apps
// project's DEFAULT compute service account; `buildCreateBuildRequest` set none either, and on a project
// created in 2026 Cloud Build's default is that SAME account. Code inside any Cloud Run container or any
// Cloud Build step can mint that account's token from the metadata server — always reachable, it cannot be
// firewalled off. So whatever the build needs (push to the shared image repository, read the shared
// staging bucket — every app's source) every RUNNING user app held too, and if the default account kept the
// Editor role Google grants it unless an org policy forbids it, one app could rewrite or delete every
// other app's service and read every other app's environment (their secrets).
//
// 🔒 THE BOUNDARY, AND WHY IT IS ONE SHARED EMPTY IDENTITY FOR RUNTIMES (not one per app):
//   • A runtime identity with NO IAM ROLES ANYWHERE can mint a token that opens nothing. Sharing it across
//     apps shares nothing, because there is nothing to share — App A's token cannot touch App B's service,
//     image, source or secrets, nor the control plane. That is the property the boundary needs.
//   • Per-app service accounts would be needed only if apps held per-app Google resources. They do not:
//     an app's data lives in the user's OWN Supabase project, its secrets are injected as its own env, and
//     nothing in Google is granted to it. Per-app accounts would also hit the per-project service-account
//     quota (100 by default) far below the 1,000-service ceiling. If per-app Google resources are ever
//     added, they go through the CONTROL PLANE (a broker that checks the caller and hands back a scoped,
//     short-lived grant) — never by granting the runtime identity anything.
//   • The BUILD identity is separate and narrow (push to the image repository, read the staging bucket,
//     write logs). It is still SHARED across builds; docs/HOSTING_ARCHITECTURE.md §11 records exactly what a
//     malicious build can still reach with it and the credential-less build step that closes it.
//
// 🔒 FAILS CLOSED. Without both identities configured, hosting is unavailable — to the admin too. Running a
// user's code under the default identity "for now" is precisely the state this file exists to end.
//
// PURE.

/** Accounts that must never run untrusted code: Google's per-project defaults. */
const DEFAULT_ACCOUNT_SHAPES: readonly RegExp[] = [
  /-compute@developer\.gserviceaccount\.com$/i,   // Compute Engine / Cloud Run default
  /@appspot\.gserviceaccount\.com$/i,              // App Engine default
  /@cloudbuild\.gserviceaccount\.com$/i,           // legacy Cloud Build default
  /@cloudservices\.gserviceaccount\.com$/i,        // Google APIs service agent
];

export type IdentityRole = 'runtime' | 'build';

const ENV_KEY: Record<IdentityRole, string> = {
  runtime: 'NAVBHARAT_APPS_RUNTIME_SA',
  build: 'NAVBHARAT_APPS_BUILD_SA',
};

export type IdentityResult = { ok: true; email: string } | { ok: false; message: string };

/** Is this a Google default account (never allowed to run user code)? PURE. */
export function isDefaultServiceAccount(email: string): boolean {
  return DEFAULT_ACCOUNT_SHAPES.some((re) => re.test(String(email ?? '').trim()));
}

/**
 * The service account one side of a user app runs as — validated, never the default. PURE.
 *
 * It must be a user-managed account OF THE APPS PROJECT (`<name>@<project>.iam.gserviceaccount.com`): an
 * account from the platform project would put user code one IAM mistake away from the control plane.
 */
export function appsServiceAccount(role: IdentityRole, projectId: string, env: NodeJS.ProcessEnv = process.env): IdentityResult {
  const key = ENV_KEY[role];
  const email = String(env[key] ?? '').trim().toLowerCase();
  const what = role === 'runtime' ? 'user apps run as' : 'user app builds run as';
  if (!email) {
    return { ok: false, message: `App hosting is off until ${key} names the dedicated service account ${what} — never the project's default account.` };
  }
  if (isDefaultServiceAccount(email)) {
    return { ok: false, message: `${key} names a Google default service account. User code must never run as a default account — create a dedicated one with no extra roles.` };
  }
  const project = String(projectId ?? '').trim().toLowerCase();
  const shape = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$/.exec(email);
  if (!shape) return { ok: false, message: `${key} is not a service-account address.` };
  if (shape[1] !== project) {
    return { ok: false, message: `${key} must be an account of the apps project (${project}), not of another project.` };
  }
  return { ok: true, email };
}

export interface AppsIdentities { runtime: string; build: string }

/** Both identities, or the one sentence that says what is missing. Runtime and build must differ. PURE. */
export function appsIdentities(projectId: string, env: NodeJS.ProcessEnv = process.env): { ok: true; identities: AppsIdentities } | { ok: false; message: string } {
  const runtime = appsServiceAccount('runtime', projectId, env);
  if (!runtime.ok) return runtime;
  const build = appsServiceAccount('build', projectId, env);
  if (!build.ok) return build;
  if (runtime.email === build.email) {
    return { ok: false, message: 'NAVBHARAT_APPS_RUNTIME_SA and NAVBHARAT_APPS_BUILD_SA must be DIFFERENT accounts — a running app must not hold the build\'s permissions.' };
  }
  return { ok: true, identities: { runtime: runtime.email, build: build.email } };
}

/** The resource name Cloud Build expects for a user-specified build account. PURE. */
export function buildServiceAccountResource(projectId: string, email: string): string {
  return `projects/${projectId}/serviceAccounts/${email}`;
}
