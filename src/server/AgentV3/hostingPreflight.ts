// IS THE APPS PROJECT ACTUALLY READY? — the check that turns a cryptic 403 into a named next step.
//
// 🔴 WHY THIS EXISTS. Turning on app hosting is not one setting; it is a new Google Cloud project, four
// APIs, one Artifact Registry repository, six IAM roles and one env var — spread across a console this
// session cannot see. Get any of them wrong and the FIRST symptom is a 403 buried in a Cloud Build log,
// on a user's publish, hours later. The admin would be told "publish failed" and have no way to learn
// which of eleven steps was the one they missed.
//
// So the setup is checked from the same code that will use it, against the same project, with the same
// credentials — and every failure names the exact remedy.
//
// 🔒 THREE HONESTY RULES, because a setup checker that lies is worse than no checker at all:
//
//  1. A CHECK THAT COULD NOT RUN IS `skipped`, NEVER `ok`. If the project is not configured there is
//     nothing to ask Google about, and reporting those checks as passing would certify a setup that was
//     never tested.
//  2. A 403 IS TWO COMPLETELY DIFFERENT PROBLEMS, and telling them apart is most of this module's value.
//     Google returns 403 both for "this API is not enabled" and for "you lack the role" — and sending an
//     admin to the IAM screen when the real fix is the API screen wastes the afternoon this file exists
//     to save. The distinction is in the error payload, so it is parsed, not guessed.
//  3. AN UNRECOGNISED FAILURE IS `unknown`, NOT `failed`. "Something we do not understand" and "your
//     setup is wrong" are different claims, and only one of them is verified.
//
// PURE classification + one thin request per check.

import { appsProject, appsRegion, buildListServicesRequest } from './cloudRunHosting';
import { appsImageRepo, BUILD_API } from './containerBuild';
import { MONITORING_API } from './hostingUsage';

export const ARTIFACT_REGISTRY_API = 'https://artifactregistry.googleapis.com/v1';

export type CheckState = 'ok' | 'failed' | 'skipped' | 'unknown';

export interface PreflightCheck {
  id: string;
  label: string;
  state: CheckState;
  /** What was actually observed. Empty when there is nothing to add beyond the state. */
  detail: string;
  /** The exact next action, or '' when there is nothing to do. */
  remedy: string;
}

/**
 * What a Google error body is really saying.
 *
 * A disabled API answers 403 with `reason: SERVICE_DISABLED`, or a message of the shape
 * "… API has not been used in project … before or it is disabled". A missing role answers 403 with
 * neither. Both are 403, and they need opposite fixes. PURE.
 */
export function isApiDisabled(status: number, body: unknown): boolean {
  if (status !== 403) return false;
  const b = body && typeof body === 'object' ? body as Record<string, any> : null;
  const err = b?.error ?? {};
  const details = Array.isArray(err.details) ? err.details : [];
  for (const d of details) {
    if (String(d?.reason ?? '') === 'SERVICE_DISABLED') return true;
  }
  const msg = String(err.message ?? '').toLowerCase();
  return msg.includes('has not been used in project') || msg.includes('api is disabled')
    || msg.includes('it is disabled');
}

/**
 * Turn one HTTP answer into a check result. PURE — this is the whole diagnosis, and it is testable
 * without touching Google.
 */
export function classifyResponse(opts: {
  id: string;
  label: string;
  status: number;
  body: unknown;
  apiName: string;
  role: string;
  /** What a 404 means for THIS check. Empty ⇒ a 404 is not an expected outcome here. */
  missingRemedy?: string;
}): PreflightCheck {
  const { id, label, status } = opts;
  if (status >= 200 && status < 300) return { id, label, state: 'ok', detail: '', remedy: '' };
  if (isApiDisabled(status, opts.body)) {
    return {
      id, label, state: 'failed',
      detail: `The ${opts.apiName} is not enabled in this project.`,
      remedy: `Enable the ${opts.apiName} in the apps project (APIs & Services → Enable APIs).`,
    };
  }
  if (status === 403) {
    return {
      id, label, state: 'failed',
      detail: 'Google accepted the request but refused it — the service account lacks permission.',
      remedy: `Grant the platform's service account the "${opts.role}" role in the apps project (IAM → Grant access).`,
    };
  }
  if (status === 404 && opts.missingRemedy) {
    return { id, label, state: 'failed', detail: 'Not found in this project.', remedy: opts.missingRemedy };
  }
  if (status === 401) {
    return {
      id, label, state: 'failed',
      detail: 'The request was not authenticated.',
      remedy: 'The platform could not obtain a Google credential. Check the Cloud Run service account.',
    };
  }
  // 🔒 Anything else is UNKNOWN, not failed — see honesty rule 3.
  return {
    id, label, state: 'unknown',
    detail: `Google answered ${status}, which this check does not recognise.`,
    remedy: 'Re-run the check. If it persists, read the exact response in the server logs.',
  };
}

/** A check that never ran, with the reason. PURE. */
export function skipped(id: string, label: string, why: string): PreflightCheck {
  return { id, label, state: 'skipped', detail: why, remedy: '' };
}

export type PreflightVerdict = 'ready' | 'blocked' | 'incomplete';

/**
 * The one-word answer.
 *
 * 🔒 ONLY ALL-OK IS `ready`. A skipped or unknown check means the setup was not proven, and "we did not
 * check" must never render as "you are good to go" — that is the precise failure this module was built
 * to prevent, applied to its own summary. PURE.
 */
