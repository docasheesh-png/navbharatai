// Create the backend service on Render, instead of asking the user to do it by hand (admin 2026-09-04).
//
// 🔴 THE STEP THIS REMOVES. `deployBackendToRender` MATCHES an existing service and, finding none,
// returned an honest instruction: *"One-time step: in Render → New → Blueprint, pick your repo."* True,
// and still a wall — the user leaves NavBharatAI, works in someone else's dashboard, and comes back.
// After the "Put this app in my GitHub" action landed, that hand-off was the ONLY manual step left
// between an app and a live site.
//
// Render's API can create the service, so the wall was ours, not theirs.
//
// 🔒 WHAT THIS DELIBERATELY WILL NOT DO — the honest boundary. Render builds from a repo it has GitHub
// access to. If the user has never authorised Render's GitHub app for that repo, the create is REFUSED
// by Render, and no amount of retrying changes it. That refusal is reported with the real next step
// (authorise the repo, once) rather than dressed up as a generic error — because a one-time
// authorisation the user must perform is exactly the kind of fact this codebase keeps learning not to
// hide behind a spinner.
//
// PURE builders + a never-throwing orchestration, in the same shape as renderDeploy.ts.

const RENDER_API_BASE = 'https://api.render.com/v1';

export interface RenderRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

function renderHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/** Whose Render account are we creating in? Required by the create call. */
export function buildListOwnersRequest(apiKey: string): RenderRequest {
  return { url: `${RENDER_API_BASE}/owners?limit=20`, method: 'GET', headers: renderHeaders(apiKey) };
}

/** Normalise an `/owners` item (`{ owner: {...} }` or the object itself). Pure. */
export function parseRenderOwnerId(raw: any): string | null {
  const o = raw && typeof raw === 'object' ? (raw.owner ?? raw) : null;
  return o && typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null;
}

export interface ServiceCommands {
  buildCommand: string;
  startCommand: string;
}

/**
 * The build and start commands, READ FROM THE APP'S OWN package.json — never invented.
 *
 * 🔒 A GUESSED START COMMAND IS A SERVICE THAT BUILDS AND THEN CRASHES, which is worse than not
 * creating one: the user gets a real Render service, a real bill, and a dead site, and nothing in our
 * UI knows it is dead. So a project with no usable `start` yields **null**, and the caller falls back
 * to the honest hand-off it always had.
 *
 * `build` is optional — plenty of Node servers need no build step, and demanding one would refuse
 * apps that are perfectly deployable. `start` is not optional: it IS the service.
 */
export function deriveServiceCommands(packageJsonRaw: string | null | undefined): ServiceCommands | null {
  if (!packageJsonRaw) return null;
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(String(packageJsonRaw)) as { scripts?: Record<string, unknown> };
    if (pkg && typeof pkg.scripts === 'object' && pkg.scripts) scripts = pkg.scripts;
  } catch {
    return null;
  }
  const has = (name: string): boolean => typeof scripts[name] === 'string' && String(scripts[name]).trim() !== '';
  if (!has('start')) return null;
  return {
    buildCommand: has('build') ? 'npm install && npm run build' : 'npm install',
    startCommand: 'npm start',
  };
}

export interface CreateServiceInput {
  ownerId: string;
  name: string;
  repoUrl: string;
  branch: string;
  commands: ServiceCommands;
  /**
   * The environment the service boots with — the user's own saved keys, planned by `planBackendEnv`.
   *
   * 🔴 OMITTING THIS WAS A REAL DEFECT, not a missing nicety (found by audit 2026-09-05). The PREVIEW
   * app is given these keys before it runs; the deployed service was given none, so an app reading
   * `DATABASE_URL` worked on screen, built on Render, crashed on boot — and we reported "deployed".
   * Optional so an app that needs nothing sends nothing.
   */
  envVars?: Array<{ key: string; value: string }>;
}

