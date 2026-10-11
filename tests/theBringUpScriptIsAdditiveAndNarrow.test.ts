// THE BRING-UP SCRIPT IS ADDITIVE AND NARROW (2026-10-07).
//
// scripts/navbharatCloudBringUp.sh is the one command an owner runs to create the hosting identities, the
// staging bucket, the custom roles and their bindings. It runs with OWNER rights, so a careless edit is a
// production IAM change. These checks keep it to the C-3 design: it only adds, it never grants a broad role,
// the runtime account receives nothing, and the custom roles hold exactly the permissions the code uses.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const script = readFileSync(join(__dirname, '..', 'scripts', 'navbharatCloudBringUp.sh'), 'utf8');
const code = script.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const gcloudLines = code.split('\n').filter((l) => /\bgcloud\b/.test(l));

/** Every permission the platform's own calls need, each traced to its call site. */
const TRACED: Record<string, string[]> = {
  nbaiPlatformRun: [
    'run.services.create',      // cloudRunHosting.ts buildCreateServiceRequest
    'run.services.get',         // buildGetServiceRequest (readiness wait)
    'run.services.list',        // buildListServicesRequest (preflight, removeWorkspaceServers)
    'run.services.update',      // buildUpdateServiceRequest (409 → PATCH)
    'run.services.delete',      // buildDeleteServiceRequest (takedown, failed first deploy)
    'run.services.setIamPolicy', // buildMakePublicRequest
    'run.revisions.list',       // imageRetention.ts (images still referenced by a revision)
  ],
  nbaiPlatformBuild: ['cloudbuild.builds.create', 'cloudbuild.builds.get', 'cloudbuild.builds.list'],
  nbaiPlatformRegistry: [
    'artifactregistry.repositories.get',   // preflight
    'artifactregistry.tags.get',           // containerBuild.ts digest pin
    'artifactregistry.tags.delete',        // force-delete of a tagged version
    'artifactregistry.dockerimages.list',  // imageRetention.ts
    'artifactregistry.versions.delete',    // imageRetention.ts
  ],
  // No storage.buckets.get on purpose: the preflight lists objects instead (hostingPreflight.ts).
  nbaiPlatformStaging: ['storage.objects.create', 'storage.objects.delete', 'storage.objects.list'],
  nbaiBuildSourceReader: ['storage.objects.get'],
};

function scriptRoles(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of script.matchAll(/^\s*"(nbai[A-Za-z]+)\|[^|]*\|([a-z.,A-Z]+)"\s*$/gm)) out[m[1]] = m[2].split(',').sort();
  return out;
}

describe('the bring-up script', () => {
  it('🔒 its custom roles hold EXACTLY the traced permissions — nothing more, nothing missing', () => {
    const roles = scriptRoles();
    expect(Object.keys(roles).sort()).toEqual(Object.keys(TRACED).sort());
    for (const [id, perms] of Object.entries(TRACED)) expect(roles[id], id).toEqual([...perms].sort());
  });

  it('🔒 only ADDS: no removal, no deletion, no policy overwrite', () => {
    const offenders = gcloudLines.filter((l) => /\b(remove-iam-policy-binding|set-iam-policy|delete|disable|undelete)\b/.test(l));
    expect(offenders).toEqual([]);
  });

  it('🔒 never grants a broad or secret-reading role to anybody', () => {
    expect(code).not.toMatch(/roles\/(editor|owner|storage\.admin|run\.admin|iam\.serviceAccountAdmin|iam\.serviceAccountTokenCreator|secretmanager\.[a-zA-Z]+|datastore\.[a-zA-Z]+|firebase\.[a-zA-Z]+|cloudbuild\.builds\.editor)/);
  });

  it('🔒 the RUNTIME account receives no binding of any kind', () => {
    expect(gcloudLines.filter((l) => /add-iam-policy-binding/.test(l) && /--member="serviceAccount:\$RUNTIME"/.test(l))).toEqual([]);
  });

  it('🔒 the BUILDER receives exactly: push on the repo, read on the bucket, log writing', () => {
    const roles = gcloudLines.filter((l) => /--member="serviceAccount:\$BUILD"/.test(l)).map((l) => l.match(/--role=("?)([^"\s]+)\1/)?.[2]);
    expect(roles.sort()).toEqual(['projects/$P/roles/nbaiBuildSourceReader', 'roles/artifactregistry.writer', 'roles/logging.logWriter'].sort());
  });

  it('🔒 actAs is granted ON the two accounts, never at project level', () => {
    const sau = gcloudLines.filter((l) => /roles\/iam\.serviceAccountUser/.test(l));
    expect(sau.length).toBe(2);
    for (const l of sau) expect(l).toMatch(/gcloud iam service-accounts add-iam-policy-binding "\$(RUNTIME|BUILD)"/);
  });

  it('asks before every change and keeps a snapshot first', () => {
    expect(code).toMatch(/apply\(\) \{\s*\n\s*snapshot\s*\n\s*validate\s*\n\s*ask /);
    expect(code).toMatch(/wire\(\) \{[\s\S]*?ask /);
  });
});
