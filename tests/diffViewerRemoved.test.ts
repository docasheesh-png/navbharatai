import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HOME_TOOL_GROUPS } from '../src/components/home/homeToolGroups';
import { hasConflictMarkers } from '../src/lib/merge3';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

// Admin 2026-07-24: remove the standalone Diff Viewer TILE (redundant with v5's inline diffs + Diff tab),
// but KEEP the merge-conflict resolver — it now surfaces via a "Resolve" banner in the Files view whenever
// a file actually has conflict markers. These tests lock that: tile gone, resolver preserved & reachable.

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('Diff Viewer tile removed from Developer Tools', () => {
  it('no tool group lists a Diff Viewer tile anymore', () => {
    const allItems = HOME_TOOL_GROUPS.flatMap(g => g.items);
    expect(allItems.some(i => i.id === 'diff')).toBe(false);
    expect(allItems.some(i => /diff viewer/i.test(i.label))).toBe(false);
  });

  it('the KB tools list no longer advertises Diff Viewer', () => {
    const tools = APP_KNOWLEDGE_BASE.find(f => f.id === 'home_other_ai_tools');
    expect(tools).toBeTruthy();
    expect(tools!.description).not.toContain('Diff Viewer');
  });
});

describe('Merge-conflict resolver is preserved and reachable', () => {
  it('the diff3 conflict engine still works', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x')).toBe(true);
    expect(hasConflictMarkers('just some normal code')).toBe(false);
  });

  it('the Files view shows a Resolve banner when a file has conflict markers, opening the resolver', () => {
    const vp = read('src/components/panels/ViewPanels.tsx');
    expect(vp).toContain('hasConflictMarkers');       // detects conflicts in the workspace files
    expect(vp).toContain("toggleTab('diff')");        // the banner opens the conflict resolver
    expect(vp).toContain("activeView === 'diff'");    // the resolver view is still rendered
  });

  it('the KB conflict-resolver entry points to the Files banner (not the retired tile)', () => {
    const mc = APP_KNOWLEDGE_BASE.find(f => f.id === 'merge-conflict-resolver');
    expect(mc).toBeTruthy();
    expect(mc!.path).toMatch(/Files/);
    expect(mc!.description).toMatch(/conflict/i);
  });
});
