// Autopsy 876afca9 (2026-09-30) — "Create a calculation app", Weak, 11 min.
//  1. The contract declared four helpers and no planned file owned them, so App.tsx imported them from
//     the types file: five tsc errors and a 241 s repair (53% of the lane).
//  2. The plan listed public/index.html beside the real root index.html; Vite served the app's module
//     as HTML ("unsupported MIME type") and two repair passes followed.
//  3. The runtime-error repair's own sentence replaced the build's summary — the user asked for a
//     calculator and was told "I removed the duplicate public/index.html".
//  4. The no-journey sentence said the fields had no id or label; they had both — the missing piece
//     was a button the check reads as submitting them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  contractUtilSignatures, utilOwnerFor, utilOwnerNote, utilOwnerPurpose, utilOwnerEnabled,
  contractModule, generationTier,
} from '../src/server/AgentV3/SimpleBuilder';
import { dropShadowingEntries, entryShadowNote, isShadowingEntryPath, entryShadowGuardEnabled } from '../src/server/AgentV3/entryShadow';
import { noJourneyReason } from '../src/server/AgentV3/journeyDerivation';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The report's contract, verbatim.
const CONTRACT = `export enum OperationType {
  Add = "add",
  Subtract = "subtract",
  Multiply = "multiply",
  Divide = "divide",
}

export interface CalculationRecord {
  id: string;
  leftOperand: number;
  rightOperand: number;
  operation: OperationType;
  result: number;
  timestamp: number;
}

export type CalculationHistory = readonly CalculationRecord[];

export interface CalculationAppProps {
  title?: string;
  maxHistory?: number;
  initialHistory?: CalculationHistory;
}

export function calculate(
  leftOperand: number,
  rightOperand: number,
  operation: OperationType,
): number;

export function isValidOperand(value: string): boolean;

export function formatResult(value: number): string;

export function generateCalculationId(): string;`;

// The report's manifest (after the boilerplate filter).
const MANIFEST = [
  { path: 'src/main.tsx', purpose: 'App entry point rendering the CalculationApp component and applying global styles' },
  { path: 'src/App.tsx', purpose: 'Main calculation application component with input fields, results display, and history' },
  { path: 'src/styles.css', purpose: 'Global CSS for layout, typography, and component styling' },
  { path: 'index.html', purpose: 'HTML document shell' },
  { path: 'public/index.html', purpose: 'Static HTML file for Vite dev server serving' },
  { path: 'vite.config.ts', purpose: 'Vite build configuration' },
  { path: 'tsconfig.json', purpose: 'TypeScript compiler configuration' },
  { path: 'package.json', purpose: 'Project dependencies and scripts' },
];

describe('1 · the contract\'s helpers get a home before file one', () => {
  it('reads the four bodiless helpers out of the report\'s contract', () => {
    expect(contractUtilSignatures(CONTRACT)).toEqual(['calculate', 'isValidOperand', 'formatResult', 'generateCalculationId']);
  });

  it('a function WITH a body is not a signature that needs a home', () => {
    expect(contractUtilSignatures('export function add(a: number, b: number): number { return a + b; }')).toEqual([]);
    expect(contractUtilSignatures('export interface X { a: number }')).toEqual([]);
  });

  it('no planned file owns them, so a utils.ts beside the contract file is added', () => {
    const names = contractUtilSignatures(CONTRACT);
    expect(utilOwnerFor(MANIFEST, names, 'src/types.ts')).toEqual({ path: 'src/utils.ts', added: true });
    expect(utilOwnerFor(MANIFEST, names, 'types.ts')).toEqual({ path: 'utils.ts', added: true });
  });

  it('a planned file that names a helper in its purpose is its owner; so is a planned utils file', () => {
    const names = contractUtilSignatures(CONTRACT);
    const withMath = [...MANIFEST, { path: 'src/math.ts', purpose: 'Pure helpers: calculate and formatResult' }];
    expect(utilOwnerFor(withMath, names, 'src/types.ts')).toEqual({ path: 'src/math.ts', added: false });
    const withUtils = [...MANIFEST, { path: 'src/utils.ts', purpose: 'Small helpers' }];
    expect(utilOwnerFor(withUtils, names, 'src/types.ts')).toEqual({ path: 'src/utils.ts', added: false });
  });

  it('no helpers, no owner', () => {
    expect(utilOwnerFor(MANIFEST, [], 'src/types.ts')).toBeNull();
  });

  it('the owner is generated in the FOUNDATION stage, before App.tsx reads its exports', () => {
    expect(generationTier('src/utils.ts')).toBe(0);
    expect(generationTier('src/App.tsx')).toBe(2);
  });

  it('the purpose names every helper, and the note tells every call where they live', () => {
    const names = contractUtilSignatures(CONTRACT);
    expect(utilOwnerPurpose(names)).toContain('calculate, isValidOperand, formatResult, generateCalculationId');
    expect(utilOwnerNote(names, 'src/utils.ts')).toContain('implemented and exported by src/utils.ts');
  });

  it('the note does not change the contract FILE — same types, no helpers', () => {
    const names = contractUtilSignatures(CONTRACT);
    const before = contractModule(CONTRACT);
    const after = contractModule(`${CONTRACT}${utilOwnerNote(names, 'src/utils.ts')}`);
    expect(after?.symbols).toEqual(before?.symbols);
    expect(after?.symbols).toEqual(['OperationType', 'CalculationRecord', 'CalculationHistory', 'CalculationAppProps']);
    expect(after?.source).not.toMatch(/function calculate/);
  });

  it('AGENTV3_UTIL_OWNER=off is the revert', () => {
    expect(utilOwnerEnabled({})).toBe(true);
    expect(utilOwnerEnabled({ AGENTV3_UTIL_OWNER: 'off' })).toBe(false);
  });

  it('the lane applies it after the contract file is decided and before the files are built', () => {
    const src = strip(read('src/server/AgentV3/SimpleBuilder.ts'));
    const owner = src.indexOf('utilOwnerFor(manifest, names,');
    expect(owner).toBeGreaterThan(src.indexOf('contractFile = { path: contractPath, content: mod.source };'));
    expect(owner).toBeLessThan(src.indexOf('Building ${manifest.length} file(s)'));
    expect(src).toContain('contract = `${contract}${utilOwnerNote(names, owner.path)}`;');
  });
});

