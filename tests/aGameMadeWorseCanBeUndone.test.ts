// A CHANGE THAT MADE THE GAME WORSE CAN BE UNDONE IN ONE TAP (admin 2026-11-21: "savdhani se on karo … user se hi pucho …
// agar game tut jaye to user ek prompt se wapas undo ho jaye"). Fixing stays the user's choice (the one-tap "Make the game
// playable" offer); the automatic repair stays suspended; and every turn on a measured game is compared with the game as
// it was measured before — a turn that made it worse ends with a plain sentence and a one-tap "Go back" to the saved
// version from just before it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { gameMeasureFromIssues, gameGotWorse, versionBeforeTurn, gameUndoMessage, UNPLAYABLE } from '../src/server/AgentV3/gameRegression';
import { HARD_DEFECTS, gameAutoRepairEnabled } from '../src/server/AgentV3/gameRepair';
import { buildFindingSuggestions, APP_FINDINGS_WITHOUT_AN_OFFER } from '../src/server/AgentV3/buildFindingSuggestions';
import { GameUndoCard, gameUndoOffer } from '../src/components/agentv3/GameUndoCard';

const report = (score: number | null, defects: string[] = [], code = 'GAME_PLAYTEST_ISSUES') => [
  { code, message: score === null ? 'The game was played.' : `Game Quality Score ${score}/100 (Runs 100 · Controls 80) — played in a real browser.` },
  ...(defects.length ? [{ code: 'GAME_DEFECTS', message: `Game defects measured (evidence, not a gate): ${defects.map((d) => `${d} — x`).join('; ')}.` }] : []),
];

describe('🎮 the game as measured before and after a turn', () => {
  it('reads the measure from a stored report, and nothing from a report where the game was never played', () => {
    expect(gameMeasureFromIssues(report(88))).toEqual({ score: 88, defects: [] });
    expect(gameMeasureFromIssues(report(40, ['GAME_DEFECT_NO_TOUCH', 'GAME_DEFECT_SILENT']))).toEqual({ score: 40, defects: ['GAME_DEFECT_NO_TOUCH', 'GAME_DEFECT_SILENT'] });
    expect(gameMeasureFromIssues([{ code: 'GAME_PLAYTEST_NOT_RUN', message: 'never played' }])).toBeNull();
    expect(gameMeasureFromIssues(null)).toBeNull();
    expect(gameMeasureFromIssues([{ code: 'TSC_OK', message: '' }])).toBeNull();
  });

  it('a new problem that makes it unplayable is "worse", named in plain words', () => {
    const before = { score: 90, defects: [] };
    expect(gameGotWorse(before, { score: 30, defects: ['GAME_DEFECT_INPUT_IGNORED'] })).toBe('the controls no longer do anything');
    expect(gameGotWorse(before, { score: 0, defects: ['GAME_DEFECT_BLANK', 'GAME_DEFECT_RUNTIME_ERROR'] })).toBe('the game screen is blank; the game now hits an error while it is played');
  });

  it('a big drop below the playable line is worse; a small dip, an improvement or an already-broken game is not', () => {
    expect(gameGotWorse({ score: 92, defects: [] }, { score: 60, defects: [] })).toBe('its play score fell from 92 to 60 out of 100');
    expect(gameGotWorse({ score: 92, defects: [] }, { score: 80, defects: [] })).toBeNull();         // still playable
    expect(gameGotWorse({ score: 95, defects: [] }, { score: 78, defects: [] })).toBeNull();         // a big drop, still playable
    expect(gameGotWorse({ score: 70, defects: [] }, { score: 62, defects: [] })).toBeNull();         // small dip
    expect(gameGotWorse({ score: 40, defects: ['GAME_DEFECT_NO_TOUCH'] }, { score: 85, defects: [] })).toBeNull();
    expect(gameGotWorse({ score: 10, defects: ['GAME_DEFECT_BLANK'] }, { score: 10, defects: ['GAME_DEFECT_BLANK'] })).toBeNull();
    expect(gameGotWorse(null, { score: 0, defects: ['GAME_DEFECT_BLANK'] })).toBeNull();           // nothing to compare with
    expect(gameGotWorse({ score: 90, defects: [] }, { score: 85, defects: ['GAME_DEFECT_SILENT'] })).toBeNull(); // a soft defect
  });

  it('"unplayable" is exactly the repair module\'s hard defects (one meaning, not two lists that drift)', () => {
    expect([...UNPLAYABLE].sort()).toEqual([...HARD_DEFECTS].sort());
  });

  it('the version to go back to is the newest good one saved before the turn began', () => {
    const start = Date.parse('2026-11-21T10:00:00Z');
    const versions = [
      { id: 'v_3', createdAt: '2026-11-21T10:05:00Z', ok: true },   // this turn's own (after it started)
      { id: 'v_2', createdAt: '2026-11-21T09:58:00Z', ok: false },  // a failed build
      { id: 'v_1', createdAt: '2026-11-21T09:50:00Z', ok: true },
      { id: 'v_0', createdAt: '2026-11-21T09:00:00Z', ok: true },
    ];
    expect(versionBeforeTurn(versions, start)).toBe('v_1');
    expect(versionBeforeTurn([], start)).toBeNull();
    expect(versionBeforeTurn(null, start)).toBeNull();
    expect(gameUndoMessage('the controls no longer do anything')).toMatch(/^This change made your game worse: the controls no longer do anything\. You can go back/);
  });
});

