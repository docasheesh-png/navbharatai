/**
 * Callable-context class prevention, not a replay of the historical generated app. Cutting at the
 * first `{`/`=` erased return objects, destructured arguments and arrows. Syntax owns body boundaries;
 * an inferred return must remain actual source rather than be advertised as a known type contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportSurfaceOf, scriptExportSurface, signatureDependencyContext } from '../src/server/AgentV3/exportSurface';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { fullDepsContext } from '../src/server/AgentV3/reliability/fastLaneV2';

const AUTH_SOURCE = [
  'interface User { id: string; email: string }',
  'type AuthState = { user: User | null; loading: boolean };',
  'export function useAuth(initial: User | null): AuthState & {',
  '  login: (email: string, password: string) => Promise<void>;',
  '  register: (email: string) => Promise<User>;',
  '  logout: () => void;',
  '} {',
  '  throw new Error("IMPLEMENTATION_ONLY");',
  '}',
].join('\n');

const INFERRED_SOURCE = [
  'export function useSession(initial: string | null) {',
  '  const user = initial;',
  '  const login = async (email: string) => email;',
  '  return { user, login };',
  '}',
].join('\n');

const bodyOf = (context: string) => context.match(/<<<EXPORTS [^\n]+>>>\n([\s\S]*?)\n<<<ENDEXPORTS>>>/)?.[1] ?? '';

afterEach(() => { vi.unstubAllEnvs(); });

describe('callable contracts use actual syntax, not a first-brace/equals guess', () => {
  it('preserves the complete multiline intersection return plus its non-exported type dependencies', () => {
    const out = scriptExportSurface(AUTH_SOURCE)!;
    expect(out).toContain('export function useAuth(initial: User | null): AuthState & {');
    expect(out).toContain('login: (email: string, password: string) => Promise<void>;');
    expect(out).toContain('register: (email: string) => Promise<User>;');
    expect(out).toContain('logout: () => void;\n} { … }');
    expect(out).not.toContain('IMPLEMENTATION_ONLY');
    expect(out).toContain('interface User { id: string; email: string }');
    expect(out).toContain('type AuthState = { user: User | null; loading: boolean };');
    expect(out).toContain('Local support (not an additional export)');
    expect(out.split('\n')[0]).toBe('// Exported names: useAuth');
  });

  it.each([
    'export function select<T extends { id: string } = { id: string }>({ value = { id: "}" } }: { value?: T }): { selected: T; reset: () => void } { throw "IMPL"; }',
    'export const select = <T extends { id: string }>({ value }: { value: T }): { selected: T; reset: () => void } => { throw "IMPL"; };',
    'export const select = function <T extends { id: string }>({ value }: { value: T }): { selected: T; reset: () => void } { throw "IMPL"; };',
  ])('preserves generic constraints, inline types and destructured parameters: %s', (source) => {
    const out = scriptExportSurface(source)!;
    expect(out).toContain('T extends { id: string }');
    expect(out).toContain('{ selected: T; reset: () => void }');
    expect(out).toContain('{ value');
    expect(out).not.toContain('IMPL');
  });

  it('preserves multiline arrow parameters, return annotations and expression-body signatures', () => {
    const out = scriptExportSurface([
      'export const useAuth = (',
      '  initial: { id: string } | null,',
      '  onChange?: (value: { id: string }) => void,',
      '): { user: { id: string } | null; logout: () => void } => ({ user: initial, logout() {} });',
    ].join('\n'))!;
    expect(out).toContain('initial: { id: string } | null');
    expect(out).toContain('onChange?: (value: { id: string }) => void');
    expect(out).toContain('): { user: { id: string } | null; logout: () => void } => …;');
    expect(out).not.toContain('logout() {}');
  });

  it('retains a declared callable variable type and its imported supporting type', () => {
    const out = scriptExportSurface('import type { User } from "./user";\nexport const load: <T extends User>(id: string) => Promise<T> = fetchUser;')!;
    expect(out).toContain('export const load: <T extends User>(id: string) => Promise<T> = …;');
    expect(out).toContain('import type { User } from "./user";');
    expect(out).not.toContain('fetchUser');
  });

  it('retains external import-equals support used in an exported callable contract', () => {
    const out = scriptExportSurface('import Models = require("./models"); export function load(): Models.User { throw 0; }')!;
    expect(out.split('\n')[0]).toBe('// Exported names: load');
    expect(out).toContain('export function load(): Models.User { … }');
    expect(out).toContain('import Models = require("./models");');
    expect(out).toContain('Local support (not an additional export)');
  });

  it('retains namespace import-equals aliases and their local namespace support', () => {
    const out = scriptExportSurface([
      'namespace Models { export interface User { id: string } }',
      'import User = Models.User;',
      'export function load(): User { throw 0; }',
    ].join('\n'))!;
    expect(out.split('\n')[0]).toBe('// Exported names: load');
    expect(out).toContain('import User = Models.User;');
    expect(out).toContain('namespace Models { export interface User { id: string } }');
  });

  it('records exported import-equals aliases as exports, not extra support exports', () => {
    const out = scriptExportSurface('namespace Models { export interface User { id: string } } export import User = Models.User;')!;
    expect(out.split('\n')[0]).toBe('// Exported names: User');
    expect(out).toContain('export import User = Models.User;');
    expect(out).toContain('namespace Models { export interface User { id: string } }');
  });

  it('keeps all overloads without turning the implementation into another callable overload', () => {
    const out = scriptExportSurface([
      'export function read(value: string): { text: string };',
      'export function read(value: number): { count: number };',
      'export function read(value: string | number) { return {}; }',
    ].join('\n'))!;
    expect(out).toContain('read(value: string): { text: string };');
    expect(out).toContain('read(value: number): { count: number };');
    expect(out).not.toContain('string | number');
    expect(out).not.toContain('return {}');
  });

  it.each([
    'export async function load<T>(key: T): Promise<{ key: T }> { throw "IMPL"; }',
    'export function* scan<T>(items: T[]): Generator<{ item: T }, void, unknown> { throw "IMPL"; }',
    'export async function* scan<T>(items: T[]): AsyncGenerator<{ item: T }, void, unknown> { throw "IMPL"; }',
    'export const load = async <T>(key: T): Promise<{ key: T }> => { throw "IMPL"; };',
  ])('retains async/generator syntax and complete annotated return: %s', (source) => {
    const out = scriptExportSurface(source)!;
    expect(out).toContain(source.slice(0, source.indexOf(' { throw')));
    expect(out).not.toContain('IMPL');
  });

  it.each([
    INFERRED_SOURCE,
    'export const useAuth = (initial: string | null) => { const logout = () => {}; return { user: initial, logout }; };',
    'export const useAuth = (initial: string | null) => ({ user: initial, logout: () => {} });',
  ])('keeps actual inferred source, explicitly not a complete type contract: %s', (source) => {
    const out = scriptExportSurface(source)!;
    expect(out).toContain(source);
    expect(out).toContain('Actual source; inferred shape is NOT a complete type contract');
    expect(out).not.toContain('= …;');
  });

  it('resolves local named/default export targets and aliases without advertising local support as exports', () => {
    const out = scriptExportSurface([
      'type Input = { name: string };',
      'function implementation(input: Input): { result: string } { return { result: input.name }; }',
      'const App = ({ title }: { title: string }) => title;',
      'export { implementation as publicHelper };',
      'export default App;',
    ].join('\n'))!;
    expect(out.split('\n')[0]).toBe('// Exported names: publicHelper, default');
    expect(out).toContain('export { implementation as publicHelper };');
    expect(out).toContain('function implementation(input: Input): { result: string } { … }');
    expect(out).toContain('type Input = { name: string };');
    expect(out).toContain('const App = ({ title }: { title: string }) => title;');
  });

  it('keeps re-export specifiers intact and does not mistake strings/comments/nested text for exports', () => {
    const source = [
      'const text = "export function fake(): string {";',
      '// export const Comment = 1;',
      '/* export interface Imaginary { broken: string } */',
      'export { type User, load as getUser } from "./user";',
      'export * from "./helpers";',
    ].join('\n');
    const out = scriptExportSurface(source)!;
    expect(out).toContain('export { type User, load as getUser } from "./user";');
    expect(out).toContain('export * from "./helpers";');
    expect(out).not.toContain('fake');
    expect(out).not.toContain('Comment');
    expect(out).not.toContain('Imaginary');
  });

  it('keeps multiline union/intersection/mapped types, enum values and unannotated constants intact', () => {
    const source = [
      'export type Result<T> =',
      '  | { kind: "ok"; value: T }',
      '  | { kind: "error"; message: string };',
      'export type Flags<T> = { [K in keyof T]?: boolean } & { ready: true };',
      'export enum Status { Active = "active", Closed = "closed" }',
      'export const LIMIT = 5, LABEL = "ready";',
      'export const CONFIG = { limit: LIMIT, status: Status.Active } as const;',
    ].join('\n');
    const out = scriptExportSurface(source)!;
    expect(out).toContain('| { kind: "error"; message: string };');
    expect(out).toContain('{ [K in keyof T]?: boolean } & { ready: true };');
    expect(out).toContain('Closed = "closed"');
    expect(out).toContain('export const LIMIT = 5;');
    expect(out).toContain('export const LABEL = "ready";');
    expect(out).toContain('export const CONFIG = { limit: LIMIT, status: Status.Active } as const;');
  });

  it('keeps ambient declarations, typed class methods and assertions as their actual source contracts', () => {
    const source = [
      'export declare function external({ id }: { id: string }): { found: boolean };',
      'export class Store { get(id: string): { id: string } { return { id }; } }',
      'export const make = ((id: string): { id: string } => ({ id })) satisfies (id: string) => { id: string };',
    ].join('\n');
    const out = scriptExportSurface(source)!;
    expect(out).toContain('export declare function external({ id }: { id: string }): { found: boolean };');
    expect(out).toContain('get(id: string): { id: string }');
    expect(out).toContain('satisfies (id: string) => { id: string }');
    expect(out).toContain('Actual source');
  });

  it('handles JSX and TS generic arrows using the producer filename, keeping inferred component props/source', () => {
    expect(exportSurfaceOf('App.tsx', 'export default function App({ name }: { name: string }) { return <div>{name}</div>; }'))
      .toContain('return <div>{name}</div>');
    expect(exportSurfaceOf('id.ts', 'export const id = <T>(value: T): T => value;')).toContain('<T>(value: T): T => …;');
    expect(exportSurfaceOf('id.tsx', 'export const id = <T,>(value: T): T => value;')).toContain('<T,>(value: T): T => …;');
  });
});

