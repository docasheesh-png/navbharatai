// A PROJECT IMPORT NEVER LANDS ON TOP OF ANOTHER APP (admin 2026-10-11, Q-733 (a): "an import of a complete
// project opens in a NEW chat and the current app is left untouched").
//
// The import merged onto whatever the chat held and deleted nothing: a 2-file probe landed on a 135-file app,
// its package.json replaced the old one, the preview crashed, the connect audit described the old app's files
// as the import's, and Publish would have shipped both apps. THE CLASS: an import whose target is "whatever
// this chat holds". Every surface now asks one module; the builder opens a new chat, Code Studio (which shares
// the builder's session and so cannot open one) refuses, and the server refuses an import that reaches an
// occupied chat anyway — an attached zip, or an older bundled app.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chatHoldsAnApp, appFileCount, importOpenedNewChatNote } from '../src/lib/projectImportTarget';

const code = (p: string) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('where an import may land', () => {
  it('🔒 a chat holding an app sends the import to a new chat; an empty one takes it', () => {
    expect(chatHoldsAnApp({ workspaceId: 'agentv3-u-s1', fileCount: 135 })).toBe(true);
    expect(chatHoldsAnApp({ workspaceId: 'agentv3-u-s1', fileCount: 0 })).toBe(false);
    expect(chatHoldsAnApp({ workspaceId: null, fileCount: 0 })).toBe(false);
  });

  it('a workspace whose files were not read yet counts as an app — the merge is the expensive mistake', () => {
    expect(chatHoldsAnApp({ workspaceId: 'agentv3-u-s1', fileCount: null })).toBe(true);
    expect(chatHoldsAnApp({ workspaceId: '', fileCount: null })).toBe(false);
  });

  it('the store\'s own dotfiles are not an app', () => {
    expect(appFileCount(['.navbharat/plan.json', '.env.example'])).toBe(0);
    expect(appFileCount(['package.json', 'src/App.tsx', '.gitignore'])).toBe(2);
  });

  it('the new chat says why it exists', () => {
    expect(importOpenedNewChatNote('shop.zip')).toContain('opens in a new chat');
    expect(importOpenedNewChatNote('shop.zip')).toContain('untouched');
  });
});

describe('🔒 every surface asks it', () => {
  const panel = code('src/components/agentv3/AgentV3Panel.tsx');

  it('the builder\'s zip, folder and GitHub imports open a new chat over an app', () => {
    const run = panel.slice(panel.indexOf('const runProjectImport = async'), panel.indexOf('const handleZipProject = async'));
    expect(run).toContain('chatHoldsAnApp({');
    expect(run).toContain('startNewSession();');
    expect(panel).toContain('importProjectArchive(file, landIn(file.name), userId, email, onProgress)');
    expect(panel).toContain('importProjectFolder(dir, name, landIn(name), userId, email, onProgress)');
    const repo = panel.slice(panel.indexOf('const importRepo = (repoUrl: string)'), panel.indexOf('const sendRepoImport = (repoUrl: string)'));
    expect(repo).toContain('chatHoldsAnApp({');
    expect(repo).toContain('setPendingRepoImport(repoUrl);');
  });

  it('Code Studio refuses a zip into a workspace with files, and keeps no merge path', () => {
    const app = code('src/App.tsx');
    expect(app).toContain('if (appFileCount(Object.keys(files)) > 0) {');
    expect(app).toContain('addToast(IMPORT_NOT_MERGED_MESSAGE');
    expect(app).not.toMatch(/\bisZip\b/);
    expect(app).not.toContain('merge = add on top of existing');
  });

  it('the server: an import into an occupied chat is not landed, and its turn ends before any model call', () => {
    const route = code('src/server/routes/agentv3.ts');
    expect(route).toContain('if (zipImports.length > 0 || importUrl) {');
    expect(route).toContain('if (zipImports.length > 0 && !projectImportNotMerged) {');
    const end = route.indexOf('if (projectImportNotMerged) {');
    expect(end).toBeGreaterThan(-1);
    expect(end).toBeLessThan(route.indexOf('if (looksLikePlatformSource(durableFilePaths)) {'));
    // every repository landing sits after that end — none can run for a refused import
    let at = route.indexOf('await landImportedProject(');
    const landings: number[] = [];
    while (at > -1) { landings.push(at); at = route.indexOf('await landImportedProject(', at + 1); }
    expect(landings.length).toBeGreaterThanOrEqual(4);
    const zipLanding = landings[0];
    expect(route.slice(route.lastIndexOf('if (zipImports.length > 0 && !projectImportNotMerged)', zipLanding), zipLanding).length).toBeLessThan(1500);
    for (const l of landings.slice(1)) expect(l).toBeGreaterThan(end);
  });
});
