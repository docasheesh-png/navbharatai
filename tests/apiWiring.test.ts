import { describe, it, expect } from 'vitest';
import { analyzeApiWiring, buildEnvForSplit, mergeEnvFile } from '../src/server/AgentV3/apiWiring';

/**
 * SHOULD WE SPLIT THIS APP AT ALL? (slice 3 of "welcome any app, in any format", admin 2026-08-23.)
 *
 * The plan for fullstack was to split — frontend to the CDN, API to a Node host. That is the textbook
 * answer and it is often WRONG, because it assumes the frontend can be told where its API went. Most
 * fullstack apps call `fetch('/api/…')`, a relative path that works precisely because one server
 * serves both halves. Split that and every call goes to a CDN that has never heard of /api: the app
 * builds, deploys, looks fine, and every button silently fails.
 *
 * These tests pin the decision, and above all the direction it errs in.
 */

describe('analyzeApiWiring — split, or ship whole?', () => {
  it('an app that reads an API base from a setting WAS BUILT to be split', () => {
    const r = analyzeApiWiring({ 'src/api.ts': 'const base = import.meta.env.VITE_API_URL;' });
    expect(r.strategy).toBe('split');
    expect(r.envVar).toBe('VITE_API_URL');
  });

  it('recognises the CRA and Next conventions too, not just Vite', () => {
    expect(analyzeApiWiring({ 'src/a.js': 'process.env.REACT_APP_API_BASE' }).envVar).toBe('REACT_APP_API_BASE');
    expect(analyzeApiWiring({ 'src/a.ts': 'process.env.NEXT_PUBLIC_BACKEND_URL' }).envVar).toBe('NEXT_PUBLIC_BACKEND_URL');
  });

  it('🔒 relative /api calls mean DO NOT SPLIT — ship it whole', () => {
    // THE INSIGHT. Splitting this app produces a site whose every button fails silently, which is
    // worse than not splitting and far harder to diagnose than a page that plainly does not load.
    // Firebase Hosting cannot proxy /api to an external host, so there is no seam to hide it behind.
    const r = analyzeApiWiring({ 'src/App.tsx': "const res = await fetch('/api/orders');" });
    expect(r.wiring).toBe('relative');
    expect(r.strategy).toBe('whole');
    expect(r.summary).toContain('belong together');
  });

  it('axios with a root-relative path counts as the same pattern', () => {
    expect(analyzeApiWiring({ 'src/a.ts': "axios.get('/api/users')" }).strategy).toBe('whole');
    expect(analyzeApiWiring({ 'src/a.ts': "fetch(`/graphql`)" }).strategy).toBe('whole');
  });

  it('a hardcoded localhost is named with its file, so the fix is not a hunt', () => {
    const r = analyzeApiWiring({ 'src/config.ts': "export const API = 'http://localhost:3000';" });
    expect(r.strategy).toBe('fix-first');
    expect(r.evidenceFile).toBe('src/config.ts');
    expect(r.summary).toContain('src/config.ts');
  });

  it('🔒 an env base WINS over a stray localhost or relative call elsewhere', () => {
    // Order is the design. An app that reads an env base was written to be split; condemning it over
    // a dev-only fallback or a commented-out line that never runs in production would be wrong.
    const r = analyzeApiWiring({
      'src/api.ts': "const base = import.meta.env.VITE_API_URL || 'http://localhost:3000';",
    });
    expect(r.strategy).toBe('split');
    expect(r.envVar).toBe('VITE_API_URL');
  });

  it('🔒 THE SAFE DEFAULT IS "WHOLE", NEVER "SPLIT"', () => {
    // A wrong guess toward split gives a site whose every button fails silently. A wrong guess toward
    // whole costs some CDN speed the user never knew they could have. Only one of those is a bug.
    for (const files of [{}, { 'readme.md': "fetch('/api/x')" }, { 'src/a.ts': 'const x = 1;' }]) {
      expect(analyzeApiWiring(files as Record<string, string>).strategy).toBe('whole');
    }
    expect(analyzeApiWiring(null as never).strategy).toBe('whole');
  });

  it('non-code files are ignored — a README is not a network call', () => {
    expect(analyzeApiWiring({ 'docs/guide.md': "fetch('/api/orders')" }).wiring).toBe('none');
  });
});

