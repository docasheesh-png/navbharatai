// NOTHING POLLS A FAKE BUILD STATUS (2026-10-11, Q-793).
//
// `public/build_status.json` was a static fixture: `"status": "building"` with seven made-up steps
// ("Generating Database — in-progress"), unchanged since it was committed. App.tsx fetched it on start and,
// because it always said "building", re-fetched it every TWO SECONDS for as long as the app was open —
// on every visitor's browser and every phone — and each answer was a new array in a context App itself
// read, so the whole 4,800-line App re-rendered every two seconds, forever. What it fed, a "Live Execution
// Progress" panel in the IDE chat, could never show: it waited for a step marked 'running', and the file
// said 'in-progress'. Found by the Q-600 sweep because `buildSteps` was read by nothing in App.
//
// THE CLASS: a client that polls something no server writes. The census below fails if any client file
// polls a status file again, and the specific pieces are pinned gone.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function clientFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'server' && name !== 'node_modules') out.push(...clientFiles(p)); }
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('the fake build status is gone at the source', () => {
  it('🔒 the static file is not shipped, and no client file fetches a *_status.json', () => {
    expect(existsSync('public/build_status.json')).toBe(false);
    const offenders = clientFiles().filter((f) => /fetch\(\s*['"`][^'"`]*_status\.json/.test(code(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('the context it fed, and the panel that could never show, are removed with it', () => {
    expect(existsSync('src/components/ide/BuildContext.tsx')).toBe(false);
    expect(existsSync('src/components/ide/AgentProgress.tsx')).toBe(false);
    expect(code(readFileSync('src/main.tsx', 'utf8'))).not.toContain('BuildProvider');
    const chat = code(readFileSync('src/components/ide/AIChat.tsx', 'utf8'));
    expect(chat).not.toContain('useBuild');
    expect(chat).not.toContain('Live Execution Progress');
    const app = code(readFileSync('src/App.tsx', 'utf8'));
    expect(app).not.toMatch(/pollBuildStatus|setBuildSteps|useBuild\(/);
  });
});
