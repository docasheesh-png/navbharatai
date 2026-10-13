// Build report 9c612cdb (admin, 2026-10-12), Q-941 — the shared contract's string enum rejected a quoted value.
//
// The fast lane's contract call returned `export enum VideoSource { YouTube = 'YouTube', Vimeo = 'Vimeo' }`.
// `src/hooks/useVideoList.ts`, written in its own isolated call, imported only `Video, VideoListData` and wrote
// `source: 'YouTube'` at line 57:
//
//     src/hooks/useVideoList.ts(57,9): error TS2322: Type '"YouTube"' is not assignable to type 'VideoSource'.
//
// The error was handed over with the salvaged files and the full builder needed two edits to fix code that
// looked right. THE CLASS: a contract NavBharatAI writes declares a NOMINAL type, and files written in isolation
// naturally write its values as plain literals. Locked here:
//   1. the report's real contract, through the one door (`prepareSharedContract`) and `contractModule`, compiles
//      with the report's line-57 consumer under the starter's own tsconfig — and a value outside the set is
//      still TS2322;
//   2. an enum member used as a TYPE inside the contract keeps compiling (TS2702 otherwise);
//   3. the siblings the conversion leans on: the name split renames a literal `as const` + type PAIR; a `(`
//      inside a string no longer drops an `as const` literal; the TS1361 heal fires for the pair; the drift
//      map still knows the pair's members;
//   4. CENSUS: every lane that asks `contractSystemPrompt` for a contract passes it through `prepareSharedContract`.