describe('2 · a second index.html in public/ never shadows a Vite entry', () => {
  it('the report\'s plan loses public/index.html and keeps the root one', () => {
    const { kept, dropped } = dropShadowingEntries(MANIFEST, 'vite-react');
    expect(dropped).toEqual(['public/index.html']);
    expect(kept.map((f) => f.path)).toContain('index.html');
  });

  it('Create React App keeps it — there it IS the entry', () => {
    expect(isShadowingEntryPath('public/index.html', 'cra')).toBe(false);
    expect(isShadowingEntryPath('public/index.html', 'create-react-app')).toBe(false);
    expect(dropShadowingEntries(MANIFEST, 'cra').dropped).toEqual([]);
  });

  it('the full builder is told at write time, and only about that file', () => {
    expect(entryShadowNote('public/index.html', 'vite-react')).toContain('Delete public/index.html');
    expect(entryShadowNote('index.html', 'vite-react')).toBe('');
    expect(entryShadowNote('public/icon.svg', 'vite-react')).toBe('');
  });

  it('AGENTV3_ENTRY_SHADOW=off is the revert', () => {
    expect(entryShadowGuardEnabled({ AGENTV3_ENTRY_SHADOW: 'off' })).toBe(false);
    expect(entryShadowGuardEnabled({})).toBe(true);
  });

  it('both doors are wired', () => {
    expect(strip(read('src/server/AgentV3/SimpleBuilder.ts'))).toContain('dropShadowingEntries(keptBoilerplate, deps.framework)');
    expect(strip(read('src/server/AgentV3/ToolDispatcher.ts'))).toContain("entryShadowNote(p, this.framework ?? 'vite-react')");
  });
});

describe('3 · a repair on a working app keeps the build\'s own summary', () => {
  it('every heal assignment goes through adoptHealResult — only the empty-build retry replaces the result', () => {
    const route = strip(read('src/server/routes/agentv3.ts'));
    const raw = route.match(/\bresult = (?!adoptHealResult\()[A-Za-z]+( as typeof result)?;/g) ?? [];
    expect(raw).toEqual(['result = retry;']);
    expect(route).toContain('result = adoptHealResult(result, fixResult as typeof result);');
    expect(route).toContain('result = adoptHealResult(result, fix);');
  });
});

describe('4 · the no-journey sentence names the missing piece', () => {
  const APP = `export default function App() {
  const [a, setA] = useState(''); const [b, setB] = useState('');
  return (<div>
    <label htmlFor="left-operand">First number</label>
    <input id="left-operand" type="text" value={a} onChange={(e) => setA(e.target.value)} />
    <label htmlFor="right-operand">Second number</label>
    <input id="right-operand" type="text" value={b} onChange={(e) => setB(e.target.value)} />
    <button type="button" onClick={() => go()}>Calculate</button>
  </div>);
}`;
  it('addressable fields with no submit-like button say so, and do not blame the fields', () => {
    const reason = noJourneyReason({ 'src/App.tsx': APP, 'src/main.tsx': 'createRoot(el).render(<App />)' });
    expect(reason).toContain('none of its buttons reads as submitting them');
    expect(reason).not.toContain('no name, id, placeholder');
  });
});
