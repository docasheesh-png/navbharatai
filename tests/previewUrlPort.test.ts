import { describe, it, expect } from 'vitest';
import { previewUrlPort, oneShotDevPort } from '../src/server/routes/agentv3';

// ADMIN REPORT 2026-08-06. The health probe picked its port with `oneShotDevPort(framework)` — a GUESS
// from the framework name. For a full-stack Express app that serves everything on its own port
// (mitrify: 5000) the guess is 5173, so the probe hit a port nothing was listening on and a healthy app
// read as "sleeping". The URL the client is actually displaying is the ground truth.
describe('previewUrlPort — probe the port the app is REALLY on, not a framework guess', () => {
  it('reads the port out of an E2B preview host', () => {
    expect(previewUrlPort('https://5000-abc123def.e2b.app')).toBe(5000);
    expect(previewUrlPort('https://5173-xyz.e2b.app/customer/home')).toBe(5173);
  });

  it('the guess it replaces would have been wrong for this app', () => {
    expect(oneShotDevPort('vite-react')).toBe(5173);          // the guess
    expect(previewUrlPort('https://5000-abc.e2b.app')).toBe(5000); // the truth
  });

  it('reads an explicit :port too', () => {
    expect(previewUrlPort('http://localhost:3000')).toBe(3000);
    expect(previewUrlPort('http://127.0.0.1:5000/api/health')).toBe(5000);
  });

  it('returns null (never a wrong number) when the URL says nothing about a port', () => {
    expect(previewUrlPort('https://myapp.example.com')).toBeNull();
    expect(previewUrlPort('')).toBeNull();
    expect(previewUrlPort(null)).toBeNull();
    expect(previewUrlPort(undefined)).toBeNull();
    expect(previewUrlPort('not a url')).toBeNull();
  });

  it('rejects out-of-range junk instead of probing port 0 or 99999', () => {
    expect(previewUrlPort('https://0-abc.e2b.app')).toBeNull();
    expect(previewUrlPort('https://99999-abc.e2b.app')).toBeNull();
  });
});
