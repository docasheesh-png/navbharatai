/**
 * A REPAIR MAY FIX FILES; IT MAY NOT ADD STRAY ONES (autopsy e706e068, School ERP, 2026-09-17).
 *
 * The real app lived under `src/` and was rendering in a real browser. Inside the batch repair's
 * window three files appeared at the project ROOT — `App.tsx`, `hooks/useStudents.ts`,
 * `types/student.ts` — named in none of the model's tool calls. The batch call had been handed
 * `src/App.tsx` and returned its content under `App.tsx`; the loop wrote whatever path came back.
 * Nothing imported the copies, so the app kept working, while the readiness gate read the whole
 * tree, found an unresolved import and placeholder data in the strays, and made a working app free.
 *
 * This file replays that exact shape against `runEndgameRepair` and pins the three admissible
 * cases of `resolveRepairTarget`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  runEndgameRepair,
  resolveRepairTarget,
  referencedMissingModules,
  parseTscErrors,
} from '../src/server/AgentV3/EndgameRepair';

const PROJECT: Record<string, string> = {
  'index.html': '<script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': `import App from './App';\nexport const boot = App;`,
  'src/App.tsx': `import { TransportRequest } from './components/TransportRequest';\nexport default function App() { return TransportRequest; }`,
  'src/hooks/useStudents.ts': `export function useStudents() { return [1, 2, 3]; }\n// ${'real code\n'.repeat(10)}`,
};

// The error the School ERP build carried into its batch repair, byte-shape from the report.
const TSC = `src/App.tsx(1,30): error TS2307: Cannot find module './components/TransportRequest' or its corresponding type declarations.`;

describe('the e706e068 batch repair, replayed', () => {
  it('writes the repaired files to the files that were being repaired — never to the root', async () => {
    const outputs = [TSC, ''];
    const llm = vi.fn(async () => [
      // The `src/` prefix dropped in transit — exactly the report's stray `App.tsx`.
      { path: 'App.tsx', content: `export default function App() { return null; } // repaired` },
      { path: 'hooks/useStudents.ts', content: `export function useStudents() { return []; } // repaired` },
      // A brand-new file at a path nothing imports: the report's stray `types/student.ts`.
      { path: 'types/student.ts', content: `export interface Student { id: string }` },
      // The one new file the app already IMPORTS (TS2307 above) — completing the app, not littering it.
      { path: 'src/components/TransportRequest.tsx', content: `export const TransportRequest = 'ok';` },
    ]);
    const writes: string[] = [];
    const logs: string[] = [];
    const v = await runEndgameRepair({
      runTsc: async () => outputs.shift() ?? '',
      readFiles: async () => ({ ...PROJECT }),
      writeFile: async (p) => { writes.push(p); },
      llmRepair: llm,
      log: (m) => logs.push(m),
    });
    expect(writes.sort()).toEqual(['src/App.tsx', 'src/components/TransportRequest.tsx', 'src/hooks/useStudents.ts']);
    // Not one of the report's three strays exists after the pass.
    expect(writes).not.toContain('App.tsx');
    expect(writes).not.toContain('hooks/useStudents.ts');
    expect(writes).not.toContain('types/student.ts');
    expect(v.llmFilesWritten).toBe(3);
    expect(v.llmFilesRejected).toBe(1);
    // The admin can see WHAT was refused and WHY, and the remap is named too.
    expect(logs.some((l) => l.includes('types/student.ts') && /not written/.test(l))).toBe(true);
    expect(logs.some((l) => l.includes("'App.tsx'") && l.includes("'src/App.tsx'"))).toBe(true);
  });

  it('a pass with nothing rejected carries no llmFilesRejected field (the verdict shape is unchanged)', async () => {
    const outputs = [TSC, ''];
    const v = await runEndgameRepair({
      runTsc: async () => outputs.shift() ?? '',
      readFiles: async () => ({ ...PROJECT }),
      writeFile: async () => {},
      llmRepair: async () => [{ path: 'src/App.tsx', content: 'export default function App() { return null; }' }],
    });
    expect(v.llmFilesWritten).toBe(1);
    expect('llmFilesRejected' in v).toBe(false);
  });
});

describe('referencedMissingModules — the imports the compile errors say are missing', () => {
  it('resolves a relative TS2307 specifier against the importing file, without an extension', () => {
    const set = referencedMissingModules(parseTscErrors(TSC));
    expect([...set]).toEqual(['src/components/TransportRequest']);
  });

  it('walks `../` and ignores package specifiers and other error codes', () => {
    const errs = parseTscErrors([
      `src/pages/Home.tsx(1,1): error TS2307: Cannot find module '../lib/api' or its corresponding type declarations.`,
      `src/pages/Home.tsx(2,1): error TS2307: Cannot find module 'react-router-dom' or its corresponding type declarations.`,
      `src/pages/Home.tsx(3,1): error TS2305: Module '"./x"' has no exported member 'Y'.`,
    ].join('\n'));
    expect([...referencedMissingModules(errs)]).toEqual(['src/lib/api']);
  });
});

describe('resolveRepairTarget — the three admissible cases, and everything else rejected', () => {
  const files = { 'src/App.tsx': 'a', 'src/hooks/useStudents.ts': 'b', 'src/a/App.tsx': 'c', 'src/b/App.tsx': 'd' };

  it('an existing path is written as itself', () => {
    expect(resolveRepairTarget('src/App.tsx', files, new Set())).toEqual({ target: 'src/App.tsx', how: 'existing' });
    expect(resolveRepairTarget('./src/App.tsx', files, new Set())).toEqual({ target: 'src/App.tsx', how: 'existing' });
  });

  it('a dropped prefix that names exactly ONE file by its tail is remapped to that file', () => {
    expect(resolveRepairTarget('hooks/useStudents.ts', files, new Set())).toEqual({ target: 'src/hooks/useStudents.ts', how: 'remapped' });
  });

  it('an AMBIGUOUS tail is rejected — guessing which of two files the model meant is not repairing', () => {
    // `App.tsx` ends three keys here (src/App.tsx, src/a/App.tsx, src/b/App.tsx) → no unique target.
    expect(resolveRepairTarget('App.tsx', files, new Set())).toEqual({ target: null, how: 'rejected' });
  });

  it('a new file is allowed only when the erroring code already imports it', () => {
    const referenced = new Set(['src/components/TransportRequest']);
    expect(resolveRepairTarget('src/components/TransportRequest.tsx', files, referenced)).toEqual({ target: 'src/components/TransportRequest.tsx', how: 'referenced' });
    expect(resolveRepairTarget('src/components/TransportRequest/index.tsx', files, referenced)).toEqual({ target: 'src/components/TransportRequest/index.tsx', how: 'referenced' });
    expect(resolveRepairTarget('types/student.ts', files, referenced)).toEqual({ target: null, how: 'rejected' });
  });

  it('an empty path is rejected', () => {
    expect(resolveRepairTarget('', files, new Set())).toEqual({ target: null, how: 'rejected' });
  });
});
