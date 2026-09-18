import { describe, it, expect } from 'vitest';
import { analyzeRequirementCoverage } from '../src/server/AgentV3/RequirementCoverage';
import type { ProjectGraph } from '../src/server/AgentV3/WorkspaceMemory';

function graph(partial: Partial<ProjectGraph>): ProjectGraph {
  return { files: [], symbols: [], components: [], routes: [], imports: {}, dependencies: [], ...partial };
}

/**
 * 🔴 BUILD b6f88a72 (2026-09-18) — the Gita reader was told its working feature was NOT BUILT.
 *
 * The user asked for "bookmarks saved in the browser". The app implemented exactly that, completely,
 * inside one `App.tsx`. The report said **"Requested feature NOT BUILT: wishlist / favorites"**, the
 * agent spent five edits renaming a tab label to satisfy the detector, and the user's own summary
 * carried BOTH "Has Favorites / Wishlist" AND "One thing you asked for isn't in the app yet".
 *
 * Why: `surface` is file and component NAMES, and a one-file app contributes none; `evidence` is a
 * list of four literal function names, and this app's handler is `toggleSave`.
 */

/** The shipped app, reduced to the lines the report itself quoted. */
const GITA_APP = `
import { useMemo, useState } from 'react';
import ThemeToggle from './theme';
  const [tab, setTab] = useState<'today' | 'chapters' | 'saved'>('today');
  const [saved, setSaved] = useState<string[]>(() => load('geeta-saved-v1'));
  function toggleSave(s: Shloka) {
    const next = saved.includes(r) ? saved.filter((x) => x !== r) : saved.concat(r);
    save('geeta-saved-v1', next);
  }
          aria-label={saved.includes(refOf(props.s)) ? 'हटाएँ' : 'सहेजें'}
        {([['today', 'आज का श्लोक'], ['chapters', 'अध्याय'], ['saved', 'सहेजे गए']]).map(([id, label]) => (
      {tab === 'saved' && (
        saved.length === 0 ? <div className="nb-empty">अभी कोई श्लोक सहेजा नहीं गया।</div> : null
      )}
`;

const REQUEST =
  'Build a Bhagavad Gita reader in Hindi: all eighteen chapters listed with their names, ' +
  'bookmarks saved in the browser, search across the Hindi meaning and the chapter name.';

/** What the sandbox actually held: one component, one app file. */
const ONE_FILE = graph({ files: ['src/App.tsx', 'src/theme.tsx'], components: ['ThemeToggle'] });

describe('a one-file app keeps its features inline', () => {
  it('does not call a fully-built feature NOT BUILT', () => {
    const r = analyzeRequirementCoverage(REQUEST, ONE_FILE, [{ path: 'src/App.tsx', content: GITA_APP }]);
    expect(r.requested).toContain('wishlist / favorites');
    expect(r.covered).toContain('wishlist / favorites');
    expect(r.missing).not.toContain('wishlist / favorites');
  });

  it('🔴 and never states it as CONFIRMED — the accusation the user read', () => {
    const r = analyzeRequirementCoverage(REQUEST, ONE_FILE, [{ path: 'src/App.tsx', content: GITA_APP }]);
    expect(r.confirmedMissing).not.toContain('wishlist / favorites');
    expect(r.findings.map((f) => f.feature)).not.toContain('wishlist / favorites');
  });

  it('⚠️ still reports a feature that genuinely is not there', () => {
    // Same app, and nothing in it uploads anything.
    const r = analyzeRequirementCoverage(
      'a gita reader with bookmarks and a file upload for your own notes',
      ONE_FILE,
      [{ path: 'src/App.tsx', content: GITA_APP }],
    );
    expect(r.covered).toContain('wishlist / favorites');
    expect(r.missing).toContain('file / image upload');
  });

  it('is unchanged for a multi-file app, where the name already reached the surface', () => {
    const r = analyzeRequirementCoverage(
      'a shop with a wishlist',
      graph({ files: ['src/Wishlist.tsx'], components: ['Wishlist'] }),
      [{ path: 'src/Wishlist.tsx', content: 'export function Wishlist() { return null }' }],
    );
    expect(r.covered).toContain('wishlist / favorites');
  });

  it('says nothing either way when it could not read the bodies', () => {
    // No sources: "missing" stays the advisory it always was, never a confirmed accusation.
    const r = analyzeRequirementCoverage(REQUEST, ONE_FILE);
    expect(r.confirmedMissing).not.toContain('wishlist / favorites');
  });
});

/**
 * 🔴 The same build's other measured waste: the agent's own `grep` tool excluded nothing, so a
 * reviewer's `grep <pattern> .` walked node_modules and returned 2,709,481 characters — truncated
 * before the model, so the walk was paid for and the answer was still lost.
 *
 * Read from the source, because the defect is what the COMMAND says: eight other search paths in
 * `ToolDispatcher` carry a skip set and this one did not.
 */
describe('the agent grep tool is bounded to the user\'s own code', () => {
  it('excludes the directories every other search in the same file excludes', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../src/server/AgentV3/ToolDispatcher.ts', import.meta.url),
      'utf8',
    );
    const grepCase = src.slice(src.indexOf("case 'grep': {"), src.indexOf("case 'glob': {"));
    expect(grepCase).toContain('--exclude-dir=');
    for (const dir of ['node_modules', 'dist', 'build', 'coverage', '.git']) {
      expect(grepCase, dir).toContain(`'${dir}'`);
    }
    // The command that actually runs must carry them, not merely a list sitting beside it.
    expect(grepCase).toMatch(/grep -rn \$\{excludes\}/);
  });
});
