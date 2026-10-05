/**
 * AUTOPSY 981ce4cc (2026-10-04) — "Edit pdf", with a scanned experience letter attached, in a chat that held only
 * our starter. 98 model calls built a PDF annotation app nobody asked for and published it broken ("Setting up
 * fake worker failed … pdf.worker.min.mjs", "Failed to load PDF file"). Every lock below uses the report's own
 * text where it exists.
 */
import { readFileSync, mkdirSync, writeFileSync, utimesSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { classifyIntentWithConfidence } from '../src/server/AgentV3/IntentClassifier';
import { buildConfirmation } from '../src/server/AgentV3/buildConfirmation';
import { editBannerText } from '../src/server/AgentV3/userProjectFiles';
import { readyOverrunNote } from '../src/server/AgentV3/doneSignal';
import { buildPrebundleStaleCheckCommand, shouldSkipDevServerLaunch } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { peerConflicts, peerConflictHint, etargetRecommendation, etargetHintLine, forcesPeers, peerDataCommand, newestCompatible } from '../src/server/AgentV3/peerCompatHint';
import { unlabelledFieldLines } from '../src/server/AppMakerLab/intelligence/A11yLinter';
import { qualityNote } from '../src/server/AgentV3/writeTimeQualityCheck';
import { applyEdit } from '../src/server/AgentV3/ToolDispatcher';
import { cdnPdfWorkerNote, setsCdnPdfWorker } from '../src/server/AgentV3/pdfWorkerSource';
import { attachedBytesNote, filesWithoutBytes } from '../src/server/AgentV3/attachedFileBytes';
import { makeTempDir } from './helpers/tempDir';

const read = (p: string) => readFileSync(p, 'utf8');

describe('"Edit pdf" names a file, not an app', () => {
  it('an edit verb on a file noun loses the lock, so a chat with no app of the user\'s is answered and offered', () => {
    expect(classifyIntentWithConfidence('Edit pdf')).toMatchObject({ intent: 'edit_existing', confidence: 'low' });
    expect(buildConfirmation('Edit pdf').confirmed).toBe(false);
    for (const m of ['edit this pdf', 'edit my document', 'edit the photo', 'change the certificate', 'fix my scanned letter']) {
      expect(classifyIntentWithConfidence(m).confidence, m).toBe('low');
    }
  });

  it('an edit of an app keeps its certainty', () => {
    for (const m of ['Edit app', 'change the title to Shop', 'edit the image', 'edit my pdf app', 'make the documents page bigger']) {
      const v = classifyIntentWithConfidence(m);
      expect(v.confidence, m).toBe('high');
    }
  });

  it('the edit banner never calls our starter "your existing app"', () => {
    expect(editBannerText(11, false)).not.toMatch(/existing app/);
    expect(editBannerText(11, true)).toBe('✏️ Editing your existing app (11 source files) — I\'ll make targeted changes, not rebuild it.');
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('text: editBannerText(sourceCount, earlierRequestLeftAnApp),');
    expect(route).not.toMatch(/text: `✏️ Editing your existing app \(/);
  });

  it('READY_BEFORE_END no longer says the edit was of "an app that already existed"', () => {
    const note = readyOverrunNote(null, 80, 600_000, { editingExistingApp: true });
    expect(note).toMatch(/^Not measured/);
    expect(note).not.toMatch(/an app that already existed/);
  });
});

describe('a running dev server is relaunched when a package changed after it pre-bundled', () => {
  it('reuse is refused when the pre-bundle is stale', () => {
    expect(shouldSkipDevServerLaunch(true, false)).toBe(true);
    expect(shouldSkipDevServerLaunch(true, false, true)).toBe(false);
  });

  const sh = (dir: string) => execSync(buildPrebundleStaleCheckCommand(), { cwd: dir, shell: '/bin/bash' }).toString();
  const at = (file: string, secs: number) => utimesSync(file, secs, secs);

  it('the shell check compares the last install with the pre-bundle, as files on disk', () => {
    const dir = makeTempDir('nbai-prebundle-');
    mkdirSync(join(dir, 'node_modules/.vite/deps'), { recursive: true });
    const meta = join(dir, 'node_modules/.vite/deps/_metadata.json');
    const lock = join(dir, 'node_modules/.package-lock.json');
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(meta, '{}');
    writeFileSync(lock, '{}');
    at(join(dir, 'package.json'), 1_000);
    // The report: react-pdf@9.2.1 installed AFTER the server bundled react-pdf@11.
    at(meta, 2_000); at(lock, 3_000);
    expect(sh(dir)).toContain('PREBUNDLE_STALE');
    // A server that re-bundled after the install is current.
    at(meta, 4_000);
    expect(sh(dir)).not.toContain('PREBUNDLE_STALE');
  });

  it('a project with no pre-bundle says nothing', () => {
    const dir = makeTempDir('nbai-prebundle-');
    writeFileSync(join(dir, 'package.json'), '{}');
    expect(sh(dir)).toBe('');
  });

  it('the reuse fast path asks it and clears the cache before relaunching', () => {
    const src = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    expect(src).toContain('buildPrebundleStaleCheckCommand()');
    expect(src).toContain('if (shouldSkipDevServerLaunch(alreadyUp, stale, prebundleStale)) {');
    expect(src).toMatch(/if \(prebundleStale\) \{\s*await sandbox\.commands\.run\(`rm -rf \$\{VITE_PREBUNDLE_DIR\}`/);
  });
});

// The report's own npm answer (ERESOLVE), and `npm view react-pdf@>=0.0.0 version peerDependencies --json`
// trimmed to the releases that matter (real data, 2026-10-04).
const ERESOLVE = `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error
npm error While resolving: project@0.1.0
npm error Found: react@18.3.1
npm error node_modules/react
npm error   react@"^18.3.1" from the root project
npm error
npm error Could not resolve dependency:
npm error peer react@"^19.0.0" from react-pdf@11.0.0
npm error node_modules/react-pdf
npm error   react-pdf@"*" from the root project`;
const R18 = '^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0';
const VIEW = JSON.stringify([
  { version: '8.0.2', peerDependencies: { react: R18, 'react-dom': R18 } },
  { version: '9.2.1', peerDependencies: { react: R18, 'react-dom': R18 } },
  { version: '10.5.0', peerDependencies: { react: R18, 'react-dom': R18 } },
  { version: '11.0.0-beta.1', peerDependencies: { react: R18 } },
  { version: '11.0.0', peerDependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } },
]);
const DATA = `NBAI_PEERS react-pdf ${VIEW}\nNBAI_HAS react=18.3.1\nNBAI_HAS react-dom=18.3.1\nNBAI_HAS vite=8.3.2`;

describe('a version this project\'s React cannot run is named before it is installed', () => {
  it('ERESOLVE: the conflict is read and the newest version that fits is handed over', () => {
    const c = peerConflicts(ERESOLVE);
    expect(c).toEqual([{ pkg: 'react-pdf', pkgVersion: '11.0.0', peer: 'react', need: '^19.0.0', found: '18.3.1' }]);
    const hint = peerConflictHint(c, DATA, false) ?? '';
    expect(hint).toContain('Do not retry with --legacy-peer-deps or --force');
    expect(hint).toContain('The newest react-pdf that works with this project is 10.5.0: install react-pdf@^10.5.0.');
    expect(newestCompatible(JSON.parse(VIEW).map((r: any) => ({ version: r.version, peers: r.peerDependencies })), new Map([['react', '18.3.1']]))).toBe('10.5.0');
  });

  it('ETARGET: a range that does not exist is answered with a version that exists AND fits, never "use the latest"', () => {
    const rec = etargetRecommendation('react-pdf', DATA);
    expect(rec).toEqual({ version: '10.5.0', latest: '11.0.0', latestNeeds: ['react@^19.0.0', 'react-dom@^19.0.0'] });
    const line = etargetHintLine('react-pdf', '12.7.1', rec!);
    expect(line).toContain('use react-pdf@^10.5.0');
    expect(line).not.toContain('react-pdf@^11');
  });

  it('a forced install that left an unsupported package is said so (the report\'s `npm ls` output)', () => {
    expect(forcesPeers('npm install react-pdf@^11.0.0 pdfjs-dist@^6.4.299 --legacy-peer-deps')).toBe(true);
    expect(forcesPeers('npm install react-pdf@^10.5.0')).toBe(false);
    const ls = 'project@0.1.0 /home/user/workspace\n+-- react-dom@18.3.1\n| `-- react@18.3.1 deduped\n+-- react-pdf@11.0.0\n| `-- react@18.3.1 deduped invalid: "^19.0.0" from node_modules/react-pdf\n`-- react@18.3.1 invalid: "^19.0.0" from node_modules/react-pdf';
    const c = peerConflicts(ls);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ pkg: 'react-pdf', peer: 'react', need: '^19.0.0', found: '18.3.1' });
    expect(peerConflictHint(c, DATA, true)).toMatch(/forced past npm's peer check[\s\S]*react-pdf@\^10\.5\.0/);
  });

  it('the data command is read-only and refuses an unsafe name', () => {
    expect(peerDataCommand(['react-pdf'])).toContain('npm view "react-pdf@>=0.0.0" version peerDependencies --json');
    expect(peerDataCommand(['bad;rm -rf /'])).toBeNull();
  });

  it('the bash tool asks it for every npm answer', () => {
    const src = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(src).toContain('const hint = await this.npmInstallHint(command, exitCode, `${stdout}\\n${stderr}`);');
  });
});

describe('the rest of the ledger', () => {
  it('the unlabelled-field note says WHERE (the model edited ten labelled buttons before finding the input)', () => {
    const file = [
      'export default function V() {',
      '  return (<div>',
      '    <button type="button" aria-label="Zoom in">+</button>',
      '    <input type="text" value={v} onChange={(e) => set(e.target.value)} />',
      '  </div>);',
      '}',
    ].join('\n');
    expect(unlabelledFieldLines(file)).toEqual([4]);
    expect(qualityNote('src/components/PDFViewer.tsx', file)).toContain('Unlabelled field at line 4.');
  });

  it('an ambiguous edit anchor is told how to append (the two failed @media edits)', () => {
    const css = '@media (prefers-reduced-motion: reduce) { .a { animation: none; } }\n.b{}\n@media (prefers-reduced-motion: reduce) {\n  * { x: 1 }\n}\n';
    expect(() => applyEdit(css, '@media (prefers-reduced-motion: reduce) {', 'x', 'src/index.css')).toThrow(/EMPTY old_string — it appends/);
  });

  it('a pdf.js worker from a CDN path is named at write time (the report\'s own line)', () => {
    const line = 'pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;';
    expect(setsCdnPdfWorker(line)).toBe(true);
    expect(cdnPdfWorkerNote('src/components/PDFViewer.tsx', line)).toContain('pdf.worker.min.mjs?url');
    expect(cdnPdfWorkerNote('src/components/PDFViewer.tsx', "import w from 'pdfjs-dist/build/pdf.worker.min.mjs?url';\npdfjs.GlobalWorkerOptions.workerSrc = w;")).toBe('');
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toContain('shadow += cdnPdfWorkerNote(p, files[p]);');
  });

  it('the builder is told an attached PDF reached it as a description, not a file', () => {
    expect(filesWithoutBytes([{ name: 'frankfin experience (3).pdf', type: 'application/pdf' }, { name: 'data.csv', type: 'text/csv' }])).toEqual(['frankfin experience (3).pdf']);
    const note = attachedBytesNote([{ name: 'frankfin experience (3).pdf', type: 'application/pdf' }]);
    expect(note).toContain('not in this project');
    expect(note).toContain('never tell the user their file is loaded');
    expect(attachedBytesNote([{ name: 'notes.txt', type: 'text/plain' }])).toBe('');
    expect(read('src/server/routes/agentv3.ts')).toContain('const bytesNote = attachedBytesNote(docAttachments);');
  });
});
