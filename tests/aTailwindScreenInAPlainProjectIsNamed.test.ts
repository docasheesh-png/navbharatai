// failedbr #1881 (2026-11-20): an inventory app's screens used 47 classes no stylesheet defined, all Tailwind
// utilities, in a project without Tailwind. The notes asked for one hand-written rule per utility. They now say the
// screens are written in Tailwind and must use the project's own classes.
import { describe, expect, it } from 'vitest';
import {
  isTailwindUtility, tailwindVocabularyLine, undefinedClassWriteNote, undefinedClassesNote, cssConsistencyError,
} from '../src/server/AgentV3/CssConsistency';

// The twelve classes the #1881 report named, verbatim.
const REPORTED = ['absolute', 'bg-accent', 'bg-accent-soft', 'bg-gray-200', 'border', 'border-b', 'border-border',
  'capitalize', 'flex', 'font-bold', 'font-medium', 'gap-1'];

describe('Tailwind vocabulary in a project without Tailwind is named (failedbr #1881)', () => {
  it("every stock utility #1881 named is read as Tailwind; its theme-token names are left as the app's own", () => {
    expect(REPORTED.filter((c) => !isTailwindUtility(c))).toEqual(['bg-accent', 'bg-accent-soft', 'border-border']);
    expect(['md:p-4', 'hover:bg-blue-600', 'text-gray-500', 'grid-cols-3', 'rounded-lg', 'w-1/2', 'px-[12px]'].filter((c) => !isTailwindUtility(c))).toEqual([]);
  });

  it("an app's own semantic classes are never read as Tailwind", () => {
    for (const c of ['card', 'card-title', 'btn-primary', 'nav-item', 'stat-card', 'order-row', 'app-shell', 'status-pending', 'bottom-nav', 'product-grid', 'text-muted', 'top-bar', 'bg-card', 'border-light', 'flex-center', 'title-lg']) {
      expect(isTailwindUtility(c), c).toBe(false);
    }
  });

  it('the write note tells the model the screen is written in Tailwind', () => {
    const project = { 'src/index.css': '.card { padding: 8px; }\n', 'package.json': '{"dependencies":{"react":"^18"}}' };
    const screen = { 'src/screens/Orders.tsx': `export default function Orders(){return <div className="${REPORTED.join(' ')}">x</div>;}` };
    const note = undefinedClassWriteNote(screen, project);
    expect(note).toMatch(/Tailwind utility classes/);
    expect(note).toMatch(/does not use Tailwind/);
  });

  it('the end-of-build note and the repair brief say it too', () => {
    expect(undefinedClassesNote(REPORTED)).toMatch(/Tailwind utility classes/);
    const files = { 'src/index.css': '.card { padding: 8px; }\n', 'src/App.tsx': `export default ()=> <div className="${REPORTED.join(' ')}"/>;` };
    expect(cssConsistencyError(files) ?? '').toMatch(/Tailwind utility classes/);
  });

  it('a handful of missing semantic classes gets no Tailwind line', () => {
    expect(tailwindVocabularyLine(['card-title', 'btn-primary', 'stat-card', 'flex', 'order-row'])).toBe('');
  });
});
