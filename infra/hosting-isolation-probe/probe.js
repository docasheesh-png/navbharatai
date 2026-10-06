// NavBharat Cloud — ISOLATION PROBE. Hosted exactly like a user's app, it acts like a HOSTILE one: from
// inside the build (npm postinstall) and inside the running container it takes the identity's token from
// the metadata server and tries to reach everything a compromised app would want. It reports what Google
// actually answered — the only evidence that counts. See docs/HOSTING_ARCHITECTURE.md §11.
//
//   build   → runs during `npm install` on Cloud Build; writes build-result.json (baked into the image)
//   serve   → the running app: GET /  = runtime result,  GET /build = what the build saw
//
// It never fails the build and never prints a token. No dependencies.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MD = 'http://metadata.google.internal/computeMetadata/v1';
const PLATFORM_PROJECT = 'gen-lang-client-0866594388';
const SENSITIVE = [
  'run.services.list', 'run.services.get', 'run.services.update', 'run.services.delete', 'run.services.setIamPolicy',
  'storage.buckets.list', 'storage.objects.list', 'storage.objects.get', 'storage.objects.create', 'storage.objects.delete',
  'artifactregistry.repositories.downloadArtifacts', 'artifactregistry.repositories.uploadArtifacts',
  'artifactregistry.tags.update', 'artifactregistry.versions.delete',
  'secretmanager.secrets.list', 'secretmanager.versions.access',
  'cloudbuild.builds.create', 'cloudbuild.builds.list',
  'iam.serviceAccounts.actAs', 'iam.serviceAccounts.getAccessToken', 'iam.serviceAccountKeys.create',
  'resourcemanager.projects.getIamPolicy', 'resourcemanager.projects.setIamPolicy',
  'logging.logEntries.list', 'logging.logEntries.create', 'datastore.entities.get', 'firebase.projects.get',
];

async function md(p) {
  try {
    const r = await fetch(`${MD}/${p}`, { headers: { 'Metadata-Flavor': 'Google' } });
    return r.ok ? (await r.text()).trim() : null;
  } catch { return null; }
}

async function call(token, method, url, body) {
  try {
    const r = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json };
  } catch (e) {
    return { status: 0, json: { error: String(e && e.message || e) } };
  }
}

async function granted(token, project) {
  const r = await call(token, 'POST', `https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`, { permissions: SENSITIVE });
  if (r.status !== 200) return { status: r.status, granted: null };
  return { status: 200, granted: Array.isArray(r.json && r.json.permissions) ? r.json.permissions : [] };
}

