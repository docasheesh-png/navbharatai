// Build 9762f589 (2026-09-30) — "sirf sample file bana o sales ki city wise jisme only 10 employees ho", Weak.
//  1. The plan had `src/utils/sales.ts` ("Sample sales data generation …"), the contract's helpers were
//     `generateSampleSalesData` and `aggregateCitySales`, and the lane ADDED `src/utils.ts` for them anyway —
//     two homes, two signatures, three repair passes spent on the disagreement.
//  2. The contract declared `interface CitySummary` beside `src/components/CitySummary.tsx` (TS2865), although
//     its prompt already forbids exactly that; the first repair made it a self-import.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  utilOwnerFor, helperModuleByWords, separateTypeFromComponentNames, contractNameSplitEnabled, runSimpleBuild,
} from '../src/server/AgentV3/SimpleBuilder';
import { fixTypeImportValueClash, endgameDeterministicPass, parseTscErrors } from '../src/server/AgentV3/EndgameRepair';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

// The report's manifest, verbatim (purposes as planned).
const MANIFEST = [
  { path: 'src/App.tsx', purpose: 'Main sales data display component with city grouping and employee filtering' },
  { path: 'src/utils/sales.ts', purpose: 'Sample sales data generation with 10 employees and city distribution logic' },
  { path: 'src/components/CityFilter.tsx', purpose: 'City selection dropdown component' },
  { path: 'src/components/EmployeeFilter.tsx', purpose: 'Employee selection dropdown component' },
  { path: 'src/components/SalesTable.tsx', purpose: 'Data table component for displaying sales records' },
  { path: 'src/components/CitySummary.tsx', purpose: 'City-wise sales summary component' },
  { path: 'src/index.css', purpose: 'Global styles for the application' },
  { path: 'src/main.tsx', purpose: 'Application entry point and React root mounting' },
  { path: 'index.html', purpose: 'HTML template for the Vite application' },
  { path: 'package.json', purpose: 'Project dependencies and scripts configuration' },
  { path: 'tsconfig.json', purpose: 'TypeScript compiler configuration' },
  { path: 'vite.config.ts', purpose: 'Vite build configuration' },
];
const HELPERS = ['generateSampleSalesData', 'aggregateCitySales'];

describe('1 · the helpers go to the file the plan already made for them', () => {
  it("the report's plan: src/utils/sales.ts owns them, and no second utils.ts is added", () => {
    expect(utilOwnerFor(MANIFEST, HELPERS, 'src/types.ts')).toEqual({ path: 'src/utils/sales.ts', added: false });
  });

  it('a component is never the owner, even when its purpose shares the words', () => {
    const onlyComponents = MANIFEST.filter((f) => f.path !== 'src/utils/sales.ts');
    expect(helperModuleByWords(onlyComponents, HELPERS)).toBeNull();
    expect(utilOwnerFor(onlyComponents, HELPERS, 'src/types.ts')).toEqual({ path: 'src/utils.ts', added: true });
  });

  it('one shared word is not enough, and a tie picks nobody', () => {
    expect(helperModuleByWords([{ path: 'src/lib/api.ts', purpose: 'Fetch wrapper for the city endpoint' }], HELPERS)).toBeNull();
    expect(helperModuleByWords([
      { path: 'src/data/sales.ts', purpose: 'Sample sales data' },
      { path: 'src/data/salesSeed.ts', purpose: 'Sample sales data' },
    ], HELPERS)).toBeNull();
  });

  it('never a config, entry or declaration file', () => {
    expect(helperModuleByWords([
      { path: 'vite.config.ts', purpose: 'sample sales data generation' },
      { path: 'src/main.ts', purpose: 'sample sales data generation' },
      { path: 'src/sales.d.ts', purpose: 'sample sales data generation' },
    ], HELPERS)).toBeNull();
  });

  it('a helper named in a purpose line still wins first (the earlier rule is unchanged)', () => {
    const m = [...MANIFEST, { path: 'src/lib/agg.ts', purpose: 'Implements aggregateCitySales' }];
    expect(utilOwnerFor(m, HELPERS, 'src/types.ts')).toEqual({ path: 'src/lib/agg.ts', added: false });
  });
});

// The report's contract, reduced to the declarations that matter here.
const CONTRACT = `export enum EmployeeRole { SalesExecutive = 'SalesExecutive', AreaManager = 'AreaManager' }

export interface SalesRecord { id: string; employeeName: string; city: string; amount: number; }

export interface CitySummary { cityName: string; totalSales: number; transactionCount: number; topEmployee: string; }

export interface CitySummaryProps { summary: CitySummary; }

export function generateSampleSalesData(count: number): SalesRecord[];

export function aggregateCitySales(records: SalesRecord[]): CitySummary[];`;