describe('bounded contract context stays honest and does not silently lose producers', () => {
  it('shares the budget across inferred source while preserving later declared signatures and type support', () => {
    const source = `export function useLarge() {\n${'  const item = 1;\n'.repeat(500)}  return { user: "real", login: () => true };\n}\n${AUTH_SOURCE}`;
    const context = signatureDependencyContext([{ path: 'src/hooks/auth.ts', content: source }], 1600);
    const body = bodyOf(context);
    expect(body.length).toBeLessThanOrEqual(1600);
    expect(body).toContain('// Exported names: useLarge, useAuth');
    expect(body).toContain('login: (email: string, password: string) => Promise<void>;');
    expect(body).toContain('interface User { id: string; email: string }');
    expect(body).toContain('return { user: "real", login: () => true };');
    expect(body).toContain('INCOMPLETE: context budget reached');
    expect(context).not.toContain('code against these signatures exactly as declared');
  });

  it.each([0, 1, 25, 100, 300, 4000, -1, 12.5])('never exceeds per-file cap %s, including fallback files', (cap) => {
    const context = signatureDependencyContext([
      { path: 'src/hooks/large.ts', content: `export function useLarge() {${'const a = 1;'.repeat(700)} return { user: true };}` },
      { path: 'index.html', content: '<div>real</div>'.repeat(500) },
      { path: 'src/broken.ts', content: 'export function incomplete(' },
    ], cap);
    const blocks = [...context.matchAll(/<<<EXPORTS ([^\n]+)>>>\n([\s\S]*?)\n<<<ENDEXPORTS>>>/g)];
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(block[2].length).toBeLessThanOrEqual(Math.max(0, Math.floor(cap)));
  });

  it('falls back honestly for malformed source and files beyond the parser bound', () => {
    const malformed = 'export function useBroken(';
    expect(scriptExportSurface(malformed)).toBeNull();
    expect(bodyOf(signatureDependencyContext([{ path: 'broken.ts', content: malformed }]))).toContain('Actual source fallback');
    const huge = '// pad\n'.repeat(170_000) + 'export const LAST = "real";';
    expect(scriptExportSurface(huge)).toBeNull();
    const context = signatureDependencyContext([{ path: 'huge.ts', content: huge }], 400);
    expect(bodyOf(context).length).toBeLessThanOrEqual(400);
    expect(context).toContain('complete export/type contract unavailable');
    expect(context).toContain('export const LAST = "real";');
    expect(context).toContain('INCOMPLETE');
  });

  it('retains cyclic local type support without looping or inventing exports', () => {
    const source = 'interface A { b: B }; interface B { a: A }; export function read(): A { throw 0; }';
    const out = scriptExportSurface(source)!;
    expect(out.split('\n')[0]).toBe('// Exported names: read');
    expect(out.match(/interface A/g)).toHaveLength(1);
    expect(out.match(/interface B/g)).toHaveLength(1);
  });

  it('uses a finite default for nonfinite caller budgets', () => {
    for (const cap of [NaN, Infinity, -Infinity]) {
      const context = signatureDependencyContext([{ path: 'a.ts', content: `export const DATA = "${'a'.repeat(8000)}";` }], cap);
      expect(bodyOf(context).length).toBeLessThanOrEqual(4000);
      expect(context).toContain('INCOMPLETE');
    }
  });

  it('the v2 full-dependency overflow also receives complete callable signatures via the same production helper', () => {
    const context = fullDepsContext('src/App.tsx', [{ path: 'src/hooks/auth.ts', content: AUTH_SOURCE }],
      new Map([['src/App.tsx', ['src/hooks/auth.ts']]]), 1, signatureDependencyContext);
    expect(context).toContain('<<<EXPORTS src/hooks/auth.ts>>>');
    expect(context).toContain('register: (email: string) => Promise<User>;');
  });
});

