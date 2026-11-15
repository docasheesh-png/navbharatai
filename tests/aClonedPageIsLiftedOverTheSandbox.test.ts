// A CLONED ONE-PAGE GAME IS LIFTED OVER WHAT IS ALREADY IN THE SANDBOX (single-file game autopsy, 2026-11-14; closes Q-2665).
// A zip is written by us, so its pages land lifted. A git clone is already in the sandbox exactly as committed: its 5 MB page kept its
// inline media there, and the 900 KB text store dropped the page. `landClone` writes the code-only page and the media files over it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { liftForLanding } from '../src/server/AgentV3/importLanding';
import { buildGameFixture, longBase64Runs } from './helpers/singleFileGameFixture';

const GAME = buildGameFixture().html;
function sink() {
  const texts = new Map<string, string>(); const bins = new Map<string, string>();
  return { texts, bins, writeFile: async (_w: string, p: string, c: string) => { texts.set(p, c); }, writeBinaryFile: async (_w: string, p: string, b: string) => { bins.set(p, b); } };
}

describe('liftForLanding / landClone', () => {
  it('a clone: the lifted page and every media file are written over the sandbox copy', async () => {
    const l = liftForLanding({ 'index.html': GAME, 'README.md': '# x' }, undefined, false);
    expect(longBase64Runs(l.files['index.html'], 200)).toEqual([]);
    expect(Object.keys(l.assets).length).toBe(6);
    const s = sink();
    await l.landClone(s, 'ws');
    expect(s.texts.get('index.html')).toBe(l.files['index.html']);
    expect(s.texts.has('README.md')).toBe(false); // untouched files are not rewritten
    expect([...s.bins.keys()].sort()).toEqual(Object.keys(l.assets).sort());
    expect(l.noteLine).toMatch(/Moved 6 embedded media/);
  });
  it('a zip (we write the files): landClone does nothing — nothing is written twice', async () => {
    const l = liftForLanding({ 'index.html': GAME }, undefined, true);
    const s = sink();
    await l.landClone(s, 'ws');
    expect(s.texts.size + s.bins.size).toBe(0);
    expect(Object.keys(l.assets).length).toBe(6);
  });
  it('nothing to lift: same files, no writes, no note', async () => {
    const l = liftForLanding({ 'a.js': 'var a;' }, { 'logo.png': 'data:image/png;base64,AA' }, false);
    const s = sink();
    await l.landClone(s, 'ws');
    expect(s.texts.size + s.bins.size).toBe(0);
    expect(l.noteLine).toBe('');
    expect(l.assets).toEqual({ 'logo.png': 'data:image/png;base64,AA' });
  });
  it('a sandbox that refuses a write never throws out of the import', async () => {
    const l = liftForLanding({ 'index.html': GAME }, undefined, false);
    await expect(l.landClone({ writeFile: async () => { throw new Error('x'); }, writeBinaryFile: async () => { throw new Error('y'); } }, 'ws')).resolves.toBeUndefined();
  });
});

describe('the landing calls it', () => {
  it('landImportedProject lifts for BOTH transports and lays a clone over the sandbox', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const at = route.indexOf('const landing = liftForLanding(importedFiles, opts.assets, opts.writeToSandbox);');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 500)).toContain('await landing.landClone(actuator, workspaceId)');
  });
});
