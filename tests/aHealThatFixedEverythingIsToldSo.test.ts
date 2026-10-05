/**
 * 🩹 A HEAL THAT FIXED EVERYTHING THE APP HAS MUST BE TOLD SO — Q-105's unhunted sibling.
 *
 * Queue row Q-105 read *"post-build gates judge files the entry never imports (no reachability)"* and
 * called the import closure a MISSING subsystem. Reading the code says that is no longer true:
 * `appReachability.ts` shipped on 2026-09-17 with autopsy e706e068, and the build route filters four
 * scans through it. **The row is stale in its premise — and stale in a way that hid a live defect.**
 *
 * Because the filter was never given a NAME, it was re-spelled at each of those four call sites as a
 * chained `.filter((x) => !isUnreachable(dispatcher.lastReachability, x.file))`. Four remembered it.
 * The fifth reader — the incomplete-code heal's RE-JUDGE, fourteen lines below its own filtered input —
 * did not:
 *
 *     const stubs = highSeverityAuthenticityIssues(written).filter(…not unreachable…);   // input  ✅
 *     const healed = await completeRunner.run(authenticityRepairInstruction(stubs));
 *     const after  = highSeverityAuthenticityIssues(written);                            // verdict ❌
 *     if (after.length === 0) { … INCOMPLETE_CODE_HEALED … readiness recovery … }
 *
 * **What that costs the user, and it is the whole e706e068 harm again.** One stub in a stray file
 * nothing imports keeps `after.length > 0` for ever. So on exactly the build that autopsy was written
 * about — a batch repair leaving `App.tsx` and `hooks/useStudents.ts` at the project root — the heal
 * completes every stub the app actually HAS, and then:
 *   • `INCOMPLETE_CODE_HEALED` is never recorded (the engine lies about its own success), and
 *   • the readiness recovery sits INSIDE that same `if`, so the build stays **NOT-ready** and
 *     GreenGuard restores it — a failed build over a file the browser never loads.
 *
 * 🔑 THE 50/50 HALF — why the branch could exist at all. "The findings about files the app loads" had
 * no name, and an unnamed idea is re-spelled, and a spelling can be forgotten while the unfiltered
 * scan answers cheerfully. `loadedFindings` is that name, and the census below fails when a new reader
 * asks the other question — so the wrong branch cannot come back by being forgotten.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { computeReachability, loadedFindings, splitByReachability } from '../src/server/AgentV3/appReachability';

/** The e706e068 shape: the real app under src/, plus the stray copies a batch repair wrote at the root. */
const SCHOOL_ERP = [
  { path: 'index.html', content: '<script type="module" src="/src/main.tsx"></script>' },
  { path: 'src/main.tsx', content: "import App from './App';" },
  { path: 'src/App.tsx', content: "import { useStudents } from './hooks/useStudents';" },
  { path: 'src/hooks/useStudents.ts', content: 'export const useStudents = () => ({ students: [] });' },
  // The strays. Nothing imports them; `npm run build` never bundles them.
  { path: 'App.tsx', content: 'export default function App() { return null; }' },
  { path: 'hooks/useStudents.ts', content: 'throw new Error("Not implemented");' },
];

const REACH = computeReachability(SCHOOL_ERP, { framework: 'vite-react' });