import { describe, it, expect, afterAll } from 'vitest';
import ts from 'typescript';
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  prepareSharedContract, contractModule, separateTypeFromComponentNames, literalConstName, topLevelStatements,
} from '../src/server/AgentV3/SimpleBuilder';
import { stringEnumsAsConstObjects, contractEnumAsConstEnabled, CONTRACT_FIXED_VALUES_RULE } from '../src/server/AgentV3/contractEnums';
import { fixTypeOnlyValueImports } from '../src/server/AgentV3/ImportExportReconcile';
import { contractDriftReport } from '../src/server/AgentV3/ContractMap';
import { projectPlanSystemPrompt } from '../src/server/AgentV3/ProjectPlan';
import { ViteReactProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProvider';

const ROOT = join(__dirname, '..');
const TMP = join(ROOT, 'tests', `.tmp-contract-enum-${process.pid}`);
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** The report's file PLAN (LLM call 1), verbatim paths. */
const MANIFEST = [
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

/** The report's consumer: useVideoList.ts imported only `Video, VideoListData` and wrote the plain value. */
const USE_VIDEO_LIST = `import { useState } from 'react';
import { Video, VideoListData } from '../types';

export function useVideoList() {
  const [videos, setVideos] = useState<VideoListData>([]);
  const addVideo = (id: string, url: string) => {
    const video: Video = {
      id,
      source: 'YouTube',
      url,
      thumbnailUrl: null,
    };
    setVideos((prev) => [...prev, video]);
  };
  return { videos, addVideo };
}
`;

/** The other ways a consumer may reach the same set — member syntax, Object.values, a switch, a type import. */
const OTHER_CONSUMER = `import { VideoSource } from '../types';
import type { VideoSource as Source, Video } from '../types';

export const vimeo: Video = { id: 'v', source: VideoSource.Vimeo, url: '', thumbnailUrl: null };
export const allSources: Source[] = Object.values(VideoSource);
export function label(s: Source): string {
  switch (s) {
    case VideoSource.YouTube: return 'YouTube';
    case 'Vimeo': return 'Vimeo';
  }
  return '';
}
`;

/** The starter the build wrote ("our 11-file starter") — its own tsconfig decides what compiles. */
const STARTER_TSCONFIG = new ViteReactProvider().getFiles([])['tsconfig.json'];

/** Compile `files` (paths under src/) with the starter's tsconfig; returns `path(line) TScode` lines. */
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
    .map((d) => `${d.file!.fileName.slice(dir.length + 1)}(${d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}) TS${d.code}`);
}

/** The contract file the lane writes for this contract — through the same door, in the same order. */
function typesFile(contract: string, env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv): string {
  const prepared = prepareSharedContract(contract, MANIFEST, env);
  return contractModule(prepared.contract, prepared.renamed)!.source;
}

describe('1 · the report: a quoted value fits the contract\'s enum', () => {
  it('🔴 the real contract + the real line-57 consumer compile with ZERO errors under the starter tsconfig', () => {
    const types = typesFile(REPORT_CONTRACT);
    // The compiler first — the claim is "it compiles", the text below only says how.
    expect(compile('report', {
      'src/types.ts': types, 'src/hooks/useVideoList.ts': USE_VIDEO_LIST, 'src/hooks/sources.ts': OTHER_CONSUMER,
    })).toEqual([]);
    expect(types).toContain("export const VideoSource = {\n  YouTube: 'YouTube',\n  Vimeo: 'Vimeo'\n} as const;");
    expect(types).toContain('export type VideoSource = (typeof VideoSource)[keyof typeof VideoSource];');
    expect(types).not.toMatch(/\benum\b/);
  }, 60_000);

  it('the set is still CLOSED: a value outside it is still TS2322', () => {
    const bad = "import type { VideoSource } from './types';\nexport const s: VideoSource = 'Dailymotion';\n";
    expect(compile('closed', { 'src/types.ts': typesFile(REPORT_CONTRACT), 'src/bad.ts': bad })).toEqual(['src/bad.ts(2) TS2322']);
  }, 60_000);

  it('canary — with the kill switch off, the report\'s TS2322 at line 57 is back (this harness sees it)', () => {
    const off = { AGENTV3_CONTRACT_ENUM_AS_CONST: 'off' } as unknown as NodeJS.ProcessEnv;
    expect(contractEnumAsConstEnabled(off)).toBe(false);
    expect(contractEnumAsConstEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(compile('canary', { 'src/types.ts': typesFile(REPORT_CONTRACT, off), 'src/hooks/useVideoList.ts': USE_VIDEO_LIST }))
      .toEqual(['src/hooks/useVideoList.ts(9) TS2322']);
  }, 60_000);

  it('an enum with no initialisers becomes member-name strings (the prompt\'s own `MediaType { YouTube, Vimeo }` shape)', () => {
    const { contract, converted } = stringEnumsAsConstObjects('export enum MediaType { YouTube, Vimeo }');
    expect(converted).toEqual(['MediaType']);
    expect(contract).toBe("export const MediaType = { YouTube: 'YouTube', Vimeo: 'Vimeo' } as const;\nexport type MediaType = (typeof MediaType)[keyof typeof MediaType];");
  });

  it('explicit numeric, heterogeneous and merged enums stay exactly as written; both switches off is byte-identical', () => {
    const kept = [
      'export enum RoadDirection { STRAIGHT = 0, LEFT = -1, RIGHT = 1 }',
      "export enum Mixed { A, B = 'b' }",
      'export enum Twice { A = \'a\' }\nexport namespace Twice { export const x = 1; }',
    ].join('\n');
    expect(stringEnumsAsConstObjects(kept)).toEqual({ contract: kept, converted: [] });
    const off = { AGENTV3_CONTRACT_ENUM_AS_CONST: 'off', AGENTV3_CONTRACT_NAME_SPLIT: 'off' } as unknown as NodeJS.ProcessEnv;
    expect(prepareSharedContract(REPORT_CONTRACT, MANIFEST, off)).toEqual({ contract: REPORT_CONTRACT, renamed: [], enumsAsConst: [] });
  });

  it('a fenced contract keeps its fences and member comments, and still converts', () => {
    const fenced = "```ts\nexport enum Status {\n  /** not started */\n  Todo = 'todo',\n  Done = 'done',\n}\n```";
    const { contract, converted } = stringEnumsAsConstObjects(fenced);
    expect(converted).toEqual(['Status']);
    expect(contract).toBe("```ts\nexport const Status = {\n  /** not started */\n  Todo: 'todo',\n  Done: 'done',\n} as const;\nexport type Status = (typeof Status)[keyof typeof Status];\n```");
  });
});

describe('2 · an enum member used as a TYPE inside the contract keeps compiling', () => {
  const REDUCER_CONTRACT = `export enum ActionType { Add = 'add', Remove = 'remove' }
export interface Video { id: string; url: string; }
export interface AddAction { type: ActionType.Add; video: Video; }
export interface RemoveAction { type: ActionType.Remove; id: string; }
export type Action = AddAction | RemoveAction;`;
  const REDUCER = `import { ActionType, type Action, type Video } from './types';
export function reduce(list: Video[], a: Action): Video[] {
  if (a.type === ActionType.Add) return [...list, a.video];
  if (a.type === 'remove') return list.filter((v) => v.id !== a.id);
  return list;
}
export const add: Action = { type: 'add', video: { id: '1', url: '' } };
`;
  it('`type: ActionType.Add` becomes `typeof ActionType.Add` and still discriminates', () => {
    const types = typesFile(REDUCER_CONTRACT);
    expect(compile('reducer', { 'src/types.ts': types, 'src/reducer.ts': REDUCER })).toEqual([]);
    expect(types).toContain('export interface AddAction { type: typeof ActionType.Add; video: Video; }');
  }, 60_000);
});

describe('3 · the siblings the conversion leans on', () => {
  it('🔴 a literal `as const` + type PAIR named after a planned component is DATA — both are renamed', () => {
    const pair = "export const VideoList = { Recent: 'recent', All: 'all' } as const;\nexport type VideoList = (typeof VideoList)[keyof typeof VideoList];";
    const { contract, renamed } = separateTypeFromComponentNames(pair, MANIFEST);
    expect(renamed).toEqual([{ from: 'VideoList', to: 'VideoListData' }]);
    expect(contract).toBe("export const VideoListData = { Recent: 'recent', All: 'all' } as const;\nexport type VideoListData = (typeof VideoListData)[keyof typeof VideoListData];");
  });

  it('a contract that declares the component itself is still left alone (the 9762f589 rule)', () => {
    const own = 'export type VideoList = string[];\nexport declare const VideoList: (p: { a: string }) => unknown;';
    expect(separateTypeFromComponentNames(own, MANIFEST).renamed).toEqual([]);
  });

  it('an `enum VideoList` beside VideoList.tsx is renamed FIRST, then converted — the order of the door', () => {
    const p = prepareSharedContract("export enum VideoList { Recent = 'recent' }", MANIFEST, {} as NodeJS.ProcessEnv);
    expect(p.renamed).toEqual([{ from: 'VideoList', to: 'VideoListData', component: 'src/components/VideoList.tsx' }]);
    expect(p.enumsAsConst).toEqual(['VideoListData']);
    expect(p.contract).toContain("export const VideoListData = { Recent: 'recent' } as const;");
  });

  it('🔴 a parenthesis inside a string no longer drops an `as const` literal from the contract file', () => {
    const c = "export const Category = { Other: 'Other (specify)', Music: \"Music (live)\" } as const;\nexport type Category = (typeof Category)[keyof typeof Category];";
    expect(literalConstName(topLevelStatements(c)[0])).toBe('Category');
    const mod = contractModule(c)!;
    expect(mod.source).toContain("export const Category = { Other: 'Other (specify)', Music: \"Music (live)\" } as const;");
    expect(compile('paren', { 'src/types.ts': mod.source })).toEqual([]);
    // A real call (or a template that can run one) still keeps the statement out of the contract file.
    expect(literalConstName("const X = { a: f() } as const")).toBeNull();
    expect(literalConstName('const X = { a: `${f}` } as const')).toBeNull();
    expect(literalConstName('const X = { a: () => 1 } as const')).toBeNull();
  }, 60_000);

  it('the TS1361 heal fires for the pair (a value of that name EXISTS — not "every declaration is a value")', async () => {
    const files = {
      'src/types.ts': typesFile(REPORT_CONTRACT),
      'src/pick.ts': "import type { VideoSource } from './types';\nexport const first = VideoSource.YouTube;\n",
    };
    const r = await fixTypeOnlyValueImports(files);
    expect(r.fixes).toHaveLength(1);
    expect(r.files['src/pick.ts']).toContain("import { VideoSource } from './types';");
  });

  it('the drift map still knows the pair\'s members (normalising must not retire the `X.Membr` line)', () => {
    const files = {
      'src/types.ts': typesFile(REPORT_CONTRACT),
      'src/a.ts': "import { VideoSource } from './types';\nexport const s = VideoSource.Youtube;\n",
    };
    const r = contractDriftReport(files) ?? '';
    expect(r).toContain('VideoSource.Youtube');
    expect(r).toContain('YouTube');
  });

  // Review of Q-941 (2026-10-12): reading `as const` objects as enums first took ANY flat exported object and
  // only the keys a regex could see. A drift line is an ORDER to the repair model ("fix these exact
  // mismatches"), so each case below was a new instruction to break correct code — none existed before.
  it('🔒 the drift map never invents a member drift line: only the enum PAIR counts, and only a fully written key set', () => {
    const cases: Array<Record<string, string>> = [
      { // a flat class-name map is not an enum — and another file's LOCAL `styles` is not checked against it
        'src/styles.ts': "export const styles = { container: 'p-4', title: 'text-xl' } as const;\n",
        'src/Button.tsx': "const styles = { button: 'btn' };\nexport const B = () => styles.button;\n",
      },
      { // a spread: the member set is not all written here
        'src/routes.ts': "const BASE = { home: '/' } as const;\nexport const Route = { ...BASE, admin: '/admin' } as const;\nexport type Route = (typeof Route)[keyof typeof Route];\n",
        'src/App.tsx': "import { Route } from './routes';\nexport const h = Route.home;\n",
      },
      { // a quoted key is still a member — the normaliser keeps `'Active' = 'active'` quoted
        'src/types.ts': typesFile("export enum Status { 'Active' = 'active', Done = 'done' }"),
        'src/a.ts': "import { Status } from './types';\nexport const s = Status.Active;\n",
      },
      { // shorthand and computed keys
        'src/k.ts': "const a = 'a';\nexport const K = { a, [`b`]: 'b' } as const;\nexport type K = (typeof K)[keyof typeof K];\n",
        'src/use.ts': "import { K } from './k';\nexport const x = K.a;\n",
      },
    ];
    for (const files of cases) expect({ files: Object.keys(files), drift: contractDriftReport(files) }).toEqual({ files: Object.keys(files), drift: null });
    // …while a real typo against the pair is still caught, quoted key or not.
    const typo = contractDriftReport({ ...cases[2], 'src/a.ts': "import { Status } from './types';\nexport const s = Status.Actve;\n" }) ?? '';
    expect(typo).toContain('uses Status.Actve but Status members are: Active, Done');
  });
});

describe('4 · CENSUS — every contract a lane asks for passes through the one door', () => {
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
  const all = [...sourceFiles(join(ROOT, 'src')), join(ROOT, 'server.ts')]
    .map((p) => ({ p: p.slice(ROOT.length + 1), src: readFileSync(p, 'utf8') }));
  const calls = (src: string, name: string): number => (src.match(new RegExp(`(?<!function )\\b${name}\\(`, 'g')) ?? []).length;

  it('🔒 a file that asks for a contract runs prepareSharedContract as often as it asks', () => {
    const askers = all.filter((f) => calls(f.src, 'contractSystemPrompt') > 0);
    expect(askers.map((f) => f.p).sort()).toEqual(['src/server/AgentV3/SimpleBuilder.ts', 'src/server/routes/agentv3.ts']);
    for (const f of askers) expect({ file: f.p, door: calls(f.src, 'prepareSharedContract') }).toEqual({ file: f.p, door: calls(f.src, 'contractSystemPrompt') });
  });

  it('🔒 the split and the normaliser are called only inside the door — no lane can run one and skip the other', () => {
    for (const name of ['separateTypeFromComponentNames', 'stringEnumsAsConstObjects']) {
      const sites = all.filter((f) => calls(f.src, name) > 0).map((f) => `${f.p}×${calls(f.src, name)}`);
      expect(sites).toEqual(['src/server/AgentV3/SimpleBuilder.ts×1']);
    }
    const sb = readFileSync(join(ROOT, 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');
    const door = sb.slice(sb.indexOf('export function prepareSharedContract('));
    expect(door.indexOf('separateTypeFromComponentNames(text, manifest)')).toBeGreaterThan(0);
    expect(door.indexOf('separateTypeFromComponentNames(text, manifest)')).toBeLessThan(door.indexOf('stringEnumsAsConstObjects(text)'));
  });

  it('🔒 the blueprint lane hands the architect the prepared text, renames included', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('const block = blueprintAdvisoryBlock(manifest, prepared.contract, prepared.renamed);');
  });

  it('Project Mode module contracts (no normaliser runs over them) carry the rule line', () => {
    expect(projectPlanSystemPrompt('vite-react')).toContain(`- ${CONTRACT_FIXED_VALUES_RULE}`);
    expect(CONTRACT_FIXED_VALUES_RULE).toMatch(/never an `enum`/);
  });
});