describe('2 · a data type never shares a component\'s name', () => {
  it("the report's contract: CitySummary becomes CitySummaryData everywhere, CitySummaryProps keeps its name", () => {
    const { contract, renamed } = separateTypeFromComponentNames(CONTRACT, MANIFEST);
    expect(renamed).toEqual([{ from: 'CitySummary', to: 'CitySummaryData' }]);
    expect(contract).toContain('export interface CitySummaryData {');
    expect(contract).toContain('export interface CitySummaryProps { summary: CitySummaryData; }');
    expect(contract).toContain('aggregateCitySales(records: SalesRecord[]): CitySummaryData[];');
    expect(contract).not.toMatch(/(?<![\w$])CitySummary(?![\w$])/);
  });

  it('nothing to rename when no type is named after a component', () => {
    const plain = CONTRACT.replace(/CitySummary\b(?!Props)/g, 'CityTotals');
    expect(separateTypeFromComponentNames(plain, MANIFEST)).toEqual({ contract: plain, renamed: [] });
  });

  it('a contract that declares the component itself under that name is left alone', () => {
    const withValue = `${CONTRACT}\nexport declare const CitySummary: (p: CitySummaryProps) => unknown;`;
    expect(separateTypeFromComponentNames(withValue, MANIFEST).renamed).toEqual([]);
  });

  it('the next free suffix is used when XData is taken', () => {
    const taken = `${CONTRACT}\nexport interface CitySummaryData { x: number }`;
    expect(separateTypeFromComponentNames(taken, MANIFEST).renamed).toEqual([{ from: 'CitySummary', to: 'CitySummaryInfo' }]);
  });

  it('AGENTV3_CONTRACT_NAME_SPLIT=off turns it off', () => {
    expect(contractNameSplitEnabled({ AGENTV3_CONTRACT_NAME_SPLIT: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(contractNameSplitEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('🔒 the lane renames right after the contract call, before the contract file is written', () => {
    const src = read('src/server/AgentV3/SimpleBuilder.ts');
    const at = src.indexOf('separateTypeFromComponentNames(contract, manifest)');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf('const mod = contractModule(contract);'));
    expect(at).toBeGreaterThan(src.indexOf("clock.contractOutcome = contract ? 'written'"));
  });
});

describe('1 + 2 through the real lane (runSimpleBuild)', () => {
  const PLAN = MANIFEST.map((f) => `${f.path} :: ${f.purpose}`).join('\n');
  const run = async () => {
    const written: Array<{ path: string; content: string }> = [];
    const logs: string[] = [];
    const filePrompts: string[] = [];
    await runSimpleBuild({
      prompt: 'sirf sample file bana o sales ki city wise jisme only 10 employees ho',
      framework: 'vite-react',
      scaffoldPaths: ['index.html', 'package.json', 'vite.config.ts', 'tsconfig.json', 'src/main.tsx', 'src/index.css', 'src/App.tsx'],
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return PLAN;
        if (user.includes('Design the shared contract')) return CONTRACT;
        filePrompts.push(user);
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nexport default function X() { return null; }\n<<<ENDFILE>>>`;
      },
      writeFiles: async (f) => { written.push(...f); },
      log: (m) => logs.push(m),
    });
    return { written, logs, filePrompts };
  };

  it('the contract file declares CitySummaryData, and the lane says so', async () => {
    const { written, logs } = await run();
    const types = written.find((f) => f.path === 'src/types.ts');
    expect(types?.content).toContain('export interface CitySummaryData {');
    expect(types?.content).not.toMatch(/interface CitySummary\s*\{/);
    expect(logs.some((l) => l.includes('CitySummary → CitySummaryData'))).toBe(true);
  });

  it('no second helper home is added, and sales.ts is told it owns the helpers', async () => {
    const { written, logs, filePrompts } = await run();
    expect(written.some((f) => f.path === 'src/utils.ts')).toBe(false);
    expect(logs.some((l) => l.includes('had no file to live in'))).toBe(false);
    const sales = filePrompts.find((p) => /write THIS file in full:\s*\n\s*src\/utils\/sales\.ts/.test(p));
    expect(sales).toContain('generateSampleSalesData');
    expect(sales).toContain('are implemented and exported by src/utils/sales.ts');
  });
});

// The report's file and compiler line, verbatim.
const CITY_SUMMARY_TSX = `import React from 'react';
import { CitySummary } from '../types';

interface CitySummaryProps {
  summary: CitySummary;
}

const CitySummary: React.FC<CitySummaryProps> = ({ summary }) => {
  return <div className="card">{summary.cityName}</div>;
};

export default CitySummary;`;
const TSC = "src/components/CitySummary.tsx(2,10): error TS2865: Import 'CitySummary' conflicts with local value, so must be declared with a type-only import when 'isolatedModules' is enabled.";

describe('3 · the compiler\'s own fix for TS2865 is applied without a model', () => {
  it("the report's file: the import becomes type-only, nothing else changes", () => {
    const { files, fixed } = fixTypeImportValueClash({ 'src/components/CitySummary.tsx': CITY_SUMMARY_TSX }, parseTscErrors(TSC));
    expect(fixed).toHaveLength(1);
    expect(files['src/components/CitySummary.tsx']).toBe(CITY_SUMMARY_TSX.replace("import { CitySummary } from '../types';", "import type { CitySummary } from '../types';"));
  });

  it('with other specifiers, only the clashing one is marked type', () => {
    const src = CITY_SUMMARY_TSX.replace("import { CitySummary } from '../types';", "import { EmployeeRole, CitySummary } from '../types';");
    const { files } = fixTypeImportValueClash({ 'src/components/CitySummary.tsx': src }, parseTscErrors(TSC));
    expect(files['src/components/CitySummary.tsx']).toContain("import { EmployeeRole, type CitySummary } from '../types';");
  });

  it('an import it cannot match with certainty is left to the model', () => {
    const twice = CITY_SUMMARY_TSX.replace("import { CitySummary } from '../types';", "import { CitySummary } from '../types';\nimport { CitySummary } from './other';");
    expect(fixTypeImportValueClash({ 'src/components/CitySummary.tsx': twice }, parseTscErrors(TSC)).fixed).toEqual([]);
  });

  it('🔒 the shared deterministic pass runs it (both lanes call that pass)', async () => {
    const r = await endgameDeterministicPass({ 'src/components/CitySummary.tsx': CITY_SUMMARY_TSX }, parseTscErrors(TSC));
    expect(r.changedPaths).toContain('src/components/CitySummary.tsx');
    expect(r.files['src/components/CitySummary.tsx']).toContain("import type { CitySummary } from '../types';");
  });
});
