import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileExplorer } from './FileExplorer';

/**
 * REGRESSION LOCK for the "Code Studio file list won't scroll vertically" report (admin 2026-08-18).
 *
 * ROOT CAUSE: the file list is a `flex-1 overflow-y-auto` child of a `flex flex-col h-full` whose
 * parent sidebar is `overflow-hidden`. A flex item defaults to `min-height:auto`, which floors it at
 * its CONTENT height — so a long list grows past the sidebar instead of scrolling, and the parent
 * clips the overflow. On a short phone screen the files below the fold become unreachable. `min-h-0`
 * lets the item shrink so `overflow-y-auto` engages.
 *
 * jsdom has no layout engine, so a true scroll test is impossible here — this asserts the load-bearing
 * class is present on the scroll container, which is exactly what a future refactor could silently drop.
 */
describe('Code Studio scroll containers keep min-h-0 (or the file list stops scrolling)', () => {
  it('the file explorer list is a scrollable flex child that can shrink', () => {
    const html = renderToStaticMarkup(
      <FileExplorer
        files={{ 'src/App.tsx': 'x', 'src/Header.tsx': 'y', 'package.json': '{}' }}
        activeFile="src/App.tsx"
        onFileSelect={() => {}}
        onFileDelete={() => {}}
        onFileCreate={() => {}}
        onFileRename={() => {}}
      />,
    );
    // The scroll container must carry BOTH the scroll behaviour AND the shrink permission.
    expect(html).toContain('overflow-y-auto');
    expect(html).toMatch(/class="[^"]*flex-1[^"]*min-h-0[^"]*overflow-y-auto/);
  });

  // The Editor mounts Monaco, which does not render cleanly under renderToStaticMarkup, so its scroll
  // container is guarded at the source instead. Same for the search-results list in CodeStudio. Both
  // are the identical flexbox trap the file explorer had.
  it('the editor content area is a flex child that can shrink (mobile textarea / Monaco scroll)', () => {
    const src = readFileSync(join(__dirname, 'Editor.tsx'), 'utf8');
    expect(src).toMatch(/flex-1 min-h-0 overflow-hidden relative/);
  });

  it("Code Studio's search-results list can shrink and scroll", () => {
    const src = readFileSync(join(__dirname, 'CodeStudio.tsx'), 'utf8');
    expect(src).toMatch(/flex-1 min-h-0 overflow-y-auto/);
  });
});
