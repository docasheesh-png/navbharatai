import { describe, it, expect } from 'vitest';
import { detectBackendPresence } from './BackendPresence';

describe('detectBackendPresence', () => {
  it('a frontend-only React app has no backend', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { react: '^18', 'react-dom': '^18' } }),
      'src/App.tsx': `export const App = () => <div>hi</div>;`,
    };
    expect(detectBackendPresence(files)).toEqual({ hasBackend: false, reason: '' });
  });

  it('an Express dependency flags a Node backend', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { express: '^4', react: '^18' } }),
      'server/index.js': `const express = require('express');`,
    };
    const r = detectBackendPresence(files);
    expect(r.hasBackend).toBe(true);
    expect(r.reason).toContain('API server');
  });

  it('fastify / koa / nestjs also count as a Node backend', () => {
    for (const dep of ['fastify', 'koa', '@nestjs/core']) {
      const files = { 'package.json': JSON.stringify({ dependencies: { [dep]: '^1' } }) };
      expect(detectBackendPresence(files).hasBackend).toBe(true);
    }
  });

  it('a Prisma schema flags a database', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { react: '^18' } }),
      'prisma/schema.prisma': `datasource db { provider = "sqlite" url = "file:./dev.db" }`,
    };
    const r = detectBackendPresence(files);
    expect(r.hasBackend).toBe(true);
    expect(r.reason).toContain('database');
  });

  it('names both pieces when a Node API and a database are present', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { express: '^4', '@prisma/client': '^5' } }),
      'prisma/schema.prisma': `model User { id Int @id }`,
    };
    const r = detectBackendPresence(files);
    expect(r.hasBackend).toBe(true);
    expect(r.reason).toContain('API server');
    expect(r.reason).toContain('database');
  });

  it('a Python server (requirements.txt + .py) is detected', () => {
    const files = {
      'requirements.txt': `fastapi==0.110\nuvicorn==0.29`,
      'main.py': `from fastapi import FastAPI\napp = FastAPI()`,
    };
    const r = detectBackendPresence(files);
    expect(r.hasBackend).toBe(true);
    expect(r.reason).toContain('Python');
  });

  it('a requirements.txt with no .py files does not falsely flag a Python backend', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: { react: '^18' } }),
      'requirements.txt': `fastapi==0.110`,
    };
    expect(detectBackendPresence(files).hasBackend).toBe(false);
  });

  it('defined Express routes are caught even without the dependency signal', () => {
    const files = {
      'package.json': JSON.stringify({ dependencies: {} }),
      'api/routes.ts': `router.get('/users', h);\nrouter.post('/users', h);`,
    };
    const r = detectBackendPresence(files);
    expect(r.hasBackend).toBe(true);
    expect(r.reason).toContain('routes');
  });

  it('malformed package.json does not crash (still checks other signals)', () => {
    const files = {
      'package.json': `{ not json`,
      'prisma/schema.prisma': `model X { id Int @id }`,
    };
    expect(detectBackendPresence(files).hasBackend).toBe(true);
  });

  it('empty / non-object input is safe', () => {
    expect(detectBackendPresence({})).toEqual({ hasBackend: false, reason: '' });
    // @ts-expect-error intentional bad input
    expect(detectBackendPresence(null)).toEqual({ hasBackend: false, reason: '' });
  });
});
