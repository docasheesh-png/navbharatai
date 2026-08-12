import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeRequirementCoverage } from '../src/server/AgentV3/RequirementCoverage';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. The user's request, verbatim:
 *
 *     "Saari cheezon ki list dikhe, upar search box ho"
 *      (show a list of everything, with a search box above it)
 *
 * No search was built. This module noticed, and said so:
 *
 *     [warning] READINESS_WARNING: Requested feature not found: search   autoResolved: true
 *
 * …and the build shipped, and the user was told their app was ready.
 *
 * The finding was RIGHT and was ignored — which is worse than not having it at all, because it cost
 * tokens to produce and bought nothing. And the honest reason it was ignored is this module's own
 * fault: matching NAMES ONLY, it could never tell "nobody built it" from "somebody built it inside
 * another file". Its own history records two false positives of exactly that shape (Registration.tsx;
 * ShopSphere's components/admin/ folder), so it was correctly labelled advisory — and an advisory
 * nobody is allowed to act on is where a true finding goes to die.
 *
 * Reading the bodies is what makes the finding trustworthy enough to be worth acting on.
 */

// The 18 source files the dukaan build actually produced, per the report.
const BUILT_FILES = [
  'src/AddItem.tsx', 'src/App.css', 'src/App.tsx', 'src/Dashboard.tsx', 'src/ErrorBoundary.tsx',
  'src/Inventory.tsx', 'src/api/client.ts', 'src/components/AddProduct.tsx', 'src/components/Login.tsx',
  'src/components/Navigation.tsx', 'src/components/ProductList.tsx', 'src/components/Summary.tsx',
  'src/context/AuthContext.tsx', 'src/db.ts', 'src/index.css', 'src/main.tsx',
];
const graph = (files: string[]) => ({ files, components: [], routes: [] }) as any;
const REQUEST = 'Meri chhoti dukaan ke liye ek stock app banao. Login ho. Saari cheezon ki list dikhe, upar search box ho.';

describe('the search box the user asked for and never got', () => {
  it('is reported missing — and now as a CONFIRMED absence, not a lookup that came up empty', () => {
    const list = 'export function ProductList({ items }) { return <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>; }';
    const r = analyzeRequirementCoverage(REQUEST, graph(BUILT_FILES), [{ path: 'src/components/ProductList.tsx', content: list }]);
    expect(r.missing).toContain('search');
    expect(r.confirmedMissing).toContain('search');
    const f = r.findings.find((x) => x.feature === 'search')!;
    expect(f.confirmed).toBe(true);
    expect(f.message).toMatch(/not in the app/);
    expect(f.message).not.toMatch(/built under another name/); // that hedge is for UNconfirmed findings
  });

  it('a search box built INLINE now counts as built — the false positive this module kept producing', () => {
    /**
     * THE OTHER HALF, and the reason the first half is safe. A search box lives inside the list page;
     * it owns no file named for it. Name-only matching called that "missing" and was wrong — which is
     * precisely why nobody could act on the finding when it was right.
     */
    const list = `
      const [searchTerm, setSearchTerm] = useState('');
      <input placeholder="Search items…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
    `;
    const r = analyzeRequirementCoverage(REQUEST, graph(BUILT_FILES), [{ path: 'src/components/ProductList.tsx', content: list }]);
    expect(r.covered).toContain('search');
    expect(r.missing).not.toContain('search');
    expect(r.findings.find((x) => x.feature === 'search')).toBeUndefined();
  });

  it('a Hindi/Hinglish placeholder counts too — the users this app is built for', () => {
    const r = analyzeRequirementCoverage(REQUEST, graph(BUILT_FILES), [
      { path: 'src/components/ProductList.tsx', content: '<input placeholder="Saaman khojein" onChange={onChange} />' },
    ]);
    expect(r.covered).toContain('search');
  });

  it('a file merely NAMED for the feature still counts, exactly as before', () => {
    const r = analyzeRequirementCoverage(REQUEST, graph([...BUILT_FILES, 'src/components/SearchBar.tsx']), [
      { path: 'src/components/SearchBar.tsx', content: 'export const SearchBar = () => null;' },
    ]);
    expect(r.covered).toContain('search');
  });
});

