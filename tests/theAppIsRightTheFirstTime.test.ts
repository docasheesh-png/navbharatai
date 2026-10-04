// Autopsy a5b661c8, second half (2026-09-30) — the five things the app HEALED, and why each needed healing.
//
// The first half fixed three false readings. This half is the 50/50 law: every self-heal in that build is
// a question about why the first attempt was wrong, answered upstream so the heal never has to run.
//   1. Three CSS classes nothing defined — found only at the end, repaired inside a 63 s heal.
//   2. `scheduledDate` where the type says `scheduledAt` — tsc named the fix at both lines; five edits.
//   3. A frontend sub-agent read the 18.7 KB stylesheet six times to learn which classes existed.
//   4. `npm install @react-three/drei` → ERESOLVE (drei 10 wants fiber 9; the project has fiber 8).
//   5. "~5–11 min" for a 24.3-minute build — the first build of an app had no evidence to learn from.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { undefinedClassesInFile, undefinedClassesWriteNote, stylesheetClassBrief } from '../src/server/AgentV3/CssConsistency';
import { parseTscErrors, suggestedPropertyRenames, fixSuggestedPropertyNames, endgameDeterministicPass } from '../src/server/AgentV3/EndgameRepair';
import { writeTypecheckNote } from '../src/server/AgentV3/writeTimeTypecheck';
import { pinKnownDepsInInstallCommand, r3fRangeForReact, reactRangeOf } from '../src/server/AgentV3/DependencyAutoFix';
import { fleetHistoryFromTelemetry, fleetEtaBasisNote } from '../src/server/AgentV3/etaHistory';
import { fleetEtaLine } from '../src/server/AgentV3/progressEta';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('1 · a class nothing defines is named while the file is open', () => {
  const sheet = { 'src/index.css': '.btn { color: red } .field > label { font-weight: 600 } .nb-shell { display: grid }' };
  const screen = '<div className="nb-shell"><label className="field-label">Interests</label><button className="btn btn-danger">Remove</button></div>';

  it('the report\'s own classes are named, with the stylesheet as the fix', () => {
    const missing = undefinedClassesInFile('src/steps/PlanStep.tsx', screen, sheet);
    expect(missing).toEqual(['btn-danger', 'field-label']);
    expect(undefinedClassesWriteNote('src/steps/PlanStep.tsx', missing)).toMatch(/\.btn-danger, \.field-label[\s\S]*UNSTYLED[\s\S]*src\/index\.css/);
  });

  it('never speaks where the end-of-build check would stay silent', () => {
    expect(undefinedClassesInFile('src/X.tsx', screen, { ...sheet, 'package.json': '{"devDependencies":{"tailwindcss":"^3"}}' })).toEqual([]);
    expect(undefinedClassesInFile('src/X.tsx', screen, { 'index.html': '<link rel="stylesheet" href="https://cdn.example.com/theme.css">', ...sheet })).toEqual([]);
    expect(undefinedClassesInFile('src/X.tsx', screen, {})).toEqual([]); // no stylesheet at all
    expect(undefinedClassesInFile('src/index.css', screen, sheet)).toEqual([]); // not a screen
  });

  it('every write door hands it back (source guard)', () => {
    const d = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(d).toContain('const undefinedCss = await this.undefinedClassNotes(files);');
    expect(d).toMatch(/return hooks \+ storeLoop \+ imports \+ typecheck \+ quality \+ invented \+ undefinedCss \+ style \+ security \+ shadow(?: \+ \w+)*;/);
  });
});

describe('2 · tsc\'s own rename is applied, and said as one instruction', () => {
  const OUT = "src/steps/PostStep.tsx(2,7): error TS2561: Object literal may only specify known properties, but 'scheduledDate' does not exist in type 'Omit<Campaign, \"id\">'. Did you mean to write 'scheduledAt'?\n"
    + "src/steps/PostStep.tsx(3,22): error TS2551: Property 'scheduledDate' does not exist on type 'Campaign'. Did you mean 'scheduledAt'?\n"
    + "src/steps/DesignStep.tsx(105,14): error TS2552: Cannot find name 'CollectionScene'. Did you mean 'collection'?";
  const errs = parseTscErrors(OUT);
  const SRC = 'const x = add({\n      scheduledDate: when,\n  const t = campaign.scheduledDate;\n';

  it('only PROPERTY suggestions are taken — a name suggestion is often a missing import', () => {
    expect(suggestedPropertyRenames(errs).map((r) => `${r.from}->${r.to}`)).toEqual(['scheduledDate->scheduledAt', 'scheduledDate->scheduledAt']);
  });

  it('the rename lands at the exact positions tsc named, and nowhere else', () => {
    const r = fixSuggestedPropertyNames({ 'src/steps/PostStep.tsx': SRC }, errs);
    expect(r.files['src/steps/PostStep.tsx']).toBe(SRC.replace(/scheduledDate/g, 'scheduledAt'));
    expect(r.fixed).toHaveLength(2);
  });

  it('a stale position changes nothing', () => {
    const moved = '\n' + SRC; // every line shifted by one
    expect(fixSuggestedPropertyNames({ 'src/steps/PostStep.tsx': moved }, errs).fixed).toEqual([]);
  });

  it('the shared deterministic pass runs it before any model repair', async () => {
    const r = await endgameDeterministicPass({ 'src/steps/PostStep.tsx': SRC }, errs);
    expect(r.fixes.join(' ')).toContain("renamed 'scheduledDate' to 'scheduledAt'");
  });

  it('the write-time note asks for every occurrence in one edit', () => {
    const note = writeTypecheckNote(errs.slice(0, 2), ['src/steps/PostStep.tsx']);
    expect(note).toContain('rename EVERY `scheduledDate` to `scheduledAt` (lines 2, 3) in ONE edit');
  });
});

