/**
 * AUTOPSY 3ab93068 (2026-09-23): a free build of a street-vendor status app ended with four of seven
 * files written, `src/App.tsx` still our "Hello World" starter, and every verdict downstream calling it
 * a working app — "✅ Preview verified", IN_BUILD_GREEN saving the starter as the last known good, the
 * reviewer's CRITICAL finding turned into an offer, and ₹85.29 billed with markup.
 *
 * Two layers are locked here: (A) the fast lane can no longer finish without writing the app's root
 * component, and (B) a page that IS the starter can no longer count as a rendered app anywhere a render
 * verdict is made.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  STARTER_ENTRY_CONTENT, starterEntryIn, starterIsWhatRendered, pageShowsStarter, starterPreviewProblem, withStarterVerdict,
} from '../src/server/AgentV3/stillTheStarterApp';
import { ensureEntryPlanned, unwrittenEntries, runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { inBuildGreenNote } from '../src/server/AgentV3/inBuildGreen';
import type { OneShotFile } from '../src/server/AgentV3/OneShotBuilder';

const HELLO_PAGE = '<html><body><div id="root"><div><h1>Hello World</h1></div></div></body></html>';
const REAL_PAGE = '<html><body><div id="root"><main><h1>Vendor Status</h1><button>Turn On</button></main></div></body></html>';

describe('layer B — the starter is never a rendered app', () => {
  it('finds the untouched entry in a file map or a Map, and nothing once it is edited', () => {
    expect(starterEntryIn({ 'src/App.tsx': STARTER_ENTRY_CONTENT })).toBe('src/App.tsx');
    expect(starterEntryIn(new Map([['src/App.tsx', `  ${STARTER_ENTRY_CONTENT}\n\n`]]))).toBe('src/App.tsx');
    expect(starterEntryIn({ 'src/App.tsx': 'export default function App(){ return <Dashboard/> }' })).toBeNull();
    expect(starterEntryIn({})).toBeNull(); // absent is "not examined", never a finding
  });

  it('needs BOTH factors: an untouched entry AND the starter heading on the page', () => {
    expect(starterIsWhatRendered('src/App.tsx', HELLO_PAGE)).toBe(true);
    // the entry is untouched but the app is mounted from main.tsx — the page is the real app
    expect(starterIsWhatRendered('src/App.tsx', REAL_PAGE)).toBe(false);
    // the page says Hello World but the entry was rewritten — a real app may say it
    expect(starterIsWhatRendered(null, HELLO_PAGE)).toBe(false);
    expect(pageShowsStarter(HELLO_PAGE)).toBe(true);
    expect(pageShowsStarter(REAL_PAGE)).toBe(false);
  });

  it('turns a RENDERED verdict into a conclusive not-rendered one naming the exact fix', () => {
    const v = withStarterVerdict({ rendered: true, inconclusive: false, serverDown: false, problems: [] as string[] }, 'src/App.tsx');
    expect(v.rendered).toBe(false);
    expect(v.inconclusive).toBe(false);
    expect(v.problems[0]).toBe(starterPreviewProblem('src/App.tsx'));
    expect(v.problems[0]).toContain('Rewrite src/App.tsx');
  });

  it('leaves every other verdict exactly as it was', () => {
    const down = { rendered: false, inconclusive: false, serverDown: true, problems: ['502'] };
    expect(withStarterVerdict(down, 'src/App.tsx')).toBe(down);
    const unsure = { rendered: false, inconclusive: true, problems: ['not painted'] };
    expect(withStarterVerdict(unsure, 'src/App.tsx')).toBe(unsure);
    const fine = { rendered: true, problems: [] as string[] };
    expect(withStarterVerdict(fine, null)).toBe(fine);
  });

  it('the in-build proof names a starter outcome and never claims it as protected', () => {
    const n = inBuildGreenNote({ kind: 'starter' }, { elapsedMs: 683_000 });
    expect(n.code).toBe('IN_BUILD_GREEN_NOT_YET');
    expect(n.autoResolved).toBe(false);
    expect(n.message).toContain('starter template');
  });

  it('every render verdict in the route passes through the starter check (source guard)', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    // the three places a real-browser verdict can call a build rendered: rescue, verify loop, last chance
    expect(src.match(/withStarterVerdict\(analyzePreviewHtml\(/g)?.length).toBe(3);
    // the in-build proof reads the tree that rendered
    expect(src).toMatch(/starterIsWhatRendered\(starterEntryIn\(files\), shot\.html\)/);
    // the fast lane is told when the workspace entry is still the starter
    expect(src).toMatch(/runSimpleBuild\(\{[^)]*starterEntryPath/);
  });
});

describe('layer A — the fast lane never finishes without the app root', () => {
  it('adds the root to a plan that has none, and only then', () => {
    const plan = [{ path: 'src/Dashboard.tsx', purpose: 'dash' }];
    const r = ensureEntryPlanned(plan, 'src/App.tsx');
    expect(r.injected).toBe('src/App.tsx');
    expect(r.manifest.map((m) => m.path)).toEqual(['src/Dashboard.tsx', 'src/App.tsx']);
    expect(ensureEntryPlanned(plan, undefined).injected).toBeNull();
    expect(ensureEntryPlanned([...plan, { path: 'src/App.tsx', purpose: 'root' }], 'src/App.tsx').injected).toBeNull();
    expect(ensureEntryPlanned([...plan, { path: 'src/main.tsx', purpose: 'mount' }], 'src/App.tsx').injected).toBeNull();
  });

  it('names a planned root that was not written', () => {
    const plan = [{ path: 'src/App.tsx', purpose: 'r' }, { path: 'src/Dashboard.tsx', purpose: 'd' }];
    expect(unwrittenEntries(plan, ['src/Dashboard.tsx'])).toEqual(['src/App.tsx']);
    expect(unwrittenEntries(plan, ['src/Dashboard.tsx', 'src/App.tsx'])).toEqual([]);
  });

  const pathOf = (user: string) => (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x';
  const block = (p: string) => `<<<FILE ${p}>>>\nexport default function X(){return null}\n<<<ENDFILE>>>`;

  it('THE EXACT FAILURE: out of budget after the first tier — hands off instead of "succeeding" without App.tsx', async () => {
    const written: string[][] = [];
    const logs: string[] = [];
    const r = await runSimpleBuild({
      prompt: 'vendor status app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx'],
      shareContract: false, overallTimeoutMs: 2000,
      generate: async (_s, user) => {
        if (user.includes('Plan the file list')) {
          return 'src/types.ts :: state\nsrc/utils.ts :: helpers\nsrc/Widget.tsx :: a widget\nsrc/App.tsx :: root';
        }
        const p = pathOf(user);
        if (p === 'src/types.ts' || p === 'src/utils.ts') await new Promise((res) => setTimeout(res, 700)); // a slow first tier
        return block(p);
      },
      writeFiles: async (f: OneShotFile[]) => { written.push(f.map((x) => x.path)); },
      log: (m) => logs.push(m),
    });
    expect(r.ok).toBe(false); // the old code returned ok:true here with App.tsx never generated
    expect(r.reason).toContain('stopped early');
    expect(r.salvagedPaths?.sort()).toEqual(['src/types.ts', 'src/utils.ts']); // finished work reaches the full builder
    expect(written.flat()).not.toContain('src/App.tsx');
  });

  it('a root whose own generation call failed is the same failure, not a smaller success', async () => {
    const r = await runSimpleBuild({
      prompt: 'app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], shareContract: false,
      generate: async (_s, user) => {
        if (user.includes('Plan the file list')) return 'src/A.tsx :: a\nsrc/B.tsx :: b\nsrc/App.tsx :: root';
        const p = pathOf(user);
        if (p === 'src/App.tsx') throw new Error('network error');
        return block(p);
      },
      writeFiles: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('src/App.tsx');
    expect(r.salvagedPaths?.sort()).toEqual(['src/A.tsx', 'src/B.tsx']);
  });

  it('a plan without a root is given one when the workspace still holds the starter', async () => {
    const asked: string[] = [];
    const r = await runSimpleBuild({
      prompt: 'app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], shareContract: false,
      starterEntryPath: 'src/App.tsx',
      generate: async (_s, user) => {
        if (user.includes('Plan the file list')) return 'src/A.tsx :: a\nsrc/B.tsx :: b';
        const p = pathOf(user); asked.push(p);
        return block(p);
      },
      writeFiles: async () => {},
    });
    expect(asked).toContain('src/App.tsx');
    expect(r.ok).toBe(true);
  });
});
