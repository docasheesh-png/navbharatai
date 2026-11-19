// 🔴 A MOCK VIDEO IS A MADE-UP RESULT, AND A STOPPED BUILD'S FAKE IS STILL NAMED (failedbr #2421, 3ce4316c, 2026-11-17).
//
// "mujhe ek app banaa kar do na" (a video maker, per the project brief). The fast lane wrote src/utils/videoProcessor.ts:
// `// Simulate video processing delay … // For now, we'll create a mock video blob` → "Mock video data processed with …".
// The made-up-result scan knew songs, translations and search results but no video, audio or blob, and it ran only on a
// successful build — the user stopped this one, so a saved fake was never named anywhere.
// Reversion: drop `videos?|audio|blobs?|clips?|renders?` from SIMULATED_RESULT_RE and the first test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulatedResultIssues } from '../src/server/AgentV3/AuthenticityAnalysis';

/** The report's own lines from videoProcessor.ts. */
const REAL = `export async function processVideo(config, options) {
  // Simulate video processing delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  // For now, we'll create a mock video blob
  const mockVideoData = \`Mock video data processed with:
  - \${config.images.length} images\`;
  return new Blob([mockVideoData], { type: 'video/webm' });
}
`;

describe('generated media is a result', () => {
  it('#2421: the mock video blob is found', () => {
    const found = simulatedResultIssues({ 'src/utils/videoProcessor.ts': REAL });
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((i) => /mock video/i.test(i.snippet))).toBe(true);
  });
  it.each([
    ['fake audio track', 'const audio = fakeAudioClip();'],
    ['a dummy render', '// return a dummy render for now'],
  ])('%s is found', (_l, code) => {
    expect(simulatedResultIssues({ 'src/x.ts': code }).length).toBeGreaterThan(0);
  });
  it('precision holds: processing delays, a practice "mock test" and a real recorder are not findings', () => {
    expect(simulatedResultIssues({ 'src/a.ts': '// simulate network delay\nawait sleep(300);' })).toEqual([]);
    expect(simulatedResultIssues({ 'src/b.ts': '// simulate processing\nprogress.set(50);' })).toEqual([]);
    expect(simulatedResultIssues({ 'src/c.tsx': '<h3>Latest mock test result</h3>' })).toEqual([]);
    expect(simulatedResultIssues({ 'src/d.ts': 'const recorder = new MediaRecorder(stream); // records the video' })).toEqual([]);
  });
});

describe('the wiring (source)', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  it('the scan is no longer gated on a successful build; only the user summary is', () => {
    const at = route.indexOf('const faked = loadedFindings(simulatedResultIssues(');
    const head = route.slice(at - 400, at);
    expect(head).toMatch(/if \(expectsArtifacts && !isImportTurn && writtenFiles\.size > 0\) \{/);
    expect(route.slice(at, at + 400)).toMatch(/result = result\.ok \? \{ \.\.\.result, summary:/);
  });
});
