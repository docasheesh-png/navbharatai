import { describe, it, expect } from 'vitest';
import { detectNeedsDatabase, envVarNames, buildDevEnvContent, externalSecretVars, externalServiceNote } from './ImportPreview';

describe('detectNeedsDatabase', () => {
  it('detects a SQL/ORM driver in package.json', () => {
    expect(detectNeedsDatabase({ 'package.json': JSON.stringify({ dependencies: { 'drizzle-orm': '^0.3', pg: '^8' } }) })).toBe(true);
    expect(detectNeedsDatabase({ 'package.json': JSON.stringify({ dependencies: { '@prisma/client': '^5' } }) })).toBe(true);
    expect(detectNeedsDatabase({ 'package.json': JSON.stringify({ devDependencies: { mongoose: '^8' } }) })).toBe(true);
  });
  it('detects a DATABASE_URL reference in source even without a recognised driver', () => {
    expect(detectNeedsDatabase({ 'package.json': '{}', 'server/db.ts': 'const url = process.env.DATABASE_URL;' })).toBe(true);
  });
  it('is false for a plain frontend app', () => {
    expect(detectNeedsDatabase({ 'package.json': JSON.stringify({ dependencies: { react: '^18', vite: '^5' } }), 'src/App.tsx': 'export default () => null;' })).toBe(false);
    expect(detectNeedsDatabase({ 'package.json': 'not json' })).toBe(false);
  });
});

describe('envVarNames', () => {
  it('extracts documented var names from the .env template', () => {
    expect(envVarNames({ '.env.example': 'DATABASE_URL=\nexport CASHFREE_APP_ID=\n# comment\nPORT=5000' }))
      .toEqual(['DATABASE_URL', 'CASHFREE_APP_ID', 'PORT']);
  });
  it('is empty without a template', () => {
    expect(envVarNames({ 'src/x.ts': 'x' })).toEqual([]);
  });
});

describe('buildDevEnvContent', () => {
  it('gives every documented var a value (placeholder or provided) + NODE_ENV, provided wins', () => {
    const content = buildDevEnvContent(['DATABASE_URL', 'CASHFREE_APP_ID', 'GOOGLE_API_KEY'], { DATABASE_URL: 'postgresql://postgres@localhost:5432/myapp' });
    expect(content).toContain('NODE_ENV=development');
    expect(content).toContain('DATABASE_URL=postgresql://postgres@localhost:5432/myapp'); // provisioned value wins
    expect(content).toContain('CASHFREE_APP_ID='); // placeholder — present so the app doesn't crash on undefined
    expect(content).toContain('GOOGLE_API_KEY=');
    expect(content.endsWith('\n')).toBe(true);
  });
  it('works with no documented vars (still sets NODE_ENV + provided)', () => {
    expect(buildDevEnvContent([], { DATABASE_URL: 'x' })).toBe('NODE_ENV=development\nDATABASE_URL=x\n');
  });
});

describe('externalSecretVars + externalServiceNote (honest partial preview)', () => {
  it('flags external-service secrets, not the infra vars we provide', () => {
    const ext = externalSecretVars(['DATABASE_URL', 'NODE_ENV', 'PORT', 'JWT_SECRET', 'CASHFREE_SECRET_KEY', 'GOOGLE_API_KEY', 'FIREBASE_WEBHOOK']);
    expect(ext).toContain('CASHFREE_SECRET_KEY');
    expect(ext).toContain('GOOGLE_API_KEY');
    expect(ext).toContain('FIREBASE_WEBHOOK');
    expect(ext).not.toContain('DATABASE_URL');
    expect(ext).not.toContain('JWT_SECRET');
    expect(ext).not.toContain('PORT');
  });
  it('produces an honest note naming what stays inactive, or "" when none', () => {
    const note = externalServiceNote(['DATABASE_URL', 'CASHFREE_APP_ID', 'GOOGLE_API_KEY']);
    expect(note).toContain('CASHFREE_APP_ID');
    expect(note).toContain("can't be provisioned");
    expect(externalServiceNote(['DATABASE_URL', 'PORT'])).toBe('');
  });
});
