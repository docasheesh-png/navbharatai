import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  managedBackendConfig, uidHandle, appSlug, serviceNameFor, subdomainFor, imagePathFor,
  cloudRunServiceBody, buildStartBuildRequest, buildCreateServiceRequest, buildSetPublicRequest,
  parseBuildStatus, parseServiceStatus, startManagedDeploy,
} from './cloudRunBackend';
import { limitsForPlan } from './backendLimits';

const ENV_KEYS = ['MANAGED_BACKEND_GCP_PROJECT', 'MANAGED_BACKEND_BUILD_BUCKET', 'MANAGED_BACKEND_REGION', 'MANAGED_BACKEND_AR_REPO'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('cloudRunBackend config + naming', () => {
  it('lists EVERY missing env at once, and defaults region to Mumbai', () => {
    const cfg = managedBackendConfig({} as NodeJS.ProcessEnv);
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toEqual(['MANAGED_BACKEND_GCP_PROJECT', 'MANAGED_BACKEND_BUILD_BUCKET']);
    expect(cfg.region).toBe('asia-south1');
    const ok = managedBackendConfig({ MANAGED_BACKEND_GCP_PROJECT: 'p', MANAGED_BACKEND_BUILD_BUCKET: 'b' } as NodeJS.ProcessEnv);
    expect(ok.configured).toBe(true);
    expect(ok.arRepo).toBe('nb-user-apps');
  });

  it('derives stable, legal, non-reversible names', () => {
    expect(uidHandle('user-1')).toHaveLength(8);
    expect(uidHandle('user-1')).toBe(uidHandle('user-1'));
    expect(uidHandle('user-1')).not.toBe(uidHandle('user-2'));
    expect(appSlug('My Shop!! App')).toBe('my-shop-app');
    expect(appSlug('---')).toBe('app');
    const svc = serviceNameFor('user-1', 'My Shop!! App');
    expect(svc).toMatch(/^nb-[0-9a-f]{8}-my-shop-app$/);
    expect(svc.length).toBeLessThanOrEqual(63);
    expect(subdomainFor('user-1', 'My Shop!! App')).toBe(`my-shop-app-${uidHandle('user-1')}`);
  });

  it('builds the image path inside the configured Artifact Registry', () => {
    const cfg = managedBackendConfig({ MANAGED_BACKEND_GCP_PROJECT: 'proj', MANAGED_BACKEND_BUILD_BUCKET: 'b' } as NodeJS.ProcessEnv);
    expect(imagePathFor(cfg, 'nb-x-app', '123')).toBe('asia-south1-docker.pkg.dev/proj/nb-user-apps/nb-x-app:123');
  });
});

describe('cloudRunBackend request shapes', () => {
  const limits = limitsForPlan('managed_backend');

  it('service body carries the plan limits — never unlimited', () => {
    const body = cloudRunServiceBody({ image: 'img', limits, env: { A: '1', B: '2' } });
    expect(body.template.containers[0].resources.limits).toEqual({ cpu: '1', memory: '512Mi' });
    expect(body.template.scaling.maxInstanceCount).toBe(limits.maxInstances);
    expect(body.template.maxInstanceRequestConcurrency).toBe(limits.concurrency);
    expect(body.template.timeout).toBe(`${limits.timeoutSeconds}s`);
    expect(body.template.containers[0].env).toEqual([{ name: 'A', value: '1' }, { name: 'B', value: '2' }]);
    expect(body.labels['nbai-managed']).toBe('true');
  });

  it('build request points Cloud Build at the uploaded source and the target image', () => {
    const req = buildStartBuildRequest('tok', { project: 'p', bucket: 'b', object: 'o.tgz', image: 'img:1' });
    expect(req.url).toBe('https://cloudbuild.googleapis.com/v1/projects/p/builds');
    const body = JSON.parse(req.body as string);
    expect(body.source.storageSource).toEqual({ bucket: 'b', object: 'o.tgz' });
    expect(body.steps[0].args).toEqual(['build', '-t', 'img:1', '.']);
    expect(body.images).toEqual(['img:1']);
  });

  it('create-service and set-public requests target the right v2 endpoints', () => {
    const create = buildCreateServiceRequest('t', { project: 'p', region: 'asia-south1', serviceId: 'svc', body: { a: 1 } });
    expect(create.url).toBe('https://run.googleapis.com/v2/projects/p/locations/asia-south1/services?serviceId=svc');
    const pub = buildSetPublicRequest('t', 'p', 'asia-south1', 'svc');
    expect(pub.url).toContain('/services/svc:setIamPolicy');
    expect(JSON.parse(pub.body as string).policy.bindings[0]).toEqual({ role: 'roles/run.invoker', members: ['allUsers'] });
  });

  it('parses build and service states without inventing success', () => {
    expect(parseBuildStatus({ status: 'WORKING' }).phase).toBe('WORKING');
    expect(parseBuildStatus({ status: 'weird' }).phase).toBe('UNKNOWN');
    expect(parseBuildStatus(null).phase).toBe('UNKNOWN');
    expect(parseServiceStatus({ uri: 'https://x.run.app', terminalCondition: { type: 'Ready', state: 'CONDITION_SUCCEEDED' } }))
      .toEqual({ ready: true, url: 'https://x.run.app', deployedImage: null });
    expect(parseServiceStatus({}).ready).toBe(false);
  });
});

describe('startManagedDeploy honest gates (no GCP needed)', () => {
  it('fails at config naming the missing envs', async () => {
    const r = await startManagedDeploy({ serviceId: 's', files: {}, appName: 'a', tag: '1', env: {} as NodeJS.ProcessEnv });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('config');
      expect(r.message).toContain('MANAGED_BACKEND_GCP_PROJECT');
    }
  });

  it('fails at source for a missing package.json, invalid JSON, and a missing start script', async () => {
    const env = { MANAGED_BACKEND_GCP_PROJECT: 'p', MANAGED_BACKEND_BUILD_BUCKET: 'b' } as NodeJS.ProcessEnv;
    const noPkg = await startManagedDeploy({ serviceId: 's', files: { 'a.js': '' }, appName: 'a', tag: '1', env });
    expect(!noPkg.ok && noPkg.stage === 'source' && noPkg.message.includes('package.json')).toBe(true);

    const badJson = await startManagedDeploy({ serviceId: 's', files: { 'package.json': '{oops' }, appName: 'a', tag: '1', env });
    expect(!badJson.ok && badJson.stage === 'source' && badJson.message.includes('valid JSON')).toBe(true);

    const noStart = await startManagedDeploy({ serviceId: 's', files: { 'package.json': '{"scripts":{}}' }, appName: 'a', tag: '1', env });
    expect(!noStart.ok && noStart.stage === 'source' && noStart.message.includes('start')).toBe(true);
  });
});
