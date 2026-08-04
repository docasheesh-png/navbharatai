import { describe, it, expect } from 'vitest';
import { filesForReview } from '../src/server/routes/appReview';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('filesForReview — bounds the Connect-App review payload to real source files', () => {
  it('keeps plain source files as-is', () => {
    const out = filesForReview({ 'src/App.tsx': 'export const A = 1;', 'index.html': '<html></html>' });
    expect(Object.keys(out).sort()).toEqual(['index.html', 'src/App.tsx']);
  });

  it('drops empty, non-string, vendored and binary entries', () => {
    const out = filesForReview({
      'src/ok.ts': 'const x = 1;',
      'src/empty.ts': '   ',
      'node_modules/lib/index.js': 'whatever',
      'dist/bundle.js': 'built',
      'app.min.js': 'min',
      'yarn.lock': 'lockfile',
      'logo.png': 'binarydata',
      'bad.ts': 123 as unknown as string,
    });
    expect(Object.keys(out)).toEqual(['src/ok.ts']);
  });

  it('caps per-file size at 20k chars', () => {
    const big = 'a'.repeat(50_000);
    const out = filesForReview({ 'src/big.ts': big });
    expect(out['src/big.ts'].length).toBe(20_000);
  });

  it('caps the number of files at 60', () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < 120; i++) input[`src/f${i}.ts`] = `const v${i} = ${i};`;
    const out = filesForReview(input);
    expect(Object.keys(out).length).toBe(60);
  });

  it('handles null / undefined / non-object input safely', () => {
    expect(filesForReview(null)).toEqual({});
    expect(filesForReview(undefined)).toEqual({});
  });
});

describe('Connect-App review route is registered and gated', () => {
  it('the route calls the real reviewCode engine on the cheap free tier and is rate-limited', () => {
    const src = readFileSync(join(__dirname, '../src/server/routes/appReview.ts'), 'utf8');
    expect(src).toContain("app.post('/api/app-review/review'");
    expect(src).toContain('buildRateLimiter()');
    expect(src).toContain('enforceNotBanned()');
    expect(src).toContain('reviewCode(');
    // cheap tier — 'navbharat' maps to the FREE namespace (never the flagship/Claude)
    expect(src).toContain("aiRouter.route(user, [], 'navbharat'");
  });

  it('is wired into the server bootstrap', () => {
    const server = readFileSync(join(__dirname, '../server.ts'), 'utf8');
    expect(server).toContain('registerAppReviewRoutes(app)');
  });
});

describe('AI Code Review — Connect App flow calls REAL APIs (no fake)', () => {
  const src = readFileSync(join(__dirname, '../src/components/ide/AICodeReview.tsx'), 'utf8');

  it('lists GitHub repos, fetches repo files, and runs the real review — all via real endpoints', () => {
    expect(src).toContain("fetch('/api/github/repos'");   // list the user's repos
    expect(src).toContain("fetch('/api/github/fetch'");   // fetch a repo's real files
    expect(src).toContain("fetch('/api/app-review/review'"); // run the real AI review
  });

  it('sources NavBharatAI apps from the user\'s real sessions (each carries files)', () => {
    expect(src).toContain('sessions');
    expect(src).toContain('.files');
  });

  it('renders the real server score + summary, not a fabricated one', () => {
    expect(src).toContain('serverScore');
    expect(src).toContain('serverSummary');
    expect(src).toContain('mapServerFindings');
  });

  it('the connected review has no artificial setTimeout delay (that is only the offline quick-check)', () => {
    // The connected path (runConnectedReview) must not fake a delay; only the local runReview does.
    const connected = src.slice(src.indexOf('runConnectedReview'));
    const untilNextFn = connected.slice(0, connected.indexOf('const runReview'));
    expect(untilNextFn).not.toContain('setTimeout');
  });
});