describe('runSimpleBuild actually feeds callable contracts to the later consumer call', () => {
  it('preserves annotations AND inferred hook returns in the default signature-context path', async () => {
    vi.stubEnv('AGENTV3_SIGNATURE_CONTEXT', 'on');
    vi.stubEnv('AGENTV3_FAST_LANE_V2', 'off');
    const sources: Record<string, string> = {
      'src/hooks/useAuth.ts': AUTH_SOURCE,
      'src/hooks/useSession.ts': INFERRED_SOURCE,
      'src/App.tsx': 'export default function App() { return null; }',
    };
    const prompts: Record<string, string> = {};
    const result = await runSimpleBuild({
      prompt: 'Build an account screen.', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'],
      shareContract: false,
      generate: async (_system, user) => {
        const path = user.match(/write THIS file in full:\s*\n\s*([^\n]+)/)?.[1]?.trim();
        if (!path) return Object.keys(sources).map((name) => `${name} :: module`).join('\n');
        prompts[path] = user;
        return `<<<FILE ${path}>>>\n${sources[path]}\n<<<ENDFILE>>>`;
      },
      writeFiles: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(result.filesWritten).toBe(3);
    const consumer = prompts['src/App.tsx'];
    expect(consumer).toContain('<<<EXPORTS src/hooks/useAuth.ts>>>');
    expect(consumer).toContain('login: (email: string, password: string) => Promise<void>;');
    expect(consumer).toContain('register: (email: string) => Promise<User>;');
    expect(consumer).toContain('interface User { id: string; email: string }');
    expect(consumer).toContain('return { user, login };');
    expect(consumer).toContain('inferred shape is NOT a complete type contract');
    expect(consumer).not.toContain('IMPLEMENTATION_ONLY');
  });
});
