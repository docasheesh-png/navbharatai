// failedbr #1798 (2026-11-20): a counter app's fast-lane plan described four scaffold files only by what they already
// are; `package.json` and `vite.config.ts` were regenerated as byte-copies of the starter (68 s, 102 s) and the lane
// ran out of budget before `src/App.tsx`. Such a purpose now reads as "(unchanged)".
import { describe, expect, it } from 'vitest';
import { describesOnlyTheDefault, dropUnchangedScaffold } from '../src/server/AgentV3/SimpleBuilder';

const SCAFFOLD = ['package.json', 'vite.config.ts', 'src/main.tsx', 'src/index.css', 'src/App.tsx', 'index.html'];
// The #1798 plan, verbatim.
const PLAN = [
  ['src/App.tsx', 'Main app component with counter state and UI controls (+, −, reset)'],
  ['src/index.css', 'Global styles for the counter app layout and button appearance'],
  ['src/main.tsx', 'Entry point rendering the App component within React.StrictMode'],
  ['index.html', 'HTML template with root div for React app mounting'],
  ['package.json', 'Project dependencies and scripts for Vite React TypeScript setup'],
  ['vite.config.ts', 'Vite configuration file for React plugin and build settings'],
].map(([path, purpose]) => ({ path, purpose }));

describe('a scaffold file described only as it already is is not rewritten (failedbr #1798)', () => {
  it('the #1798 plan keeps only the files the app needs', () => {
    const { kept, dropped } = dropUnchangedScaffold(PLAN as never, SCAFFOLD);
    expect(kept.map((k) => k.path)).toEqual(['src/App.tsx', 'src/index.css']);
    expect(dropped.sort()).toEqual(['index.html', 'package.json', 'src/main.tsx', 'vite.config.ts']);
  });

  it.each([
    ['package.json', 'Project dependencies including react-router-dom and zustand'],
    ['src/main.tsx', 'Entry point that wraps App in a BrowserRouter'],
    ['index.html', 'HTML template that sets the page title to Ginti Counter'],
    ['vite.config.ts', 'Vite config with a PWA plugin'],
  ])('a named change keeps the file: %s', (path, purpose) => {
    expect(describesOnlyTheDefault(path, purpose)).toBe(false);
  });

  it('only the four default scaffold files are judged this way, and only when they are in the scaffold', () => {
    expect(describesOnlyTheDefault('src/App.tsx', 'Main app component')).toBe(false);
    expect(dropUnchangedScaffold([{ path: 'vite.config.ts', purpose: 'Vite configuration file' }] as never, []).dropped).toEqual([]);
  });
});
