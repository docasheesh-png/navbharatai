import { describe, it, expect } from 'vitest';
import {
  generateDockerfile, generateDockerCompose, generateCiWorkflow, generateDeployArtifacts,
} from './DeployArtifactGenerator';

describe('DeployArtifactGenerator (P-CGE.9)', () => {
  describe('generateDockerfile', () => {
    it('emits a multi-stage, non-root, alpine Dockerfile', () => {
      const df = generateDockerfile({ nodeVersion: '20', port: 3000, buildCmd: 'npm run build', startCmd: 'node server.js' });
      expect(df).toContain('FROM node:20-alpine AS build');
      expect(df).toContain('FROM node:20-alpine AS runtime');
      expect(df).toContain('RUN npm run build');
      expect(df).toContain('USER node');         // non-root
      expect(df).toContain('EXPOSE 3000');
      expect(df).toContain('CMD ["node","server.js"]');
    });
    it('supports a single-stage build and omits build when not given', () => {
      const df = generateDockerfile({ multiStage: false });
      expect(df).not.toContain('AS build');
      expect(df).not.toContain('RUN npm run build');
      expect(df).toContain('USER node');
      expect(df).toContain('EXPOSE 8080'); // default port
    });
  });

  describe('generateDockerCompose', () => {
    it('emits a compose service with port mapping + env', () => {
      const c = generateDockerCompose({ serviceName: 'My App', port: 4000, env: ['NODE_ENV=production', 'API_KEY=x'] });
      expect(c).toContain('myapp:');         // sanitised service name
      expect(c).toContain('- "4000:4000"');
      expect(c).toContain('- NODE_ENV=production');
      expect(c).toContain('restart: unless-stopped');
    });
  });

  describe('generateCiWorkflow', () => {
    it('includes only the declared steps (honest — no placeholder steps)', () => {
      const yml = generateCiWorkflow({ nodeVersion: '20', testCmd: 'npm test', buildCmd: 'npm run build' });
      expect(yml).toContain('name: CI');
      expect(yml).toContain("node-version: '20'");
      expect(yml).toContain('- name: Install');
      expect(yml).toContain('- name: Test');
      expect(yml).toContain('run: npm test');
      expect(yml).toContain('- name: Build');
      expect(yml).not.toContain('- name: Lint'); // no lint command → no lint step
    });
    it('always has install + checkout + setup-node', () => {
      const yml = generateCiWorkflow({});
      expect(yml).toContain('actions/checkout@v4');
      expect(yml).toContain('actions/setup-node@v4');
      expect(yml).toContain('run: npm ci');
    });

    it('npm (default): npm ci + npm cache', () => {
      const yml = generateCiWorkflow({ packageManager: 'npm' });
      expect(yml).toContain('run: npm ci');
      expect(yml).toContain("cache: 'npm'");
    });

    it('pnpm: pnpm/action-setup BEFORE setup-node, pnpm cache, frozen install', () => {
      const yml = generateCiWorkflow({ packageManager: 'pnpm' });
      expect(yml).toContain('pnpm/action-setup@v4');
      expect(yml).toContain("cache: 'pnpm'");
      expect(yml).toContain('run: pnpm install --frozen-lockfile');
      // action-setup must precede setup-node so the pnpm store cache resolves.
      expect(yml.indexOf('pnpm/action-setup')).toBeLessThan(yml.indexOf('actions/setup-node@v4'));
      expect(yml).not.toContain('npm ci');
    });

    it('yarn: yarn cache + frozen install, no pnpm/bun setup', () => {
      const yml = generateCiWorkflow({ packageManager: 'yarn' });
      expect(yml).toContain("cache: 'yarn'");
      expect(yml).toContain('run: yarn install --frozen-lockfile');
      expect(yml).not.toContain('pnpm/action-setup');
      expect(yml).not.toContain('oven-sh/setup-bun');
    });

    it('bun: uses setup-bun instead of setup-node (bun brings its own toolchain)', () => {
      const yml = generateCiWorkflow({ packageManager: 'bun' });
      expect(yml).toContain('oven-sh/setup-bun@v2');
      expect(yml).not.toContain('actions/setup-node@v4');
      expect(yml).toContain('run: bun install --frozen-lockfile');
    });

    it('an explicit installCmd overrides the manager default', () => {
      const yml = generateCiWorkflow({ packageManager: 'pnpm', installCmd: 'pnpm i --offline' });
      expect(yml).toContain('run: pnpm i --offline');
      expect(yml).not.toContain('pnpm install --frozen-lockfile');
    });
  });

  describe('generateDeployArtifacts', () => {
    it('returns only the requested artifacts', () => {
      const out = generateDeployArtifacts({ docker: { port: 8080 }, ci: { testCmd: 'npm test' } });
      expect(out.dockerfile).toBeTruthy();
      expect(out.ciWorkflow).toBeTruthy();
      expect(out.dockerCompose).toBeUndefined();
    });
  });
});
