// 🔴 Q-2915 (failedbr #2475, aba63ead): "Move to Mumbai" was COVERED — "button.absolute is on top of it". That name
// (tag + first class) fits dozens of elements, so the 150 s repair spent its budget hunting through five files and was
// undone. The explorer now records the coverer's fingerprint and the platform finds it in the source.
// Reversion: drop the `located` sentence from explorerRepairFindings, or the coverer from parseExploreOutput, and this fails.
import { describe, it, expect } from 'vitest';
import { locateCoveringElement, covererLocationSentence } from '../src/server/AgentV3/coveringElementSource';
import { explorerRepairFindings } from '../src/server/AgentV3/explorerRepair';
import { parseExploreOutput, EXPLORE_RESULT_MARKER, type PressResult } from '../src/server/AgentV3/clickExplorer';

const FILES: Record<string, string> = {
  'src/components/WorldMap.tsx': [
    'export function WorldMap({ cities, onMove }) {',
    '  return (<div className="relative w-full h-full">',
    '    {cities.map((c) => <button key={c.id} className="absolute px-2 py-1 bg-white/80 rounded" onClick={() => onMove(c)}>Move to {c.name}</button>)}',
    '  </div>);',
    '}',
  ].join('\n'),
  'src/components/BattlegroundGame.tsx': [
    'export function BattlegroundGame({ onEnter }) {',
    '  return (<div className="relative">',
    '    <button className="absolute bottom-8 left-1/2 -translate-x-1/2 enter-cta bg-orange-500" onClick={onEnter}>Enter Battleground</button>',
    '  </div>);',
    '}',
  ].join('\n'),
};

describe('the covering element is found in the source', () => {
  it('by its visible text and its distinctive classes — the #2475 shape', () => {
    const locs = locateCoveringElement({ name: 'button.absolute', tag: 'button', text: 'Enter Battleground', classes: ['absolute', 'bottom-8', 'left-1/2', '-translate-x-1/2', 'enter-cta', 'bg-orange-500'] }, FILES);
    expect(locs[0]).toMatchObject({ path: 'src/components/BattlegroundGame.tsx', line: 3 });
    expect(covererLocationSentence(locs)).toMatch(/src\/components\/BattlegroundGame\.tsx:3/);
  });

  it('generic utility classes alone name nothing (a wrong place is worse than none)', () => {
    expect(locateCoveringElement({ name: 'button.absolute', classes: ['absolute', 'rounded', 'px-2'] }, FILES)).toEqual([]);
  });

  it('an ambiguous fingerprint names nothing', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 6; i++) many[`src/C${i}.tsx`] = '<button className="cta-x cta-y">Go</button>';
    expect(locateCoveringElement({ classes: ['cta-x', 'cta-y'], text: 'Go' }, many)).toEqual([]);
  });
});

describe('the repair is told where to start', () => {
  const covered: PressResult = {
    label: 'Move to Mumbai', tag: 'button', verdict: 'covered', note: 'it cannot be pressed: button.absolute is on top of it',
    errors: [], changed: false,
    coverer: { name: 'button.absolute', classes: ['absolute', 'bottom-8', 'enter-cta', 'bg-orange-500'], text: 'Enter Battleground', ariaLabel: '', tag: 'button' },
  };

  it('a covered finding carries file:line when the files are known', () => {
    const [f] = explorerRepairFindings([covered], FILES);
    expect(f).toMatch(/most likely at src\/components\/BattlegroundGame\.tsx:3/);
  });

  it('without files (or without a fingerprint) it reads exactly as before', () => {
    const [before] = explorerRepairFindings([covered]);
    expect(before).not.toMatch(/most likely at/);
    const { coverer: _drop, ...plain } = covered;
    expect(explorerRepairFindings([plain as PressResult], FILES)[0]).not.toMatch(/most likely at/);
  });

  it("the explorer's output keeps the fingerprint through parsing", () => {
    const line = JSON.stringify({ type: 'press', label: 'Move to Mumbai', tag: 'button', verdict: 'covered', note: 'x', errors: [], changed: false,
      coverer: { name: 'button.absolute', classes: ['absolute', 'enter-cta'], text: 'Enter Battleground', ariaLabel: '', tag: 'button' } });
    const marker = EXPLORE_RESULT_MARKER;
    const run = parseExploreOutput([`${marker}${JSON.stringify({ type: 'summary', loaded: true, note: '', found: 1, chosen: 1, skipped: [] })}`, `${marker}${line}`].join('\n'));
    expect(run.presses[0]?.coverer?.text).toBe('Enter Battleground');
  });
});
