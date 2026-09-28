// ADMIN REPORT 2026-09-28: a user's built app, opened from its saved files, read "No React entry module
// found — expected a module entry (e.g. src/main.jsx) referenced by index.html". The durable save
// REPLACES the file index with the files a turn wrote; a carry-forward kept index.html and package.json
// alive, but not the module index.html loads. The scaffold seeds src/main.tsx and the model rarely
// rewrites it, so the saved app kept a page whose script was gone — every render from the saved files,
// and every cold restore of the sandbox, was a broken app.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  localScriptPaths, entryModulesToCarry, restoreDroppedEntryModules, essentialManifestsToCarry,
} from '../src/server/AgentV3/WorkspaceFileStore';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import { findReactEntry } from '../src/server/runtime/ReactPreview';

const PAGE = '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

describe('the page\'s own script is read correctly', () => {
  it('local sources become workspace keys; remote and data sources are not ours', () => {
    expect(localScriptPaths(PAGE)).toEqual(['src/main.tsx']);
    expect(localScriptPaths('<script src="./app.js?v=2"></script><script src="https://cdn.x/y.js"></script><script src="//cdn.x/z.js"></script><script src="data:text/javascript,1"></script>'))
      .toEqual(['app.js']);
    expect(localScriptPaths(null)).toEqual([]);
  });
});

describe('a partial save keeps the entry its page loads', () => {
  const existing = ['index.html', 'package.json', 'src/main.tsx', 'src/App.tsx', 'src/index.css'];
  const incoming = ['src/App.tsx', 'src/components/Board.tsx', 'src/index.css'];

  it('the reported shape: the model rewrote App.tsx and components, never main.tsx', () => {
    expect(essentialManifestsToCarry(existing, incoming)).toEqual(['index.html', 'package.json']);
    expect(entryModulesToCarry(existing, incoming, PAGE)).toEqual(['src/main.tsx']);
  });
  it('an entry the turn DID write is not carried — the new content wins', () => {
    expect(entryModulesToCarry(existing, [...incoming, 'src/main.tsx'], PAGE)).toEqual([]);
  });
  it('only what the page loads is carried, not every unlisted file', () => {
    expect(entryModulesToCarry([...existing, 'src/old.tsx'], incoming, PAGE)).toEqual(['src/main.tsx']);
  });
  it('a page that cannot be read carries the conventional entry names instead', () => {
    expect(entryModulesToCarry(['index.html', 'src/main.jsx', 'src/util.ts'], [], null)).toEqual(['src/main.jsx']);
  });
});

describe('indexes saved before this fix heal on read', () => {
  it('the dropped entry is still a content doc, so it comes back and the app has an entry again', () => {
    const listed = { 'index.html': PAGE, 'src/App.tsx': 'export default function App(){return null}' };
    const before = VirtualFileSystem.fromRecord({ ...listed, 'package.json': '{"dependencies":{"react":"18"}}' });
    expect(findReactEntry(before)).toBeNull();
    const healed = restoreDroppedEntryModules({ ...listed }, new Map([['src/main.tsx', 'import "./App"'], ['src/deleted.tsx', 'x']]));
    expect(healed['src/main.tsx']).toBe('import "./App"');
    expect(healed['src/deleted.tsx']).toBeUndefined();
    expect(findReactEntry(VirtualFileSystem.fromRecord(healed))).toBe('src/main.tsx');
  });
  it('no page, nothing restored', () => {
    expect(restoreDroppedEntryModules({ 'a.ts': '1' }, new Map([['src/main.tsx', 'x']]))).toEqual({ 'a.ts': '1' });
  });
});

describe('the wiring (source guards — tsc cannot see which files a replace keeps)', () => {
  const src = readFileSync('src/server/AgentV3/WorkspaceFileStore.ts', 'utf8');
  it('the replace keeps the carried entry in the final index', () => {
    expect(src).toMatch(/const keep = \[\.\.\.carried, \.\.\.entryCarry\];/);
    expect(src).toMatch(/entryModulesToCarry\(existingPaths, safe\.paths, indexHtml\)/);
  });
  it('every load passes through the heal', () => {
    expect(src).toMatch(/return restoreDroppedEntryModules\(out, unindexed\);/);
  });
});
