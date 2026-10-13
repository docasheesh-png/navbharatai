// Build report 9c612cdb (admin, 2026-10-12), Q-985 — NavBharatAI renamed a contract type and told only the user.
//
// The fast lane's name split (build 9762f589) renamed the contract's data type `VideoList` (= `Video[]`) to
// `VideoListData`, because `src/components/VideoList.tsx` is the component. The ONLY reader told was the user:
// "🏷️ Renamed VideoList → VideoListData in the shared contract …". The written `src/types.ts` carried a generic
// header and only the new name; the hand-off said "keep their types and export names". The full builder,
// which never saw the contract call, wrote App.tsx with the natural name in a type position:
//
//     src/App.tsx(30,37): error TS2749: 'VideoList' refers to a value, but is being used as a type here.
//     Did you mean 'typeof VideoList'?
//
// — tsc's own suggestion pointing at the wrong fix. THE CLASS: the platform silently changes a name a model
// must later use. Locked here — every place the rename must now reach, all read from ONE strict record:
//   1. the contract file's header (a pinned protocol, read back by the heal);
//   2. the lane's result and the hand-off sentence; the blueprint block;
//   3. the write-time typecheck's ✏️ advice on TS2749, in BOTH buckets, with conditional wording;
//   4. the write-door heal, proven with the real compiler — and never inside `ComponentProps<…>`, where the
//      compiler's `typeof` IS right;
//   5. CENSUS: every door that renames forwards the renames to every reader.