/**
 * Build the create-service request.
 *
 * `plan: 'free'` and `autoDeploy: 'yes'` are deliberate: this is the USER'S Render account, so the
 * default must be the option that cannot surprise them with a bill, and a service that redeploys on
 * push is what makes every later NavBharatAI change reach their site without another button.
 */
export function buildCreateServiceRequest(apiKey: string, input: CreateServiceInput): RenderRequest {
  return {
    url: `${RENDER_API_BASE}/services`,
    method: 'POST',
    headers: renderHeaders(apiKey),
    body: JSON.stringify({
      type: 'web_service',
      name: input.name,
      ownerId: input.ownerId,
      repo: input.repoUrl,
      branch: input.branch || 'main',
      autoDeploy: 'yes',
      // Sent at CREATE time only. Render's env-var API REPLACES the whole set, so writing to an
      // existing service would silently delete anything the user added in Render's own dashboard —
      // see the deploy route, which reports what an existing service is missing instead of rewriting it.
      ...(input.envVars && input.envVars.length > 0 ? { envVars: input.envVars } : {}),
      serviceDetails: {
        env: 'node',
        plan: 'free',
        envSpecificDetails: {
          buildCommand: input.commands.buildCommand,
          startCommand: input.commands.startCommand,
        },
      },
    }),
  };
}

/** The created service, narrowed to what we use. */
export interface CreatedService {
  id: string;
  name: string;
  serviceUrl: string;
}

/** Normalise a create response (`{ service: {...} }` or the service itself). Pure. */
export function parseCreatedService(raw: any): CreatedService | null {
  const s = raw && typeof raw === 'object' ? (raw.service ?? raw) : null;
  if (!s || typeof s.id !== 'string' || !s.id.trim()) return null;
  return {
    id: s.id.trim(),
    name: typeof s.name === 'string' ? s.name : '',
    serviceUrl: typeof s.serviceUrl === 'string' ? s.serviceUrl : (typeof s.url === 'string' ? s.url : ''),
  };
}

/**
 * A Render refusal that a retry can never fix, turned into the step that actually fixes it.
 *
 * The single most likely one is GitHub access: Render can only build a repo its GitHub app can read,
 * and a user who has never authorised it gets a 400/403 whose raw text means nothing to them.
 */
export function createFailureMessage(status: number, body: unknown, repoPath: string): string {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  const mentionsRepo = /repo|permission|access|not found|unauthor/i.test(raw);
  if (status === 401) {
    return 'Your backend host rejected the key. Save a valid RENDER_API_KEY under Settings → Secrets & API Keys and try again.';
  }
  if (status === 402) {
    return 'Your backend host says this account cannot add another free service right now. Free up a service there, or upgrade that account, then press Deploy backend again.';
  }
  if (status === 403 || status === 404 || (status === 400 && mentionsRepo)) {
    return `Your backend host cannot read ${repoPath} yet. Open Render → Account Settings → GitHub and give it access to that repository (one time), then press Deploy backend again.`;
  }
  return `Your backend host refused to create the service (HTTP ${status}). Nothing was created, and your app is unchanged.`;
}

export type CreateServiceResult =
  | { ok: true; service: CreatedService }
  | { ok: false; reason: 'no-owner' | 'no-commands' | 'refused'; message: string };

/**
 * Create the user's backend service on Render. NEVER throws — every branch returns a reason the caller
 * can show verbatim, and a failure always leaves the honest hand-off available underneath.
 */