export function preflightVerdict(checks: readonly PreflightCheck[]): PreflightVerdict {
  if (!checks.length) return 'incomplete';
  if (checks.some((c) => c.state === 'failed')) return 'blocked';
  if (checks.every((c) => c.state === 'ok')) return 'ready';
  return 'incomplete';
}

/** The first thing the admin should do, or '' when there is nothing. PURE. */
export function nextAction(checks: readonly PreflightCheck[]): string {
  return checks.find((c) => c.remedy)?.remedy ?? '';
}

export interface PreflightReport {
  verdict: PreflightVerdict;
  projectId: string | null;
  region: string;
  checks: PreflightCheck[];
  nextAction: string;
}

/**
 * Run every check against the real apps project.
 *
 * Order matters: configuration first, then credentials, then one call per API. A failure never stops the
 * run — the admin should see EVERY missing step in one pass, not discover them one deploy at a time.
 */
export async function runHostingPreflight(opts: {
  token: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<PreflightReport> {
  const env = opts.env ?? process.env;
  const region = appsRegion(env);
  const project = appsProject(env);
  const checks: PreflightCheck[] = [];

  checks.push(project.projectId
    ? { id: 'project', label: 'Apps project configured', state: 'ok', detail: project.projectId, remedy: '' }
    : {
      id: 'project', label: 'Apps project configured', state: 'failed',
      detail: project.message,
      remedy: project.problem === 'is-platform-project'
        ? 'Point NAVBHARAT_APPS_PROJECT at the SEPARATE apps project, not NavBharatAI\'s own.'
        : 'Set NAVBHARAT_APPS_PROJECT in Cloud Run to the apps project id.',
    });

  /**
   * End the run early, marking every check that never got to happen.
   *
   * Skips ids ALREADY recorded — otherwise the no-credential path would list "Google credential" twice,
   * once failed and once skipped, and a report that contradicts itself is not a report.
   */
  const blocked = (why: string): PreflightReport => {
    for (const [id, label] of REMOTE_CHECKS) {
      if (!checks.some((c) => c.id === id)) checks.push(skipped(id, label, why));
    }
    return { verdict: preflightVerdict(checks), projectId: project.projectId, region, checks, nextAction: nextAction(checks) };
  };
  if (!project.projectId) return blocked('Not checked — the apps project is not configured yet.');

  if (!opts.token) {
    checks.push({
      id: 'credentials', label: 'Google credential', state: 'failed',
      detail: 'The platform could not obtain a Google access token.',
      remedy: 'Check the Cloud Run service account on navbharat-ai-prod.',
    });
    return blocked('Not checked — no Google credential.');
  }
  checks.push({ id: 'credentials', label: 'Google credential', state: 'ok', detail: '', remedy: '' });

  const doFetch = opts.fetchImpl ?? fetch;
  const ask = async (url: string): Promise<{ status: number; body: unknown }> => {
    try {
      const r = await doFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${opts.token!.trim()}` } });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: 0, body: null };
    }
  };
  const p = project.projectId;

  const run = await ask(buildListServicesRequest(opts.token, p, region, 1).url);
  checks.push(classifyResponse({
    id: 'cloudRun', label: 'Cloud Run', status: run.status, body: run.body,
    apiName: 'Cloud Run Admin API', role: 'Cloud Run Admin',
  }));

  const build = await ask(`${BUILD_API}/projects/${p}/locations/${region}/builds?pageSize=1`);
  checks.push(classifyResponse({
    id: 'cloudBuild', label: 'Cloud Build', status: build.status, body: build.body,
    apiName: 'Cloud Build API', role: 'Cloud Build Editor',
  }));

  const repo = appsImageRepo(env);
  const ar = await ask(`${ARTIFACT_REGISTRY_API}/projects/${p}/locations/${region}/repositories/${repo}`);
  checks.push(classifyResponse({
    id: 'artifactRegistry', label: `Image repository “${repo}”`, status: ar.status, body: ar.body,
    apiName: 'Artifact Registry API', role: 'Artifact Registry Writer',
    // The one check whose 404 is a real, common, and completely fixable answer.
    missingRemedy: `Create a DOCKER repository named “${repo}” in region ${region} (Artifact Registry → Create repository).`,
  }));

  const mon = await ask(`${MONITORING_API}/projects/${p}/timeSeries?`
    + `filter=${encodeURIComponent('metric.type="run.googleapis.com/request_count"')}`
    + `&interval.startTime=${new Date(Date.now() - 600_000).toISOString()}`
    + `&interval.endTime=${new Date().toISOString()}`);
  checks.push(classifyResponse({
    id: 'monitoring', label: 'Usage metering', status: mon.status, body: mon.body,
    apiName: 'Cloud Monitoring API', role: 'Monitoring Viewer',
  }));

  return { verdict: preflightVerdict(checks), projectId: p, region, checks, nextAction: nextAction(checks) };
}

/** The remote checks, named once so a skipped run reports the SAME list a real run would. */
const REMOTE_CHECKS: ReadonlyArray<readonly [string, string]> = [
  ['credentials', 'Google credential'],
  ['cloudRun', 'Cloud Run'],
  ['cloudBuild', 'Cloud Build'],
  ['artifactRegistry', 'Image repository'],
  ['monitoring', 'Usage metering'],
];
