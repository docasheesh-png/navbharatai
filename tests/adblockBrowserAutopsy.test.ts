/**
 * The ad-blocker-browser autopsy (admin build report, 2026-09-01).
 *
 * THE REPORT. A user's browser app was built as TWO processes: `server.ts`, an Express proxy on :3001
 * that fetched pages and stripped the ads — the entire product — and a Vite frontend on :5173 whose
 * dev-server proxy forwarded `/api` to it. Inside the sandbox both ran, and the platform PROVED it:
 * `curl :3001/health` returned ok and `curl :3001/api/fetch?url=…` returned a real fetched page.
 *
 * Then it published the static build and told the user: "Aapka browser ab ready hai — koi bhi website
 * open karein aur ads/trackers automatically block ho jayenge!" Both halves of that were impossible on
 * the published link: a Vite `server.proxy` does not exist after `vite build`, and static hosting
 * cannot run a Node process. The user saw a site that worked while it was being built and stopped
 * working once it was "finished", and reasonably asked what had broken it. Nothing broke — the working
 * half was never published.
 *
 * Three defects are pinned here, each with the report's own numbers.
 */
import { describe, it, expect } from 'vitest';
import { detectServerNeed, serverNeedReportLine } from '../src/server/AgentV3/staticPublishGuard';
import { classifyProviderFailure, deadLadderRung } from '../src/server/AgentV3/BuildDiagnostics';
import { partitionSummary } from '../src/server/AgentV3/frontendBackendPartition';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTE = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
const DISPATCH = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

/** The real project, as the report described it. */
const ADBLOCK = {
  sourcePaths: [
    'server.ts', 'index.html', 'package.json', 'vite.config.ts',
    'src/main.tsx', 'src/App.tsx', 'src/components/WebView.tsx', 'src/components/Viewport.tsx',
  ],
  packageJson: JSON.stringify({
    name: 'adblock-browser-beta',
    scripts: { dev: 'vite', build: 'tsc && vite build', server: 'tsx server.ts' },
    dependencies: { react: '^18', express: '^4', cheerio: '^1' },
  }),
  buildConfig: `export default defineConfig({ server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } } } })`,
};

describe('1 · a static publish must not claim an app with a server works', () => {
  it('catches the ad-blocker browser', () => {
    const v = detectServerNeed(ADBLOCK);
    expect(v.needsServer).toBe(true);
    expect(v.findings.map((f) => f.kind)).toContain('server-entry');
    expect(v.findings.map((f) => f.kind)).toContain('dev-only-proxy');
    // The note has to name the file, or the user cannot check it themselves.
    expect(v.note).toContain('server.ts');
    expect(v.note).toMatch(/static hosting, which cannot run it/i);
  });

  it('says what still WORKS — the frontend really was published', () => {
    // A note that reads "your app is broken" would be its own false claim: the pages do load.
    const note = detectServerNeed(ADBLOCK).note;
    expect(note).toMatch(/pages will load/i);
    expect(note).not.toMatch(/\bfailed\b|\bbroken\b/i);
  });

  it('needs TWO independent signals — one alone must not nag a healthy app', () => {
    // A stray api.ts, or a script nobody runs, is not evidence that the app calls a backend.
    expect(detectServerNeed({ sourcePaths: ['src/api.ts', 'index.html'] }).needsServer).toBe(false);
    expect(detectServerNeed({ packageJson: JSON.stringify({ scripts: { server: 'node server.js' } }) }).needsServer).toBe(false);
  });

  it('stays silent on a plain static app', () => {
    const v = detectServerNeed({
      sourcePaths: ['index.html', 'src/main.tsx', 'src/App.tsx', 'vite.config.ts'],
      packageJson: JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^18' } }),
      buildConfig: 'export default defineConfig({ plugins: [react()] })',
    });
    expect(v.needsServer).toBe(false);
    expect(v.note).toBe('');
  });

  it('stays silent on a framework that deploys its own server', () => {
    // Next/Nuxt/Remix ship a server as part of their build — warning there would be noise on an app
    // that is completely fine.
    for (const dep of ['next', 'nuxt', '@remix-run/node', '@sveltejs/kit', 'astro']) {
      const v = detectServerNeed({
        ...ADBLOCK,
        packageJson: JSON.stringify({ scripts: { build: 'build' }, dependencies: { [dep]: '^1' } }),
      });
      expect(v.needsServer, `${dep} must not be flagged`).toBe(false);
    }
  });

  it('the report line names it as OUR omission, not the app failing', () => {
    const line = serverNeedReportLine(detectServerNeed(ADBLOCK));
    expect(line).toMatch(/is not deployed anywhere/i);
    expect(line).toMatch(/unsupported/i);
  });

  it('is wired into deploy WITHOUT being able to block a publish', () => {
    // The frontend really is live; refusing the publish would remove something that works.
    expect(DISPATCH).toMatch(/detectServerNeed\(\{ sourcePaths, packageJson: pkg, buildConfig: cfg \}\)/);
    const at = DISPATCH.indexOf('let serverNeedLine');
    const block = DISPATCH.slice(at, at + 900);
    expect(block).toMatch(/catch \{[^}]*advisory/);      // failures are swallowed
    expect(block).not.toMatch(/throw /);                  // and can never reject the deploy
  });
});