describe('"confirmed" means we actually looked — it is never a louder guess', () => {
  it('with NO bodies, every finding stays the advisory it has always been', () => {
    const r = analyzeRequirementCoverage(REQUEST, graph(BUILT_FILES));
    expect(r.missing).toContain('search');
    expect(r.confirmedMissing).toEqual([]);
    expect(r.findings.every((f) => f.confirmed === false)).toBe(true);
    expect(r.findings.find((x) => x.feature === 'search')!.message).toMatch(/built under another name/);
  });

  it('empty or whitespace bodies are the same as no bodies — not a licence to confirm', () => {
    for (const sources of [[], [{ path: 'a.tsx', content: '' }], [{ path: 'a.tsx', content: '   \n  ' }]]) {
      expect(analyzeRequirementCoverage(REQUEST, graph(BUILT_FILES), sources).confirmedMissing).toEqual([]);
    }
  });

  it('a feature with no evidence pattern is NEVER confirmed, even with bodies in hand', () => {
    /**
     * A dashboard or an about page always owns a file, so there is nothing distinctive to match in a
     * body — an evidence pattern there would invent false negatives. Those features keep the old
     * advisory semantics rather than being confirmed on a pattern that was never written.
     */
    const r = analyzeRequirementCoverage('build a dashboard and an about page', graph(['src/App.tsx']), [
      { path: 'src/App.tsx', content: 'export default function App() { return <div/>; }' },
    ]);
    expect(r.missing).toEqual(expect.arrayContaining(['dashboard', 'about page']));
    expect(r.confirmedMissing).toEqual([]);
  });

  it('the negation guard still wins — an unrequested feature is never missing', () => {
    // "No search" must not become a confirmed missing feature just because bodies are now readable.
    const r = analyzeRequirementCoverage('a simple list app, no search', graph(['src/App.tsx']), [
      { path: 'src/App.tsx', content: 'const x = 1;' },
    ]);
    expect(r.requested).not.toContain('search');
    expect(r.confirmedMissing).not.toContain('search');
  });

  it('confirmedMissing is always a subset of missing', () => {
    const r = analyzeRequirementCoverage('login, search, cart, notifications, upload', graph(['src/App.tsx']), [
      { path: 'src/App.tsx', content: 'const x = 1;' },
    ]);
    for (const f of r.confirmedMissing) expect(r.missing).toContain(f);
  });

  it('other inline-built features are recognised the same way', () => {
    const sources = [{ path: 'src/App.tsx', content: 'addToCart(item); toast.success("added"); <input type="file" onChange={up} />' }];
    const r = analyzeRequirementCoverage('cart, notifications and image upload please', graph(['src/App.tsx']), sources);
    expect(r.covered).toEqual(expect.arrayContaining(['shopping cart', 'notifications', 'file / image upload']));
    expect(r.confirmedMissing).toEqual([]);
  });

  it('nothing built yet stays silent — it must never nag before there is an app', () => {
    const r = analyzeRequirementCoverage(REQUEST, graph([]), [{ path: 'x.tsx', content: 'anything' }]);
    expect(r.findings).toEqual([]);
    expect(r.confirmedMissing).toEqual([]);
  });
});

describe('WIRING — readiness passes the bodies, and says what actually happened', () => {
  const dispatcher = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

  it('the analyzer is given snap.sources — the bodies readiness already had in hand', () => {
    expect(dispatcher).toContain('analyzeRequirementCoverage(requestText, mem.graph(), snap.sources)');
  });

  it('a confirmed absence reads "NOT BUILT", not "not found"', () => {
    // "not found" reads like a lookup that came up empty — which is how a true finding gets skimmed
    // past. In the dukaan report the user had written "upar search box ho", no search existed, that
    // line said so, and the build shipped anyway.
    expect(dispatcher).toContain('Requested feature NOT BUILT: ${f.feature}');
    expect(dispatcher).toContain('Requested feature not found: ${f.feature}'); // unconfirmed keeps its hedge
  });
});
