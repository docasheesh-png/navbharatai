import { describe, it, expect } from 'vitest';
import { ensureHostBinding } from './devServerHost';

describe('ensureHostBinding (v3.0 actuator)', () => {
  it('appends --host to a vite package-manager dev script', () => {
    expect(ensureHostBinding('npm run dev')).toBe('npm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('pnpm run dev')).toBe('pnpm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('yarn dev')).toBe('yarn dev -- --host 0.0.0.0');
  });

  it('appends --host to a bare vite command', () => {
    expect(ensureHostBinding('vite')).toBe('vite --host 0.0.0.0');
    expect(ensureHostBinding('npx vite')).toBe('npx vite --host 0.0.0.0');
  });

  it('uses -H for next dev', () => {
    expect(ensureHostBinding('next dev')).toBe('next dev -H 0.0.0.0');
    expect(ensureHostBinding('npx next dev')).toBe('npx next dev -H 0.0.0.0');
  });

  it('leaves a command that already binds a host untouched', () => {
    expect(ensureHostBinding('npm run dev -- --host 0.0.0.0')).toBe('npm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('vite --host')).toBe('vite --host');
    expect(ensureHostBinding('next dev -H 0.0.0.0')).toBe('next dev -H 0.0.0.0');
    expect(ensureHostBinding('HOST=0.0.0.0 npm start')).toBe('HOST=0.0.0.0 npm start');
  });

  it('does NOT touch an ambiguous `start` script (CRA needs HOST=, not --host)', () => {
    expect(ensureHostBinding('npm start')).toBe('npm start');
  });

  it('leaves a non-dev-server command untouched', () => {
    expect(ensureHostBinding('npm install')).toBe('npm install');
    expect(ensureHostBinding('npm run build')).toBe('npm run build');
    expect(ensureHostBinding('')).toBe('');
  });
});
