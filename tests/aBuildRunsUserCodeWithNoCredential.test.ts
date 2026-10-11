// A BUILD RUNS THE APP'S OWN CODE WITH NO WAY TO A CREDENTIAL (admin 2026-10-11, Q-706 gap a: "this session
// designs the credential-less build step; the admin verifies it in Cloud Shell on real Cloud Build before it is
// claimed").
//
// THE GAP: `npm install` runs the app's `postinstall` as the shared build identity, so a hostile script could take
// that identity's token from the metadata server and read other apps' images and staged sources. THE DESIGN: the
// metadata route is dropped for build containers, the untrusted phase never holds the Docker socket, and only
// Cloud Build itself — after the untrusted step exited — pushes. OFF until the Cloud Shell check passes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildJobConfig, credentiallessBuildConfig, credentiallessBuildEnabled, credentiallessBuildSteps, metadataBlockScript,
  METADATA_ADDRESS, buildCreateBuildRequest,
} from '../src/server/AgentV3/containerBuild';

const IMAGE = 'asia-south1-docker.pkg.dev/apps/nbai-apps/svc:tag';
const SA = 'projects/apps/serviceAccounts/nbai-app-builder@apps.iam.gserviceaccount.com';

describe('🔒 off until the admin has verified it', () => {
  it('unset, off or junk means the build runs exactly as before', () => {
    for (const v of [undefined, '', 'off', 'false', 'maybe']) {
      expect(credentiallessBuildEnabled({ NAVBHARAT_APPS_CREDENTIALLESS_BUILD: v } as NodeJS.ProcessEnv)).toBe(false);
    }
    expect(credentiallessBuildEnabled({ NAVBHARAT_APPS_CREDENTIALLESS_BUILD: 'on' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('the default job is byte-for-byte the old one: pack publishes, Cloud Build pushes nothing', () => {
    const job = buildJobConfig({ image: IMAGE, serviceAccount: SA });
    expect(job.steps).toEqual([{ name: 'gcr.io/k8s-skaffold/pack', entrypoint: 'pack', args: ['build', IMAGE, '--builder=gcr.io/buildpacks/builder:v1', '--path=.', '--publish'] }]);
    expect(job).not.toHaveProperty('images');
    expect(job.serviceAccount).toBe(SA);
  });
});

describe('🔒 the credential-less job', () => {
  const job = credentiallessBuildConfig(IMAGE, SA) as { steps: Array<{ id: string; args: string[]; volumes?: unknown }>; images: string[]; serviceAccount: string };

  it('closes the metadata route BEFORE any user code runs', () => {
    expect(job.steps[0].id).toBe('block-metadata');
    expect(job.steps[0].args).toContain('--privileged');
    expect(metadataBlockScript()).toContain(`-d ${METADATA_ADDRESS} -j DROP`);
  });

  it('fails CLOSED: a build that could not close the route never runs user code', () => {
    expect(metadataBlockScript()).toMatch(/\[ "\$ok" = 1 \] \|\| \{[^}]*exit 1; \}/);
  });

  it('the untrusted step cannot push, cannot reach the socket, and runs the phases apart', () => {
    const build = job.steps[1];
    expect(build.id).toBe('build-untrusted');
    expect(build.args).not.toContain('--publish');
    expect(build.args).toContain('--trust-builder=false');
    expect(build.volumes).toBeUndefined();
  });

  it('only Cloud Build pushes, after the untrusted step exited, as the dedicated build identity', () => {
    expect(job.images).toEqual([IMAGE]);
    expect(job.serviceAccount).toBe(SA);
  });

  it('the server sends exactly this job when the mode is on', () => {
    const req = buildCreateBuildRequest('t', 'apps', 'asia-south1', { bucket: 'b', object: 'o', image: IMAGE, serviceAccount: SA, credentialless: true });
    const body = JSON.parse(String(req.body));
    expect(body.source).toEqual({ storageSource: { bucket: 'b', object: 'o' } });
    expect(body.steps).toEqual(credentiallessBuildSteps(IMAGE));
    expect(body.images).toEqual([IMAGE]);
  });
});

describe('🔒 the Cloud Shell check runs the server\'s own job', () => {
  const printer = readFileSync('scripts/printCredentiallessBuild.ts', 'utf8');
  const check = readFileSync('scripts/verifyCredentiallessBuild.sh', 'utf8');

  it('the config is printed from containerBuild.ts, never copied', () => {
    expect(printer).toContain("from '../src/server/AgentV3/containerBuild'");
    expect(printer).toContain('credentiallessBuildConfig(image, serviceAccount)');
    expect(check).toContain('npx --yes tsx scripts/printCredentiallessBuild.ts');
  });

  it('it looks for the very line the block step prints, and for the probe\'s view from inside npm install', () => {
    const marker = /echo "(NBAI: metadata route blocked for build containers)"/.exec(metadataBlockScript())?.[1];
    expect(marker).toBeTruthy();
    expect(check).toContain(`grep -q "${marker}"`);
    expect(check).toContain('build-result.json');
    expect(check).toMatch(/"identity": \*null/);
  });

  it('the server reads the mode where it starts a build', () => {
    expect(readFileSync('src/server/AgentV3/containerBuild.ts', 'utf8')).toContain('credentialless: credentiallessBuildEnabled(),');
  });
});