import { describe, it, expect, afterAll } from 'vitest';
import ts from 'typescript';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  prepareSharedContract, contractModule, runSimpleBuild, blueprintAdvisoryBlock, type SimpleFileSpec,
} from '../src/server/AgentV3/SimpleBuilder';
import {
  contractRenameHeaderLine, contractRenamesFromSource, contractRenamesInSources, suggestedTypeRenames, typeRenameAdvice,
  fixRecordedTypeRenames, errorsAfterTypeRenames, typeRenameHealNote, contractRenameHealEnabled, valueUsedAsTypeName,
} from '../src/server/AgentV3/contractRenames';
import { contractRenameHandoffLine, contractRenameHandoffClause, SALVAGE_HANDOFF_MARKER } from '../src/server/AgentV3/handoffRule';
import { writeTypecheckNote } from '../src/server/AgentV3/writeTimeTypecheck';
import { parseTscErrors } from '../src/server/AgentV3/EndgameRepair';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { ViteReactProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProvider';

const ROOT = join(__dirname, '..');
const TMP = join(ROOT, 'tests', `.tmp-renamed-type-${process.pid}`);
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** The report's file PLAN (LLM call 1). */
const MANIFEST: SimpleFileSpec[] = [
  'src/App.tsx', 'src/components/VideoPlayer.tsx', 'src/components/VideoList.tsx', 'src/components/VideoItem.tsx',
  'src/utils/youtube.ts', 'src/hooks/usePlayer.ts', 'src/hooks/useVideoList.ts', 'src/components/Modal.tsx',
  'src/components/ModalInput.tsx',
].map((path) => ({ path, purpose: '' }));

/** The report's SHARED CONTRACT (LLM call 2), verbatim; its cut tail is completed minimally (VideoListProps). */
const REPORT_CONTRACT = `export enum VideoSource {
  YouTube = 'YouTube',
  Vimeo = 'Vimeo'
}
export type VideoId = string;
export interface Video { id: VideoId; source: VideoSource; url: string; thumbnailUrl: string | null; }
export type VideoList = Video[];
export interface PlayerState { activeVideo: Video | null; isPlaying: boolean; }
export interface ExtractVideoIdOptions { url: string; }
export type ExtractVideoIdResult = { id: VideoId; source: VideoSource } | null;
export interface PlayerProps { video: Video; }
export interface ModalProps { isOpen: boolean; onClose: () => void; }
export interface ModalInputProps { value: string; onChange: (value: string) => void; onSubmit: (value: string) => void; placeholder: string; }
export interface VideoListProps { videos: VideoList; }`;

/** The report's compiler line, verbatim (typecheck at 201.3 s). */
const REPORT_TS2749 = "src/App.tsx(30,37): error TS2749: 'VideoList' refers to a value, but is being used as a type here. Did you mean 'typeof VideoList'?";

/** The exact header line the protocol writes for the report's rename. */
const HEADER = '// renamed: VideoList -> VideoListData (VideoList is the component in src/components/VideoList.tsx; the data type is VideoListData)';

const prepared = prepareSharedContract(REPORT_CONTRACT, MANIFEST, {} as NodeJS.ProcessEnv);
const TYPES = contractModule(prepared.contract, prepared.renamed)!.source;

/** The component the build wrote at 178.9 s (shape only). */
const VIDEO_LIST_TSX = `import type { VideoListProps } from '../types';

export default function VideoList({ videos }: VideoListProps) {
  return <ul>{videos.map((v) => <li key={v.id}>{v.url}</li>)}</ul>;
}
`;

/** An App.tsx whose line 30, column 37 is the report's `VideoList` in a type position — plus a generic argument. */
const APP_TSX = `import { useState } from 'react';
import type { Video } from './types';
import VideoList from './components/VideoList';

const STORAGE_KEY = 'videos';

function loadLibrary(): Video[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Video[]) : [];
  } catch {
    return [];
  }
}

function toVideo(url: string): Video | null {
  const m = /(?:v=|youtu\\.be\\/)([\\w-]{11})/.exec(url);
  return m ? { id: m[1], source: 'YouTube', url, thumbnailUrl: null } : null;
}

export default function App() {
  const [videos, setVideos] = useState<Video[]>(loadLibrary);
  const [link, setLink] = useState('');

  const handleAdd = () => {
    const video = toVideo(link);
    if (video) setVideos((prev) => [video, ...prev]);
    setLink('');
  };
  const saveLibraryToStore = (next: VideoList) => localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  const [history] = useState<VideoList>([]);
  saveLibraryToStore(videos);

  return (
    <main>
      <input value={link} onChange={(e) => setLink(e.target.value)} />
      <button onClick={handleAdd}>Add link</button>
      <VideoList videos={[...videos, ...history]} />
    </main>
  );
}
`;

const STARTER_TSCONFIG = new ViteReactProvider().getFiles([])['tsconfig.json'];

/** Compile with the starter's own tsconfig; returns tsc-format lines (`file(line,col): error TSxxxx: message`). */
function compile(id: string, files: Record<string, string>): string[] {
  const dir = join(TMP, id);
  rmSync(dir, { recursive: true, force: true });
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  const parsed = ts.parseJsonConfigFileContent(JSON.parse(STARTER_TSCONFIG), ts.sys, dir);
  const program = ts.createProgram(Object.keys(files).filter((p) => /\.tsx?$/.test(p)).map((p) => join(dir, p)), parsed.options);
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file && d.file.fileName.startsWith(dir))
    .map((d) => {
      const at = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
      return `${d.file!.fileName.slice(dir.length + 1)}(${at.line + 1},${at.character + 1}): error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
}

describe('1 · the contract file records the rename in a strict, pinned header line', () => {
  it('🔴 the report: VideoList → VideoListData, the component\'s path included', () => {
    expect(prepared.renamed).toEqual([{ from: 'VideoList', to: 'VideoListData', component: 'src/components/VideoList.tsx' }]);
    expect(contractRenameHeaderLine(prepared.renamed[0])).toBe(HEADER);
    expect(TYPES.split('\n').slice(0, 3)).toEqual([
      '// Shared contract — the enums, interfaces and types every file of this app imports from here.',
      '// Written by NavBharatAI before any other file, so all files agree on these names by construction.',
      HEADER,
    ]);
    expect(TYPES).toContain('export type VideoListData = Video[];');
  });

  it('the header reads back exactly — the heal\'s only source of truth', () => {
    expect(contractRenamesFromSource(TYPES)).toEqual(prepared.renamed);
    expect(contractRenamesInSources({ 'src/types.ts': TYPES })).toEqual(prepared.renamed);
    expect(contractRenamesFromSource(contractModule(prepared.contract)!.source)).toEqual([]);
  });

  it('strict: an edited line, a line after code, or a self-rename is not a record', () => {
    expect(contractRenamesFromSource(HEADER.replace('the data type is VideoListData', 'the data type is Other'))).toEqual([]);
    expect(contractRenamesFromSource(`// x\nexport type A = 1;\n${HEADER}`)).toEqual([]);
    expect(contractRenamesFromSource('// renamed: A -> A (A is the component; the data type is A)')).toEqual([]);
    expect(contractRenamesFromSource('// renamed: A -> AData (A is the component; the data type is AData)')).toEqual([{ from: 'A', to: 'AData' }]);
  });
});

