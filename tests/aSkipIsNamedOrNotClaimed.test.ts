// BR1960 (report 1946f797, 2026-11-08) — EXPLORE_NOTHING_TO_PRESS said "No control on the home screen was
// safe to press (2 found, all deliberately skipped)" and recorded NO detail: both controls had been dropped
// silently (hidden / disabled / overlay / our badge / repeat) before any safety reason was considered.
// The class: a sentence that claims a reason must have recorded one. Admin-only text — the user card for
// 'nothing' is empty and stays empty; codes, outcomes and gates are unchanged.
import { describe, it, expect } from 'vitest';
import {
  parseExploreOutput, summarizeExplore, exploreUserSummary, clickExplorerScript, EXPLORE_RESULT_MARKER, droppedPhrases,
} from '../src/server/AgentV3/clickExplorer';

const line = (o: object) => `${EXPLORE_RESULT_MARKER}${JSON.stringify(o)}`;

describe('a skip is named, or it is not claimed', () => {
  it('BR1960 shape: 2 found, nothing skipped for safety, both dropped → honest message and detail', () => {
    const run = parseExploreOutput(line({ type: 'summary', loaded: true, note: '', found: 2, chosen: 0, skipped: [], dropped: { hidden: 1, disabled: 1, overlay: 0, ours: 0, repeat: 0 } }));
    const v = summarizeExplore(run);
    expect(v.code).toBe('EXPLORE_NOTHING_TO_PRESS');
    expect(v.outcome).toBe('nothing');
    expect(v.message).not.toMatch(/deliberately/);
    expect(v.message).toBe('No control on the home screen could be pressed (2 found: 1 hidden or too small to press, 1 disabled (often until something is typed or chosen first)).');
    expect(v.detail).toContain('NOT CONSIDERED — 1 disabled');
    expect(exploreUserSummary(v)).toEqual({ ok: false, headline: '', steps: [] });
  });

  it('mixed: a safety skip and a repeat are both counted', () => {
    const run = parseExploreOutput(line({ type: 'summary', loaded: true, note: '', found: 3, chosen: 0, skipped: [{ label: 'Delete', why: 'could change, send or delete something' }], dropped: { repeat: 2 } }));
    expect(summarizeExplore(run).message).toBe('No control on the home screen could be pressed (3 found: 1 skipped for safety, 2 a repeat of a control already counted).');
  });

  it('the parser never trusts junk counts', () => {
    const run = parseExploreOutput(line({ type: 'summary', loaded: true, found: 1, chosen: 0, skipped: [], dropped: { hidden: -4, disabled: 'x', ours: 1.7 } }));
    expect(run.summary?.dropped).toEqual({ hidden: 0, disabled: 0, overlay: 0, ours: 1, repeat: 0 });
    expect(droppedPhrases(undefined)).toEqual([]);
  });

  it('the in-page collector reports drops on the summary line', () => {
    // Syntax of the generated module is covered by theAppIsPressedNotOnlyPainted's `node --check` test.
    const src = clickExplorerScript('http://127.0.0.1:5173/', { blockWrites: false });
    for (const k of ['hidden', 'disabled', 'overlay', 'ours', 'repeat']) expect(src).toContain(`dropped.${k}++`);
    expect(src).toContain('dropped: plan.dropped');
  });
});

describe('🔒 neighbours: older output and other verdicts are unchanged', () => {
  it('no `dropped` field (older runner) keeps the old sentence byte-for-byte', () => {
    const run = parseExploreOutput(line({ type: 'summary', loaded: true, note: '', found: 2, chosen: 0, skipped: [{ label: 'Pay', why: 'could change, send or delete something' }] }));
    expect(run.summary?.dropped).toBeUndefined();
    expect(summarizeExplore(run).message).toBe('No control on the home screen was safe to press (2 found, all deliberately skipped).');
  });

  it('all-zero drops also keep the old sentence (every one really was a safety skip)', () => {
    const run = parseExploreOutput(line({ type: 'summary', loaded: true, found: 1, chosen: 0, skipped: [{ label: 'Pay', why: 'x' }], dropped: { hidden: 0, disabled: 0, overlay: 0, ours: 0, repeat: 0 } }));
    expect(summarizeExplore(run).message).toMatch(/all deliberately skipped/);
  });

  it('chosen > 0 with no presses keeps its own sentence', () => {
    const run = parseExploreOutput(line({ type: 'summary', loaded: true, found: 2, chosen: 1, skipped: [], dropped: { hidden: 1 } }));
    expect(summarizeExplore(run).message).toBe('Controls were found but none could be pressed on a fresh load, so nothing was proven about them.');
  });

  it('a passing run is unaffected by drops except one detail line', () => {
    const run = parseExploreOutput([
      line({ type: 'summary', loaded: true, found: 3, chosen: 1, skipped: [], dropped: { ours: 1 } }),
      line({ type: 'press', label: 'Generate', tag: 'button', verdict: 'ok', note: 'the page changed', errors: [], changed: true }),
    ].join('\n'));
    const v = summarizeExplore(run);
    expect(v.code).toBe('EXPLORE_PASSED');
    expect(v.detail.split('\n')).toContain('NOT CONSIDERED — 1 our own NavBharatAI badge');
    expect(exploreUserSummary(v).ok).toBe(true);
  });
});
