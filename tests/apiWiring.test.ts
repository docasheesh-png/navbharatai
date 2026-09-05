import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  analyzeApiWiring, buildEnvForSplit, buildEnvForWhole, backendAllowsCrossOrigin, mergeEnvFile,
} from '../src/server/AgentV3/apiWiring';

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

/**
 * ⚠️ THESE FIXTURES GAINED A SERVER ON 2026-09-05, and the reason is the point of the change.
 *
 * They used to contain a frontend file alone and assert `split`. Reading an env base says the author
 * ANTICIPATED a separate API; it does not say their server will ACCEPT one. Once the website is on a
 * CDN every call is cross-origin, and a server with no CORS refuses all of them — the page loads,
 * looks right, and nothing works. That is the same silent failure this file was written to prevent,
 * arriving through the one door it had left open.
 *
 * So the property under test is unchanged — an env base is recognised, and it still outranks a
 * relative or localhost call elsewhere — but a split is only ADVISED when the backend can really be
 * called from another origin. The fixtures now say that out loud instead of assuming it.
 */
const SERVER_WITH_CORS = { 'server.js': "const cors = require('cors');\napp.use(cors());" };

describe('analyzeApiWiring — split, or ship whole?', () => {
  it('an app that reads an API base from a setting, whose server accepts other origins, is split', () => {
    const r = analyzeApiWiring({ ...SERVER_WITH_CORS, 'src/api.ts': 'const base = import.meta.env.VITE_API_URL;' });
    expect(r.strategy).toBe('split');
    expect(r.envVar).toBe('VITE_API_URL');
  });

  it('🔒 built to be split is NOT the same as safe to split — no CORS means ship it whole', () => {
    // Splitting here would produce a site whose every request is refused by its own backend.
    const r = analyzeApiWiring({ 'server.js': 'app.get("/api/x", h);', 'src/api.ts': 'import.meta.env.VITE_API_URL' });
    expect(r.wiring).toBe('env');
    expect(r.strategy).toBe('whole');
    expect(r.envVar).toBe('VITE_API_URL');   // kept: a whole deploy still has to answer it
    expect(r.summary).toContain('another address');
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
      ...SERVER_WITH_CORS,
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
  const split = analyzeApiWiring({
    'server.js': "const cors = require('cors');\napp.use(cors());",
    'src/api.ts': 'import.meta.env.VITE_API_URL',
  });

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

/**
 * THE COMPANION TO THE CORS GATE (admin 2026-09-05).
 *
 * Downgrading a split to a whole deploy is only safe if the frontend is told what its API base is.
 * An env-based frontend builds `${base}/api/x`; with no value that is the literal string
 * `undefined/api/x` and every call 404s — so the gate that prevents one silent failure would have
 * created another. Shipped whole, the API is at the app's own origin, and the empty string is the
 * honest value.
 */
describe('buildEnvForWhole — the half that makes the CORS gate safe', () => {
  it('an env-based app shipped whole gets an EMPTY base, so its calls become relative', () => {
    const whole = analyzeApiWiring({ 'server.js': 'app.get("/api/x", h);', 'src/api.ts': 'import.meta.env.VITE_API_URL' });
    expect(whole.strategy).toBe('whole');
    expect(buildEnvForWhole(whole)).toEqual({ VITE_API_URL: '' });
  });

  it('🔒 a variable the code does not read is never invented', () => {
    // A setting nothing consumes is indistinguishable from a working one.
    const relative = analyzeApiWiring({ 'src/App.tsx': "fetch('/api/x')" });
    expect(relative.envVar).toBe('');
    expect(buildEnvForWhole(relative)).toEqual({});
  });

  it('a split app gets nothing from here — its real URL comes from buildEnvForSplit', () => {
    const split = analyzeApiWiring({
      'server.js': "const cors = require('cors');\napp.use(cors());",
      'src/api.ts': 'import.meta.env.VITE_API_URL',
    });
    expect(buildEnvForWhole(split)).toEqual({});
  });
});

describe('backendAllowsCrossOrigin — positive evidence only', () => {
  it('recognises what the frameworks actually document', () => {
    for (const files of [
      { 'server.js': "app.use(cors());" },
      { 'server.ts': "res.setHeader('Access-Control-Allow-Origin', '*');" },
      { 'app.py': 'from flask_cors import CORS\nCORS(app)' },
      { 'main.py': 'app.add_middleware(CORSMiddleware, allow_origins=["*"])' },
    ]) expect(backendAllowsCrossOrigin(files), Object.keys(files)[0]).toBe(true);
  });

  it('🔒 no evidence is treated as absence — under-detecting ships a WORKING app', () => {
    // Over-detecting ships a split into a wall of blocked requests. Only one of those is a bug.
    expect(backendAllowsCrossOrigin({ 'server.js': 'app.get("/api/x", h);' })).toBe(false);
    expect(backendAllowsCrossOrigin({})).toBe(false);
    expect(backendAllowsCrossOrigin({ 'docs/cors.md': 'app.use(cors())' })).toBe(false);
  });

  it('a test file is not the app', () => {
    expect(backendAllowsCrossOrigin({ 'server.test.js': 'app.use(cors());' })).toBe(false);
  });
});

describe('🔒 the wiring — a whole deploy carries the base, and never overrides the user', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    return route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('the created service receives the whole-deploy base', () => {
    expect(handler).toContain('buildEnvForWhole(analyzeApiWiring(envSource))');
    expect(handler).toContain('envVars: createEnvVars');
  });

  it('🔒 a value the user saved WINS — theirs is a decision, ours a default', () => {
    expect(handler).toContain('.filter(([k]) => !envPlan.envVars.some((e) => e.key === k))');
  });
});