describe('2 · the lane hands the rename on — result, hand-off sentence, blueprint block', () => {
  it('🔴 runSimpleBuild: the written types file carries the header and the hand-off result carries the renames', async () => {
    const written: Array<{ path: string; content: string }> = [];
    const r = await runSimpleBuild({
      prompt: 'Build a app where I can just similar to youtube where where there is an option for paste link',
      framework: 'vite-react',
      scaffoldPaths: ['index.html', 'package.json', 'tsconfig.json', 'src/main.tsx', 'src/App.tsx'],
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return MANIFEST.map((f) => `${f.path} :: part`).join('\n');
        if (user.includes('Design the shared contract')) return REPORT_CONTRACT;
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nexport default function X() { return null; }\n<<<ENDFILE>>>`;
      },
      writeFiles: async (f) => { written.push(...f); },
      verify: async () => ({ ok: false, errors: "src/App.tsx(30,37): error TS2749: 'VideoList' refers to a value" }),
      repair: async () => [],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('verify_failed');
    expect(r.contractRenames).toEqual([{ from: 'VideoList', to: 'VideoListData', component: 'src/components/VideoList.tsx' }]);
    expect(written.find((f) => f.path === 'src/types.ts')?.content).toContain(HEADER);
  });

  it('the hand-off sentence names each rename and says when the compiler\'s typeof is right', () => {
    const line = contractRenameHandoffLine(prepared.renamed);
    expect(line).toContain('VideoList → VideoListData (VideoList is the component in src/components/VideoList.tsx)');
    expect(line).toMatch(/In a type position always write the NEW name/);
    expect(line).toMatch(/only right when you mean the component itself/);
    expect(contractRenameHandoffLine([])).toBe('');
    expect(contractRenameHandoffLine(undefined)).toBe('');
    // The prompt's clause: nothing when nothing was renamed, otherwise the line with its leading space.
    expect(contractRenameHandoffClause([])).toBe('');
    expect(contractRenameHandoffClause(undefined)).toBe('');
    expect(contractRenameHandoffClause(prepared.renamed)).toBe(` ${line}`);
  });

  it('SOURCE: the salvage hand-off appends it after the entry line, inside the same note', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    const start = route.indexOf(`\`\${SALVAGE_HANDOFF_MARKER} A faster build lane already generated`);
    expect(start).toBeGreaterThan(0);
    const note = route.slice(start, route.indexOf('`\\n\\n---\\n\\n${buildPrompt}`', start));
    expect(note).toContain("(salvageEntryLine ? ` ${salvageEntryLine}` : '') +");
    // PIN UPDATED 2026-10-13: the empty case moved into `contractRenameHandoffClause` (the chat handler is at TypeScript's
    // control-flow limit, TS2563, so the template carries no condition); its behaviour is asserted below.
    expect(note).toContain('contractRenameHandoffClause(sb.contractRenames) +');
    expect(SALVAGE_HANDOFF_MARKER).toBe('[CONTINUE — DO NOT START OVER]');
  });

  it('the blueprint block names the rename for the architect', () => {
    const block = blueprintAdvisoryBlock(MANIFEST, prepared.contract, prepared.renamed);
    expect(block).toContain('VideoList → VideoListData (VideoList is the component in src/components/VideoList.tsx)');
    expect(blueprintAdvisoryBlock(MANIFEST, prepared.contract)).not.toContain('Renamed so no data type');
  });
});

describe('3 · the write-time typecheck says which name is which (✏️), in both buckets', () => {
  const errors = parseTscErrors(REPORT_TS2749);
  it('🔴 the report\'s TS2749 is recognised as a platform-recorded rename', () => {
    expect(valueUsedAsTypeName(errors[0])).toBe('VideoList');
    expect(suggestedTypeRenames(errors, prepared.renamed)).toEqual([
      { file: 'src/App.tsx', line: 30, col: 37, from: 'VideoList', to: 'VideoListData', component: 'src/components/VideoList.tsx' },
    ]);
  });

  it('elsewhere (the 201.3 s write of AddVideoModal) AND in the file just written, the advice is the same', () => {
    const elsewhere = writeTypecheckNote(errors, ['src/components/AddVideoModal.tsx'], { 'src/types.ts': TYPES });
    const own = writeTypecheckNote(errors, ['src/App.tsx'], { 'src/types.ts': TYPES });
    for (const note of [elsewhere, own]) {
      expect(note).toContain('✏️ `VideoList` is the COMPONENT (src/components/VideoList.tsx). NavBharatAI renamed the shared DATA type to `VideoListData`');
      expect(note).toContain('In src/App.tsx (line 30): if you mean the data, write `VideoListData`');
      expect(note).toContain('only if you mean the component\'s own type, write `typeof VideoList`');
    }
  });

  it('without a record, the note is byte-identical to before (no guessing at an unrecorded name)', () => {
    const before = writeTypecheckNote(errors, ['src/App.tsx'], {});
    expect(before).not.toContain('✏️');
    expect(writeTypecheckNote(errors, ['src/App.tsx'], { 'src/types.ts': contractModule(prepared.contract)!.source })).toBe(before);
    expect(typeRenameAdvice([])).toEqual([]);
  });
});

describe('4 · the write door heals it — proven with the real compiler', () => {
  const project = { 'src/types.ts': TYPES, 'src/components/VideoList.tsx': VIDEO_LIST_TSX, 'src/App.tsx': APP_TSX };

  it('🔴 the fixture reproduces the report\'s exact compiler line', () => {
    const errs = compile('before', project);
    expect(errs).toContain(REPORT_TS2749);
    expect(errs.every((e) => / error TS2749: 'VideoList' refers to a value/.test(e))).toBe(true);
    expect(errs).toHaveLength(2); // line 30 (an annotation) and line 31 (`useState<VideoList>`)
  }, 60_000);

  it('🔴 healed: the old name becomes the new one in both type positions, imported from the contract — ZERO errors', () => {
    const errs = parseTscErrors(compile('before-heal', project).join('\n'));
    const fix = fixRecordedTypeRenames({ 'src/App.tsx': APP_TSX }, errs, prepared.renamed, { path: 'src/types.ts', source: TYPES });
    expect(fix.fixed.map((f) => f.line)).toEqual([30, 31]);
    const app = fix.files['src/App.tsx'];
    expect(app).toContain("import type { Video, VideoListData } from './types';");
    expect(app).toContain('(next: VideoListData)');
    expect(app).toContain('useState<VideoListData>([])');
    expect(app).toContain('<VideoList videos={[...videos, ...history]} />'); // the component is untouched
    expect(compile('after-heal', { ...project, 'src/App.tsx': app })).toEqual([]);
    expect(errorsAfterTypeRenames(errs, fix, new Set(['src/App.tsx']))).toEqual([]);
    expect(typeRenameHealNote(fix.fixed)).toContain('src/App.tsx lines 30, 31 (`VideoList` → `VideoListData`)');
  }, 60_000);

  it('🔒 `ComponentProps<VideoList>` gives the SAME TS2749 — and is never touched, because `typeof` is right there', () => {
    const app = "import type { ComponentProps } from 'react';\nimport VideoList from './components/VideoList';\n\nexport type ListProps = ComponentProps<VideoList>;\n";
    const errs = compile('component-props', { ...project, 'src/App.tsx': app });
    expect(errs).toEqual(["src/App.tsx(4,40): error TS2749: 'VideoList' refers to a value, but is being used as a type here. Did you mean 'typeof VideoList'?"]);
    const fix = fixRecordedTypeRenames({ 'src/App.tsx': app }, parseTscErrors(errs.join('\n')), prepared.renamed, { path: 'src/types.ts', source: TYPES });
    expect(fix.fixed).toEqual([]);
    expect(fix.files['src/App.tsx']).toBe(app);
    for (const wrapper of ['React.ComponentProps', 'ComponentPropsWithoutRef', 'ReturnType', 'Partial<ComponentProps']) {
      const src = `import VideoList from './components/VideoList';\nexport type T = ${wrapper}<VideoList>${wrapper.startsWith('Partial') ? '>' : ''};\n`;
      const col = src.split('\n')[1].indexOf('VideoList') + 1;
      const e = parseTscErrors(`src/X.tsx(2,${col}): error TS2749: 'VideoList' refers to a value, but is being used as a type here. Did you mean 'typeof VideoList'?`);
      expect(fixRecordedTypeRenames({ 'src/X.tsx': src }, e, prepared.renamed, { path: 'src/types.ts', source: TYPES }).fixed).toEqual([]);
    }
  }, 60_000);

  it('a new import line moves every later error down one line, so what the model is told stays true', () => {
    const app = "import VideoList from './components/VideoList';\n\nexport function keep(list: VideoList): number { return list.length; }\nexport const n: number = 'x';\n";
    const errs = parseTscErrors(compile('no-contract-import', { ...project, 'src/App.tsx': app }).join('\n'));
    expect(errs.map((e) => `${e.line}:${e.code}`)).toEqual(['3:TS2749', '4:TS2322']);
    const fix = fixRecordedTypeRenames({ 'src/App.tsx': app }, errs, prepared.renamed, { path: 'src/types.ts', source: TYPES });
    expect(fix.files['src/App.tsx'].split('\n')[1]).toBe("import type { VideoListData } from './types';");
    const left = errorsAfterTypeRenames(errs, fix, new Set(['src/App.tsx']));
    expect(left.map((e) => `${e.line}:${e.code}`)).toEqual(['5:TS2322']);
    expect(compile('no-contract-import-after', { ...project, 'src/App.tsx': fix.files['src/App.tsx'] }).map((e) => e.replace(/:.*/, ''))).toEqual(['src/App.tsx(5,14)']);
  }, 60_000);

  it('no record, a record the contract does not back, or a stale position: nothing is touched', () => {
    const errs = parseTscErrors(REPORT_TS2749);
    const files = { 'src/App.tsx': APP_TSX };
    expect(fixRecordedTypeRenames(files, errs, [], { path: 'src/types.ts', source: TYPES }).fixed).toEqual([]);
    expect(fixRecordedTypeRenames(files, errs, [{ from: 'VideoList', to: 'VideoListRows' }], { path: 'src/types.ts', source: TYPES }).fixed).toEqual([]);
    const moved = parseTscErrors(REPORT_TS2749.replace('(30,37)', '(30,12)'));
    expect(fixRecordedTypeRenames(files, moved, prepared.renamed, { path: 'src/types.ts', source: TYPES }).fixed).toEqual([]);
    expect(contractRenameHealEnabled({ AGENTV3_CONTRACT_RENAME_HEAL: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(contractRenameHealEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('5 · WIRING — the dispatcher heals at the write door, and only in files this build wrote', () => {
  class Act implements ActuatorPort {
    files: Map<string, string>;
    constructor(public tscOut: string) {
      this.files = new Map([['tsconfig.json', '{}'], ['src/types.ts', TYPES], ['src/components/VideoList.tsx', VIDEO_LIST_TSX], ['src/App.tsx', APP_TSX]]);
    }
    async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
    async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
    async listFiles() { return [...this.files.keys()]; }
    async runCommand(_w: string, cmd: string) {
      return /\btsc\b/.test(cmd) ? { exitCode: 2, stdout: this.tscOut, stderr: '' } : { exitCode: 0, stdout: '', stderr: '' };
    }
    async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
  }
  const tscOut = () => compile('wiring', { 'src/types.ts': TYPES, 'src/components/VideoList.tsx': VIDEO_LIST_TSX, 'src/App.tsx': APP_TSX }).join('\n');

  it('🔴 writing App.tsx: the platform fixes it and says so — no model turn spent', async () => {
    const act = new Act(tscOut());
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws-rename-1', new WorkspaceState(stream), stream);
    const out = String((await d.dispatch({ id: 'w1', name: 'write_file', input: { path: 'src/App.tsx', content: APP_TSX } }, 'architect')).content);
    expect(out).toContain('🔧 Fixed automatically: src/App.tsx lines 30, 31 (`VideoList` → `VideoListData`)');
    expect(out).not.toContain('⛔ TYPECHECK');
    expect(act.files.get('src/App.tsx')).toContain('useState<VideoListData>([])');
  }, 60_000);

  it('🔴 an error in a file this build did NOT write (the 201.3 s case, "elsewhere") is advised, never edited', async () => {
    const act = new Act(tscOut());
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, 'ws-rename-2', new WorkspaceState(stream), stream);
    const modal = "export default function AddVideoModal() { return null; }\n";
    const out = String((await d.dispatch({ id: 'w2', name: 'write_file', input: { path: 'src/components/AddVideoModal.tsx', content: modal } }, 'architect')).content);
    expect(out).toContain('ℹ️ TYPECHECK after this write: src/components/AddVideoModal.tsx is clean, but 2 error(s) remain elsewhere');
    expect(out).toContain('✏️ `VideoList` is the COMPONENT (src/components/VideoList.tsx)');
    expect(out).toContain('In src/App.tsx (lines 30, 31)');
    expect(act.files.get('src/App.tsx')).toBe(APP_TSX);
  }, 60_000);
});

describe('6 · CENSUS — a door that renames forwards the renames to every reader', () => {
  const SIMPLE = readFileSync(join(ROOT, 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');
  const ROUTE = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');

  it('🔒 the fast lane: renames → the contract file\'s header → the result the hand-off reads', () => {
    expect(SIMPLE).toContain('contractRenames = prepared.renamed;');
    expect(SIMPLE).toContain('const mod = contractModule(contract, contractRenames);');
    // Both hand-offs that carry files (timeout salvage and verify failure) carry the renames.
    expect(SIMPLE.match(/\.\.\.\(contractRenames\.length \? \{ contractRenames \} : \{\}\)/g)).toHaveLength(2);
  });

  it('🔒 every prepareSharedContract call in a lane forwards `.renamed` to what it writes', () => {
    const sites = [...SIMPLE.matchAll(/=\s*prepareSharedContract\(/g), ...ROUTE.matchAll(/=\s*prepareSharedContract\(/g)];
    expect(sites).toHaveLength(2);
    expect(ROUTE).toContain('blueprintAdvisoryBlock(manifest, prepared.contract, prepared.renamed)');
  });

  it('🔒 the dispatcher heals before it quotes, and the note reads the contract the heal put in hand', () => {
    const dispatcher = readFileSync(join(ROOT, 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    const body = dispatcher.slice(dispatcher.indexOf('private async writeTypecheckNote('), dispatcher.indexOf('private async healTypeOnlyImportsAtWrite('));
    // Keyed on the shared run (aJoinedWriteSeesTheRunItJoined's census): one heal per compile, however many
    // writers joined it — and the helper it goes through is the rename heal itself.
    const heal = body.indexOf('await this.typeRenameHealForRun(run, errors, tsPaths, sources)');
    expect(heal).toBeGreaterThan(0);
    expect(heal).toBeLessThan(body.indexOf('return healedNote + writeTypecheckNote(errors, tsPaths, sources);'));
    expect(body).toContain('errors = typeRenames.errors;');
    expect(body).toContain('sources = { ...sources, ...typeRenames.added };');
    expect(body).toContain('this.healRecordedTypeRenamesAtWrite(errors, tsPaths, sources).then(');
  });
});