describe('3 · a UI sub-agent is handed the classes instead of reading the stylesheet for them', () => {
  it('the brief lists what the sheets on disk define', () => {
    const brief = stylesheetClassBrief({ 'src/index.css': '.card { } .btn-primary:hover { } @media (max-width: 600px) { .nb-shell { } }' });
    expect(brief).toContain('already defined in src/index.css');
    expect(brief).toContain('.btn-primary .card .nb-shell');
  });

  it('no sheet ⇒ no brief, never a guess', () => {
    expect(stylesheetClassBrief({})).toBe('');
    expect(stylesheetClassBrief({ 'src/index.css': 'body { margin: 0 }' })).toBe('');
  });

  it('only the roles that write screens get it (source guard)', () => {
    const d = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(d).toContain('const result = await this.spawnSubAgent(role, instruction + parallelSiblingBrief(readSiblingTasks(input)) + await this.stylesheetBriefFor(role));');
    expect(d).toContain("if (role !== 'frontend' && role !== 'designer') return '';");
  });
});

describe('4 · the React Three Fiber family follows the project\'s React', () => {
  it('the report\'s install is pinned to the pair that resolves', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18.3.1', '@react-three/fiber': '^8.17.10' } });
    expect(pinKnownDepsInInstallCommand('npm install @react-three/drei', { reactRange: reactRangeOf(pkg) })).toBe('npm install @react-three/drei@^9');
    expect(r3fRangeForReact('@react-three/fiber', '^19.0.0')).toBe('^9');
    expect(r3fRangeForReact('@react-three/drei', '^19.0.0')).toBe('^10');
  });

  it('an unknown React keeps today\'s unpinned install; an explicit version is respected', () => {
    expect(pinKnownDepsInInstallCommand('npm install @react-three/drei')).toBe('npm install @react-three/drei');
    expect(pinKnownDepsInInstallCommand('npm install @react-three/drei@9.122.0', { reactRange: '^18' })).toBe('npm install @react-three/drei@9.122.0');
  });

  it('the dispatcher reads package.json for it (source guard)', () => {
    expect(read('src/server/AgentV3/ToolDispatcher.ts')).toContain('reactRange: reactRangeOf(pinPkg)');
  });
});

describe('5 · a first build learns from the platform\'s own builds of its kind', () => {
  const days = [
    { date: '2026-09-30', byTaskType: { complex_app: { builds: 6, durationMs: 6 * 20 * 60_000 }, simple_app: { builds: 9, durationMs: 9 * 4 * 60_000 } } },
    { date: '2026-09-29', byTaskType: { complex_app: { builds: 1, durationMs: 3 * 60_000 } } }, // one build is noise
    { date: '2026-09-28', byTaskType: { complex_app: { builds: 4, durationMs: 4 * 22 * 60_000 } } },
  ];
  const complexity = { featureCount: 6, fileCount: 20 } as never;

  it('one entry per measured day, the mean of that day\'s builds of this kind', () => {
    const f = fleetHistoryFromTelemetry(days, 'complex_app', complexity);
    expect(f.history.map((h) => h.durationMs)).toEqual([20 * 60_000, 22 * 60_000]);
    expect(f.builds).toBe(10);
    expect(fleetEtaBasisNote('complex_app', f.builds, f.days)).toContain('10 builds over 2 days');
  });

  it('no task type, or no measured day, is no evidence', () => {
    expect(fleetHistoryFromTelemetry(days, undefined, complexity).history).toEqual([]);
    expect(fleetHistoryFromTelemetry(days, 'game', complexity).history).toEqual([]);
  });

  it('the user is told whose builds the figure comes from', () => {
    expect(fleetEtaLine({ estimateMs: 21 * 60_000, lowMs: 15 * 60_000, highMs: 27 * 60_000 }, 10)).toMatch(/10 recent builds of this kind of app took on NavBharatAI[\s\S]*your app's own figure/);
  });

  it('the app\'s own history still wins (source guard)', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain('const est = estimateBuildTime(etaComplexity, past.length > 0 ? past : fleet.history);');
  });
});