describe('🩹 loadedFindings — one name for "the findings about files the app loads"', () => {
  it('is applicable on the autopsy\'s own file set', () => {
    expect(REACH.applicable).toBe(true);
    expect(REACH.unreachable).toContain('hooks/useStudents.ts');
    expect(REACH.unreachable).toContain('App.tsx');
    expect(REACH.unreachable).not.toContain('src/App.tsx');
  });

  it('drops a stub in a file the app never loads — the heal\'s verdict, now asked correctly', () => {
    // What the RE-JUDGE saw before the fix: one stub, in the stray. So the heal "failed" for ever.
    const afterTheHeal = [{ file: 'hooks/useStudents.ts', line: 1, snippet: 'throw new Error("Not implemented")' }];
    expect(afterTheHeal).toHaveLength(1);
    expect(loadedFindings(afterTheHeal, REACH)).toEqual([]);
  });

  it('keeps every finding about a file the app does load', () => {
    const real = [{ file: 'src/hooks/useStudents.ts' }, { file: 'src/App.tsx' }];
    expect(loadedFindings(real, REACH)).toHaveLength(2);
  });

  it('keeps a finding that names no file — it cannot be placed, so it is never dismissed', () => {
    expect(loadedFindings([{ file: null }, {}], REACH)).toHaveLength(2);
  });

  it('keeps EVERYTHING when the question could not be answered — today\'s behaviour, never a demotion', () => {
    const notApplicable = computeReachability(SCHOOL_ERP, { framework: 'nextjs' });
    expect(notApplicable.applicable).toBe(false);
    expect(loadedFindings([{ file: 'hooks/useStudents.ts' }], notApplicable)).toHaveLength(1);
    expect(loadedFindings([{ file: 'hooks/useStudents.ts' }], null)).toHaveLength(1);
  });

  it('is exactly the `loaded` half of the split the readiness gate already uses — not a second answer', () => {
    const findings = [{ file: 'src/App.tsx' }, { file: 'App.tsx' }, { file: null }];
    expect(loadedFindings(findings, REACH)).toEqual(splitByReachability(findings, REACH).loaded);
  });

  it('never throws on rubbish', () => {
    expect(loadedFindings(null, REACH)).toEqual([]);
    expect(loadedFindings(undefined, null)).toEqual([]);
  });
});

/**
 * THE CENSUS. The decision this fixes is inline in the build route's handler and cannot be called from
 * a test, so what is locked here is the SHAPE: every reader of these scans in the route asks the one
 * named question. A new call site that chains its own filter — or forgets one — fails this.
 */
describe('🔒 every reader of a post-build scan in the build route asks the ONE named question', () => {
  const ROUTE = fs.readFileSync(path.join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  /** The scans whose findings are about a FILE, so reachability applies to each of them. */
  const SCANS = ['highSeverityAuthenticityIssues', 'simulatedDataIssues', 'simulatedResultIssues', 'findFakeFeatures'];

  it('wraps every one of them in loadedFindings(…)', () => {
    const unwrapped: string[] = [];
    let calls = 0;
    for (const scan of SCANS) {
      const re = new RegExp(`\\b${scan}\\s*\\(`, 'g');
      for (let m = re.exec(ROUTE); m; m = re.exec(ROUTE)) {
        if (m.index > 0 && /[\w.]/.test(ROUTE[m.index - 1])) continue; // part of a longer name
        const before = ROUTE.slice(Math.max(0, m.index - 60), m.index);
        if (/^import\s|from '/.test(ROUTE.slice(Math.max(0, m.index - 200), m.index).split('\n').pop() ?? '')) continue;
        calls++;
        if (!/loadedFindings\($/.test(before)) {
          unwrapped.push(`${scan} at offset ${m.index}: …${before.slice(-40)}`);
        }
      }
    }
    // Five readers: the heal's input, the heal's RE-JUDGE, the fake-feature scan, and the two
    // simulated-content disclosures. If this number moves, a reader was added — wrap it or argue it.
    expect(calls).toBe(5);
    expect(unwrapped).toEqual([]);
  });

  it('the heal asks it TWICE — once for what to fix, once for whether it is fixed', () => {
    // The asymmetry was the whole defect: the second reader must be the same question as the first.
    const asked = ROUTE.match(/loadedFindings\(\s*highSeverityAuthenticityIssues\(/g) ?? [];
    expect(asked).toHaveLength(2);
  });

  it('no reader spells the question by hand any more', () => {
    // The four chained `.filter((x) => !isUnreachable(…))` copies are what let the fifth be forgotten.
    expect(ROUTE).not.toMatch(/!isUnreachable\(dispatcher\.lastReachability/);
  });
});
