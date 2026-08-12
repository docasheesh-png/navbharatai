import { describe, it, expect } from 'vitest';
import {
  tokenize, contentSearchTerms, groundableFile, isGeneratedArtifact, looksMinified,
  rankByBM25, selectGroundingCandidates,
} from './ContextReranker';

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, drops stopwords + 1-char tokens', () => {
    expect(tokenize('Fix the Payment page!')).toEqual(['payment', 'page']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('contentSearchTerms (content-based file retrieval for large repos)', () => {
  it('keeps only salient words long enough to grep for without over-matching', () => {
    // "fix"/"the" are dropped (stopword / short); "credits", "decrement" survive.
    const terms = contentSearchTerms('fix the bug where credits do not decrement on a call');
    expect(terms).toContain('credits');
    expect(terms).toContain('decrement');
    expect(terms).not.toContain('fix');
    expect(terms.every((t) => t.length >= 4)).toBe(true);
  });

  it('dedups and caps the number of terms', () => {
    const terms = contentSearchTerms('subscription subscription payment provider dashboard analytics reporting exporting importing', 4);
    expect(terms.length).toBe(4);
    expect(new Set(terms).size).toBe(terms.length); // no duplicates
  });

  it('returns [] for an empty / stopword-only request (no grep fired)', () => {
    expect(contentSearchTerms('')).toEqual([]);
    expect(contentSearchTerms('please fix it and add a bit')).toEqual([]); // all short/stopwords
  });
});

// ── Retrieval v2 (Mitrify autopsy: grounding picked BackButton.tsx for a survey) ──────────────────
import { isOverviewRequest, structuralAnchors, centralFiles, selectGroundingCandidates, buildGroundedContext, groundableFile, pathTokenize } from './ContextReranker';

/** A Mitrify-shaped tree: many alphabetically-early leaf components + the real structural files. */
const MITRIFY_TREE = [
  'client/src/components/AIChat.tsx',
  'client/src/components/BackButton.tsx',
  'client/src/components/ChangeCredentialsDialog.tsx',
  'client/src/components/ui/button.tsx',
  'client/src/components/ui/dialog.tsx',
  'client/src/pages/AdminDashboardPage.tsx',
  'client/src/pages/CustomerHomePage.tsx',
  'client/src/App.tsx',
  'client/src/main.tsx',
  'server/index.ts',
  'server/routes.ts',
  'server/storage.ts',
  'shared/schema.ts',
  'package.json',
  'README.md',
];

describe('isOverviewRequest (intent detection)', () => {
  it('detects the EXACT Mitrify survey prompt', () => {
    expect(isOverviewRequest('Import this app from my GitHub repository and give me a short survey of what it is and how it is structured. Do not change any files yet.')).toBe(true);
  });
  it('detects overview/architecture/explain/summarize forms (EN + Hinglish)', () => {
    expect(isOverviewRequest('give me an overview of the project')).toBe(true);
    expect(isOverviewRequest('explain the architecture')).toBe(true);
    expect(isOverviewRequest('analyze this codebase')).toBe(true);
    expect(isOverviewRequest('yeh app kya hai?')).toBe(true);
    expect(isOverviewRequest('mujhe samjhao yeh project')).toBe(true);
  });
  it('a targeted edit request is NOT an overview', () => {
    expect(isOverviewRequest('fix the bug where credits do not decrement on a call')).toBe(false);
    expect(isOverviewRequest('add a dark mode toggle to settings')).toBe(false);
  });
});

describe('structuralAnchors (what an engineer opens first)', () => {
  it('surfaces package.json, README, entry, App, server index, routes, schema, storage — in priority order', () => {
    const anchors = structuralAnchors(MITRIFY_TREE);
    expect(anchors[0]).toBe('package.json');
    expect(anchors[1]).toBe('README.md');
    expect(anchors).toContain('client/src/main.tsx');
    expect(anchors).toContain('client/src/App.tsx');
    expect(anchors).toContain('server/routes.ts');
    // Never a leaf component.
    expect(anchors).not.toContain('client/src/components/BackButton.tsx');
  });
  it('is deterministic and capped', () => {
    expect(structuralAnchors(MITRIFY_TREE, 3)).toHaveLength(3);
    expect(structuralAnchors(MITRIFY_TREE)).toEqual(structuralAnchors([...MITRIFY_TREE].reverse()));
  });
  it('ignores node_modules copies', () => {
    expect(structuralAnchors(['node_modules/x/package.json', 'src/main.tsx'])).toEqual(['src/main.tsx']);
  });
});

describe('centralFiles (import-graph centrality)', () => {
  const imports = {
    'server/routes.ts': ['./storage', '../shared/schema', 'express'],
    'server/index.ts': ['./routes', './storage'],
    'client/src/App.tsx': ['@/pages/CustomerHomePage', 'react'],
    'client/src/pages/CustomerHomePage.tsx': ['@/components/ui/button', '../../../shared/schema'],
    'client/src/pages/AdminDashboardPage.tsx': ['@/components/ui/button', '../../../shared/schema'],
  };
  it('ranks the most-imported project files first (storage, schema) and ignores npm bare imports', () => {
    const central = centralFiles(MITRIFY_TREE, imports);
    expect(central[0]).toBe('shared/schema.ts'); // imported by 3 files
    expect(central).toContain('server/storage.ts'); // imported by 2
    expect(central.join()).not.toContain('express'); // bare import = npm package, never a candidate
  });
  it('excludes UI-kit primitives (components/ui/*) despite their high in-degree', () => {
    expect(centralFiles(MITRIFY_TREE, imports)).not.toContain('client/src/components/ui/button.tsx');
  });
  it('handles a missing/empty graph safely', () => {
    expect(centralFiles(MITRIFY_TREE, undefined)).toEqual([]);
    expect(centralFiles(MITRIFY_TREE, {})).toEqual([]);
  });
});

describe('selectGroundingCandidates (the Mitrify regression)', () => {
  const imports = {
    'server/routes.ts': ['./storage', '../shared/schema'],
    'server/index.ts': ['./routes'],
    'client/src/pages/CustomerHomePage.tsx': ['../../../shared/schema'],
  };

  it('THE regression: the Mitrify survey prompt selects structural files, never BackButton/alphabetical noise', () => {
    const sel = selectGroundingCandidates({
      fileTree: MITRIFY_TREE,
      prompt: 'Import this app from my GitHub repository and give me a short survey of what it is and how it is structured. Do not change any files yet.',
      imports,
    });
    expect(sel.overview).toBe(true);
    expect(sel.candidates[0]).toBe('package.json');
    expect(sel.candidates).toContain('server/routes.ts');
    expect(sel.candidates).toContain('shared/schema.ts');
    expect(sel.candidates).not.toContain('client/src/components/BackButton.tsx');
    expect(sel.candidates).not.toContain('client/src/components/ChangeCredentialsDialog.tsx');
  });

  it('targeted request: content hits come FIRST, then filename overlap', () => {
    const sel = selectGroundingCandidates({
      fileTree: MITRIFY_TREE,
      prompt: 'fix the credits decrement bug on customer calls',
      contentHits: ['server/storage.ts'],
      imports,
    });
    expect(sel.overview).toBe(false);
    expect(sel.candidates[0]).toBe('server/storage.ts'); // grep hit = strongest signal
    expect(sel.candidates).toContain('client/src/pages/CustomerHomePage.tsx'); // filename overlap ("customer")
  });

  it('the zero-overlap TIE BUG can never return: a vague ask falls to anchors, not alphabetical order', () => {
    const sel = selectGroundingCandidates({ fileTree: MITRIFY_TREE, prompt: 'make it better please', imports });
    // No filename shares tokens with the ask → the OLD code took the first 14 files alphabetically
    // (AIChat, BackButton, ChangeCredentialsDialog…). v2 must fall back to structural priors.
    expect(sel.candidates[0]).toBe('package.json');
    expect(sel.candidates).not.toContain('client/src/components/BackButton.tsx');
  });

  it('binary/non-groundable files are never candidates', () => {
    const sel = selectGroundingCandidates({
      fileTree: [...MITRIFY_TREE, 'attached_assets/IMG_1.png'],
      prompt: 'survey the app',
      contentHits: ['attached_assets/IMG_1.png'],
    });
    expect(sel.candidates.join()).not.toContain('IMG_1');
  });

  it('caps the candidate list', () => {
    const sel = selectGroundingCandidates({ fileTree: MITRIFY_TREE, prompt: 'survey the app', imports, cap: 4 });
    expect(sel.candidates.length).toBeLessThanOrEqual(4);
  });
});

describe('buildGroundedContext preserveOrder (overview mode)', () => {
  it('keeps candidate order (anchors first) instead of BM25 for a survey query', () => {
    const files = {
      'package.json': '{ "name": "mitrify", "dependencies": { "react": "1" } }',
      'server/routes.ts': 'import x from "./storage"; app.get("/api/providers", handler);',
      'client/src/components/BackButton.tsx': 'import { survey } from "x"; survey(); // mentions survey twice: survey',
    };
    const out = buildGroundedContext(files, 'give me a survey of the app', 2, { preserveOrder: true });
    // preserveOrder → the first two files in candidate order, NOT the BM25 winner (BackButton,
    // which spuriously repeats the query token "survey").
    expect(out).toContain('package.json');
    expect(out).toContain('server/routes.ts');
    expect(out).not.toContain('BackButton');
  });
  it('groundableFile covers code + the two doc anchors, and rejects binaries', () => {
    expect(groundableFile('package.json')).toBe(true);
    expect(groundableFile('README.md')).toBe(true);
    expect(groundableFile('src/App.tsx')).toBe(true);
    expect(groundableFile('a.png')).toBe(false);
  });
});

describe('pathTokenize (camelCase-aware filename matching)', () => {
  it('splits PascalCase/camelCase so page names match request words', () => {
    expect(pathTokenize('client/src/pages/CustomerHomePage.tsx')).toEqual(
      expect.arrayContaining(['customer', 'home', 'page', 'pages', 'client', 'src', 'tsx']),
    );
  });
  it('handles consecutive capitals (AIChat → ai chat is at least not one opaque token)', () => {
    const t = pathTokenize('components/AIChat.tsx');
    expect(t).toContain('chat');
  });
});

/**
 * GENERATED OUTPUT MUST NEVER BE GROUNDING MATERIAL.
 *
 * From a real build report (Shiv Medical Store, 2026-08-10): a Capacitor app, so `npx cap sync` had
 * copied the built web bundle into android/app/src/main/assets/public/. Only node_modules/ was
 * excluded, so the MINIFIED REACT BUNDLE ranked as the #1 "most relevant existing file" and rode along
 * in the grounding preamble of all ~26 model calls. That build spent ~776k input tokens to change 3
 * files and billed ₹567 to a free-tier user.
 *
 * It costs twice: tokens are the bill, and the model's context fills with minified vendor code instead
 * of the app's real source.
 */
describe('generated build output is never grounded on', () => {
  it('rejects the EXACT file from the report', () => {
    expect(groundableFile('android/app/src/main/assets/public/assets/index-CW6KpYSX.js')).toBe(false);
    expect(isGeneratedArtifact('android/app/src/main/assets/public/assets/index-CW6KpYSX.js')).toBe(true);
  });

  it('rejects every common build output directory', () => {
    for (const p of [
      'dist/index.js', 'build/main.js', 'out/page.js', 'coverage/lcov-report/x.js',
      '.next/static/chunks/main.js', '.nuxt/dist/client.js', '.svelte-kit/output/x.js',
      'node_modules/react/index.js', 'ios/App/App/public/assets/index-abc.js',
      'www/js/app.js', 'test-results/x.js', 'playwright-report/index.html', 'vendor/jquery.js',
    ]) {
      expect(groundableFile(p), p).toBe(false);
    }
  });

  it('rejects bundler output by name, wherever it sits', () => {
    for (const p of ['src/lib.min.js', 'public/app.bundle.js', 'src/app.js.map', 'styles.min.css']) {
      expect(groundableFile(p), p).toBe(false);
    }
  });

  it('STILL ACCEPTS ordinary source — the check must not eat the app', () => {
    // The failure that would matter more than the bug: grounding on nothing at all.
    for (const p of [
      'src/App.tsx', 'src/pages/Dashboard.tsx', 'src/components/Card.jsx', 'src/index.css',
      'index.html', 'package.json', 'README.md', 'app/routes/_index.tsx', 'src/App.vue',
      'src/App.svelte', 'server/main.py',
      // Names that merely CONTAIN a banned word must survive.
      'src/components/BuildStatus.tsx', 'src/lib/distance.ts', 'src/pages/about-us.tsx',
    ]) {
      expect(groundableFile(p), p).toBe(true);
    }
  });

  it('BM25 refuses a minified doc even when its path looks innocent', () => {
    // A hashed chunk dropped somewhere unusual would otherwise win on raw term frequency.
    const bundle = `var a=1;${'x'.repeat(4000)};function q(){return 1}`.replace(/\n/g, '');
    const ranked = rankByBM25(
      { 'src/weird/chunk-abc.js': `${bundle} medicine stock inventory`, 'src/Real.tsx': 'medicine stock inventory list' },
      'medicine stock inventory',
    );
    expect(ranked.map((r) => r.path)).toEqual(['src/Real.tsx']);
  });

  it('looksMinified is about LINE LENGTH, not file size — a long normal file is fine', () => {
    const normal = Array.from({ length: 2000 }, (_, i) => `const x${i} = ${i}; // a normal line of source`).join('\n');
    expect(looksMinified(normal)).toBe(false);
    expect(looksMinified('a'.repeat(2000))).toBe(true);
    expect(looksMinified('')).toBe(false);
    expect(looksMinified('short')).toBe(false);
  });

  it('the candidate selector drops them too, so nothing downstream can resurrect one', () => {
    const { candidates } = selectGroundingCandidates({
      fileTree: [
        'android/app/src/main/assets/public/assets/index-CW6KpYSX.js',
        'dist/assets/index-9f8a.js',
        'src/App.tsx',
        'src/pages/Medicines.tsx',
      ],
      prompt: 'fix the medicines page',
    });
    expect(candidates.some((c) => c.includes('android/app'))).toBe(false);
    expect(candidates.some((c) => c.startsWith('dist/'))).toBe(false);
    expect(candidates).toContain('src/pages/Medicines.tsx');
  });
});
