import { describe, it, expect } from 'vitest';
import { dropShadowingEntries, isStrayEntryCopy, entryShadowNote } from '../src/server/AgentV3/entryShadow';

// Autopsy 993d3127: the fast lane planned `src/index.html` beside the real root index.html and spent a generation
// call on a file nothing serves. Same class as 876afca9 (public/index.html) — a second page entry.
describe('a second copy of the page entry is never planned', () => {
  const plan = [{ path: 'src/index.html' }, { path: 'public/index.html' }, { path: 'src/App.tsx' }, { path: 'index.html' }];
  it('vite: both stray copies are dropped, the real files are kept', () => {
    const { kept, dropped } = dropShadowingEntries(plan, 'vite-react');
    expect(dropped.sort()).toEqual(['public/index.html', 'src/index.html']);
    expect(kept.map((k) => k.path)).toEqual(['src/App.tsx', 'index.html']);
  });
  it('angular keeps its src/index.html (its real entry)', () => {
    expect(isStrayEntryCopy('src/index.html', 'angular')).toBe(false);
    expect(dropShadowingEntries([{ path: 'src/index.html' }], 'angular').dropped).toEqual([]);
  });
  it('CRA is untouched', () => {
    expect(dropShadowingEntries([{ path: 'src/index.html' }], 'cra').dropped).toEqual([]);
  });
  it('the write note tells the truth for a src copy (it is unused, not shadowing)', () => {
    const n = entryShadowNote('src/index.html', 'vite-react');
    expect(n).toContain('nothing serves this copy');
    expect(n).not.toContain('shadows');
  });
});