describe('buildEnvForSplit — never invent a setting the code does not read', () => {
  const split = analyzeApiWiring({ 'src/api.ts': 'import.meta.env.VITE_API_URL' });

  it('hands the backend URL to the variable the app actually reads', () => {
    expect(buildEnvForSplit(split, 'https://my-api.onrender.com')).toEqual({ VITE_API_URL: 'https://my-api.onrender.com' });
  });

  it('trims a trailing slash, so the app’s own /api join cannot double up', () => {
    expect(buildEnvForSplit(split, 'https://my-api.onrender.com/')).toEqual({ VITE_API_URL: 'https://my-api.onrender.com' });
  });

  it('🔒 gives NOTHING when the app is not being split, or the URL is missing', () => {
    // A setting nothing consumes is indistinguishable from a working one, and would turn a broken
    // split into a mysterious one.
    const whole = analyzeApiWiring({ 'src/App.tsx': "fetch('/api/x')" });
    expect(buildEnvForSplit(whole, 'https://my-api.onrender.com')).toEqual({});
    expect(buildEnvForSplit(split, '')).toEqual({});
    expect(buildEnvForSplit(split, '   ')).toEqual({});
  });
});

describe('mergeEnvFile — merge, never overwrite', () => {
  it('🔒 keeps every other setting in the file', () => {
    // Not politeness — the difference between a working app and a broken one. A fullstack project's
    // .env.production routinely holds the analytics key, the Stripe publishable key, a Sentry DSN.
    // Writing our one line over that publishes a build silently missing all of them.
    const before = 'VITE_STRIPE_KEY=pk_live_123\nVITE_SENTRY_DSN=https://sentry.io/1\n';
    const after = mergeEnvFile(before, { VITE_API_URL: 'https://api.example.com' });
    expect(after).toContain('VITE_STRIPE_KEY=pk_live_123');
    expect(after).toContain('VITE_SENTRY_DSN=https://sentry.io/1');
    expect(after).toContain('VITE_API_URL=https://api.example.com');
  });

  it('replaces our own key in place when it is already there — theirs is stale by definition', () => {
    const after = mergeEnvFile('VITE_API_URL=http://localhost:3000\nVITE_X=1\n', { VITE_API_URL: 'https://api.example.com' });
    expect(after).toContain('VITE_API_URL=https://api.example.com');
    expect(after).not.toContain('localhost:3000');
    expect(after).toContain('VITE_X=1');
  });

  it('preserves comments and blank lines verbatim', () => {
    const before = '# analytics\nVITE_GA=G-1\n\n# other\nVITE_Y=2\n';
    const after = mergeEnvFile(before, { VITE_API_URL: 'https://a.com' });
    expect(after).toContain('# analytics');
    expect(after).toContain('# other');
    expect(after.split('\n').filter((l) => l === '').length).toBeGreaterThan(0);
  });

  it('an absent or empty file just gets our line', () => {
    expect(mergeEnvFile('', { VITE_API_URL: 'https://a.com' })).toBe('VITE_API_URL=https://a.com\n');
  });

  it('nothing to set leaves the file byte-identical', () => {
    const before = 'VITE_X=1\n';
    expect(mergeEnvFile(before, {})).toBe(before);
  });

  it('a key that merely CONTAINS our name is not mistaken for it', () => {
    const after = mergeEnvFile('VITE_API_URL_OLD=keep-me\n', { VITE_API_URL: 'https://a.com' });
    expect(after).toContain('VITE_API_URL_OLD=keep-me');
    expect(after).toContain('VITE_API_URL=https://a.com');
  });
});
