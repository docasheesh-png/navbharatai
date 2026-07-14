import { describe, it, expect } from 'vitest';
import { classifyInfraFile, analyzeDockerfile, analyzeK8sManifest, analyzeTerraform, optimizeInfra, infraOptimizeSummary } from './InfraOptimizer';

describe('classifyInfraFile', () => {
  it('classifies by name and content sniff', () => {
    expect(classifyInfraFile('Dockerfile', 'FROM node')).toBe('dockerfile');
    expect(classifyInfraFile('web.Dockerfile', 'FROM x')).toBe('dockerfile');
    expect(classifyInfraFile('main.tf', 'resource "x" {}')).toBe('terraform');
    expect(classifyInfraFile('deploy.yaml', 'apiVersion: apps/v1\nkind: Deployment')).toBe('k8s');
    expect(classifyInfraFile('src/app.ts', 'const x = 1')).toBeNull();
  });
});

describe('analyzeDockerfile', () => {
  it('flags :latest, root user, baked secret, and no healthcheck', () => {
    const df = 'FROM node:latest\nENV API_KEY=sk-real-value-123\nCMD ["node","x"]\n';
    const rules = analyzeDockerfile('Dockerfile', df).map((f) => f.rule);
    expect(rules).toContain('docker-latest-tag');
    expect(rules).toContain('docker-root-user');
    expect(rules).toContain('docker-baked-secret');
    expect(rules).toContain('docker-no-healthcheck');
  });
  it('is clean for a well-formed Dockerfile', () => {
    const df = 'FROM node:20-alpine\nUSER node\nHEALTHCHECK CMD wget -q localhost:8080/health\nARG BUILD_ID\nCMD ["node","x"]\n';
    expect(analyzeDockerfile('Dockerfile', df).filter((f) => f.severity !== 'info')).toEqual([]);
  });
  it('does NOT treat an env-var-referenced ARG as a baked secret', () => {
    expect(analyzeDockerfile('Dockerfile', 'FROM node:20\nUSER node\nARG SECRET_KEY=${SECRET_KEY}\n').filter((f) => f.rule === 'docker-baked-secret')).toEqual([]);
  });
});

describe('analyzeK8sManifest', () => {
  it('flags privileged, missing resources/probes, and :latest image', () => {
    const y = 'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          image: myapp:latest\n          securityContext:\n            privileged: true\n';
    const rules = analyzeK8sManifest('d.yaml', y).map((f) => f.rule);
    expect(rules).toContain('k8s-privileged');
    expect(rules).toContain('k8s-no-resources');
    expect(rules).toContain('k8s-no-liveness');
    expect(rules).toContain('k8s-latest-image');
  });
  it('ignores non-workload docs (Service/ConfigMap)', () => {
    expect(analyzeK8sManifest('s.yaml', 'apiVersion: v1\nkind: Service\nspec:\n  ports: []\n')).toEqual([]);
  });
});

describe('analyzeTerraform', () => {
  it('flags a public allUsers IAM binding and an unpinned provider', () => {
    const tf = 'provider "google" {\n  project = "p"\n}\nresource "google_cloud_run_v2_service_iam_member" "x" {\n  member = "allUsers"\n}\n';
    const rules = analyzeTerraform('main.tf', tf).map((f) => f.rule);
    expect(rules).toContain('tf-public-iam');
    expect(rules).toContain('tf-unpinned-provider');
  });
});

describe('optimizeInfra + summary', () => {
  it('honest when there is no infra', () => {
    const r = optimizeInfra([{ path: 'src/a.ts', content: 'x' }]);
    expect(r.scanned).toEqual([]);
    expect(infraOptimizeSummary(r)).toMatch(/no Dockerfile/i);
  });
  it('scans, sorts errors first, and reports honestly', () => {
    const r = optimizeInfra([{ path: 'Dockerfile', content: 'FROM node:latest\nENV TOKEN=abc123\n' }]);
    expect(r.scanned).toEqual(['Dockerfile']);
    expect(r.findings[0].severity).toBe('error'); // errors sorted first
    expect(infraOptimizeSummary(r)).toContain('Infra optimizer —');
  });
  it('clean-scan message when files exist but have no issues', () => {
    const r = optimizeInfra([{ path: 'Dockerfile', content: 'FROM node:20-alpine\nUSER node\nHEALTHCHECK CMD x\n' }]);
    expect(infraOptimizeSummary(r)).toMatch(/no anti-patterns/i);
  });
});
