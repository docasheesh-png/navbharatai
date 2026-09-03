import { describe, it, expect } from 'vitest';
import { summarizeProject, projectSummaryNote } from './ProjectSummary';
import type { ProjectGraph } from './WorkspaceMemory';

/** Build a ProjectGraph with sensible defaults so each test only sets what it cares about. */
const graph = (partial: Partial<ProjectGraph>): ProjectGraph => ({
  files: [],
  symbols: [],
  components: [],
  routes: [],
  imports: {},
  dependencies: [],
  ...partial,
});

describe('summarizeProject', () => {
  it('detects a React + Vite stack and includes counts and component names', () => {
    const g = graph({
      files: ['src/App.tsx', 'src/main.tsx', 'src/components/Header.tsx', 'src/components/Footer.tsx'],
      components: ['App', 'Header', 'Footer'],
      routes: ['/', '/about'],
      dependencies: ['react', 'react-dom', 'vite'],
    });
    const out = summarizeProject(g, 'build a landing page');

    expect(out).toContain('Stack: React + Vite');
    expect(out).toContain('4 files');
    expect(out).toContain('3 components');
    expect(out).toContain('2 routes');
    expect(out).toContain('Header');
    expect(out).toContain('Footer');
    expect(out).toContain('/about');
    expect(out).toContain("Here's what I built");
    expect(out).toContain('Preview tab');
  });

  it('detects Next.js even when react is also a dependency', () => {
    const g = graph({
      files: ['pages/index.tsx', 'pages/_app.tsx'],
      components: ['Home'],
      dependencies: ['next', 'react', 'react-dom'],
    });
    const out = summarizeProject(g, 'build a blog');
    expect(out).toContain('Stack: Next.js');
  });

  it('detects a plain React (no Vite) stack', () => {
    const g = graph({
      files: ['src/App.jsx'],
      components: ['App'],
      dependencies: ['react', 'react-dom'],
    });
    expect(summarizeProject(g, '')).toContain('Stack: React');
  });

  it('detects a Node/Express stack', () => {
    const g = graph({
      files: ['server.js', 'routes/users.js'],
      routes: ['/api/users'],
      dependencies: ['express'],
    });
    expect(summarizeProject(g, '')).toContain('Stack: Node/Express');
  });

  it('detects Python from .py files and a python framework', () => {
    const g = graph({
      files: ['main.py', 'app/models.py'],
      dependencies: ['fastapi'],
    });
    const out = summarizeProject(g, '');
    expect(out).toContain('Stack: Python');
    expect(out).toContain('pip install');
  });

  it('falls back to "Web app" for an unrecognised stack', () => {
    const g = graph({ files: ['index.html', 'style.css'], dependencies: [] });
    expect(summarizeProject(g, '')).toContain('Stack: Web app');
  });

  it('returns an empty string for an essentially empty graph (no files)', () => {
    expect(summarizeProject(graph({}), 'anything')).toBe('');
  });

  it('stays within the length bound for a large graph', () => {
    const many = (n: number, prefix: string): string[] =>
      Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    const g = graph({
      files: many(400, 'src/file'),
      components: many(200, 'Component'),
      routes: many(200, '/route'),
      dependencies: ['react', 'vite'],
    });
    const out = summarizeProject(g, 'x'.repeat(5000));
    expect(out.length).toBeLessThanOrEqual(1200);
    // The capped lists must not dump every item.
    expect(out).toContain('…');
  });

  it('projectSummaryNote is an alias for summarizeProject', () => {
    const g = graph({ files: ['a.tsx'], components: ['A'], dependencies: ['react', 'vite'] });
    expect(projectSummaryNote(g, 'req')).toBe(summarizeProject(g, 'req'));
  });

  it('does NOT claim "see it live" when the live preview never came up (no-fake-success)', () => {
    const g = graph({ files: ['src/App.tsx'], components: ['App'], dependencies: ['react', 'vite'] });
    const out = summarizeProject(g, 'build an app', { previewLive: false });
    // The honest message must not falsely tell the user the app is live.
    expect(out).not.toContain('see it live');
    // It points them at the real, working paths instead.
    expect(out).toContain('In-browser preview');
    expect(out).toContain('Diagnose');
  });

  it('claims "see it live" only when a live preview actually came up', () => {
    const g = graph({ files: ['src/App.tsx'], components: ['App'], dependencies: ['react', 'vite'] });
    expect(summarizeProject(g, 'x', { previewLive: true })).toContain('see it live');
    // Default (no opts) stays backward-compatible = preview-live message.
    expect(summarizeProject(g, 'x')).toContain('see it live');
  });

  // HONESTY (build-report autopsy 2026-07-05): a read-only import+survey run ended with
  // "✅ Here's what I built: … 165 files, 186 routes" — claiming authorship of an app the AI never
  // touched. The header must reflect what ACTUALLY happened this run.
  describe('honest header: analyzed vs edited vs built', () => {
    const mitrify = graph({
      files: ['client/src/App.tsx', 'server/routes.ts', 'shared/schema.ts'],
      components: ['App', 'AdminDashboardPage'],
      routes: ['/', '/admin/dashboard'],
      dependencies: ['react', 'vite', 'express'],
    });

    it('a run that changed NOTHING says "analyzed — no files were changed", never "built"', () => {
      const out = summarizeProject(mitrify, 'survey my app', { changedFiles: 0, editMode: true });
      expect(out).toContain('I analyzed your project');
      expect(out).toContain('no files were changed');
      expect(out).not.toContain("Here's what I built");
      // Counts describe the EXISTING project, framed as such.
      expect(out).toContain('Project: 3 files');
    });

    it('an EDIT run says how many files it changed, never "built"', () => {
      const out = summarizeProject(mitrify, 'fix the login bug', { changedFiles: 2, editMode: true });
      expect(out).toContain('I changed 2 files in your project');
      expect(out).not.toContain("Here's what I built");
      expect(out).toContain('Project: 3 files');
    });

    it('uses the singular for a single changed file', () => {
      const out = summarizeProject(mitrify, 'tweak', { changedFiles: 1, editMode: true });
      expect(out).toContain('I changed 1 file in your project');
    });

    it('a FRESH build keeps "Here\'s what I built" even when the graph holds extra scaffold files', () => {
      // changedFiles < graph size here (scaffold files the AI did not write) — editMode:false must
      // still classify it as a BUILD, proving classification comes from editMode, not a size compare.
      const out = summarizeProject(mitrify, 'build me an app', { changedFiles: 2, editMode: false });
      expect(out).toContain("Here's what I built");
      expect(out).not.toContain('I changed');
    });

    it('backward-compatible: callers that do not track changes keep today\'s wording', () => {
      expect(summarizeProject(mitrify, 'x')).toContain("Here's what I built");
    });
  });

  // Mitrify autopsy 2026-08-04: on a "do not change any files" survey turn the header said
  // "I changed 1 file in your project" — the pipeline's own dev .env from key-provisioning — and named
  // nothing. The user read that as a broken promise. Naming the files turns confusion into
  // information; an engine-config-only change-set is said as exactly what it is: setup, source untouched.
  describe('WHICH files changed — naming + engine-config attribution', () => {
    const mitrify = graph({
      files: ['client/src/App.tsx', 'server/routes.ts', 'shared/schema.ts'],
      components: ['App'],
      routes: ['/'],
      dependencies: ['react', 'vite', 'express'],
    });

    it('an edit run NAMES the changed files when there are three or fewer', () => {
      const out = summarizeProject(mitrify, 'fix login', {
        changedFiles: 2, editMode: true, changedPaths: ['client/src/App.tsx', 'server/routes.ts'],
      });
      expect(out).toContain('I changed 2 files in your project (client/src/App.tsx, server/routes.ts)');
    });

    it('a change-set that is ONLY engine-written setup config says the source is untouched', () => {
      const out = summarizeProject(mitrify, 'import and analyze my app', {
        changedFiles: 1, editMode: true, changedPaths: ['.env'],
      });
      expect(out).toContain('Your source files are untouched');
      expect(out).toContain('a setup file (.env)');
      expect(out).not.toContain('I changed 1 file');
      expect(out).not.toContain("Here's what I built");
    });

    it('a MIXED change-set (setup + real source) keeps the honest "I changed" header', () => {
      const out = summarizeProject(mitrify, 'fix it', {
        changedFiles: 2, editMode: true, changedPaths: ['.env', 'server/routes.ts'],
      });
      expect(out).toContain('I changed 2 files in your project (.env, server/routes.ts)');
      expect(out).not.toContain('untouched');
    });

    it('more than three changed files: count only, no unwieldy path dump', () => {
      const out = summarizeProject(mitrify, 'refactor', {
        changedFiles: 4, editMode: true, changedPaths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      });
      expect(out).toContain('I changed 4 files in your project.');
      expect(out).not.toContain('a.ts');
    });

    it('.env variants and node version files count as engine config', () => {
      const out = summarizeProject(mitrify, 'analyze', {
        changedFiles: 2, editMode: true, changedPaths: ['.env.local', '.nvmrc'],
      });
      expect(out).toContain('2 setup files (.env.local, .nvmrc)');
      expect(out).toContain('Your source files are untouched');
    });

    it('a fresh build never names paths — the app itself is the change-set', () => {
      const out = summarizeProject(mitrify, 'build me an app', {
        changedFiles: 2, editMode: false, changedPaths: ['a.ts', 'b.ts'],
      });
      expect(out).toContain("Here's what I built");
      expect(out).not.toContain('a.ts');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The EXACT change-set of report faa98da9 (2026-09-03): a "do not change any files yet" survey of an
// imported repo, during which the engine provisioned `.env` and hardened `.gitignore` so the app
// could boot. The 2026-08-04 fix covered `.env` alone, so this pair fell through to the alarming
// branch and the user was told their files had been changed after asking that they not be.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('engine setup files never read as "I changed your files" (report faa98da9)', () => {
  const graph = { files: ['a.tsx'], components: ['A'], routes: ['/'], entry: 'a.tsx' } as never;

  it('.env + .gitignore together are reported as setup, with the source called untouched', () => {
    const out = summarizeProject(graph, 'survey it', {
      changedFiles: 2, editMode: true, changedPaths: ['.env', '.gitignore'],
    });
    expect(out).toContain('Your source files are untouched');
    expect(out).toContain('.env, .gitignore');
    expect(out).not.toContain('I changed 2 files in your project');
  });

  it('.gitignore alone is setup too — it is written only because .env was', () => {
    const out = summarizeProject(graph, 'survey it', {
      changedFiles: 1, editMode: true, changedPaths: ['.gitignore'],
    });
    expect(out).toContain('Your source files are untouched');
    expect(out).not.toContain('I changed 1 file in your project');
  });

  it('THE MIRROR-IMAGE GUARD: a real source edit is still reported as a real change', () => {
    // The failure mode worse than the one being fixed — a genuine edit reported as "untouched".
    const out = summarizeProject(graph, 'fix the header', {
      changedFiles: 2, editMode: true, changedPaths: ['.gitignore', 'client/src/App.tsx'],
    });
    expect(out).toContain('I changed 2 files in your project');
    expect(out).not.toContain('Your source files are untouched');
  });
});