describe('🎮 the one-tap Go back', () => {
  const finding = (detail: string, extra: object = {}) => ({ issues: [{ code: 'GAME_GOT_WORSE', message: gameUndoMessage('the game screen is blank'), detail, ...extra }] });

  it('the card reads the offer from the finished build\'s report, and only a version id the server minted', () => {
    expect(gameUndoOffer(finding('v_1795000000000_ab12c'))).toEqual({ versionId: 'v_1795000000000_ab12c', message: gameUndoMessage('the game screen is blank') });
    expect(gameUndoOffer(finding('../../etc'))).toBeNull();
    expect(gameUndoOffer(finding(''))).toBeNull();
    expect(gameUndoOffer(finding('v_1795000000000_ab12c', { autoResolved: true }))).toBeNull();
    expect(gameUndoOffer({ issues: [] })).toBeNull();
    expect(gameUndoOffer(undefined)).toBeNull();
  });

  it('shows the sentence, a Go back button and a way to keep the new version', () => {
    const html = renderToStaticMarkup(createElement(GameUndoCard, {
      offer: { versionId: 'v_1_abcde', message: 'This change made your game worse: the game screen is blank.' },
      workspaceId: 'ws1', onRestored: () => undefined, onDismiss: () => undefined,
    }));
    expect(html).toMatch(/This change made your game worse: the game screen is blank\./);
    expect(html).toMatch(/Go back/);
    expect(html).toMatch(/Keep this version/);
  });

  it('it restores through the Time Machine\'s own route, which saves the current app first', () => {
    const card = readFileSync(join(__dirname, '../src/components/agentv3/GameUndoCard.tsx'), 'utf8');
    expect(card).toMatch(/fetch\('\/api\/agentv3\/restore-version'/);
    expect(card).toMatch(/versionId: offer\.versionId/);
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/savedBefore = await buildHistoryStore\.save\(historyKey/);   // the existing "save current first"
  });
});

describe('🎮 the build route and the screen', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  it('reads the previous report BEFORE this turn\'s diagnostics exist (their first save overwrites it)', () => {
    const read = route.indexOf('const previousReportAtStart = loadDiagnostics(workspaceId)');
    const diag = route.indexOf('const buildDiag = new BuildDiagnostics({');
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(diag);
  });

  it('after the playtest it compares, finds the version before the turn, and records the offer with that version', () => {
    expect(route).toMatch(/gameGotWorse\(before, \{ score: verdict\.score\?\.overall \?\? null, defects: measured\.map\(\(d\) => d\.code\) \}\)/);
    expect(route).toMatch(/versionBeforeTurn\(versions, buildStartedAt\)/);
    expect(route).toMatch(/code: 'GAME_GOT_WORSE', message: gameUndoMessage\(worse\), detail: versionId, autoResolved: false/);
  });

  it('the panel shows the card for a finished build carrying the offer', () => {
    const panel = readFileSync(join(__dirname, '../src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    expect(panel).toMatch(/gameUndoOffer\(state\.diagnostics/);
    expect(panel).toMatch(/<GameUndoCard/);
  });

  it('the finding has its home (answered by the card, never a prompt), and the hidden automatic repair stays off', () => {
    expect(APP_FINDINGS_WITHOUT_AN_OFFER.has('GAME_GOT_WORSE')).toBe(true);
    expect(buildFindingSuggestions([{ code: 'GAME_GOT_WORSE', severity: 'warning', message: 'x' }])).toEqual([]);
    expect(gameAutoRepairEnabled({ AGENTV3_GAME_AUTO_REPAIR: 'on' } as NodeJS.ProcessEnv)).toBe(false);
  });
});