async function probe(phase) {
  const email = await md('instance/service-accounts/default/email');
  const project = await md('project/project-id');
  const regionPath = await md('instance/region'); // projects/<n>/regions/<region> on Cloud Run
  const region = (regionPath || '').split('/').pop() || process.env.PROBE_REGION || 'asia-south1';
  const tokenRaw = await md('instance/service-accounts/default/token');
  let token = null;
  try { token = tokenRaw ? JSON.parse(tokenRaw).access_token : null; } catch { token = null; }

  const out = {
    phase, at: new Date().toISOString(), identity: email, project, region,
    identityIsDefault: /-compute@developer\.gserviceaccount\.com$|@appspot\.gserviceaccount\.com$|@cloudbuild\.gserviceaccount\.com$/.test(email || ''),
    tokenAvailable: !!token, attempts: [], grantedOnAppsProject: null, grantedOnPlatformProject: null, verdict: 'UNKNOWN', notes: [],
  };
  if (!token || !project) { out.notes.push('No metadata token or project — cannot judge; this is NOT a pass.'); return out; }

  const tries = [
    ['List Cloud Run services (other apps)', 'GET', `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services`],
    ['List storage buckets', 'GET', `https://storage.googleapis.com/storage/v1/b?project=${project}`],
    ['List staged build sources (other apps\' code)', 'GET', `https://storage.googleapis.com/storage/v1/b/${project}_cloudbuild/o?prefix=nbai-source/`],
    ['List image repositories', 'GET', `https://artifactregistry.googleapis.com/v1/projects/${project}/locations/${region}/repositories`],
    ['List images in nbai-apps (other apps\' images)', 'GET', `https://artifactregistry.googleapis.com/v1/projects/${project}/locations/${region}/repositories/nbai-apps/packages`],
    ['List secrets', 'GET', `https://secretmanager.googleapis.com/v1/projects/${project}/secrets`],
    ['List builds', 'GET', `https://cloudbuild.googleapis.com/v1/projects/${project}/locations/${region}/builds`],
    ['List service accounts', 'GET', `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`],
    ['Read project IAM policy', 'POST', `https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`, {}],
    ['Read project logs', 'POST', 'https://logging.googleapis.com/v2/entries:list', { resourceNames: [`projects/${project}`], pageSize: 1 }],
    ['Control plane: Firestore of the platform', 'GET', `https://firestore.googleapis.com/v1/projects/${PLATFORM_PROJECT}/databases/(default)/documents/users?pageSize=1`],
    ['Control plane: platform Cloud Run', 'GET', `https://run.googleapis.com/v2/projects/${PLATFORM_PROJECT}/locations/asia-southeast1/services`],
  ];
  for (const [name, method, url, body] of tries) {
    const r = await call(token, method, url, body);
    out.attempts.push({ name, status: r.status, denied: r.status === 401 || r.status === 403 });
  }
  const apps = await granted(token, project);
  const plat = await granted(token, PLATFORM_PROJECT);
  out.grantedOnAppsProject = apps.granted;
  out.grantedOnPlatformProject = plat.granted;

  // The runtime must reach NOTHING. The build may hold exactly what a build needs, at the RESOURCE level
  // (the repository and the staging bucket), so at PROJECT level only log writing may appear.
  const allowedAtProject = phase === 'build' ? ['logging.logEntries.create'] : [];
  const extraApps = (apps.granted || []).filter((p) => !allowedAtProject.includes(p));
  const deniedAll = out.attempts.every((a) => a.denied || (phase === 'build' && /staged build sources|images in nbai-apps|image repositories/.test(a.name)));
  const platformClean = Array.isArray(plat.granted) ? plat.granted.length === 0 : plat.status === 403;
  if (phase === 'build') {
    for (const a of out.attempts) if (!a.denied && /staged build sources|images in nbai-apps/.test(a.name)) {
      out.notes.push(`RESIDUAL (shared build identity): "${a.name}" answered ${a.status}. A malicious build can read what every build can.`);
    }
  }
  out.verdict = !out.identityIsDefault && apps.granted !== null && extraApps.length === 0 && deniedAll && platformClean ? 'ISOLATED' : 'NOT ISOLATED';
  if (out.identityIsDefault) out.notes.push('Runs as a Google DEFAULT account — the P0 itself.');
  if (extraApps.length) out.notes.push(`Project-level permissions held: ${extraApps.join(', ')}`);
  if (!platformClean) out.notes.push('Has permissions on the PLATFORM project — control-plane exposure.');
  return out;
}

const RESULT_FILE = path.join(__dirname, 'build-result.json');

if (process.argv[2] === 'build') {
  probe('build').then((r) => {
    try { fs.writeFileSync(RESULT_FILE, JSON.stringify(r, null, 2)); } catch { /* best effort */ }
    console.log(`[isolation-probe] build verdict: ${r.verdict} as ${r.identity}`);
  }).catch((e) => console.log(`[isolation-probe] build probe error: ${e && e.message}`)).finally(() => process.exit(0));
} else {
  const port = Number(process.env.PORT) || 8080;
  http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/build') {
      res.end(fs.existsSync(RESULT_FILE) ? fs.readFileSync(RESULT_FILE) : JSON.stringify({ verdict: 'UNKNOWN', notes: ['The build probe did not run.'] }));
      return;
    }
    res.end(JSON.stringify(await probe('runtime'), null, 2));
  }).listen(port);
}