describe('2 · the service graph must see the whole project, not one turn', () => {
  it('reads the durable project ∪ this turn, not just the writes', () => {
    // With `Object.fromEntries(writtenFiles)` a backend written in an EARLIER turn is invisible — which
    // is the normal case for a second service. The report said "Single service: frontend on port 5173"
    // about a project whose Express proxy the platform had just health-checked on :3001.
    expect(ROUTE).toMatch(/const sgFiles = integrityFiles;/);
    expect(ROUTE).not.toMatch(/const sgFiles = Object\.fromEntries\(writtenFiles\)/);
  });

  it('the FE/BE partition says WHAT it measured', () => {
    // Its turn-scope is correct for its purpose (evidence for parallel building). Its old wording was
    // not: "0 backend" read as a fact about the app and was false about it.
    const line = partitionSummary({ frontend: ['a.tsx'], backend: [], shared: ['s.ts'], other: [], partitionable: false } as any);
    expect(line).toMatch(/THIS TURN wrote/);
    expect(line).toMatch(/not a survey of the whole project/i);
  });
});

describe('3 · a model that can never answer is a config defect, not a provider blip', () => {
  it('classifies the exact failure the report carried', () => {
    // "KIMI: 55 other: 404 Not found the model kimi-k2.5 or Permission denied, 2 timeout"
    expect(classifyProviderFailure('404 Not found the model kimi-k2.5 or Permission denied')).toBe('model-unavailable');
    for (const m of ['model_not_found', 'no such model: x', 'The model does not exist', 'unknown model foo', 'model deprecated']) {
      expect(classifyProviderFailure(m), m).toBe('model-unavailable');
    }
  });

  it('does NOT swallow the transient buckets it sits in front of', () => {
    // It is checked first, so it must not capture things a retry really does fix.
    expect(classifyProviderFailure('429 Too Many Requests')).toBe('rate-limit');
    expect(classifyProviderFailure('request timed out')).toBe('timeout');
    expect(classifyProviderFailure('503 Service Unavailable')).toBe('server-error');
    expect(classifyProviderFailure('401 unauthorized')).toBe('auth');
  });

  it('names it as a ladder defect rather than a provider outage', () => {
    const line = deadLadderRung({ KIMI: '55 model-unavailable, 2 timeout' });
    expect(line).toMatch(/configuration defect/i);
    expect(line).toMatch(/not a provider outage/i);
    expect(line).toMatch(/55/);
    expect(deadLadderRung({ GLM: '18 rate-limit, 2 timeout' })).toBe('');
    expect(deadLadderRung({})).toBe('');
  });
});
