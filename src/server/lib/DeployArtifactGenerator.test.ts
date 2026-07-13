import { describe, it, expect } from 'vitest';
import {
  generateDockerfile, generateDockerCompose, generateCiWorkflow, generateDeployArtifacts, generateDockerignore,
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

    it('npm (default): node base, npm ci, node user, npm start', () => {
      const df = generateDockerfile({ packageManager: 'npm' });
      expect(df).toContain('FROM node:20-alpine');
      expect(df).toContain('RUN npm ci');
      expect(df).toContain('CMD ["npm","start"]');
      expect(df).not.toContain('corepack');
    });

    it('pnpm: corepack enable in BOTH stages, frozen install, pnpm-lock COPY, pnpm start', () => {
      const df = generateDockerfile({ packageManager: 'pnpm' });
      expect(df).toContain('COPY package.json pnpm-lock.yaml* ./');
      expect(df).toContain('RUN corepack enable && pnpm install --frozen-lockfile');
      expect(df).toContain('CMD ["pnpm","start"]');
      // runtime stage also enables corepack so `pnpm start` resolves.
      expect(df.match(/corepack enable/g)?.length).toBe(2);
      expect(df).not.toContain('npm ci');
    });

    it('yarn: corepack + yarn frozen install + yarn.lock COPY', () => {
      const df = generateDockerfile({ packageManager: 'yarn' });
      expect(df).toContain('COPY package.json yarn.lock* ./');
      expect(df).toContain('RUN corepack enable && yarn install --frozen-lockfile');
      expect(df).toContain('CMD ["yarn","start"]');
    });

    it('bun: oven/bun base image, bun user, bun install, no corepack/node', () => {
      const df = generateDockerfile({ packageManager: 'bun' });
      expect(df).toContain('FROM oven/bun:1-alpine');
      expect(df).not.toContain('node:20-alpine');
      expect(df).toContain('USER bun');
      expect(df).toContain('RUN bun install --frozen-lockfile');
      expect(df).toContain('CMD ["bun","start"]');
      expect(df).not.toContain('corepack');
    });

    it('an explicit installCmd/startCmd still overrides the manager defaults', () => {
      const df = generateDockerfile({ packageManager: 'pnpm', installCmd: 'pnpm i', startCmd: 'node dist/main.js' });
      expect(df).toContain('RUN corepack enable && pnpm i');
      expect(df).toContain('CMD ["node","dist/main.js"]');
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

    it('adds a mongo service (image + port + volume), depends_on, and a MONGO_URL for a mongoose app', () => {
      const c = generateDockerCompose({ dependencies: ['react', 'mongoose', 'express'] });
      expect(c).toContain('mongo:');
      expect(c).toContain('image: mongo:7');
      expect(c).toContain('- "27017:27017"');
      expect(c).toContain('- MONGO_URL=mongodb://mongo:27017/app'); // app can reach it on the network
      expect(c).toContain('mongo-data:/data/db');
      expect(c).toMatch(/volumes:\n {2}mongo-data:/); // top-level named volume declared
      // app waits for mongo to be HEALTHY, not just started; mongo declares a healthcheck.
      expect(c).toContain('condition: service_healthy');
      expect(c).toContain('healthcheck:');
      expect(c).toContain("db.adminCommand('ping')");
    });

    it('gives each DB a healthcheck (postgres pg_isready, redis redis-cli ping)', () => {
      expect(generateDockerCompose({ dependencies: ['pg'] })).toContain('pg_isready -U postgres');
      expect(generateDockerCompose({ dependencies: ['redis'] })).toContain('redis-cli ping');
    });

    it('adds postgres with credentials env for a pg app', () => {
      const c = generateDockerCompose({ dependencies: ['pg'] });
      expect(c).toContain('image: postgres:16-alpine');
      expect(c).toContain('POSTGRES_PASSWORD: postgres');
      expect(c).toContain('- DATABASE_URL=postgres://postgres:postgres@postgres:5432/app');
    });

    it('adds redis (no volume) alongside a DB, deduped', () => {
      const c = generateDockerCompose({ dependencies: ['ioredis', 'redis', 'pg'] });
      expect((c.match(/^ {2}redis:$/gm) || []).length).toBe(1); // redis + ioredis → ONE redis service
      expect(c).toContain('image: redis:7-alpine');
      expect(c).toContain('- REDIS_URL=redis://redis:6379');
    });

    it('adds NO backing services for a purely frontend app', () => {
      const c = generateDockerCompose({ dependencies: ['react', 'react-dom', 'vite'] });
      expect(c).not.toContain('depends_on:');
      expect(c).not.toContain('volumes:');
      expect(c).not.toContain('image:');
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
    it('returns only the requested artifacts, and always pairs a .dockerignore with the Dockerfile', () => {
      const out = generateDeployArtifacts({ docker: { port: 8080 }, ci: { testCmd: 'npm test' } });
      expect(out.dockerfile).toBeTruthy();
      expect(out.dockerignore).toBeTruthy(); // a Dockerfile without .dockerignore ships node_modules/.env
      expect(out.ciWorkflow).toBeTruthy();
      expect(out.dockerCompose).toBeUndefined();
    });

    it('does NOT emit a .dockerignore when no Dockerfile is requested', () => {
      const out = generateDeployArtifacts({ ci: { testCmd: 'npm test' } });
      expect(out.dockerignore).toBeUndefined();
    });

    it('the .dockerignore excludes node_modules/.git/.env but keeps .env.example', () => {
      const di = generateDockerignore();
      for (const e of ['node_modules', '.git', 'dist', '.env', '*.tsbuildinfo', 'Dockerfile']) {
        expect(di.split('\n')).toContain(e);
      }
      expect(di).toContain('!.env.example'); // the safe template is NOT ignored
    });
  });
});
