// Queue Q-018 (autopsy 4d538ca3, admin-approved 2026-10-01, option a): a file the user uploads on its
// own is the user's file, so no build deletes it unasked. Only Code Studio typing went through the edit
// seam that records ownership; a single-file upload called a raw `setFiles`, so it never reached the
// build workspace at all and was never remembered as the user's. A zip or repo import stays a project,
// not a file of the user's, so it is not recorded (ordinary "clean up the project" requests still work).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffChangedFiles } from '../src/lib/workspaceSync';

const APP = readFileSync(join(__dirname, '../src/App.tsx'), 'utf8');

function body(name: string): string {
  const start = APP.indexOf(`const ${name} = useCallback(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = APP.indexOf('\n  }, [', start);
  return APP.slice(start, end);
}

describe('a single uploaded text file goes through the edit seam', () => {
  it('the first upload of a text file is applied through applyIdeFileChange', () => {
    const upload = body('handleFilesUpload');
    expect(upload).toMatch(/if \(isText\) applyIdeFileChange\(next\)/);
    expect(upload).not.toMatch(/setFiles\(prev => \(\{ \.\.\.prev, \[selectedFile\.name\]: content \}\)\)/);
  });

  it('resolving a name clash goes through the same seam', () => {
    expect(body('resolveFileConflict')).toMatch(/if \(isTextFile\(file\.name\)\) applyIdeFileChange\(next\)/);
  });

  it('the seam is the one that records ownership (source ide-edit)', () => {
    expect(APP).toMatch(/makeWorkspaceSyncer\(\{ sync: \(changed\) => syncFilesToV3\(changed, \{ silent: true, source: 'ide-edit' \}\) \}\)/);
    expect(body('applyIdeFileChange')).toMatch(/workspaceSyncerRef\.current\?\.onLocalChange\(files, newFiles\)/);
  });

  it('the seam sends only the uploaded file, never the placeholder of a name clash', () => {
    const before = { 'src/App.tsx': 'app', '__pending__notes.txt': 'new' };
    const after = { 'src/App.tsx': 'app', 'notes_new.txt': 'new' };
    expect(Object.keys(diffChangedFiles(before, after))).toEqual(['notes_new.txt']);
  });
});

describe('a zip import is a project, not a file of the user\'s', () => {
  it('a zip is still handed to the zip importer, which syncs with source "import"', () => {
    const zip = readFileSync(join(__dirname, '../src/hooks/useZipImport.ts'), 'utf8');
    expect(zip).toMatch(/syncFilesToV3\(loadedFiles, \{ source: 'import' \}\)/);
    expect(body('handleFilesUpload')).toMatch(/isZipFile\(selectedFile\.name, selectedFile\.type\)[\s\S]*?handleZipImport\(selectedFile\)/);
  });

  it('the server records ownership only for ide-edit', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/if \(req\.body\?\.source === 'ide-edit'\) \{\s*try \{ await recordManualEdits\(/);
  });
});