export async function createRenderService(
  opts: {
    apiKey: string; name: string; repoUrl: string; repoPath: string; branch?: string;
    packageJson?: string | null;
    /** The environment to boot with — see CreateServiceInput.envVars. */
    envVars?: Array<{ key: string; value: string }>;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<CreateServiceResult> {
  const apiKey = String(opts.apiKey ?? '').trim();
  const commands = deriveServiceCommands(opts.packageJson);
  if (!commands) {
    // Refusing here is the point: a service created with an invented start command builds, crashes,
    // and bills the user for a dead site that our UI would report as deployed.
    return {
      ok: false,
      reason: 'no-commands',
      message: 'We could not tell how your app starts (no "start" script in package.json), so we did not create a service that would fail to run. Add a start script, or set the service up yourself in Render.',
    };
  }
  try {
    const ownersReq = buildListOwnersRequest(apiKey);
    const ownersRes = await fetchImpl(ownersReq.url, { method: ownersReq.method, headers: ownersReq.headers });
    if (!ownersRes.ok) {
      return { ok: false, reason: 'no-owner', message: createFailureMessage(ownersRes.status, await ownersRes.text().catch(() => ''), opts.repoPath) };
    }
    const ownersJson = await ownersRes.json().catch(() => null);
    const ownerId = (Array.isArray(ownersJson) ? ownersJson : []).map(parseRenderOwnerId).find((id): id is string => !!id) ?? null;
    if (!ownerId) {
      return { ok: false, reason: 'no-owner', message: 'We could not read your backend host account, so nothing was created. Try again in a moment.' };
    }

    const req = buildCreateServiceRequest(apiKey, {
      ownerId, name: opts.name, repoUrl: opts.repoUrl, branch: opts.branch || 'main', commands,
      envVars: opts.envVars,
    });
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
    if (!res.ok) {
      return { ok: false, reason: 'refused', message: createFailureMessage(res.status, await res.text().catch(() => ''), opts.repoPath) };
    }
    const service = parseCreatedService(await res.json().catch(() => null));
    if (!service) {
      // A 2xx we cannot read is NOT a success: claiming one would leave the caller pointing a domain at
      // a service whose address we never learned.
      return { ok: false, reason: 'refused', message: 'Your backend host accepted the request but did not tell us the new service. Open Render to check, then press Deploy backend again.' };
    }
    return { ok: true, service };
  } catch (e) {
    return { ok: false, reason: 'refused', message: `Could not reach your backend host: ${e instanceof Error ? e.message : String(e)}. Nothing was created.` };
  }
}

/**
 * WHAT ENVIRONMENT DOES AN *EXISTING* SERVICE ALREADY HAVE?
 *
 * 🔒 READ-ONLY, AND DELIBERATELY SO. Render's env-var API REPLACES the entire set, so "helpfully"
 * writing our keys into a service the user already runs would delete every variable they added in
 * Render's own dashboard — a destructive fix for a reporting problem. Creation is the one moment we
 * can set an environment without taking anything away; after that, the honest move is to say what is
 * absent and let the user decide.
 */
export function buildListEnvVarsRequest(apiKey: string, serviceId: string): RenderRequest {
  return {
    url: `${RENDER_API_BASE}/services/${encodeURIComponent(serviceId)}/env-vars?limit=100`,
    method: 'GET',
    headers: renderHeaders(apiKey),
  };
}

/** The variable NAMES a service has set. Values are never read — we do not need them, so we do not take them. */
export function parseEnvVarKeys(raw: any): string[] {
  const rows = Array.isArray(raw) ? raw : [];
  const keys: string[] = [];
  for (const row of rows) {
    const item = row && typeof row === 'object' ? (row.envVar ?? row) : null;
    const key = item && typeof item.key === 'string' ? item.key.trim() : '';
    if (key) keys.push(key);
  }
  return keys;
}

/**
 * The names an existing service has, or **null** when we could not find out.
 *
 * 🔒 NULL IS NOT AN EMPTY SET. Treating an unreadable response as "it has nothing" would report every
 * required variable as missing and send the user to fix a problem that may not exist; treating it as
 * "it has everything" would hide a real one. Only a genuine answer produces a verdict — the caller
 * says it could not check. Never throws.
 */
export async function fetchServiceEnvKeys(
  apiKey: string,
  serviceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | null> {
  try {
    const req = buildListEnvVarsRequest(apiKey, serviceId);
    const res = await fetchImpl(req.url, { method: req.method, headers: req.headers });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json === null ? null : parseEnvVarKeys(json);
  } catch {
    return null;
  }
}
