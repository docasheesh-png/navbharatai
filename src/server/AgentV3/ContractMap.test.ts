import { describe, it, expect } from 'vitest';
import { extractModuleContract, extractContract, contractDriftReport } from './ContractMap';

describe('extractModuleContract', () => {
  it('captures declaration exports, export lists, default, and enum members', () => {
    const c = extractModuleContract([
      'export function extractEmbedUrl(u: string): string { return u; }',
      'export const FOO = 1;',
      'export interface PlayerProps { url: string }',
      'export enum MediaType { YOUTUBE, VIMEO = "v", DIRECT }',
      'function helper(){}; export { helper as util };',
      'export default function App(){ return null }',
    ].join('\n'));
    expect(c.exports.has('extractEmbedUrl')).toBe(true);
    expect(c.exports.has('FOO')).toBe(true);
    expect(c.exports.has('PlayerProps')).toBe(true);
    expect(c.exports.has('util')).toBe(true);
    expect(c.exports.has('default')).toBe(true);
    expect([...c.enums.get('MediaType')!]).toEqual(['YOUTUBE', 'VIMEO', 'DIRECT']);
    expect(c.hasWildcard).toBe(false);
  });
  it('flags wildcard re-export', () => {
    expect(extractModuleContract("export * from './x';").hasWildcard).toBe(true);
  });
});

describe('contractDriftReport — the exact symptoms from the build report', () => {
  it('flags a named import the target does NOT export (extractVimeoEmbedUrl)', () => {
    const files = {
      'src/utils/extractEmbedUrl.ts': 'export function extractEmbedUrl(u: string){ return u; }',
      'src/components/VimeoPlayer.tsx': "import { extractVimeoEmbedUrl } from '../utils/extractEmbedUrl';\nexport default function V(){ return null }",
    };
    const r = contractDriftReport(files);
    expect(r).toBeTruthy();
    expect(r).toContain('extractVimeoEmbedUrl');
    expect(r).toContain('extractEmbedUrl'); // tells repair what IS exported
  });

  it('flags an enum member the enum does NOT declare (MediaType.YouTube vs {YOUTUBE})', () => {
    const files = {
      'src/types/media.ts': 'export enum MediaType { YOUTUBE, VIMEO }',
      'src/components/MediaPlayer.tsx': "import { MediaType } from '../types/media';\nconst x = MediaType.YouTube;\nexport default function M(){ return null }",
    };
    const r = contractDriftReport(files);
    expect(r).toBeTruthy();
    expect(r).toContain('MediaType.YouTube');
    expect(r).toContain('YOUTUBE');
  });

  it('returns null when files agree (no false positives)', () => {
    const files = {
      'src/types/media.ts': 'export enum MediaType { YOUTUBE, VIMEO }',
      'src/utils/x.ts': 'export function extractEmbedUrl(u: string){ return u; }',
      'src/components/MediaPlayer.tsx': "import { MediaType } from '../types/media';\nimport { extractEmbedUrl } from '../utils/x';\nconst x = MediaType.YOUTUBE; extractEmbedUrl('a');\nexport default function M(){ return null }",
    };
    expect(contractDriftReport(files)).toBeNull();
  });

  it('is conservative: skips external imports and wildcard-export targets', () => {
    const files = {
      'src/a.ts': "export * from './hidden';",
      'src/b.tsx': "import { Anything } from './a';\nimport { useState } from 'react';\nexport default function B(){ return null }",
    };
    // './a' uses export * (unknown surface) and 'react' is external → no drift reported.
    expect(contractDriftReport(files)).toBeNull();
  });

  it('resolves ./dir/index modules', () => {
    const files = {
      'src/lib/index.ts': 'export const helper = 1;',
      'src/App.tsx': "import { missing } from './lib';\nexport default function A(){ return null }",
    };
    const r = contractDriftReport(files);
    expect(r).toContain('missing');
  });
});

describe('extractContract', () => {
  it('keys modules by path without extension and indexes only TS/JS files', () => {
    const map = extractContract({ 'src/x.ts': 'export const a=1;', 'src/y.css': '.a{}' });
    expect(map.has('src/x')).toBe(true);
    expect(map.has('src/y')).toBe(false);
  });
});

describe('contractDriftReport — destructured exports + ambiguous same-named enums (false-positive fixes)', () => {
  it('does NOT report drift for a consumer importing a DESTRUCTURED export (Zustand/Context pattern)', () => {
    const files = {
      'src/store.ts': 'export const { useStore, StoreProvider } = createStore();',
      'src/App.tsx': "import { useStore } from './store';\nexport default function App(){ return useStore(); }",
    };
    const r = contractDriftReport(files);
    // The old parser saw store.ts as exporting "(none)" → false drift on the valid useStore import.
    expect(r === null || !/useStore.*but it exports/.test(r)).toBe(true);
  });

  it('extractModuleContract captures object AND array destructured export bindings (incl. rename)', () => {
    const c = extractModuleContract('export const { a, b: c } = x;\nexport const [ d, e ] = y;');
    for (const name of ['a', 'c', 'd', 'e']) expect(c.exports.has(name)).toBe(true);
    expect(c.exports.has('b')).toBe(false); // `b: c` binds the LOCAL name `c`, not `b`
  });

  it('does NOT report enum drift when two files declare a same-named enum with DIFFERENT members', () => {
    const files = {
      'src/user.ts': 'export enum Status { ACTIVE, INACTIVE }\nexport const u = Status.ACTIVE;',
      'src/order.ts': 'export enum Status { OPEN, CLOSED }\nexport const o = Status.OPEN;',
    };
    const r = contractDriftReport(files);
    // order.ts's valid Status.OPEN must NOT be flagged against user.ts's Status members.
    expect(r === null || !/Status\.OPEN but/.test(r)).toBe(true);
    expect(r === null || !/Status\.ACTIVE but/.test(r)).toBe(true);
  });

  it('STILL reports a genuine enum drift when the enum name is unambiguous', () => {
    const files = {
      'src/types.ts': 'export enum Color { RED, GREEN }',
      'src/App.tsx': "import { Color } from './types';\nconst c = Color.BLUE;",
    };
    const r = contractDriftReport(files);
    expect(r).toContain('Color.BLUE');
  });
});
